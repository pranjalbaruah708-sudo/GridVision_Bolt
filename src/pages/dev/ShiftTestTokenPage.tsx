import { useMemo, useRef, useState } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { createClient } from '@supabase/supabase-js';
import { Copy, Loader2, ShieldCheck } from 'lucide-react';
import {
  isAuthCaptchaError,
  isAuthConnectivityError,
  isAuthRateLimitError,
} from '@/services/authErrors';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/services/supabase';

type Actor = 'FIELD_OFFICER' | 'OPERATOR' | 'ADMIN';

interface ActorState {
  email: string;
  password: string;
  captchaToken: string | null;
  busy: boolean;
  accessToken: string | null;
  error: string | null;
}

const ACTORS: Array<{ id: Actor; label: string; acceptedRoles: string[] }> = [
  { id: 'FIELD_OFFICER', label: 'Field Officer', acceptedRoles: ['FIELD_OFFICER'] },
  { id: 'OPERATOR', label: 'Operator', acceptedRoles: ['OPERATOR'] },
  { id: 'ADMIN', label: 'Admin', acceptedRoles: ['ADMIN', 'SUPER_ADMIN'] },
];

function initialActorState(): ActorState {
  return { email: '', password: '', captchaToken: null, busy: false, accessToken: null, error: null };
}

function authenticationError(error: unknown) {
  if (isAuthCaptchaError(error)) return 'Please complete the security verification and try again.';
  if (isAuthRateLimitError(error)) return 'Too many authentication attempts. Please wait a while and try again.';
  if (isAuthConnectivityError(error)) return 'We could not verify this actor right now. Please check your connection and try again.';
  return 'We could not verify this actor right now. Please try again.';
}

function isolatedClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function ShiftTestTokenPage() {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();
  const [actors, setActors] = useState<Record<Actor, ActorState>>({ FIELD_OFFICER: initialActorState(), OPERATOR: initialActorState(), ADMIN: initialActorState() });
  const [showCommands, setShowCommands] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const turnstileRefs = useRef<Record<Actor, TurnstileInstance | null>>({ FIELD_OFFICER: null, OPERATOR: null, ADMIN: null });
  const allAuthenticated = ACTORS.every((actor) => Boolean(actors[actor.id].accessToken));
  const commands = useMemo(() => ACTORS.map((actor) => `$env:SHIFT_ROSTER_TEST_${actor.id}_ACCESS_TOKEN = '${actors[actor.id].accessToken ?? ''}'`).join('\n'), [actors]);

  const updateActor = (actor: Actor, patch: Partial<ActorState>) => {
    setActors((current) => ({ ...current, [actor]: { ...current[actor], ...patch } }));
  };

  const resetCaptcha = (actor: Actor) => {
    updateActor(actor, { captchaToken: null });
    turnstileRefs.current[actor]?.reset();
  };

  const authenticate = async (actor: Actor) => {
    const current = actors[actor];
    const actorDefinition = ACTORS.find((definition) => definition.id === actor);
    if (!actorDefinition) return;
    if (!current.email.trim() || !current.password) {
      updateActor(actor, { error: 'Enter an email address and password to continue.' });
      return;
    }
    if (!siteKey || !current.captchaToken) {
      updateActor(actor, { error: 'Please complete the security verification and try again.' });
      return;
    }

    updateActor(actor, { busy: true, error: null, accessToken: null });
    const temporaryClient = isolatedClient();
    try {
      const { data, error } = await temporaryClient.auth.signInWithPassword({
        email: current.email.trim(),
        password: current.password,
        options: { captchaToken: current.captchaToken },
      });
      if (error || !data.session?.access_token) throw error ?? new Error('No access token was returned.');

      const { data: role, error: roleError } = await temporaryClient.rpc('get_my_role');
      if (roleError || !actorDefinition.acceptedRoles.includes(String(role))) {
        await temporaryClient.auth.signOut({ scope: 'local' });
        updateActor(actor, { password: '', accessToken: null, error: `This account does not have the required ${actorDefinition.label} role.` });
        return;
      }

      updateActor(actor, { accessToken: data.session.access_token, password: '', error: null });
    } catch (error) {
      updateActor(actor, { accessToken: null, error: authenticationError(error) });
    } finally {
      resetCaptcha(actor);
      updateActor(actor, { busy: false });
    }
  };

  const copyCommands = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopyStatus('Commands copied to the clipboard.');
    } catch {
      setCopyStatus('Copy is unavailable in this browser. Select and copy the commands manually.');
    }
  };

  if (!siteKey) {
    return <main className="mx-auto max-w-xl p-6 text-slate-900"><h1 className="text-xl font-bold">Shift validation token helper</h1><p className="mt-3">Turnstile is not configured for this development build.</p></main>;
  }

  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h1 className="text-xl font-bold">Shift validation token helper</h1>
          <p className="mt-2 text-sm text-slate-700">Development-only utility. Tokens remain in this page&apos;s memory until you close or reload it.</p>
        </header>

        {ACTORS.map((actorDefinition) => {
          const { id: actor, label } = actorDefinition;
          const state = actors[actor];
          return (
            <section key={actor} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-busy={state.busy}>
              <h2 className="text-lg font-semibold">{label}</h2>
              {state.accessToken ? (
                <p role="status" className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><ShieldCheck className="h-4 w-4" />{label} authenticated successfully</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
                  <label className="block text-sm font-medium">Email<input type="email" autoComplete="off" value={state.email} disabled={state.busy} onChange={(event) => updateActor(actor, { email: event.target.value, error: null })} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="block text-sm font-medium">Password<input type="password" autoComplete="off" value={state.password} disabled={state.busy} onChange={(event) => updateActor(actor, { password: event.target.value, error: null })} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <div className="flex justify-center"><Turnstile ref={(instance) => { turnstileRefs.current[actor] = instance ?? null; }} siteKey={siteKey} options={{ size: 'flexible', theme: 'light' }} onSuccess={(captchaToken) => updateActor(actor, { captchaToken, error: null })} onExpire={() => resetCaptcha(actor)} onError={() => { resetCaptcha(actor); updateActor(actor, { error: 'Please complete the security verification and try again.' }); }} /></div>
                  <button type="button" disabled={state.busy} onClick={() => void authenticate(actor)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{state.busy && <Loader2 className="h-4 w-4 animate-spin" />}Authenticate</button>
                </div>
              )}
            </section>
          );
        })}

        {allAuthenticated && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><button type="button" onClick={() => setShowCommands(true)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Generate PowerShell Commands</button>{showCommands && <div className="mt-4"><pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{commands}</pre><button type="button" onClick={() => void copyCommands()} className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"><Copy className="h-4 w-4" />Copy</button>{copyStatus && <p role="status" className="mt-2 text-sm text-slate-600">{copyStatus}</p>}</div>}</section>}
      </div>
    </main>
  );
}
