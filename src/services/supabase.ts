import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Supabase consumes callback fragments during client initialization. Keep only
// the non-sensitive invitation type so App can route an invitation callback to
// first-password setup even when an older invitation redirect omitted ?invite=1.
const callbackHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
export const hasSupabaseInviteCallback = callbackHashParams.get('type') === 'invite';
export const hasSupabaseRecoveryCallback = callbackHashParams.get('type') === 'recovery';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Expected VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const REST_URL = `${supabaseUrl}/rest/v1`;
export const REST_HEADERS = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
