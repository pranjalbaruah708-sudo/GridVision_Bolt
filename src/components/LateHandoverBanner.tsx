import { AlertTriangle, ClipboardCheck } from 'lucide-react';

import { useApp } from '@/context/AppContext';
import { useLateShiftHandover } from '@/hooks/useLateShiftHandover';
import type { AppRole } from '@/security/permissions';

export function LateHandoverBanner({ role, onReview }: { role: AppRole | null; onReview: () => void }) {
  const { activeStation } = useApp();
  const late = useLateShiftHandover(activeStation?.id ?? null);
  if (role !== 'OPERATOR' || !late.pending) return null;

  return <div role="alert" className="fixed inset-x-0 top-0 z-[75] border-b border-amber-300 bg-amber-100 px-3 py-2 text-amber-950 shadow-md">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />Late handover received — review and acceptance required.</span>
      <button type="button" onClick={onReview} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-amber-800 px-3 text-xs font-bold text-white"><ClipboardCheck className="h-4 w-4" />Review now</button>
    </div>
  </div>;
}

