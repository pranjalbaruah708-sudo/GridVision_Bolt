import { useEffect } from 'react';
import { Power, X } from 'lucide-react';

type ExitAppConfirmationDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ExitAppConfirmationDialog({ open, onCancel, onConfirm }: ExitAppConfirmationDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-app-dialog-title"
        aria-describedby="exit-app-dialog-description"
        className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">
            <Power aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="exit-app-dialog-title" className="text-lg font-bold text-slate-900">Exit GridVision?</h2>
            <p id="exit-app-dialog-description" className="mt-1 text-sm leading-5 text-slate-600">
              You will remain signed in and can continue from where you left off when you open the app again.
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel exit" className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} autoFocus className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            Exit App
          </button>
        </div>
      </section>
    </div>
  );
}
