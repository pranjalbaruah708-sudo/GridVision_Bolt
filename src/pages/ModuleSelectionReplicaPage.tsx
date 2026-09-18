import { useEffect, useRef, useState } from 'react';
import { Ban, Bell, BookOpen, CalendarClock, Check, ChevronDown, ChevronRight, HelpCircle, Layers, Lock, LogOut, Monitor, Power, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { Logo } from '@/components/Logo';
import substationHero from '@/assets/module-selection-substation-hero.png';
import { ExitAppConfirmationDialog } from '@/components/ExitAppConfirmationDialog';
import { SignOutConfirmationDialog } from '@/components/SignOutConfirmationDialog';
import { isAndroidApp, minimizeAndroidApp } from '@/services/platform/runtime';

export type GridVisionModule = 'manual' | 'scada' | 'shutdown';

interface ModuleSelectionReplicaPageProps {
  username: string;
  role: string;
  avatarUrl?: string | null;
  siteContext?: string | null;
  onSelectModule: (module: GridVisionModule) => void;
  onNotifications?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  onHelpAbout?: () => void;
  onLogout?: () => Promise<void>;
}

type ModuleFeature = string | { title: string; description: string };
type ModuleDefinition = { id: GridVisionModule; title: string; subtitle: string; icon: typeof BookOpen; accent: 'blue' | 'emerald' | 'amber'; enabled: boolean; features: ModuleFeature[] };

const MODULES: ModuleDefinition[] = [
  { id: 'manual', title: 'Station Management System', subtitle: 'Complete digital workspace for station operations', icon: BookOpen, accent: 'blue', enabled: true, features: [
    { title: 'Operational Logbook', description: 'Parameter readings and interruption records' },
    { title: 'Shift Management', description: 'Scheduling, roster, duty and attendance' },
    { title: 'Digital Handover', description: 'Shift handover, review and acceptance' },
    { title: 'Alerts & Analysis', description: 'Operational alerts, trends and performance analysis' },
    { title: 'Reports & Compliance', description: 'Logbooks, shift history and compliance reporting' },
    { title: 'Offline Operations', description: 'Continue operational entries offline with automatic sync' },
  ] },
  { id: 'scada', title: 'SCADA Integration', subtitle: 'Live monitoring & control', icon: Monitor, accent: 'emerald', enabled: false, features: ['Real-time monitoring', 'Remote operations', 'Alarms & events', 'Data visualization'] },
  { id: 'shutdown', title: 'Shutdown Management', subtitle: 'Plan, approve & track shutdowns', icon: CalendarClock, accent: 'amber', enabled: true, features: ['Dashboard', 'My requests', 'Initiate & approve requests', 'Reports'] },
];

const MODULE_STYLES = {
  blue: { card: 'border-blue-300 ring-1 ring-blue-100', icon: 'bg-blue-600 text-white shadow-blue-200', title: 'text-blue-800', check: 'bg-blue-50 text-blue-600' },
  emerald: { card: 'border-slate-200', icon: 'bg-emerald-600 text-white shadow-emerald-200', title: 'text-slate-900', check: 'bg-emerald-50 text-emerald-600' },
  amber: { card: 'border-slate-200', icon: 'bg-amber-500 text-white shadow-amber-200', title: 'text-slate-900', check: 'bg-amber-50 text-amber-600' },
} as const;

function initialsFor(username: string) {
  return username.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'GV';
}

export function ModuleSelectionReplicaPage({ username, role, avatarUrl, siteContext, onSelectModule, onNotifications, onProfile, onSettings, onHelpAbout, onLogout }: ModuleSelectionReplicaPageProps) {
  const initials = initialsFor(username);
  const isAndroid = isAndroidApp();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const [unavailableModuleId, setUnavailableModuleId] = useState<GridVisionModule | null>(null);
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const moduleMenuRef = useRef<HTMLDivElement>(null);
  const unavailableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accountMenuOpen && !moduleMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
      if (!moduleMenuRef.current?.contains(event.target as Node)) setModuleMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountMenuOpen(false); setModuleMenuOpen(false); } };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOnOutsideClick); document.removeEventListener('keydown', closeOnEscape); };
  }, [accountMenuOpen, moduleMenuOpen]);

  useEffect(() => () => {
    if (unavailableTimerRef.current) clearTimeout(unavailableTimerRef.current);
  }, []);

  const requestSignOut = () => { setAccountMenuOpen(false); setShowSignOutConfirmation(true); };
  const showUnavailableFeedback = (module: ModuleDefinition) => {
    if (module.enabled) return;
    if (unavailableTimerRef.current) clearTimeout(unavailableTimerRef.current);
    setUnavailableModuleId(module.id);
    unavailableTimerRef.current = setTimeout(() => setUnavailableModuleId(null), 1800);
  };
  const quickActions = [
    { label: 'Profile', description: 'View your profile', icon: UserRound, onClick: onProfile, tone: 'text-violet-600', iconBg: 'bg-violet-50' },
    { label: 'Settings', description: 'Preferences and notifications', icon: Settings, onClick: onSettings, tone: 'text-blue-600', iconBg: 'bg-blue-50' },
    { label: 'Notifications', description: 'View all alerts and messages', icon: Bell, onClick: onNotifications, tone: 'text-amber-600', iconBg: 'bg-amber-50' },
    { label: 'Help & About', description: 'Support and information', icon: HelpCircle, onClick: onHelpAbout, tone: 'text-teal-700', iconBg: 'bg-teal-50' },
  ];

  return (
    <main className="min-h-screen bg-[#F3F6FA] pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-slate-800 lg:p-2">
      <div className="mx-auto min-h-screen max-w-[1536px] overflow-hidden bg-[#F3F6FA] shadow-xl lg:rounded-[22px]">
      <header className="relative overflow-visible bg-gradient-to-br from-[#02183f] via-[#043480] to-[#061b46] text-white shadow-xl lg:rounded-b-[22px]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden lg:rounded-b-[22px]" aria-hidden="true">
          <img src={substationHero} alt="" className="absolute inset-0 h-full w-full object-fill object-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#02183f]/55 via-[#03275f]/25 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#020d27]/25 via-transparent to-[#031a47]/10" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
        </div>
        <div className="relative mx-auto max-w-[1400px] px-5 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-8 lg:px-12 lg:pb-5 lg:pt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20 lg:h-12 lg:w-12"><Logo size={32} className="h-8 w-8" /></span><div><p className="text-xl font-bold tracking-tight lg:text-2xl">GridVision</p><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-blue-200 sm:text-xs">Secure Operations. Smarter Decisions.</p></div></div>
            <div ref={accountMenuRef} className="relative z-20">
              <button type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={accountMenuOpen} className="flex items-center gap-2 rounded-xl bg-white/10 p-1.5 pr-2 ring-1 ring-white/15 transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                {avatarUrl ? <img src={avatarUrl} alt={`${username}'s profile`} className="h-9 w-9 rounded-lg object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-xs font-bold">{initials}</span>}
                <span className="hidden max-w-36 truncate text-sm font-semibold sm:block">{username}</span><ChevronDown className={`h-4 w-4 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {accountMenuOpen && <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-2xl">
                <button type="button" role="menuitem" disabled={!onProfile} onClick={() => { setAccountMenuOpen(false); onProfile?.(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"><UserRound className="h-4 w-4 text-blue-600" />My Profile</button>
                <button type="button" role="menuitem" disabled={!onLogout} onClick={requestSignOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"><LogOut className="h-4 w-4" />LogOut</button>
              </div>}
            </div>
          </div>
          <div className="mt-7 lg:mt-8">
            <div><p className="text-xl font-bold lg:text-3xl">Welcome,</p><h1 className="text-3xl font-extrabold tracking-tight text-blue-400 lg:text-4xl">{username}</h1><div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-blue-50 lg:text-sm"><ShieldCheck className="h-4 w-4 text-blue-400" /><span>{role}</span>{siteContext && <><span className="text-blue-300/60">|</span><ShieldCheck className="h-4 w-4 text-blue-400" /><span>{siteContext}</span></>}</div></div>
            <div ref={moduleMenuRef} className="relative mt-5 inline-block">
              <button type="button" onClick={() => setModuleMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={moduleMenuOpen} className="inline-flex min-w-52 items-center gap-2 rounded-full border border-white/5 bg-blue-300/10 px-3 py-2 text-left backdrop-blur focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:min-w-60 lg:gap-3 lg:px-4 lg:py-2.5"><Layers className="h-6 w-6 text-blue-400 lg:h-7 lg:w-7" /><span className="flex-1"><span className="block text-[9px] font-bold text-blue-100 lg:text-[10px]">Current Module</span><span className="block text-xs text-blue-400 lg:text-sm">Not selected</span></span><ChevronRight className={`h-4 w-4 transition-transform lg:h-5 lg:w-5 ${moduleMenuOpen ? 'rotate-90' : ''}`} /></button>
              {moduleMenuOpen && <div role="menu" className="absolute left-0 top-[calc(100%+0.4rem)] z-30 w-64 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-2xl">{MODULES.map((module) => { const Icon = module.enabled ? module.icon : Ban; return <button key={module.id} type="button" role="menuitem" aria-disabled={!module.enabled} onClick={() => { if (module.enabled) { setModuleMenuOpen(false); onSelectModule(module.id); } else showUnavailableFeedback(module); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-blue-50 active:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:text-slate-400"><Icon className={`h-5 w-5 ${module.enabled ? 'text-blue-600' : 'text-slate-400'}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{module.title}</span><span className="block text-[10px]">{module.enabled ? module.subtitle : unavailableModuleId === module.id ? 'Unavailable — coming soon' : 'Coming Soon'}</span></span>{module.enabled && <ChevronRight className="h-4 w-4" />}</button>; })}</div>}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1400px] px-3 pt-4 sm:px-8 lg:px-12 lg:pt-7">
        <div className="text-center"><h2 className="text-xl font-bold tracking-tight text-[#07143d] lg:text-3xl">Select a module to continue</h2><span className="mx-auto mt-2 block h-0.5 w-10 bg-blue-600" /><p className="mt-3 hidden text-sm text-slate-600 lg:block lg:text-base">Choose the workspace that matches your task today.</p></div>
        <div className="mt-5 grid grid-cols-1 gap-2 lg:mt-7 lg:grid-cols-3 lg:gap-8">
          {MODULES.map((module) => {
            const Icon = module.icon; const styles = MODULE_STYLES[module.accent];
            const showingUnavailable = !module.enabled && unavailableModuleId === module.id;
            return <article key={module.id} onPointerDownCapture={() => showUnavailableFeedback(module)} onClick={(event) => { if (module.enabled && !(event.target as HTMLElement).closest('button')) onSelectModule(module.id); }} onKeyDown={(event) => { if (module.enabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectModule(module.id); } }} role={module.enabled ? 'button' : undefined} tabIndex={module.enabled ? 0 : undefined} className={`group relative grid grid-cols-[4.5rem_1fr] gap-x-4 rounded-xl border bg-white p-3 shadow-[0_8px_22px_-14px_rgba(15,23,42,0.45)] transition active:scale-[0.99] lg:flex lg:min-h-[22rem] lg:flex-col lg:items-center lg:rounded-2xl lg:p-7 ${styles.card} ${module.enabled ? 'cursor-pointer hover:shadow-xl' : 'cursor-not-allowed'} ${showingUnavailable ? 'ring-2 ring-slate-400' : ''}`}>
              {module.enabled && <span className="absolute right-0 top-0 grid h-8 w-8 place-items-center rounded-bl-2xl rounded-tr-xl bg-blue-600 text-white">★</span>}
              <span className={`row-span-2 grid h-16 w-16 place-items-center rounded-2xl shadow-lg lg:h-20 lg:w-20 ${styles.icon}`}><Icon className={`h-9 w-9 lg:h-11 lg:w-11 ${module.enabled ? '' : `${showingUnavailable ? 'hidden' : ''} lg:group-hover:hidden`}`} strokeWidth={2.1} />{!module.enabled && <Ban className={`${showingUnavailable ? 'block' : 'hidden'} h-9 w-9 lg:h-11 lg:w-11 lg:group-hover:block`} strokeWidth={2.1} />}</span>
              <div className="min-w-0 lg:mt-5 lg:text-center"><h3 className={`text-base font-bold lg:text-xl ${styles.title}`}>{module.title}</h3><p className="mt-0.5 text-xs font-medium text-slate-500 lg:text-sm">{module.subtitle}</p></div>
              <ul className={`${module.enabled ? 'mt-2 grid' : 'hidden'} space-y-1.5 lg:mt-6 lg:block lg:w-full lg:flex-1 lg:space-y-3`}>{module.features.map((feature) => <li key={typeof feature === 'string' ? feature : feature.title} className="flex items-start gap-2 text-xs text-slate-700 lg:text-sm"><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full lg:h-5 lg:w-5 ${styles.check}`}><Check className="h-2.5 w-2.5 lg:h-3 lg:w-3" strokeWidth={3} /></span>{typeof feature === 'string' ? <span>{feature}</span> : <span className="min-w-0"><span className="block font-bold text-slate-800">{feature.title}</span><span className="block text-[10px] leading-3 text-slate-500 lg:text-xs lg:leading-4">{feature.description}</span></span>}</li>)}</ul>
              <button type="button" disabled={!module.enabled} aria-disabled={!module.enabled} onClick={() => onSelectModule(module.id)} className={`col-span-2 mt-3 min-h-9 w-full rounded-md px-4 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:mt-6 lg:min-h-11 lg:text-sm ${module.enabled ? 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600 active:scale-[0.99]' : `border bg-white ${module.accent === 'emerald' ? 'border-emerald-400 text-emerald-600' : 'border-orange-400 text-orange-600'}`}`}>{module.enabled ? <span className="flex items-center justify-center gap-2">Open Module<ChevronRight className="h-4 w-4" /></span> : <span className="flex items-center justify-center gap-2">{showingUnavailable ? 'Unavailable — Coming Soon' : 'Coming Soon'}<Lock className="h-3.5 w-3.5" /></span>}</button>
            </article>;
          })}
        </div>

        <h3 className="mt-3 text-sm font-bold text-[#07143d] lg:mt-7">Quick actions</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5 lg:gap-5">
          {quickActions.map((action) => { const Icon = action.icon; return <button key={action.label} type="button" disabled={!action.onClick} onClick={action.onClick} className="flex min-h-[4.15rem] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-20 lg:gap-3 lg:p-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg lg:h-11 lg:w-11 ${action.iconBg}`}><Icon className={`h-5 w-5 lg:h-6 lg:w-6 ${action.tone}`} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-[#07143d] lg:text-sm">{action.label}</span><span className="mt-0.5 block text-[10px] leading-3 text-slate-500 lg:text-xs lg:leading-4">{action.description}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-500" /></button>; })}
          <button type="button" disabled={!onLogout} onClick={() => setShowSignOutConfirmation(true)} className="hidden min-h-20 items-center gap-3 rounded-xl border border-red-200 bg-white p-3 text-left text-red-600 shadow-sm transition hover:bg-red-50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 lg:flex"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-red-50"><LogOut className="h-6 w-6" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">Sign Out</span><span className="block text-xs leading-4 text-slate-500">Sign out securely</span></span><ChevronRight className="h-4 w-4 shrink-0" /></button>
        </div>
        <div className="mt-2 space-y-3 lg:mt-5">
          {isAndroid && <button type="button" onClick={() => setShowExitConfirmation(true)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-sm lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-lg bg-red-50"><Power className="h-5 w-5 text-red-600" /></span><span className="flex-1"><span className="block text-sm font-bold text-[#07143d]">Exit App</span><span className="block text-[10px] text-slate-500">Close GridVision application</span></span><ChevronRight className="h-4 w-4 text-slate-500" /></button>}
          <button type="button" disabled={!onLogout} onClick={() => setShowSignOutConfirmation(true)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-red-300 bg-white px-3 text-left text-red-600 disabled:cursor-not-allowed disabled:opacity-50 lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-lg bg-red-50"><LogOut className="h-5 w-5" /></span><span className="flex-1"><span className="block text-sm font-bold">Sign Out</span><span className="block text-[10px] text-slate-600">Sign out from GridVision securely</span></span><ChevronRight className="h-4 w-4" /></button>
        </div>
        <footer className="hidden pt-6 text-center text-xs font-medium text-slate-500 lg:block">GridVision <span aria-hidden="true">•</span> Secure Operations</footer>
      </section>

      {onLogout && <SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onLogout} />}
      {isAndroid && <ExitAppConfirmationDialog open={showExitConfirmation} onCancel={() => setShowExitConfirmation(false)} onConfirm={() => { setShowExitConfirmation(false); void minimizeAndroidApp(); }} />}
      </div>
    </main>
  );
}
