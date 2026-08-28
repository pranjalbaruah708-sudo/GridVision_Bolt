import { useState } from 'react';
import {
  Bell,
  BookOpen,
  CalendarClock,
  ChevronRight,
  LogOut,
  Monitor,
  Settings,
  UserRound,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { SignOutConfirmationDialog } from '@/components/SignOutConfirmationDialog';

type GridVisionModule = 'manual' | 'scada' | 'shutdown';

interface ModuleSelectionReplicaPageProps {
  username: string;
  role: string;
  avatarUrl?: string | null;
  onSelectModule: (module: GridVisionModule) => void;
  onNotifications?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  onLogout?: () => Promise<void>;
}

type ModuleDefinition = {
  id: GridVisionModule;
  title: string;
  subtitle: string;
  icon: typeof BookOpen;
  accent: 'blue' | 'emerald' | 'amber';
  enabled: boolean;
};

const MODULES: ModuleDefinition[] = [
  { id: 'manual', title: 'Digital Log Books', subtitle: 'Manual substation operations', icon: BookOpen, accent: 'blue', enabled: true },
  { id: 'scada', title: 'SCADA Integration', subtitle: 'Live monitoring & control', icon: Monitor, accent: 'emerald', enabled: false },
  { id: 'shutdown', title: 'Shutdown Management', subtitle: 'Plan, approve & track shutdowns', icon: CalendarClock, accent: 'amber', enabled: false },
];

const MODULE_STYLES = {
  blue: { card: 'border-blue-200 bg-blue-50/70', icon: 'bg-blue-600 text-white', text: 'text-blue-700', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  emerald: { card: 'border-emerald-200 bg-emerald-50/70', icon: 'bg-emerald-600 text-white', text: 'text-emerald-700', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  amber: { card: 'border-amber-200 bg-amber-50/70', icon: 'bg-amber-500 text-white', text: 'text-amber-700', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
} as const;

function initialsFor(username: string) {
  const initials = username.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
  return initials || 'GV';
}

export function ModuleSelectionReplicaPage({ username, role, avatarUrl, onSelectModule, onNotifications, onProfile, onSettings, onLogout }: ModuleSelectionReplicaPageProps) {
  const initials = initialsFor(username);
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const globalActions = [
    { label: 'Notifications', icon: Bell, onClick: onNotifications, tone: 'text-blue-600' },
    { label: 'Profile', icon: UserRound, onClick: onProfile, tone: 'text-slate-600' },
    { label: 'Settings', icon: Settings, onClick: onSettings, tone: 'text-slate-600' },
    { label: 'Logout', icon: LogOut, onClick: onLogout ? () => setShowSignOutConfirmation(true) : undefined, tone: 'text-red-500' },
  ];

  return (
    <main className="min-h-screen bg-[#f4f7fc] pb-8 text-slate-800">
      <header className="relative overflow-hidden rounded-b-[34px] bg-gradient-to-br from-[#0d47a1] via-[#1565c0] to-[#093778] px-5 pb-24 pt-6 text-white shadow-[0_18px_45px_-20px_rgba(13,71,161,0.8)]">
        <div className="pointer-events-none absolute -right-20 top-20 h-56 w-56 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -left-24 bottom-[-120px] h-64 w-64 rounded-full bg-blue-300/10 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/12 p-1.5 ring-1 ring-white/20"><Logo size={30} className="h-7 w-7 object-contain" /></div>
            <span className="text-xl font-bold tracking-tight">GridVision</span>
          </div>
          {onNotifications && <button type="button" onClick={onNotifications} className="rounded-full p-2 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95" aria-label="Open notifications"><Bell className="h-6 w-6" /></button>}
        </div>
        <div className="relative mt-8 flex items-center gap-4">
          {avatarUrl ? <img src={avatarUrl} alt={`${username}'s profile`} className="h-20 w-20 rounded-full border-2 border-white object-cover shadow-lg" /> : <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-white bg-blue-800/40 text-2xl font-bold shadow-lg" aria-label={`${username}'s initials`}>{initials}</div>}
          <div className="min-w-0"><p className="text-2xl font-bold tracking-tight">Welcome, {username}</p><p className="mt-1 text-sm font-medium text-blue-100">{role}</p></div>
        </div>
      </header>

      <section className="relative mx-4 -mt-14 rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_20px_45px_-20px_rgba(15,23,42,0.32)] sm:mx-auto sm:max-w-lg">
        <div className="mb-5"><h1 className="text-2xl font-bold tracking-tight text-slate-950">Choose a Module</h1><p className="mt-1 text-sm text-slate-500">3 modules available</p></div>
        <div className="space-y-3">
          {MODULES.map((module) => {
            const Icon = module.icon;
            const styles = MODULE_STYLES[module.accent];
            return <button key={module.id} type="button" disabled={!module.enabled} aria-disabled={!module.enabled} onClick={() => onSelectModule(module.id)} className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left shadow-sm transition ${styles.card} ${module.enabled ? 'hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:scale-[0.99]' : 'cursor-not-allowed opacity-60'}`}>
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${styles.icon}`}><Icon className="h-6 w-6" strokeWidth={2.15} /></span>
              <span className="min-w-0 flex-1"><span className={`block text-base font-bold ${styles.text}`}>{module.title}</span><span className="mt-0.5 block text-sm text-slate-600">{module.subtitle}</span></span>
              {module.enabled ? <ChevronRight className={`h-6 w-6 shrink-0 ${styles.text}`} strokeWidth={2.5} /> : <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${styles.badge}`}>Coming Soon</span>}
            </button>;
          })}
        </div>

        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {globalActions.map((action, index) => {
            const Icon = action.icon;
            const isDisabled = !action.onClick;
            return <button key={action.label} type="button" disabled={isDisabled} aria-disabled={isDisabled} onClick={action.onClick} className={`flex min-h-20 items-center justify-center gap-2.5 p-3 text-sm font-semibold transition ${index % 2 === 0 ? 'border-r border-slate-200' : ''} ${index < 2 ? 'border-b border-slate-200' : ''} ${isDisabled ? 'cursor-not-allowed text-slate-400' : 'hover:bg-slate-50 active:bg-slate-100'}`}><Icon className={`h-5 w-5 ${isDisabled ? 'text-slate-400' : action.tone}`} strokeWidth={2.1} /><span>{action.label}</span></button>;
          })}
        </div>
        <footer className="pt-7 text-center text-xs font-medium text-slate-500">GridVision <span aria-hidden="true">•</span> Secure Operations</footer>
      </section>
      {onLogout && <SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onLogout} />}
    </main>
  );
}
