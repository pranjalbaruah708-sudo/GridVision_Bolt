import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase';

function getFriendlySignInError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (/invalid credentials|invalid login|wrong password/i.test(message)) {
    return 'The email address or password is incorrect.';
  }

  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many sign-in attempts. Please try again in a little while.';
  }

  if (/network|fetch|connection|offline|timeout/i.test(message)) {
    return 'We could not connect to GridVision. Please check your connection and try again.';
  }

  return 'We could not sign you in right now. Please try again.';
}

function getFriendlyRecoveryError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many recovery requests. Please try again in a little while.';
  }

  if (/network|fetch|connection|offline|timeout/i.test(message)) {
    return 'We could not send recovery instructions. Please check your connection and try again.';
  }

  return 'We could not send recovery instructions right now. Please try again.';
}

export function SignInPage({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { signIn } = auth;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sendingRecovery, setSendingRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  const isBusy = signingIn || sendingRecovery;
  const version = import.meta.env.VITE_APP_VERSION as string | undefined;

  const clearError = () => setError(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

    setError(null);
    setRecoveryMessage(null);

    if (!trimmedEmail || !password) {
      setError('Enter your email address and password to sign in.');
      return;
    }

    setSigningIn(true);
    try {
      await signIn(trimmedEmail, password);
    } catch (signInError) {
      setError(getFriendlySignInError(signInError));
    } finally {
      setSigningIn(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    setError(null);
    setRecoveryMessage(null);

    if (!trimmedEmail) {
      setError('Enter your email address to receive password recovery instructions.');
      return;
    }

    setSendingRecovery(true);
    try {
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
      if (recoveryError) {
        throw recoveryError;
      }

      setRecoveryMessage(
        'If an account exists for that email address, recovery instructions have been sent.'
      );
    } catch (recoveryError) {
      setError(getFriendlyRecoveryError(recoveryError));
    } finally {
      setSendingRecovery(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-gradient-to-br from-[#08244F] via-[#103F84] to-[#071A38] px-5 py-8 sm:px-6 sm:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(191,219,254,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(191,219,254,0.42) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-300/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 right-[-8rem] h-72 w-72 rounded-full bg-blue-400/15 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center py-3 sm:min-h-[calc(100dvh-5rem)]">
        <header className="mb-7 text-center sm:mb-8">
          <div className="mx-auto flex h-[86px] w-[86px] items-center justify-center rounded-[26px] border border-cyan-100/30 bg-white/10 p-3 shadow-[0_18px_45px_rgba(3,24,61,0.34)] backdrop-blur-sm">
            <Logo size={62} title="GridVision" />
          </div>
          <h1 className="mt-4 text-[32px] font-bold tracking-[-0.045em] text-white sm:text-[34px]">
            Grid<span className="text-cyan-300">Vision</span>
          </h1>
          <p className="mt-1.5 text-sm font-medium text-blue-100/90">
            Unified Grid Operations Platform
          </p>
        </header>

        <section
          aria-label="Sign in"
          aria-busy={signingIn}
          className="rounded-[28px] border border-white/65 bg-[#F5F7FA]/95 p-6 shadow-[0_24px_60px_rgba(3,24,61,0.28)] backdrop-blur-xl sm:p-8"
        >
          <div className="mb-6">
            <h2 className="text-[25px] font-bold tracking-[-0.025em] text-slate-900">Sign in</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              Use your organisation account to continue.
            </p>
          </div>

          {error && (
            <div
              id="sign-in-error"
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4.5 w-4.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {recoveryMessage && (
            <div
              role="status"
              className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
            >
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
              <p>{recoveryMessage}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="sign-in-email" className="mb-2 block text-sm font-semibold text-slate-700">
                Email address
              </label>
              <div className="relative">
                <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="sign-in-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  disabled={isBusy}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearError();
                  }}
                  placeholder="name@organisation.com"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'sign-in-error' : undefined}
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sign-in-password" className="mb-2 block text-sm font-semibold text-slate-700">
                Password
              </label>
              <div className="relative">
                <Lock aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="sign-in-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  disabled={isBusy}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError();
                  }}
                  placeholder="Enter your password"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'sign-in-error' : undefined}
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-12 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-2 top-1/2 flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex min-h-6 justify-end">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleForgotPassword}
                className="min-h-10 rounded-lg px-1 text-sm font-semibold text-blue-700 transition hover:text-blue-900 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendingRecovery ? 'Sending recovery…' : 'Forgot password?'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isBusy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0B4CA8] to-[#1675D1] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(15,91,190,0.24)] transition hover:from-[#0A4292] hover:to-[#1267B9] focus:outline-none focus:ring-4 focus:ring-blue-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingIn ? (
                <><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Signing in…</>
              ) : (
                <><KeyRound aria-hidden="true" className="h-5 w-5" />Sign in securely</>
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 text-xs font-medium text-slate-600">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" />
            <span>Authorised personnel only</span>
          </div>
        </section>

        <footer className="mt-6 text-center text-xs text-blue-100/90">
          <div className="flex items-center justify-center gap-2 font-medium">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-300" />
            <span>Secure, role-based access for authorised users</span>
          </div>
          <p className="mt-3 text-[11px] text-blue-200/75">
            {version ? 'GridVision · ' + version : 'GridVision · Secure Operations'}
          </p>
        </footer>
      </div>
    </main>
  );
}
