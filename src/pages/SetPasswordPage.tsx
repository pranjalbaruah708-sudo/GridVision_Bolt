import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { supabase } from '@/services/supabase';

type SetPasswordPageProps = {
  hasValidSession: boolean;
  onComplete: () => void;
  onDismiss: () => void;
};

const invalidInvitationMessage =
  'This invitation link is invalid or has expired. Please contact your administrator for a new invitation.';

function clearInvitationCallbackUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function getFriendlySetupError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (/session|jwt|token|expired|invalid/i.test(message)) {
    return invalidInvitationMessage;
  }

  if (/network|fetch|connection|offline|timeout/i.test(message)) {
    return 'We could not connect to GridVision. Please check your connection and try again.';
  }

  return 'We could not set your password right now. Please try again.';
}

export function SetPasswordPage({ hasValidSession, onComplete, onDismiss }: SetPasswordPageProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    hasValidSession ? null : invalidInvitationMessage
  );
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!success) return;

    const completionTimer = window.setTimeout(onComplete, 900);
    return () => window.clearTimeout(completionTimer);
  }, [onComplete, success]);

  const clearError = () => setError(null);

  const handleDismiss = () => {
    clearInvitationCallbackUrl();
    onDismiss();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();

    if (!hasValidSession) {
      setError(invalidInvitationMessage);
      return;
    }

    if (!password || !confirmPassword) {
      setError('Enter and confirm your new password.');
      return;
    }

    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setPassword('');
      setConfirmPassword('');
      clearInvitationCallbackUrl();
      setSuccess(true);
    } catch (updateError) {
      setError(getFriendlySetupError(updateError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-gradient-to-br from-[#0B2E63] via-[#154C9E] to-[#0A2147] px-5 py-8 sm:px-6 sm:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(191,219,254,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(191,219,254,0.42) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-14 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-300/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center py-3 sm:min-h-[calc(100dvh-5rem)]">
        <header className="mb-7 text-center sm:mb-8">
          <div className="mx-auto flex h-[82px] w-[82px] items-center justify-center rounded-[26px] border border-cyan-100/30 bg-white/10 p-3 shadow-[0_18px_45px_rgba(3,24,61,0.34)] backdrop-blur-sm">
            <Logo size={58} title="GridVision" />
          </div>
          <h1 className="mt-4 text-[32px] font-bold tracking-[-0.045em] text-white sm:text-[34px]">
            Grid<span className="text-cyan-300">Vision</span>
          </h1>
          <p className="mt-1.5 text-sm font-medium text-blue-100/90">Unified Grid Operations Platform</p>
        </header>

        <section
          aria-label="Set password"
          aria-busy={submitting}
          className="rounded-[28px] border border-white/65 bg-[#F5F7FA]/95 p-6 shadow-[0_24px_60px_rgba(3,24,61,0.28)] backdrop-blur-xl sm:p-8"
        >
          <div className="mb-6">
            <h2 className="text-[25px] font-bold tracking-[-0.025em] text-slate-900">Set your password</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Create a password to activate your GridVision account.</p>
          </div>

          {error && (
            <div id="set-password-error" role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {success ? (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <p>Password set successfully. Opening GridVision…</p>
            </div>
          ) : hasValidSession ? (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <PasswordField
                id="set-password-new"
                label="New Password"
                value={password}
                visible={showPassword}
                disabled={submitting}
                error={error}
                onChange={(value) => {
                  setPassword(value);
                  clearError();
                }}
                onToggle={() => setShowPassword((visible) => !visible)}
              />
              <PasswordField
                id="set-password-confirm"
                label="Confirm Password"
                value={confirmPassword}
                visible={showConfirmPassword}
                disabled={submitting}
                error={error}
                onChange={(value) => {
                  setConfirmPassword(value);
                  clearError();
                }}
                onToggle={() => setShowConfirmPassword((visible) => !visible)}
              />
              <p className="-mt-2 text-xs text-slate-500">Use at least 8 characters.</p>
              <button type="submit" disabled={submitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0B4CA8] to-[#1675D1] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(15,91,190,0.24)] transition hover:from-[#0A4292] hover:to-[#1267B9] focus:outline-none focus:ring-4 focus:ring-blue-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Setting password…</> : <><KeyRound aria-hidden="true" className="h-5 w-5" />Set Password</>}
              </button>
            </form>
          ) : (
            <button type="button" onClick={handleDismiss} className="min-h-11 w-full rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
              Return to sign in
            </button>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 text-xs font-medium text-slate-600">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" />
            <span>Authorised personnel only</span>
          </div>
        </section>
      </div>
    </main>
  );
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onToggle: () => void;
};

function PasswordField({ id, label, value, visible, disabled, error, onChange, onToggle }: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
      <div className="relative">
        <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter your new password"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'set-password-error' : undefined}
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-12 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        />
        <button type="button" disabled={disabled} onClick={onToggle} className="absolute right-2 top-1/2 flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          {visible ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
