import type { ReactNode } from 'react';

export function DesktopPageHeading({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="hidden items-center justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5 lg:flex xl:px-8">
    <div className="min-w-0"><h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 truncate text-sm text-slate-500">{subtitle}</p>}</div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>;
}
