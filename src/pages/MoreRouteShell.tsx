import { BookOpen, Construction, Download, ExternalLink } from 'lucide-react';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';

export function MoreRouteShell({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <Screen showStatusBar={false}>
      <AppHeader title={title} onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
      <DesktopPageHeading title={title} subtitle="GridVision administration" />
      <PageBody>
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Construction className="h-6 w-6" /></div>
          <h2 className="mt-4 text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Information and support resources for GridVision users.</p>
          <section className="mx-auto mt-6 max-w-xl rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-left">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-700 shadow-sm"><BookOpen className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-900">GridVision User Manual</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">Use the user manual for guidance on station operations, logbook entries, alerts, reports, shift duty and shutdown management.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/GridVision_User_Manual.pdf" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800"><ExternalLink className="h-4 w-4" />Open manual</a>
                  <a href="/GridVision_User_Manual.pdf" download="GridVision_User_Manual.pdf" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"><Download className="h-4 w-4" />Download PDF</a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </PageBody>
    </Screen>
  );
}
