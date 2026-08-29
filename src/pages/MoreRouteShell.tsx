import { Construction } from 'lucide-react';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';

export function MoreRouteShell({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <Screen>
      <AppHeader title={title} subtitle="More" onBack={onBack} className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0]" />
      <PageBody>
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Construction className="h-6 w-6" /></div>
          <h2 className="mt-4 text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Information and support resources for GridVision users.</p>
        </div>
      </PageBody>
    </Screen>
  );
}
