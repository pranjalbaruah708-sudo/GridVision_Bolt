import { Home, BarChart2, Bell, FileText, MoreHorizontal, ClipboardPenLine, Clock3, SlidersHorizontal } from 'lucide-react';
import type { AppRole } from '@/security/permissions';
import { canInitiateShutdown } from '@/security/permissions';

export type Tab = 'dashboard' | 'analytics' | 'alerts' | 'reports' | 'more';

export function BottomNav({
  active,
  onNavigate,
  module = 'manual',
  onShutdownNavigate,
  onOpenModuleSelection,
  shutdownActive,
  role,
}: {
  active: Tab;
  onNavigate: (tab: Tab) => void;
  module?: 'manual' | 'shutdown' | 'scada';
  onShutdownNavigate?: (target: 'dashboard' | 'requests' | 'initiate' | 'reports') => void;
  onOpenModuleSelection?: () => void;
  shutdownActive?: 'dashboard' | 'requests' | 'initiate' | 'reports';
  role?: AppRole;
}) {
  if (module === 'shutdown') {
    const tabs = [
      { id: 'dashboard' as const, label: 'Dashboard', icon: Home },
      { id: 'requests' as const, label: 'My Requests', icon: ClipboardPenLine },
      ...(canInitiateShutdown(role) ? [{ id: 'initiate' as const, label: role === 'OPERATOR' ? 'Initiate' : 'Initiate / Approve', icon: Clock3 }] : []),
      { id: 'reports' as const, label: 'Reports', icon: FileText },
      { id: 'modules' as const, label: 'Switch Module', icon: SlidersHorizontal },
    ];
    return (
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-safe shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id !== 'modules' && (shutdownActive === tab.id || (!shutdownActive && ((tab.id === 'dashboard' && active === 'dashboard') || (tab.id === 'reports' && active === 'reports'))));
            return <button key={tab.id} type="button" onClick={() => tab.id === 'modules' ? onOpenModuleSelection?.() : onShutdownNavigate?.(tab.id)} className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2 transition ${selected ? 'text-blue-700' : 'text-gray-400 hover:text-gray-600'}`}>
              <Icon className="h-5 w-5" strokeWidth={selected ? 2.5 : 2} />
              <span className={`max-w-full truncate text-[10px] font-medium ${selected ? 'text-blue-700' : ''}`}>{tab.label}</span>
            </button>;
          })}
        </div>
      </nav>
    );
  }
  const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'alerts', label: 'Alerts', icon: Bell },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'more', label: 'More', icon: MoreHorizontal },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 bg-white border-t border-gray-200 pb-safe shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition ${
                isActive ? 'text-blue-700' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon
                className="h-5 w-5"
                strokeWidth={isActive ? 2.5 : 2}
                fill={isActive && t.id !== 'analytics' && t.id !== 'more' ? 'currentColor' : 'none'}
              />
              <span className={`text-[10px] font-medium ${isActive ? 'text-blue-700' : ''}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
