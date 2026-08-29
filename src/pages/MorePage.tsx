import { useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, ClipboardPenLine, FileCog, GitBranch, HelpCircle, LogOut, Network, Power, Settings, ShieldCheck, SlidersHorizontal, UsersRound, ZapOff } from 'lucide-react';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { SignOutConfirmationDialog } from '@/components/SignOutConfirmationDialog';
import { useApp } from '@/context/AppContext';
import { getRoleLabel, hasCapability, type AppRole, type Capability } from '@/security/permissions';

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

function initialsFor(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GV';
}

function isAllowed(item: MenuItem, role: AppRole) {
  return !item.capabilities || item.capabilities.some((capability) => hasCapability(role, capability));
}

function MenuRows({ items, role, onOpen }: { items: MenuItem[]; role: AppRole; onOpen: (id: MoreDestination) => void }) {
  return <div className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="divide-y divide-slate-100">{items.filter((item) => isAllowed(item, role)).map((item) => {
    const Icon = item.icon;
    const badge = item.badge?.(role);
    return <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.tone}`}><Icon className="h-5 w-5 text-white" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{item.label}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.description}</span></span>{badge && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{badge}</span>}<ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /></button>;
  })}</div></div>;
}

export function MorePage({ onOpen, onSwitchModule, fullName, userEmail, avatarUrl, role, onSignOut }: { onOpen: (id: MoreDestination) => void; onSwitchModule: () => void; fullName: string; userEmail: string | null; avatarUrl?: string | null; role: AppRole; onSignOut: () => Promise<void> }) {
  const { activeStation, stations } = useApp();
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const isAndroid = Capacitor.getPlatform() === 'android';
  const operationalItems = useMemo(() => OPERATIONAL_ITEMS.filter((item) => isAllowed(item, role)), [role]);
  const administrationItems = useMemo(() => ADMINISTRATION_ITEMS.filter((item) => isAllowed(item, role)), [role]);
  const scope = role === 'OPERATOR' ? activeStation?.name ?? 'No assigned station' : `${stations.length} accessible station${stations.length === 1 ? '' : 's'}`;

  return <Screen>
    <AppHeader title="More" subtitle={`${getRoleLabel(role)} workspace`} className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0]" />
    <PageBody>
      <button type="button" onClick={() => onOpen('profile')} className="mb-5 flex min-h-20 w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:bg-slate-100" aria-label="Open My Profile">
        {avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-12 w-12 rounded-full object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-700 text-sm font-bold text-white">{initialsFor(fullName)}</span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{fullName}</span><span className="mt-0.5 block text-xs font-medium text-blue-700">{getRoleLabel(role)}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{scope}{userEmail ? ` · ${userEmail}` : ''}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
      </button>

      {operationalItems.length > 0 && <section className="mb-5"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">OPERATIONAL TOOLS</h2><MenuRows items={operationalItems} role={role} onOpen={onOpen} /></section>}
      {administrationItems.length > 0 && <section className="mb-5"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">ADMINISTRATION</h2><MenuRows items={administrationItems} role={role} onOpen={onOpen} /></section>}

      <section className="mb-5"><h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500">APP &amp; SUPPORT</h2><div className="overflow-hidden rounded-2xl bg-white shadow-sm"><button type="button" onClick={onSwitchModule} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600"><FileCog className="h-5 w-5 text-white" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">Switch Module</span><span className="mt-0.5 block text-xs text-slate-500">Return to the GridVision module selector</span></span><ChevronRight className="h-4 w-4 text-slate-300" /></button><div className="border-t border-slate-100"><MenuRows items={SUPPORT_ITEMS} role={role} onOpen={onOpen} /></div></div></section>

      {isAndroid && <button type="button" onClick={() => { void CapacitorApp.minimizeApp(); }} className="mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><Power className="h-4 w-4" />Close App</button>}
      <button type="button" onClick={() => setShowSignOutConfirmation(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-white text-sm font-semibold text-red-600 transition hover:bg-red-50"><LogOut className="h-4 w-4" />Sign Out</button>
      <p className="mt-6 text-center text-[11px] text-slate-400">GridVision · Secure Operations</p>
      <SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onSignOut} />
    </PageBody>
  </Screen>;
}
