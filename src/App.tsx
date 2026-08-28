import { useEffect, useState } from 'react';

import { AppProvider } from '@/context/AppContext';
import { useRouter } from '@/hooks/useRouter';
import { useAuth } from '@/hooks/useAuth';

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

import { MorePage } from '@/pages/MorePage';
import { SettingsPage } from '@/pages/SettingsPage';

import { SignInPage } from '@/pages/SignInPage';
import { ModuleSelectionReplicaPage } from '@/pages/ModuleSelectionReplicaPage';

import { NotificationTestPage } from '@/pages/NotificationTestPage';

import { Loader2 } from 'lucide-react';

import {
  deactivateCurrentDeviceToken,
} from '@/pushNotifications';


function Shell() {
  const { route, go } = useRouter();
  const auth = useAuth();

  const [selectedModule, setSelectedModule] =
    useState<'manual' | 'scada' | 'shutdown' | null>(null);


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

  const handleSignOut = async () => {
    try {
      console.log('🚪 Starting logout...');
      await deactivateCurrentDeviceToken();
      console.log('✅ Device token deactivated successfully.');
      await auth.signOut();
      setSelectedModule(null);
      console.log('✅ Supabase logout completed.');
    } catch (error) {
      console.error('❌ Logout failed:', error);
      throw error;
    }
  };

  const returnToModuleSelection = () => {
    setSelectedModule(null);
    go({ tab: 'dashboard' });
  };

  const returnToReports = () => go({ tab: 'reports' });
  const returnToMore = () => go({ tab: 'more' });


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


  // ======================================================
  // SIGN IN
  // ======================================================

  if (!auth.session) {
    return <SignInPage auth={auth} />;
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
        role="System Operator"
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


  // ------------------------------------------------------
  // NOTIFICATION TEST
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'notification-test'
  ) {
    return (
      <>
        <NotificationTestPage
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
          userEmail={
            auth.user?.email ?? null
          }

          onSignOut={handleSignOut}


          // --------------------------------------------
          // MORE PAGE NAVIGATION
          // --------------------------------------------

          onOpen={(id) => {

            switch (id) {

              case 'operator-entry':

                go({
                  tab: 'more',
                  sub: 'operator-entry',
                });

                break;


              case 'interruption-entry':

                go({
                  tab: 'more',
                  sub: 'interruption-entry',
                });

                break;


              case 'settings':

                go({
                  tab: 'more',
                  sub: 'settings',
                });

                break;


              case 'analytics':

                go({
                  tab: 'analytics',
                });

                break;


              case 'notification-test':

                go({
                  tab: 'more',
                  sub: 'notification-test',
                });

                break;


              case 'reports':

                go({
                  tab: 'reports',
                });

                break;


              case 'alerts':

                go({
                  tab: 'alerts',
                });

                break;


              default:

                break;
            }
          }}
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
