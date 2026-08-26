import { useEffect, useState } from 'react';

import { AppProvider } from '@/context/AppContext';
import { useRouter } from '@/hooks/useRouter';
import { useAuth } from '@/hooks/useAuth';

import { BottomNav } from '@/components/BottomNav';

import { DashboardPage } from '@/pages/DashboardPage';
import { DashboardLogbookPage } from '@/pages/DashboardLogbookPage';
import AnalysisLogbook1 from '@/pages/AnalysisLogbook1';

import { AlertsPage } from '@/pages/AlertsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { LogBookReportPage } from '@/pages/LogBookReportPage';

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
  const { route, go, back } = useRouter();
  const auth = useAuth();

  const [selectedModule, setSelectedModule] =
    useState<'manual' | 'scada' | null>(null);


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
        permissions={{
          manual: true,
          scada: true,
        }}
        onSelectModule={(module) =>
          setSelectedModule(module)
        }
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
        <LogBookReportPage onBack={back} />

        <BottomNav
          active="reports"
          onNavigate={(tab) =>
            go({ tab })
          }
        />
      </>
    );
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
          onBack={back}
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
          onBack={back}
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
        <SettingsPage onBack={back} />

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
          onBack={back}
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
  onBack={back}
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
          onBack={() => {
            setSelectedModule(null);

            go({
              tab: 'dashboard',
            });
          }}
        />
      );

      break;


    // --------------------------------------------------
    // ALERTS
    // --------------------------------------------------

    case 'alerts':

      page = (
        <AlertsPage
          onBack={() => {
            setSelectedModule(null);

            go({
              tab: 'dashboard',
            });
          }}
        />
      );

      break;


    // --------------------------------------------------
    // REPORTS
    // --------------------------------------------------

    case 'reports':

      page = (
        <ReportsPage
          onBack={() => {
            setSelectedModule(null);

            go({
              tab: 'dashboard',
            });
          }}

          onOpenReport={() =>
            go({
              tab: 'reports',
              sub: 'log-book',
            })
          }
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

          // --------------------------------------------
          // LOGOUT
          //
          // First deactivate THIS device's FCM token.
          // Then sign out from Supabase.
          // --------------------------------------------

          onSignOut={async () => {
            try {
              console.log(
                '🚪 Starting logout...'
              );

              await deactivateCurrentDeviceToken();

              console.log(
                '✅ Device token deactivated successfully.'
              );

              setSelectedModule(null);

              await auth.signOut();

              console.log(
                '✅ Supabase logout completed.'
              );

            } catch (error) {
              console.error(
                '❌ Logout failed:',
                error
              );
            }
          }}


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
  onBack={back}
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