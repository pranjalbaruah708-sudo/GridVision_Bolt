/*
 * Temporary local helper for obtaining fresh access tokens for the Stage 2
 * validation actors. Credentials are read only from this process environment.
 */
import { createClient } from '@supabase/supabase-js';

const DEVELOPMENT_URL = 'https://eetlzxntgvjompmipprb.supabase.co';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

function client(url, anonKey) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function accessTokenFor(actor, url, anonKey) {
  const email = required(`SHIFT_TOKEN_ACTOR_${actor}_EMAIL`);
  const password = required(`SHIFT_TOKEN_ACTOR_${actor}_PASSWORD`);
  const { data, error } = await client(url, anonKey).auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    return { actor, error: error ?? new Error('No access token was returned.') };
  }
  return { actor, accessToken: data.session.access_token };
}

function sanitizedMessage(error) {
  const message = String(error?.message ?? 'Authentication failed.')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<redacted-email>')
    .replace(/\beyJ[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}\b/g, '<redacted-token>')
    .trim();
  return message || 'Authentication failed.';
}

function printFailure(actor, error) {
  console.error(`Actor ${actor} authentication failed.`);
  if (error?.name) console.error(`Name: ${error.name}`);
  if (error?.status != null) console.error(`Status: ${error.status}`);
  if (error?.code) console.error(`Code: ${error.code}`);
  console.error(`Message: ${sanitizedMessage(error)}`);
}

async function main() {
  const url = required('SHIFT_TOKEN_SUPABASE_URL');
  if (url !== DEVELOPMENT_URL) {
    throw new Error('Refusing to authenticate against a URL other than the approved GridVision development project.');
  }
  const anonKey = required('SHIFT_TOKEN_ANON_KEY');
  const results = await Promise.all(['A', 'B', 'C'].map((actor) => accessTokenFor(actor, url, anonKey)));
  const failures = results.filter((result) => result.error);
  if (failures.length) {
    for (const failure of failures) printFailure(failure.actor, failure.error);
    process.exitCode = 1;
    return;
  }

  for (const [index, actor] of ['A', 'B', 'C'].entries()) {
    console.log(`$env:SHIFT_TEST_ACTOR_${actor}_ACCESS_TOKEN = '${results[index].accessToken}'`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Token helper failed.');
  process.exitCode = 1;
});
