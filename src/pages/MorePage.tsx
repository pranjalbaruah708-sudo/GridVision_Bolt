import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ChevronRight, ClipboardPenLine, FileCog, GitBranch, HelpCircle, LogOut, Network, Power, Settings, ShieldCheck, SlidersHorizontal, UsersRound, ZapOff } from 'lucide-react';
import { PageBody } from '@/components/ui/Page';
import { ExitAppConfirmationDialog } from '@/components/ExitAppConfirmationDialog';
import { SignOutConfirmationDialog } from '@/components/SignOutConfirmationDialog';
import { useApp } from '@/context/AppContext';
import { getRoleLabel, hasCapability, type AppRole, type Capability } from '@/security/permissions';
import { isAndroidApp, minimizeAndroidApp } from '@/services/platform/runtime';
import { DesktopPageContainer } from '@/components/layout/DesktopPageContainer';

export type MoreDestination = 'profile' | 'operator-entry' | 'interruption-entry' | 'organisation-structure' | 'network-master-data' | 'users-access' | 'system-configuration' | 'audit-activity' | 'settings' | 'help-about';

type MenuItem = { id: MoreDestination; label: string; description: string; icon: LucideIcon; tone: string; capabilities?: readonly Capability[]; badge?: (role: AppRole) => string | null };

const OPERATIONAL_ITEMS: MenuItem[] = [
  { id: 'operator-entry', label: 'Parameter Entry', description: 'Record substation operating readings', icon: ClipboardPenLine, tone: 'bg-blue-600', capabilities: ['create_parameter_entry'] },
  { id: 'interruption-entry', label: 'Interruption Entry', description: 'Record feeder trips and restoration', icon: ZapOff, tone: 'bg-red-600', capabilities: ['create_interruption_entry'] },
];

const ADMINISTRATION_ITEMS: MenuItem[] = [
  { id: 'organisation-structure', label: 'Organisation Structure', description: 'View organisational and station hierarchy', icon: GitBranch, tone: 'bg-violet-600', capabilities: ['view_organisation_structure'], badge: (role) => hasCapability(role, 'manage_offices') ? 'Manage' : 'View' },
  { id: 'network-master-data', label: 'Network Master Data', description: 'Stations, feeders and network configuration', icon: Network, tone: 'bg-cyan-600', capabilities: ['manage_scoped_feeders', 'manage_all_feeders'] },
  { id: 'users-access', label: 'Users & Access', description: 'View and manage authorised users', icon: UsersRound, tone: 'bg-indigo-600', capabilities: ['view_scoped_users', 'manage_users'] },
  { id: 'system-configuration', label: 'System Configuration', description: 'Operational and system settings', icon: SlidersHorizontal, tone: 'bg-slate-700', capabilities: ['manage_scoped_configuration', 'manage_system_configuration'] },
  { id: 'audit-activity', label: 'Audit Activity', description: 'Review operational and administrative activity', icon: ShieldCheck, tone: 'bg-amber-600', capabilities: ['view_scoped_audit', 'view_all_audit'] },
];

const SUPPORT_ITEMS: MenuItem[] = [
  { id: 'settings', label: 'Settings', description: 'App preferences and notifications', icon: Settings, tone: 'bg-slate-700' },
  { id: 'help-about', label: 'Help & About', description: 'Application help and support information', icon: HelpCircle, tone: 'bg-blue-600' },
];

export function getAvailableMoreNavigation(role: AppRole): Array<{ id: MoreDestination; label: string }> {
  return [
    { id: 'profile' as const, label: 'My Profile' },
    ...ADMINISTRATION_ITEMS.filter((item) => isAllowed(item, role)).map(({ id, label }) => ({ id, label })),
    { id: 'help-about' as const, label: 'Help & About' },
  ];
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GV';
}

function isAllowed(item: MenuItem, role: AppRole) {
  return !item.capabilities || item.capabilities.some((capability) => hasCapability(role, capability));
}

function MenuRows({ items, role, onOpen }: { items: MenuItem[]; role: AppRole; onOpen: (id: MoreDestination) => void }) {
  return <div className="overflow-hidden rounded-2xl bg-white shadow-sm lg:overflow-visible lg:bg-transparent lg:shadow-none"><div className="divide-y divide-slate-100 lg:grid lg:grid-cols-2 lg:gap-3 lg:divide-y-0 xl:grid-cols-3">{items.filter((item) => isAllowed(item, role)).map((item) => {
    const Icon = item.icon;
    const badge = item.badge?.(role);
    return <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100 lg:min-h-24 lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-4 lg:shadow-sm lg:hover:border-blue-200 lg:hover:shadow-md"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.tone}`}><Icon className="h-5 w-5 text-white" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{item.label}</span><span className="mt-0.5 block truncate text-xs text-slate-500 lg:whitespace-normal">{item.description}</span></span>{badge && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{badge}</span>}<ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /></button>;
  })}</div></div>;
}

type MorePageProps = { onBack: () => void; onOpen: (id: MoreDestination) => void; onSwitchModule: () => void; fullName: string; userEmail: string | null; avatarUrl?: string | null; designation: string; employeeCode: string | null; assignedOffices: string[]; accessibleStationCount: number; role: AppRole; onSignOut: () => Promise<void> };

export function MorePage({ onBack, onOpen, onSwitchModule, fullName, userEmail, avatarUrl, designation, employeeCode, assignedOffices, accessibleStationCount, role, onSignOut }: MorePageProps) {
  const { activeStation, stations } = useApp();
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const isAndroid = isAndroidApp();
  const operationalItems = useMemo(() => OPERATIONAL_ITEMS.filter((item) => isAllowed(item, role)), [role]);
  const administrationItems = useMemo(() => ADMINISTRATION_ITEMS.filter((item) => isAllowed(item, role)), [role]);
  const scope = role === 'OPERATOR' ? activeStation?.name ?? 'No assigned station' : `${stations.length} accessible station${stations.length === 1 ? '' : 's'}`;

  return <><div className="min-h-screen bg-[#f0f2f7] lg:hidden">
    <header className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] px-4 pb-4 pt-[22px] text-white shadow-md lg:rounded-none lg:px-0">
      <DesktopPageContainer width="wide">
      <div className="grid min-h-8 grid-cols-[32px_1fr_32px] items-center">
        <button type="button" onClick={onBack} className="rounded-full p-1 transition hover:bg-white/10 active:scale-95" aria-label="Back to previous page">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center">
          <h1 className="m-0 text-2xl font-bold">More</h1>
          <p className="mt-0.5 text-xs font-medium text-blue-100/90">{getRoleLabel(role)} workspace</p>
        </div>
        <span aria-hidden="true" />
      </div>
      </DesktopPageContainer>
    </header>
    <DesktopPageContainer width="wide">
    <PageBody className="lg:grid lg:max-w-none lg:grid-cols-12 lg:items-start lg:gap-x-6 lg:px-0 lg:py-6 lg:pb-10">
      <button type="button" onClick={() => onOpen('profile')} className="mb-5 flex min-h-20 w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:bg-slate-100 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:mb-0 lg:min-h-32 lg:border lg:border-slate-200 lg:p-5" aria-label="Open My Profile">
        {avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-12 w-12 rounded-full object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-700 text-sm font-bold text-white">{initialsFor(fullName)}</span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{fullName}</span><span className="mt-0.5 block text-xs font-medium text-blue-700">{getRoleLabel(role)}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{scope}{userEmail ? ` · ${userEmail}` : ''}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
      </button>

      {operationalItems.length > 0 && <section className="mb-5 lg:col-span-8 lg:col-start-5 lg:row-start-1"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">OPERATIONAL TOOLS</h2><MenuRows items={operationalItems} role={role} onOpen={onOpen} /></section>}
      {administrationItems.length > 0 && <section className="mb-5 lg:col-span-8 lg:col-start-5"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">ADMINISTRATION</h2><MenuRows items={administrationItems} role={role} onOpen={onOpen} /></section>}

      <section className="mb-5 lg:col-span-8 lg:col-start-5"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">APP &amp; SUPPORT</h2><div className="overflow-hidden rounded-2xl bg-white shadow-sm lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-visible lg:bg-transparent lg:shadow-none"><button type="button" onClick={onSwitchModule} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100 lg:min-h-24 lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-4 lg:shadow-sm lg:hover:border-blue-200 lg:hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600"><FileCog className="h-5 w-5 text-white" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">Switch Module</span><span className="mt-0.5 block text-xs text-slate-500">Return to the GridVision module selector</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button><div className="border-t border-slate-100 lg:col-span-2 lg:border-0 [&>div>div]:lg:grid-cols-2"><MenuRows items={SUPPORT_ITEMS} role={role} onOpen={onOpen} /></div></div></section>

      {isAndroid && <button type="button" onClick={() => setShowExitConfirmation(true)} className="mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-blue-600 bg-white text-sm font-semibold text-blue-600 transition hover:bg-blue-50 lg:col-span-4 lg:col-start-1 lg:row-start-2 lg:mt-4"><Power className="h-4 w-4" />Exit App</button>}
      <button type="button" onClick={() => setShowSignOutConfirmation(true)} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-red-600 bg-white text-sm font-semibold text-red-600 transition hover:bg-red-50 lg:col-span-4 lg:col-start-1 lg:mt-4 ${isAndroid ? 'lg:row-start-3' : 'lg:row-start-2'}`}><LogOut className="h-4 w-4" />Sign Out</button>
      <p className={`mt-6 text-center text-[11px] text-slate-400 lg:col-span-4 lg:col-start-1 ${isAndroid ? 'lg:row-start-4' : 'lg:row-start-3'}`}>GridVision · Secure Operations</p>
      <ExitAppConfirmationDialog open={showExitConfirmation} onCancel={() => setShowExitConfirmation(false)} onConfirm={() => { setShowExitConfirmation(false); void minimizeAndroidApp(); }} />
      <SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onSignOut} />
    </PageBody>
    </DesktopPageContainer>
  </div>
  <DesktopMorePage fullName={fullName} userEmail={userEmail} avatarUrl={avatarUrl} designation={designation} employeeCode={employeeCode} assignedOffices={assignedOffices} accessibleStationCount={accessibleStationCount} role={role} operationalItems={operationalItems} administrationItems={administrationItems} onOpen={onOpen} onSwitchModule={onSwitchModule} onSignOut={() => setShowSignOutConfirmation(true)} />
  <div className="hidden lg:block"><SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onSignOut} /></div>
  </>;
}

function DesktopMoreCard({ item, role, onOpen }: { item: MenuItem; role: AppRole; onOpen: (id: MoreDestination) => void }) {
  const Icon = item.icon; const badge = item.badge?.(role);
  return <button type="button" onClick={() => onOpen(item.id)} className="group flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"><span className={`grid h-12 w-12 place-items-center rounded-full ${item.tone}`}><Icon className="h-6 w-6 text-white" /></span><span className="mt-4 flex w-full items-start justify-between gap-2"><span className="text-base font-bold leading-6 text-slate-900">{item.label}</span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /></span><span className="mt-2 text-sm leading-5 text-slate-500">{item.description}</span>{badge && <span className="mt-auto self-start rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{badge}</span>}</button>;
}

function DesktopMorePage({ fullName, userEmail, avatarUrl, designation, employeeCode, assignedOffices, accessibleStationCount, role, operationalItems, administrationItems, onOpen, onSwitchModule, onSignOut }: Omit<MorePageProps, 'onBack' | 'onSignOut'> & { operationalItems: MenuItem[]; administrationItems: MenuItem[]; onSignOut: () => void }) {
  return <main className="hidden min-h-[calc(100vh-4rem)] bg-[#F4F7FB] px-6 py-7 lg:block xl:px-8">
    <div className="mx-auto max-w-7xl">
      <div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">More</h1><p className="mt-1 text-sm text-slate-500">{designation} workspace and system administration</p></div>
      <section className="mt-6 grid grid-cols-[minmax(0,1fr)_300px] items-center gap-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <button type="button" onClick={() => onOpen('profile')} className="flex min-w-0 items-center gap-5 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          {avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-20 w-20 rounded-full object-cover" /> : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-blue-800 text-xl font-extrabold text-white">{initialsFor(fullName)}</span>}
          <span className="min-w-0"><span className="block truncate text-xl font-extrabold text-slate-900">{fullName}</span><span className="mt-1 block text-sm font-semibold text-blue-700">{designation || getRoleLabel(role)}</span><span className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">{employeeCode && <span>Employee code: {employeeCode}</span>}<span>{accessibleStationCount} accessible station{accessibleStationCount === 1 ? '' : 's'}</span>{userEmail && <span>{userEmail}</span>}{assignedOffices.length > 0 && <span>{assignedOffices.join(', ')}</span>}</span></span>
        </button>
        <div className="border-l border-slate-200 pl-7"><p className="text-xs font-semibold text-slate-500">Current Module</p><p className="mt-1 text-sm font-bold text-blue-700">GridVision</p><button type="button" onClick={onSwitchModule} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-50"><FileCog className="h-4 w-4" />Switch Module</button></div>
      </section>

      {operationalItems.length > 0 && <section className="mt-7"><h2 className="mb-3 border-b border-slate-200 pb-2 text-base font-bold text-slate-900">Operational Tools</h2><div className="grid grid-cols-2 gap-4 xl:grid-cols-3">{operationalItems.map((item) => <DesktopMoreCard key={item.id} item={item} role={role} onOpen={onOpen} />)}</div></section>}
      {administrationItems.length > 0 && <section className="mt-7"><h2 className="mb-3 border-b border-slate-200 pb-2 text-base font-bold text-slate-900">Administration</h2><div className="grid grid-cols-2 gap-4 xl:grid-cols-5">{administrationItems.map((item) => <DesktopMoreCard key={item.id} item={item} role={role} onOpen={onOpen} />)}</div></section>}

      <section className="mt-7"><h2 className="mb-3 border-b border-slate-200 pb-2 text-base font-bold text-slate-900">App &amp; Support</h2><div className="grid grid-cols-3 gap-4"><button type="button" onClick={onSwitchModule} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md"><span className="grid h-12 w-12 place-items-center rounded-full bg-blue-600"><FileCog className="h-6 w-6 text-white" /></span><span><span className="block font-bold text-slate-900">Switch Module</span><span className="mt-1 block text-sm text-slate-500">Return to the module selector</span></span></button>{SUPPORT_ITEMS.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md"><span className={`grid h-12 w-12 place-items-center rounded-full ${item.tone}`}>{<item.icon className="h-6 w-6 text-white" />}</span><span><span className="block font-bold text-slate-900">{item.label}</span><span className="mt-1 block text-sm text-slate-500">{item.description}</span></span></button>)}</div></section>
      <button type="button" onClick={onSignOut} className="mt-6 flex w-full items-center gap-4 rounded-2xl border border-red-300 bg-white px-6 py-4 text-left text-red-600 transition hover:bg-red-50"><LogOut className="h-6 w-6" /><span><span className="block font-bold">Sign Out</span><span className="block text-xs text-slate-500">Sign out from GridVision</span></span></button>
      <footer className="flex justify-between py-8 text-xs text-slate-400"><span>GridVision · Secure Operations</span><span>v1.0.0</span></footer>
    </div>
  </main>;
}
