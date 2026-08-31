import type {
  ReactNode,
  RefObject,
} from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  PageBody,
} from '@/components/ui/Page';

type ReportPageShellProps = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: ReactNode;
  filters: ReactNode;
  contentRef: RefObject<HTMLDivElement>;
  children: ReactNode;
};

export function ReportPageShell({
  title,
  subtitle,
  onBack,
  actions,
  filters,
  contentRef,
  children,
}: ReportPageShellProps) {
  return (
    <div className="min-h-screen bg-[#EEF3F8]">
      <header className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] px-4 pb-4 pt-[22px] text-white shadow-md">
        <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 rounded-full p-1 transition hover:bg-white/10 active:scale-95"
            aria-label="Back to Reports"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="min-w-0 pt-0.5 text-center">
            <h1 className="m-0 truncate text-xl font-bold leading-tight">{title}</h1>
            {subtitle && <p className="mt-1 truncate text-[11px] font-medium text-blue-100/90">{subtitle}</p>}
          </div>
          <span aria-hidden="true" />
        </div>
      </header>
      <PageBody>
        <div className="space-y-4">
          {filters}
          {actions && <div className="flex flex-wrap justify-end gap-2" data-report-exclude>{actions}</div>}
          <div ref={contentRef} className="rounded-2xl bg-white p-4 shadow-sm">
            {children}
          </div>
        </div>
      </PageBody>
    </div>
  );
}
