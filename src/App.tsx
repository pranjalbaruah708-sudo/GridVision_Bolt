import { useEffect, useRef, useState } from 'react';

import { AppProvider } from '@/context/AppContext';
import { useRouter, type Route } from '@/hooks/useRouter';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { hasSupabaseInviteCallback } from '@/services/supabase';
import { canAccessRoute, getRoleLabel, type AppRole } from '@/security/permissions';

import { BottomNav } from '@/components/BottomNav';

import { DashboardPage } from '@/pages/DashboardPage';
import { DashboardLogbookPage } from '@/pages/DashboardLogbookPage';
import AnalysisLogbook1 from '@/pages/AnalysisLogbook1';

import { AlertsPage } from '@/pages/AlertsPage';
import {
  ReportsPage,
  type ReportType,
} from '@/pages/ReportsPage';
import { LogBookReportPage } from '@/pages/Reports/LogBookReportPage';
import { InterruptionReportPage } from '@/pages/Reports/InterruptionReportPage';
import { LoadEnergyReportPage } from '@/pages/Reports/LoadEnergyReportPage';
import { DataCompletenessReportPage } from '@/pages/Reports/DataCompletenessReportPage';
import { ParameterExceptionReportPage } from '@/pages/Reports/ParameterExceptionReportPage';
import { PerformanceReportPage } from '@/pages/Reports/PerformanceReportPage';
import { ExecutiveSummaryReportPage } from '@/pages/Reports/ExecutiveSummaryReportPage';
import { NotificationDeliveryReportPage, OperatorActivityReportPage } from '@/pages/Reports/AdministrativeReportPages';

import { OperatorEntryPage } from '@/pages/OperatorEntryPage';
import { InterruptionEntryPage } from '@/pages/InterruptionEntryPage';

import { MorePage, type MoreDestination } from '@/pages/MorePage';
import { MoreRouteShell } from '@/pages/MoreRouteShell';
import { MyProfilePage } from '@/pages/MyProfilePage';
import { AdministrationPage } from '@/pages/AdministrationPages';
import { UsersAccessPage } from '@/pages/UsersAccessPage';
import { SystemConfigurationPage } from '@/pages/SystemConfigurationPage';
import { AuditActivityPage } from '@/pages/AuditActivityPage';
import { SettingsPage } from '@/pages/SettingsPage';

import { SignInPage } from '@/pages/SignInPage';
import { SetPasswordPage } from '@/pages/SetPasswordPage';
import { ModuleSelectionReplicaPage } from '@/pages/ModuleSelectionReplicaPage';


import { Loader2 } from 'lucide-react';

import {
  deactivateCurrentDeviceToken,
} from '@/pushNotifications';

const MORE_ROUTE_SHELL_TITLES: Partial<Record<MoreDestination, string>> = {
  'help-about': 'Help & About',
};


function Shell() {
  const { route, go } = useRouter();
  const auth = useAuth();
  const moreOriginRef = useRef<Route | null>(null);

  const [selectedModule, setSelectedModule] =
    useState<'manual' | 'scada' | 'shutdown' | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [inviteFlowComplete, setInviteFlowComplete] = useState(false);
  const isInvitationFlow = !inviteFlowComplete && (
    new URLSearchParams(window.location.search).get('invite') === '1' ||
    hasSupabaseInviteCallback
  );


  // ======================================================
  // SERVICE WORKER
  // ======================================================

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => undefined);
    }
  }, []);


  // ======================================================
  // RESET MODULE AFTER LOGOUT
  // ======================================================

  useEffect(() => {
    if (!auth.session) {
      setSelectedModule(null);
    }
  }, [auth.session]);

  useEffect(() => {
    if (route.tab !== 'more') {
      moreOriginRef.current = route;
    }
  }, [route]);

  useEffect(() => {
    let cancelled = false;

    if (!auth.session) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    setRoleLoading(true);
    void api.getMyRole()
      .then((nextRole) => {
        if (!cancelled) setRole(nextRole);
      })
      .catch((error: unknown) => {
        console.error('Failed to load application role:', error);
        if (!cancelled) setRole(null);
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.session]);

  const handleSignOut = async () => {
    await deactivateCurrentDeviceToken();
    await auth.signOut();
    setSelectedModule(null);
  };

  const returnToModuleSelection = () => {
    setSelectedModule(null);
    go({ tab: 'dashboard' });
  };

  const returnToReports = () => go({ tab: 'reports' });
  const returnToMore = () => go({ tab: 'more' });
  const returnFromMore = () => {
    if (moreOriginRef.current) {
      go(moreOriginRef.current);
      return;
    }

    returnToModuleSelection();
  };


  // ======================================================
  // AUTH LOADING
  // ======================================================

  if (auth.loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#142851]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
      </div>
    );
  }

  // Invitation setup must win over every regular authenticated route. Supabase
  // places its one-time callback tokens in the URL hash, while this explicit
  // query flag remains stable until SetPasswordPage completes successfully.
  if (isInvitationFlow) {
    return (
      <SetPasswordPage
        hasValidSession={Boolean(auth.session && auth.user)}
        onComplete={() => {
          setInviteFlowComplete(true);
          setSelectedModule(null);
        }}
        onDismiss={() => setInviteFlowComplete(true)}
      />
    );
  }


  // ======================================================
  // SIGN IN
  // ======================================================

  if (!auth.session) {
    return <SignInPage auth={auth} />;
  }

  if (roleLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#142851]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-sm rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Access not configured</h1>
          <p className="mt-2 text-sm text-slate-600">Your GridVision account does not have an active application role. Please contact an administrator.</p>
        </div>
      </div>
    );
  }


  // ======================================================
  // MODULE SELECTION
  // ======================================================

  if (!selectedModule) {
    return (
      <ModuleSelectionReplicaPage
        username={
          auth.user?.user_metadata?.full_name ??
          auth.user?.email?.split('@')[0] ??
          'User'
        }
        role={getRoleLabel(role)}
        avatarUrl={auth.user?.user_metadata?.avatar_url ?? null}
        onSelectModule={(module) => setSelectedModule(module)}
        onNotifications={() => {
          setSelectedModule('manual');
          go({ tab: 'alerts' });
        }}
        onSettings={() => {
          setSelectedModule('manual');
          go({ tab: 'more', sub: 'settings' });
        }}
        onLogout={handleSignOut}
      />
    );
  }

  if (!canAccessRoute(role, route)) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-sm rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Access denied</h1>
          <p className="mt-2 text-sm text-slate-600">You do not have permission to open this page.</p>
          <button type="button" onClick={returnToModuleSelection} className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Return to modules</button>
        </div>
      </div>
    );
  }

  // ======================================================
  // SUB PAGES
  // ======================================================


  // ------------------------------------------------------
  // LOG BOOK REPORT
  // ------------------------------------------------------

  if (
    route.tab === 'reports' &&
    route.sub === 'log-book'
  ) {
    return (
      <>
        <LogBookReportPage onBack={returnToReports} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'interruption-report'
  ) {
    return (
      <>
        <InterruptionReportPage onBack={returnToReports} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'load-energy-report'
  ) {
    return (
      <>
        <LoadEnergyReportPage onBack={returnToReports} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'data-completeness-report'
  ) {
    return (
      <>
        <DataCompletenessReportPage onBack={returnToReports} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'parameter-exception-report'
  ) {
    return (
      <>
        <ParameterExceptionReportPage onBack={returnToReports} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  if (route.tab === 'reports' && route.sub === 'station-performance-report') {
    return <><PerformanceReportPage entity="STATION" onBack={returnToReports} /><BottomNav active="reports" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'reports' && route.sub === 'feeder-performance-report') {
    return <><PerformanceReportPage entity="FEEDER" onBack={returnToReports} /><BottomNav active="reports" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'reports' && route.sub === 'executive-summary-report') {
    return <><ExecutiveSummaryReportPage onBack={returnToReports} /><BottomNav active="reports" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'reports' && route.sub === 'operator-activity-report') {
    return <><OperatorActivityReportPage onBack={returnToReports} /><BottomNav active="reports" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'reports' && route.sub === 'notification-delivery-report') {
    return <><NotificationDeliveryReportPage onBack={returnToReports} /><BottomNav active="reports" onNavigate={(tab) => go({ tab })} /></>;
  }


  // ------------------------------------------------------
  // OPERATOR ENTRY
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'operator-entry'
  ) {
    return (
      <>
        <OperatorEntryPage
          onBack={returnToMore}
        />

        <BottomNav
          active="more"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }


  // ------------------------------------------------------
  // INTERRUPTION ENTRY
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'interruption-entry'
  ) {
    return (
      <>
        <InterruptionEntryPage
          onBack={returnToMore}
        />

        <BottomNav
          active="more"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }


  // ------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'settings'
  ) {
    return (
      <>
        <SettingsPage onBack={returnToMore} />

        <BottomNav
          active="more"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
  }

  const moreRouteShellTitle = route.tab === 'more' && route.sub
    ? MORE_ROUTE_SHELL_TITLES[route.sub as MoreDestination]
    : undefined;

  if (moreRouteShellTitle) {
    return <><MoreRouteShell title={moreRouteShellTitle} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'more' && route.sub === 'profile') {
    return <><MyProfilePage user={auth.user!} role={role} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'more' && route.sub === 'users-access') {
    return <><UsersAccessPage role={role} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'more' && route.sub === 'system-configuration') {
    return <><SystemConfigurationPage role={role} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'more' && route.sub === 'audit-activity') {
    return <><AuditActivityPage role={role} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }

  if (route.tab === 'more' && route.sub && ['organisation-structure', 'network-master-data'].includes(route.sub)) {
    return <><AdministrationPage destination={route.sub as 'organisation-structure' | 'network-master-data'} role={role} onBack={returnToMore} /><BottomNav active="more" onNavigate={(tab) => go({ tab })} /></>;
  }


  // ======================================================
  // MAIN PAGES
  // ======================================================

  let page: React.ReactNode;


  switch (route.tab) {

    // --------------------------------------------------
    // DASHBOARD
    // --------------------------------------------------

    case 'dashboard':

      console.log(
        'Rendering Dashboard'
      );

      page =
        selectedModule === 'manual' ? (
          <DashboardLogbookPage
            onBack={returnToModuleSelection}
            onNavigate={(tab) =>
              go({ tab })
            }
          />
        ) : (
          <DashboardPage
            onNavigate={(tab) =>
              go({ tab })
            }
            onBackToOptions={() =>
              setSelectedModule(null)
            }
          />
        );

      break;


    // --------------------------------------------------
    // ANALYTICS
    // --------------------------------------------------

    case 'analytics':

      page = (
        <AnalysisLogbook1
          onBack={returnToModuleSelection}
        />
      );

      break;


    // --------------------------------------------------
    // ALERTS
    // --------------------------------------------------

    case 'alerts':

      page = (
        <AlertsPage
          onBack={returnToModuleSelection}
        />
      );

      break;


    // --------------------------------------------------
    // REPORTS
    // --------------------------------------------------

    case 'reports':

      page = (
        <ReportsPage
          onBack={returnToModuleSelection}

          onOpenReport={(reportType: ReportType) => {
            if (reportType === 'daily-log-book') {
              go({
                tab: 'reports',
                sub: 'log-book',
              });
            }
            if (reportType === 'interruption') {
              go({
                tab: 'reports',
                sub: 'interruption-report',
              });
            }
            if (reportType === 'load-energy') {
              go({
                tab: 'reports',
                sub: 'load-energy-report',
              });
            }
            if (reportType === 'data-completeness') {
              go({
                tab: 'reports',
                sub: 'data-completeness-report',
              });
            }
            if (reportType === 'parameter-exceptions') {
              go({
                tab: 'reports',
                sub: 'parameter-exception-report',
              });
            }
            if (reportType === 'station-performance') {
              go({ tab: 'reports', sub: 'station-performance-report' });
            }
            if (reportType === 'feeder-performance') {
              go({ tab: 'reports', sub: 'feeder-performance-report' });
            }
            if (reportType === 'executive-summary') {
              go({ tab: 'reports', sub: 'executive-summary-report' });
            }
            if (reportType === 'operator-activity') {
              go({ tab: 'reports', sub: 'operator-activity-report' });
            }
            if (reportType === 'notification-delivery') {
              go({ tab: 'reports', sub: 'notification-delivery-report' });
            }
          }}
        />
      );

      break;


    // --------------------------------------------------
    // MORE
    // --------------------------------------------------

    case 'more':

      page = (
        <MorePage
          fullName={auth.user?.user_metadata?.full_name ?? auth.user?.email?.split('@')[0] ?? 'User'}
          userEmail={auth.user?.email ?? null}
          avatarUrl={auth.user?.user_metadata?.avatar_url ?? null}
          role={role}
          onSignOut={handleSignOut}
          onBack={returnFromMore}
          onSwitchModule={returnToModuleSelection}
          onOpen={(id) => go({ tab: 'more', sub: id })}
        />
      );

      break;


    // --------------------------------------------------
    // DEFAULT
    // --------------------------------------------------

    default:

      page =
        selectedModule === 'manual' ? (
         <DashboardLogbookPage
           onBack={returnToModuleSelection}
           onNavigate={(tab) =>
             go({ tab })
           }
         />
        ) : (
          <DashboardPage
            onNavigate={(tab) =>
              go({ tab })
            }

            onBackToOptions={() =>
              setSelectedModule(null)
            }
          />
        );

      break;
  }


  // ======================================================
  // PAGE + BOTTOM NAVIGATION
  // ======================================================

  return (
    <>
      {page}

      <BottomNav
        active={route.tab}
        onNavigate={(tab) =>
          go({ tab })
        }
      />
    </>
  );
}


// ========================================================
// APP
// ========================================================

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
