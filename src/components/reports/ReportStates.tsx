import {
  AlertCircle,
  FileX2,
  Loader2,
} from 'lucide-react';

export function ReportLoadingState({ label = 'Generating report…' }: { label?: string }) {
  return <div className="grid min-h-48 place-items-center rounded-2xl bg-white text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-blue-700" />{label}</span></div>;
}

export function ReportEmptyState({ message = 'No report rows match the selected filters.' }: { message?: string }) {
  return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-5 text-center text-sm font-medium text-slate-500"><span><FileX2 className="mx-auto mb-2 h-5 w-5 text-slate-400" />{message}</span></div>;
}

export function ReportErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="grid min-h-48 place-items-center rounded-2xl bg-red-50 px-5 text-center"><span><AlertCircle className="mx-auto mb-2 h-5 w-5 text-red-600" /><span className="block text-sm font-semibold text-red-700">{message}</span>{onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm">Retry</button>}</span></div>;
}
