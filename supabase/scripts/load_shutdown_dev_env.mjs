// Legacy token-auth support retained for compatibility. Shutdown database
// authorization regression testing is superseded by the transactional SQL test
// in supabase/tests/database/shutdown_security_test.sql.
import { existsSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const shutdownDevEnvPath = fileURLToPath(
  new URL('../../.env.shutdown-dev.local', import.meta.url),
);

export function loadShutdownDevEnvironment() {
  if (existsSync(shutdownDevEnvPath)) loadEnvFile(shutdownDevEnvPath);
}

const allowedRefreshTokenVariables = new Set([
  'DEV_OPERATOR_A_REFRESH_TOKEN',
  'DEV_OPERATOR_B_REFRESH_TOKEN',
  'DEV_OFFICER_A_REFRESH_TOKEN',
  'DEV_ADMIN_REFRESH_TOKEN',
]);

export async function persistShutdownDevRefreshToken(variableName, newRefreshToken) {
  if (!allowedRefreshTokenVariables.has(variableName) || !newRefreshToken) {
    throw new Error('Invalid Shutdown DEV refresh-token persistence request');
  }

  const original = await readFile(shutdownDevEnvPath, 'utf8');
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignmentPattern = new RegExp(`^${escapedName}=[^\\r\\n]*`, 'gm');
  const matches = original.match(assignmentPattern) ?? [];
  if (matches.length > 1) throw new Error('Duplicate Shutdown DEV refresh-token variable');

  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let updated;
  if (matches.length === 1) {
    updated = original.replace(assignmentPattern, `${variableName}=${newRefreshToken}`);
  } else {
    const hasFinalNewline = original.endsWith('\n');
    const separator = original.length > 0 && !hasFinalNewline ? newline : '';
    updated = `${original}${separator}${variableName}=${newRefreshToken}${hasFinalNewline ? newline : ''}`;
  }

  const temporaryPath = join(
    dirname(shutdownDevEnvPath),
    `.${basename(shutdownDevEnvPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, updated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, shutdownDevEnvPath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error('Shutdown DEV refresh token could not be persisted safely');
  }
}

export async function createShutdownValidationActor({
  url,
  anonKey,
  label,
  expectedEmail,
  password,
  accessToken,
  refreshToken,
  refreshTokenVariable,
}) {
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  const verifyAndCreateTokenClient = async (currentAccessToken, verificationFailurePrefix) => {
    const verifier = createClient(url, anonKey, authOptions);
    const verified = await verifier.auth.getUser(currentAccessToken);
    if (verified.error || !verified.data.user) {
      const reason = verified.error?.message ?? 'No authenticated user returned';
      throw new Error(`${verificationFailurePrefix}: ${reason}`);
    }
    if ((verified.data.user.email ?? '').toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new Error(`${label} token belongs to a different user`);
    }
    const client = createClient(url, anonKey, {
      ...authOptions,
      global: { headers: { Authorization: `Bearer ${currentAccessToken}` } },
    });
    return { client, user: verified.data.user };
  };

  if (refreshToken) {
    const refresher = createClient(url, anonKey, authOptions);
    const refreshed = await refresher.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.error) {
      throw new Error(`${label} refresh-token exchange failed: ${refreshed.error.message}`);
    }
    const session = refreshed.data.session;
    if (!session?.access_token || !session.refresh_token) {
      throw new Error(`${label} refresh-token exchange failed: Complete session token material was not returned`);
    }
    const authenticated = await verifyAndCreateTokenClient(
      session.access_token,
      `${label} refreshed access-token verification failed`,
    );
    try {
      await persistShutdownDevRefreshToken(refreshTokenVariable, session.refresh_token);
    } catch {
      throw new Error(`${label} authentication succeeded but rotated refresh token could not be persisted safely`);
    }
    process.env[refreshTokenVariable] = session.refresh_token;
    console.log(`${label} refresh token rotated and local DEV env updated`);
    return { ...authenticated, authMode: 'refresh-token' };
  }

  if (accessToken) {
    const authenticated = await verifyAndCreateTokenClient(
      accessToken,
      `${label} access-token verification failed`,
    );
    return { ...authenticated, authMode: 'access-token' };
  }

  if (!password) {
    throw new Error(`${label} requires an access token or password`);
  }

  const client = createClient(url, anonKey, authOptions);
  const login = await client.auth.signInWithPassword({ email: expectedEmail, password });
  if (login.error || !login.data.user) {
    const reason = login.error?.message ?? 'No authenticated user returned';
    if (/captcha/i.test(reason)) {
      throw new Error(`${label} password login requires a browser-authenticated access token because CAPTCHA is enabled`);
    }
    throw new Error(`Could not authenticate ${label} (${expectedEmail}): ${reason}`);
  }
  if ((login.data.user.email ?? '').toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(`${label} password login belongs to a different user`);
  }
  return { client, user: login.data.user, authMode: 'password' };
}
