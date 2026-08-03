import { useState } from 'react';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Logo } from '@/components/Logo';

export function SignInPage({
  auth,
}: {
  auth: ReturnType<typeof useAuth>;
}) {
  const { signIn } = auth;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);

    if (!username || !password) {
      setError('Please enter Username and Password.');
      return;
    }

    setBusy(true);

    try {
      // Username is actually email for Supabase authentication
      await signIn(username, password);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to sign in';

      setError(
        /invalid credentials|invalid login|wrong password/i.test(msg)
          ? 'Incorrect Username or Password.'
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0B2E63] via-[#154C9E] to-[#0A2147]">

      {/* Background Effects */}

      <div className="absolute inset-0">

        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl"/>

        <div className="absolute bottom-0 -left-24 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl"/>

        <div className="absolute top-24 -right-20 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"/>

      </div>

      <div className="relative z-10 w-full max-w-md px-6">

        {/* Logo */}

        <div className="mb-8 flex flex-col items-center text-center">

 <div className="flex justify-center">
<div className="flex h-36 w-36 items-center justify-center rounded-full bg-cyan-400/10 p-2 shadow-2xl backdrop-blur-3xl">

 
    <Logo size={130} />
 
 </div>
 
 </div>

  <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">
    GridVision
  </h1>

  <p className="mt-2 text-sm text-blue-100">
    Unified Digital Platform
  </p>

  <p className="text-sm text-blue-200/80">
    for Sub-Station Monitoring & Log Book
  </p>

</div>

        {/* Login Card */}

        <div className="rounded-3xl border border-white/20 bg-white/95 shadow-2xl backdrop-blur-xl">

          <div className="p-8">

            <div className="mb-6 text-center">

              <h2 className="text-2xl font-bold text-slate-800">
                Welcome Back
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Sign in to continue
              </p>

            </div>

            {error && (

              <div className="mb-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">

                <AlertCircle className="mt-0.5 h-5 w-5 text-red-500"/>

                <p className="text-sm text-red-700">
                  {error}
                </p>

              </div>

            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-5"
            >
                            {/* Username */}

              <div>

                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Username
                </label>

                <div className="relative">

                  <User className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />

                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter Username"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />

                </div>

                <p className="mt-1 text-xs text-slate-400">
                  Enter your registered username (email address).
                </p>

              </div>

              {/* Password */}

              <div>

                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Password
                </label>

                <div className="relative">

                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />

                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter Password"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-12 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:text-blue-700"
                    aria-label={
                      showPw
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showPw ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>

                </div>

              </div>

              {/* Remember Me */}

              <div className="flex items-center justify-between">

                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">

                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) =>
                      setRememberMe(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />

                  Remember Me

                </label>

                <button
                  type="button"
                  className="text-sm font-medium text-blue-700 transition hover:text-blue-900"
                >
                  Forgot Password?
                </button>

              </div>
                            {/* Sign In Button */}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-700 to-blue-500 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:from-blue-800 hover:to-blue-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  <>
                    <KeyRound className="h-5 w-5" />
                    Sign In
                  </>
                )}
              </button>

            </form>

            {/* Security */}

            <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">

              <div className="flex items-start gap-3">

                <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />

                <div>

                  <h3 className="text-sm font-semibold text-emerald-700">
                    Secure Authentication
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-emerald-700/80">
                    User accounts are created and managed by your
                    organization administrator. Access to different
                    modules depends on assigned roles and privileges.
                  </p>

                </div>

              </div>

            </div>

          </div>

        </div>

        {/* Footer */}

        <div className="mt-8 text-center">

          <p className="text-xs tracking-wide text-blue-100/90">
            GridVision
          </p>

          <p className="mt-1 text-[11px] text-blue-200/70">
            Sub-Station Monitoring & Log Book System
          </p>

          <p className="mt-4 text-[11px] text-blue-200/50">
            Version 1.0.0
          </p>

        </div>

      </div>
          </div>
  );
}