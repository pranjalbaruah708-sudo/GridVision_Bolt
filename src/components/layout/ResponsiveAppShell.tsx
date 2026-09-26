import { useState, type ReactNode } from 'react';

import { BottomNav, type Tab } from '@/components/BottomNav';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { DesktopHeader } from '@/components/layout/DesktopHeader';
import { useApp } from '@/context/AppContext';
import type { AppRole } from '@/security/permissions';
import type { Route } from '@/hooks/useRouter';
import type { GridVisionModule } from '@/pages/ModuleSelectionReplicaPage';
import { isAndroidApp } from '@/services/platform/runtime';
import { SignOutConfirmationDialog } from '@/components/SignOutConfirmationDialog';

export type DesktopShellIdentity = { fullName: string; designation: string; employeeCode: string | null; email: string | null; avatarUrl: string | null; assignedOffices: string[]; accessibleStationCount: number; role: AppRole };

type ResponsiveAppShellProps = {
  active: Tab;
  onNavigate: (tab: Tab) => void;
  children: ReactNode;
  identity: DesktopShellIdentity;
  onOpenProfile: () => void;
  onOpenAlerts: () => void;
  onSignOut: () => Promise<void>;
  route: Route;
  selectedModule: GridVisionModule;
  onNavigateRoute: (route: Route) => void;
  onOpenModuleSelection: () => void;
  onSelectModule: (module: GridVisionModule) => void;
};

/**
 * The desktop breakpoint is intentionally isolated in this component. Existing
 * pages render through an unstyled main element below `lg`, preserving their
 * current mobile sizing, headers, safe areas, and bottom spacing.
 */
export function ResponsiveAppShell({ active, onNavigate, children, identity, onOpenProfile, onOpenAlerts, onSignOut, route, selectedModule, onNavigateRoute, onOpenModuleSelection, onSelectModule }: ResponsiveAppShellProps) {
  const { online, pending } = useApp();
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const androidShellClass = isAndroidApp() ? 'gv-android-shell' : '';
  return (
    <>
      <div className="hidden lg:block">
        <DesktopSidebar route={route} onNavigate={onNavigateRoute} identity={identity} selectedModule={selectedModule} onOpenProfile={onOpenProfile} onOpenModuleSelection={onOpenModuleSelection} onSelectModule={onSelectModule} />
      </div>

      <main className={`${androidShellClass} lg:min-h-screen lg:min-w-0 lg:overflow-x-clip lg:pl-64`}>
        <DesktopHeader identity={identity} online={online} pending={pending} onAlerts={onOpenAlerts} onProfile={onOpenProfile} onSignOut={() => setShowSignOutConfirmation(true)} />
        {children}
      </main>

      <div className="hidden lg:block">
        <SignOutConfirmationDialog open={showSignOutConfirmation} onCancel={() => setShowSignOutConfirmation(false)} onConfirm={onSignOut} />
      </div>

      <div className="lg:hidden">
        <BottomNav
          active={active}
          onNavigate={onNavigate}
          module={selectedModule}
          onShutdownNavigate={(target) => {
            if (target === 'dashboard') onNavigateRoute({ tab: 'dashboard' });
            if (target === 'requests') onNavigateRoute({ tab: 'dashboard', sub: 'my-requests' });
            if (target === 'initiate') onNavigateRoute({ tab: 'dashboard', sub: 'shutdown-request-new' });
            if (target === 'reports') onNavigateRoute({ tab: 'dashboard', sub: 'shutdown-reports' });
          }}
          onOpenModuleSelection={onOpenModuleSelection}
          role={identity.role}
          shutdownActive={selectedModule === 'shutdown' ? (route.sub === 'my-requests' ? 'requests' : route.sub === 'shutdown-reports' ? 'reports' : route.sub?.startsWith('shutdown-request-') ? 'initiate' : 'dashboard') : undefined}
        />
      </div>
    </>
  );
}
