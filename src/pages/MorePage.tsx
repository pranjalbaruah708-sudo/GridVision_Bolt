import { ChevronRight, Settings, Bell, FileText, BarChart2, PencilLine, HelpCircle, LogOut, User } from 'lucide-react';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';
import { useApp } from '@/context/AppContext';

type MoreItem = {
  id: string;
  label: string;
  desc: string;
  icon: typeof Settings;
  color: string;
};

const TOOLS: MoreItem[] = [
  { id: 'operator-entry', label: 'Operator Entry', desc: 'Manual parameter logging', icon: PencilLine, color: 'bg-blue-600' },
  { id: 'settings', label: 'Settings', desc: 'App preferences & notifications', icon: Settings, color: 'bg-slate-700' },
  { id: 'analytics', label: 'Analytics', desc: 'Charts & performance trends', icon: BarChart2, color: 'bg-rose-500' },
  { id: 'reports', label: 'Reports', desc: 'Generate & export reports', icon: FileText, color: 'bg-emerald-600' },
  { id: 'alerts', label: 'Alerts', desc: 'View active notifications', icon: Bell, color: 'bg-amber-500' },
  { id: 'help', label: 'Help & Support', desc: 'FAQs & contact information', icon: HelpCircle, color: 'bg-indigo-500' },
];

export function MorePage({ onOpen, userEmail, onSignOut }: { onOpen: (id: string) => void; userEmail: string | null; onSignOut: () => void }) {
  const { activeStation } = useApp();

  return (
    <Screen>
      <AppHeader title="More" subtitle="Tools & settings" />
      <PageBody>
        {/* Profile card */}
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-blue-700 text-white">
            <User className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">{userEmail ?? 'Field Operator'}</p>
            <p className="text-[11px] text-gray-500">{activeStation?.name ?? 'No station'} · Operator</p>
          </div>
        </div>

        {/* Tools list */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="divide-y divide-gray-50">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
                >
                  <div className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${t.color}`}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{t.label}</p>
                    <p className="text-[11px] text-gray-500 truncate">{t.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={onSignOut}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-50 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>

        <p className="mt-6 text-center text-[10px] text-gray-400">GridVision v1.0.0 · Build 2024.05</p>
      </PageBody>
    </Screen>
  );
}
