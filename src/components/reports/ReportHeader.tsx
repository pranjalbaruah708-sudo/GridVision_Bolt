import {
  CalendarClock,
  MapPin,
} from 'lucide-react';
import type {
  ReportPreviewMeta,
} from './types';

export function ReportHeader({ meta }: { meta: ReportPreviewMeta }) {
  const generatedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(meta.generatedAt);

  return (
    <header className="border-b border-slate-200 pb-4">
      <h1 className="text-xl font-extrabold text-slate-900">{meta.title}</h1>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-700" /><span><strong className="text-slate-800">Scope:</strong> {meta.stationScope}{meta.feederScope ? ` · ${meta.feederScope}` : ''}</span></p>
        <p className="flex items-start gap-2"><CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-700" /><span><strong className="text-slate-800">Period:</strong> {meta.periodLabel}</span></p>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Generated: {generatedAt} IST</p>
      {meta.appliedFilters.length > 0 && <p className="mt-2 text-[11px] text-slate-500"><strong className="text-slate-700">Applied filters:</strong> {meta.appliedFilters.join(' · ')}</p>}
    </header>
  );
}
