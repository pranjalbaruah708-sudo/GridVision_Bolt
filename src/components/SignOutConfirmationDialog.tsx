import { useEffect, useState } from 'react';
import { LogOut, X } from 'lucide-react';

type SignOutConfirmationDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function SignOutConfirmationDialog({ open, onCancel, onConfirm }: SignOutConfirmationDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setError(null);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onCancel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open, submitting]);

  if (!open) return null;

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-out-dialog-title"
        aria-describedby="sign-out-dialog-description"
        className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600">
            <LogOut className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="sign-out-dialog-title" className="text-lg font-bold text-slate-900">Sign out?</h2>
            <p id="sign-out-dialog-description" className="mt-1 text-sm leading-5 text-slate-600">You will need to sign in again to access GridVision.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={submitting} aria-label="Cancel sign out" className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} disabled={submitting} autoFocus className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
          <button type="button" onClick={confirm} disabled={submitting} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Signing out…' : 'Sign Out'}</button>
        </div>
      </section>
    </div>
  );
}
