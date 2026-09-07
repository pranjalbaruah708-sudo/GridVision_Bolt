import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Cloud, CloudOff, LogOut, UserRound } from 'lucide-react';

import type { DesktopShellIdentity } from '@/components/layout/ResponsiveAppShell';

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GV';
}

export function DesktopHeader({ identity, online, pending, onAlerts, onProfile, onSignOut }: { identity: DesktopShellIdentity; online: boolean; pending: number; onAlerts: () => void; onProfile: () => void; onSignOut: () => void }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen]);

  return <header className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-blue-800 bg-gradient-to-r from-[#0B4695] to-[#07336F] px-6 text-white shadow-sm lg:flex xl:px-8">
    <div className="flex items-center gap-2 text-xs font-semibold text-blue-100" aria-live="polite">
      {online ? <Cloud className="h-4 w-4 text-emerald-300" /> : <CloudOff className="h-4 w-4 text-amber-300" />}
      <span>{online ? 'Connected' : 'Offline'}</span>
      {pending > 0 && <span className="rounded-full bg-amber-400/20 px-2 py-1 text-amber-100">{pending} pending</span>}
    </div>
    <div className="flex items-center gap-3">
      <button type="button" onClick={onAlerts} className="grid h-10 w-10 place-items-center rounded-xl text-blue-100 transition hover:bg-white/10 hover:text-white" aria-label="Open alerts"><Bell className="h-5 w-5" /></button>
      <div ref={profileMenuRef} className="relative">
        <button type="button" onClick={() => setProfileMenuOpen((open) => !open)} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/10" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen}>
          {identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-9 w-9 rounded-full border border-white/30 object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-600 text-xs font-extrabold ring-1 ring-white/25">{initials(identity.fullName)}</span>}
          <span className="min-w-0"><span className="block max-w-40 truncate text-sm font-bold xl:max-w-48">{identity.fullName}</span><span className="block max-w-40 truncate text-[11px] text-blue-100 xl:max-w-48">{identity.designation}</span></span>
          <ChevronDown className={`h-4 w-4 text-blue-100 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {profileMenuOpen && <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] w-52 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl">
          <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); onProfile(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-slate-100"><UserRound className="h-4 w-4 text-blue-600" />My Profile</button>
          <div className="my-1 border-t border-slate-100" />
          <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); onSignOut(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" />Sign Out</button>
        </div>}
      </div>
    </div>
  </header>;
}
