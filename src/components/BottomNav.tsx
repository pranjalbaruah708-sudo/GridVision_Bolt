import { Home, BarChart2, Bell, FileText, MoreHorizontal } from 'lucide-react';

export type Tab = 'dashboard' | 'analytics' | 'alerts' | 'reports' | 'more';

export function BottomNav({
  active,
  onNavigate,
}: {
  active: Tab;
  onNavigate: (tab: Tab) => void;
}) {
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
