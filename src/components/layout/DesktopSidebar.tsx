import { BarChart2, Bell, ChevronRight, ClipboardPenLine, Clock3, FileText, Home, MoreHorizontal, Settings, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, type FocusEvent } from 'react';
import { Logo } from '@/components/Logo';
import type { DesktopShellIdentity } from '@/components/layout/ResponsiveAppShell';
import type { Route } from '@/hooks/useRouter';
import { hasCapability } from '@/security/permissions';
import { getAvailableReportNavigation } from '@/pages/ReportsPage';
import { getAvailableMoreNavigation } from '@/pages/MorePage';
import type { GridVisionModule } from '@/pages/ModuleSelectionReplicaPage';

type SubmenuItem = { label: string; route?: Route; onSelect?: () => void; disabled?: boolean; badge?: string };
type Props = { route: Route; identity: DesktopShellIdentity; selectedModule: GridVisionModule; onNavigate: (route: Route) => void; onOpenProfile: () => void; onOpenModuleSelection: () => void; onSelectModule: (module: GridVisionModule) => void };

function initials(name: string): string { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GV'; }
function isRouteActive(current: Route, target?: Route): boolean { return Boolean(target && current.tab === target.tab && current.sub === target.sub); }

function FlyoutItem({ item, route, onNavigate }: { item: SubmenuItem; route: Route; onNavigate: (route: Route) => void }) {
  const active = isRouteActive(route, item.route);
  return <button type="button" role="menuitem" disabled={item.disabled} aria-current={active ? 'page' : undefined} onClick={() => item.route ? onNavigate(item.route) : item.onSelect?.()} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${item.disabled ? 'cursor-not-allowed text-slate-400' : active ? 'bg-blue-50 font-bold text-blue-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'}`}><span>{item.label}</span>{item.badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500">{item.badge}</span>}</button>;
}

function SidebarGroup({ label, icon: Icon, active, onClick, items, route, onNavigate }: { label: string; icon: LucideIcon; active: boolean; onClick: () => void; items: SubmenuItem[]; route: Route; onNavigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const openFlyout = () => setOpen(true);
  const closeFlyout = () => setOpen(false);
  const closeAfterFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeFlyout();
  };

  return <div className="group relative" onMouseEnter={openFlyout} onMouseLeave={closeFlyout} onFocusCapture={openFlyout} onBlurCapture={closeAfterFocusLeaves}>
    <button type="button" onClick={onClick} aria-haspopup="menu" aria-expanded={open} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${active ? 'bg-blue-600/70 text-white shadow-sm ring-1 ring-blue-300/20' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`}><Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} /><span className="min-w-0 flex-1 truncate">{label}</span><ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? 'translate-x-0.5' : ''}`} /></button>
    <div onMouseEnter={openFlyout} onMouseLeave={closeFlyout} className={`absolute left-[calc(100%-0.25rem)] top-0 z-50 w-[18.25rem] pl-2 ${open ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'}`} role="menu"><div className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl"><p className="px-3 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p>{items.map((item) => <FlyoutItem key={`${item.label}-${item.route?.sub ?? 'action'}`} item={item} route={route} onNavigate={onNavigate} />)}</div></div>
  </div>;
}

export function DesktopSidebar({ route, identity, selectedModule, onNavigate, onOpenProfile, onOpenModuleSelection, onSelectModule }: Props) {
  const analytics: SubmenuItem[] = [{ label: 'Load/Demand Analysis', route: { tab: 'analytics', sub: 'load-demand' } }, { label: 'Interruption Analysis', route: { tab: 'analytics', sub: 'interruptions' } }, { label: 'Indices', route: { tab: 'analytics', sub: 'indices' } }];
  const alerts: SubmenuItem[] = ['all', 'critical', 'warning', 'info'].map((sub) => ({ label: sub === 'all' ? 'All' : sub[0].toUpperCase() + sub.slice(1), route: { tab: 'alerts', sub } }));
  const operator: SubmenuItem[] = [{ label: 'Current Shift', route: { tab: 'more', sub: 'current-shift' } }, ...(hasCapability(identity.role, 'create_parameter_entry') ? [{ label: 'Parameter Entry', route: { tab: 'more', sub: 'operator-entry' } }, { label: 'Interruption Entry', route: { tab: 'more', sub: 'interruption-entry' } }] as SubmenuItem[] : [])];
  const reports: SubmenuItem[] = getAvailableReportNavigation(identity.role).map((item) => ({ label: item.label, route: { tab: 'reports', sub: item.sub } }));
  const more: SubmenuItem[] = getAvailableMoreNavigation(identity.role).map((item) => ({ label: item.label, route: { tab: 'more', sub: item.id } }));
  const modules: SubmenuItem[] = [{ label: 'Digital Log Books', onSelect: () => onSelectModule('manual'), badge: selectedModule === 'manual' ? 'Current' : undefined }, { label: 'SCADA Integration', disabled: true, badge: 'Coming Soon' }, { label: 'Shutdown Management', disabled: true, badge: 'Coming Soon' }];
  const operatorActive = route.tab === 'more' && (route.sub === 'current-shift' || route.sub === 'operator-entry' || route.sub === 'interruption-entry');
  const groupProps = { route, onNavigate };

  return <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-blue-900/70 bg-gradient-to-b from-[#062E61] via-[#052957] to-[#032348] text-white shadow-xl">
    <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 shadow-sm ring-1 ring-white/15"><Logo size={31} className="h-8 w-8" /></span><div><p className="text-lg font-bold tracking-tight">GridVision</p><p className="text-xs font-medium text-blue-200">Grid operations</p></div></div>
    <nav className="flex-1 space-y-1 p-4" aria-label="Primary navigation">
      <button type="button" onClick={() => onNavigate({ tab: 'dashboard' })} aria-current={route.tab === 'dashboard' ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors ${route.tab === 'dashboard' ? 'bg-blue-600/70 text-white shadow-sm ring-1 ring-blue-300/20' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`}><Home className="h-5 w-5" /><span>Dashboard</span></button>
      <SidebarGroup label="Analytics" icon={BarChart2} active={route.tab === 'analytics'} onClick={() => onNavigate({ tab: 'analytics', sub: 'load-demand' })} items={analytics} {...groupProps} />
      <SidebarGroup label="Alerts" icon={Bell} active={route.tab === 'alerts'} onClick={() => onNavigate({ tab: 'alerts', sub: 'all' })} items={alerts} {...groupProps} />
      <SidebarGroup label="Operations" icon={Clock3} active={operatorActive} onClick={() => onNavigate({ tab: 'more', sub: 'current-shift' })} items={operator} {...groupProps} />
      <SidebarGroup label="Reports" icon={FileText} active={route.tab === 'reports'} onClick={() => onNavigate({ tab: 'reports' })} items={reports} {...groupProps} />
      <button type="button" onClick={() => onNavigate({ tab: 'more', sub: 'settings' })} aria-current={route.tab === 'more' && route.sub === 'settings' ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors ${route.tab === 'more' && route.sub === 'settings' ? 'bg-blue-600/70 text-white shadow-sm ring-1 ring-blue-300/20' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`}><Settings className="h-5 w-5 shrink-0" /><span>Settings</span></button>
      <SidebarGroup label="More" icon={MoreHorizontal} active={route.tab === 'more' && !operatorActive && route.sub !== 'settings'} onClick={() => onNavigate({ tab: 'more' })} items={more} {...groupProps} />
      <SidebarGroup label="Switch Module" icon={SlidersHorizontal} active={false} onClick={onOpenModuleSelection} items={modules} {...groupProps} />
    </nav>
    <button type="button" onClick={onOpenProfile} className="m-4 flex items-center gap-3 border-t border-white/10 px-1 pt-4 text-left transition hover:text-blue-100" aria-label="Open profile">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-white/25 object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-extrabold ring-1 ring-white/20">{initials(identity.fullName)}</span>}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{identity.fullName}</span><span className="block truncate text-[11px] text-blue-200">{identity.designation}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-blue-200" /></button>
  </aside>;
}
