import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { AppProvider } from '@/context/AppContext';
import { useRouter, type Route } from '@/hooks/useRouter';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { hasSupabaseInviteCallback, hasSupabaseRecoveryCallback } from '@/services/supabase';
import { canAccessRoute, getRoleLabel, type AppRole } from '@/security/permissions';

import { ResponsiveAppShell } from '@/components/layout/ResponsiveAppShell';
import type { DesktopShellIdentity } from '@/components/layout/ResponsiveAppShell';
import type { DesktopIdentity } from '@/services/api';
import { addAndroidBackButtonListener, addNativeAppStateListener, APP_RESUMED_EVENT, isAndroidApp, isNativeApp, minimizeAndroidApp } from '@/services/platform/runtime';
import { ExitAppConfirmationDialog } from '@/components/ExitAppConfirmationDialog';
import { useApp } from '@/context/AppContext';
import {
  deleteVerifiedApplicationIdentity,
  isTransientConnectivityError,
  readVerifiedApplicationIdentity,
  writeVerifiedApplicationIdentity,
} from '@/services/verifiedIdentity';
import { setQueueSyncAuthorization } from '@/services/syncAuthorization';
import { markQueuedOperationsAuthorizationAttention, type QueuedOp } from '@/services/offline';
import { runStorageMaintenance } from '@/services/storageHealth';
import { recordAuthorizationDiagnostic } from '@/services/diagnostics';

import { DashboardPage } from '@/pages/DashboardPage';
import { DashboardLogbookPage } from '@/pages/DashboardLogbookPage';
import AnalysisLogbook1, { type AnalyticsView } from '@/pages/AnalysisLogbook1';

import { AlertsPage, type AlertFilter } from '@/pages/AlertsPage';
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
import { CurrentShiftPage } from '@/pages/CurrentShiftPage';
import { ShiftSchedulePage } from '@/pages/ShiftSchedulePage';

import { SignInPage } from '@/pages/SignInPage';
const DevShiftTestTokenPage = import.meta.env.DEV
  ? lazy(() => import('@/pages/dev/ShiftTestTokenPage').then((module) => ({ default: module.ShiftTestTokenPage })))
  : null;
import { SetPasswordPage } from '@/pages/SetPasswordPage';
import { ModuleSelectionReplicaPage } from '@/pages/ModuleSelectionReplicaPage';


import { Loader2 } from 'lucide-react';

import {
  consumePendingNotificationNavigation,
  deactivateCurrentDeviceToken,
  GRIDVISION_NOTIFICATION_OPENED_EVENT,
} from '@/pushNotifications';

const MORE_ROUTE_SHELL_TITLES: Partial<Record<MoreDestination, string>> = {
  'help-about': 'Help & About',
};


function Shell() {
  const { route, go } = useRouter();
  const auth = useAuth();
  const { online, reload: reloadOperationalScope, flush: flushPendingOperations, setActiveStationId } = useApp();
  const moreOriginRef = useRef<Route | null>(null);
  const authorizationUserRef = useRef<string | null>(null);

  const [selectedModule, setSelectedModule] =
    useState<'manual' | 'scada' | 'shutdown' | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [authorizationState, setAuthorizationState] = useState<'LOADING' | 'AUTHORIZED' | 'OFFLINE_VERIFIED' | 'NO_ACTIVE_ROLE' | 'OFFLINE_NOT_CACHED' | 'AUTH_ERROR'>('LOADING');
  const [desktopProfile, setDesktopProfile] = useState<DesktopIdentity | null>(null);
  const [reviewOperation, setReviewOperation] = useState<QueuedOp | null>(null);
  const [passwordSetupComplete, setPasswordSetupComplete] = useState(false);
  const [resumeGeneration, setResumeGeneration] = useState(0);
  const isInvitationFlow = !passwordSetupComplete && (
    new URLSearchParams(window.location.search).get('invite') === '1' ||
    hasSupabaseInviteCallback
  );
  const isRecoveryFlow = !passwordSetupComplete && (
    new URLSearchParams(window.location.search).get('reset-password') === '1' ||
    hasSupabaseRecoveryCallback
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
    void runStorageMaintenance().catch(() => undefined);
  }, []);

  useEffect(() => {
    let listener: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    void addNativeAppStateListener().then((value) => {
      if (disposed) { void value?.remove(); return; }
      listener = value;
    });
    const onResume = () => setResumeGeneration((value) => value + 1);
    window.addEventListener(APP_RESUMED_EVENT, onResume);
    return () => { disposed = true; window.removeEventListener(APP_RESUMED_EVENT, onResume); void listener?.remove(); };
  }, []);


  // ======================================================
  // RESET MODULE AFTER LOGOUT
  // ======================================================

  useEffect(() => {
    if (!auth.session) {
      authorizationUserRef.current = null;
      setSelectedModule(null);
    }
  }, [auth.session]);

  useEffect(() => {
    if (route.tab !== 'more') {
      moreOriginRef.current = route;
    }
  }, [route]);

  useEffect(() => {
    const openAlertsFromNotification = () => {
      if (!auth.session || !role || !consumePendingNotificationNavigation()) return;
      setSelectedModule('manual');
      go({ tab: 'alerts', sub: 'all' });
    };
    window.addEventListener(GRIDVISION_NOTIFICATION_OPENED_EVENT, openAlertsFromNotification);
    openAlertsFromNotification();
    return () => window.removeEventListener(GRIDVISION_NOTIFICATION_OPENED_EVENT, openAlertsFromNotification);
  }, [auth.session, go, role]);

  useEffect(() => {
    let cancelled = false;

    if (!auth.session) {
      setRole(null);
      setDesktopProfile(null);
      setRoleLoading(false);
      setAuthorizationState('AUTH_ERROR');
      setQueueSyncAuthorization(null);
      return;
    }

    const session = auth.session;
    const userId = session.user.id;
    if (authorizationUserRef.current !== userId) {
      authorizationUserRef.current = userId;
      setRole(null);
      setDesktopProfile(null);
    }
    const displayName = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? null;
    setRoleLoading(true);
    setAuthorizationState('LOADING');
    setQueueSyncAuthorization(null);

    void (async () => {
      if (!online) {
        if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
          if (!cancelled) {
            setRole(null);
            setDesktopProfile(null);
            setAuthorizationState('AUTH_ERROR');
          }
          return;
        }
        const cached = await readVerifiedApplicationIdentity(userId);
        if (!cancelled) {
          setRole(cached?.role ?? null);
          setDesktopProfile(cached?.desktopIdentity ?? null);
          setAuthorizationState(cached ? 'OFFLINE_VERIFIED' : 'OFFLINE_NOT_CACHED');
        }
        void recordAuthorizationDiagnostic(userId, 'REQUIRES_RECONNECTION');
        return;
      }

      try {
        const nextRole = await api.getMyRole();
        if (!nextRole) {
          try { await markQueuedOperationsAuthorizationAttention(userId); }
          catch { console.error('Pending operations could not be marked after an access change.'); }
          await deleteVerifiedApplicationIdentity(userId);
          void recordAuthorizationDiagnostic(userId, 'REVOKED');
          if (!cancelled) {
            setRole(null);
            setDesktopProfile(null);
            setAuthorizationState('NO_ACTIVE_ROLE');
          }
          return;
        }

        let profile: DesktopIdentity | null | undefined;
        if (!isNativeApp()) {
          try { profile = await api.getMyDesktopIdentity(); }
          catch { console.error('Desktop identity could not be loaded.'); }
        }
        try {
          await writeVerifiedApplicationIdentity({ userId, role: nextRole, displayName, desktopIdentity: profile });
        } catch {
          console.error('Verified application identity could not be cached.');
        }

        const scopeVerified = await reloadOperationalScope();
        if (cancelled) return;
        setRole(nextRole);
        if (profile !== undefined) setDesktopProfile(profile);
        setAuthorizationState('AUTHORIZED');
        void recordAuthorizationDiagnostic(userId, 'VERIFIED');
        if (scopeVerified) {
          setQueueSyncAuthorization(userId);
          void flushPendingOperations().catch(() => undefined);
        }
      } catch (error) {
        console.error('Application access could not be verified.');
        if (isTransientConnectivityError(error)) {
          void recordAuthorizationDiagnostic(userId, 'TEMPORARILY_UNAVAILABLE');
          try {
            const cached = await readVerifiedApplicationIdentity(userId);
            if (!cancelled) {
              setRole(cached?.role ?? null);
              setDesktopProfile(cached?.desktopIdentity ?? null);
              setAuthorizationState(cached ? 'OFFLINE_VERIFIED' : 'OFFLINE_NOT_CACHED');
            }
          } catch {
            console.error('Verified application identity could not be read from local storage.');
            if (!cancelled) {
              setRole(null);
              setAuthorizationState('AUTH_ERROR');
            }
          }
        } else if (!cancelled) {
          setRole(null);
          setAuthorizationState('AUTH_ERROR');
        }
      }
    })().catch(() => {
      console.error('Application authorization could not be initialized.');
      if (!cancelled) {
        setRole(null);
        setAuthorizationState('AUTH_ERROR');
      }
    }).finally(() => {
      if (!cancelled) setRoleLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [auth.session, online, flushPendingOperations, reloadOperationalScope, resumeGeneration]);

  const handleSignOut = async () => {
    setQueueSyncAuthorization(null);
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

  const shellIdentity: DesktopShellIdentity = {
    fullName: desktopProfile?.full_name || auth.user?.user_metadata?.full_name || auth.user?.email?.split('@')[0] || 'User',
    designation: desktopProfile?.designation || getRoleLabel(role),
    employeeCode: desktopProfile?.employee_code ?? null,
    email: auth.user?.email ?? null,
    avatarUrl: auth.user?.user_metadata?.avatar_url ?? null,
    assignedOffices: desktopProfile?.assigned_offices ?? [],
    accessibleStationCount: desktopProfile?.accessible_station_count ?? 0,
    role: role ?? 'OPERATOR',
  };

  const renderRoutedPage = (content: React.ReactNode, active = route.tab) => (
    <ResponsiveAppShell active={active} onNavigate={(tab) => go({ tab })} identity={shellIdentity} onOpenProfile={() => go({ tab: 'more', sub: 'profile' })} onOpenAlerts={() => go({ tab: 'alerts', sub: 'all' })} onSignOut={handleSignOut} route={route} selectedModule={selectedModule ?? 'manual'} onNavigateRoute={go} onOpenModuleSelection={() => setSelectedModule(null)} onSelectModule={(module) => { if (module === 'manual') { setSelectedModule('manual'); go({ tab: 'dashboard' }); } }}>
      {content}
    </ResponsiveAppShell>
  );


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
        mode="invite"
        hasValidSession={Boolean(auth.session && auth.user)}
        onComplete={() => {
          setPasswordSetupComplete(true);
          setSelectedModule(null);
        }}
        onDismiss={() => setPasswordSetupComplete(true)}
      />
    );
  }

  if (isRecoveryFlow) {
    return (
      <SetPasswordPage
        mode="recovery"
        hasValidSession={Boolean(auth.session && auth.user)}
        onComplete={() => {
          setPasswordSetupComplete(true);
          setSelectedModule(null);
        }}
        onDismiss={() => setPasswordSetupComplete(true)}
      />
    );
  }


  // ======================================================
  // SIGN IN
  // ======================================================

  if (!auth.session) {
    return <SignInPage auth={auth} />;
  }

  if (roleLoading && !role) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#142851]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
      </div>
    );
  }

  if (!role) {
    const noActiveRole = authorizationState === 'NO_ACTIVE_ROLE';
    const offlineNotCached = authorizationState === 'OFFLINE_NOT_CACHED';
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-sm rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">{noActiveRole ? 'Access not configured' : offlineNotCached ? 'Online verification required' : 'Unable to verify access'}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {noActiveRole
              ? 'Your GridVision account does not have an active application role. Please contact an administrator.'
              : offlineNotCached
                ? 'Connect once to verify your GridVision access before using the app offline.'
                : 'GridVision could not verify your session or read your saved access. Check your connection and try again.'}
          </p>
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
        siteContext={desktopProfile?.assigned_offices?.[0] ?? null}
        onSelectModule={(module) => setSelectedModule(module)}
        onProfile={() => {
          setSelectedModule('manual');
          go({ tab: 'more', sub: 'profile' });
        }}
        onNotifications={() => {
          setSelectedModule('manual');
          go({ tab: 'alerts' });
        }}
        onSettings={() => {
          setSelectedModule('manual');
          go({ tab: 'more', sub: 'settings' });
        }}
        onHelpAbout={() => {
          setSelectedModule('manual');
          go({ tab: 'more', sub: 'help-about' });
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
    return renderRoutedPage(<LogBookReportPage onBack={returnToReports} />, 'reports');
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'interruption-report'
  ) {
    return renderRoutedPage(<InterruptionReportPage onBack={returnToReports} />, 'reports');
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'load-energy-report'
  ) {
    return renderRoutedPage(<LoadEnergyReportPage onBack={returnToReports} />, 'reports');
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'data-completeness-report'
  ) {
    return renderRoutedPage(<DataCompletenessReportPage onBack={returnToReports} />, 'reports');
  }

  if (
    route.tab === 'reports' &&
    route.sub === 'parameter-exception-report'
  ) {
    return renderRoutedPage(<ParameterExceptionReportPage onBack={returnToReports} />, 'reports');
  }

  if (route.tab === 'reports' && route.sub === 'station-performance-report') {
    return renderRoutedPage(<PerformanceReportPage entity="STATION" onBack={returnToReports} />, 'reports');
  }

  if (route.tab === 'reports' && route.sub === 'feeder-performance-report') {
    return renderRoutedPage(<PerformanceReportPage entity="FEEDER" onBack={returnToReports} />, 'reports');
  }

  if (route.tab === 'reports' && route.sub === 'executive-summary-report') {
    return renderRoutedPage(<ExecutiveSummaryReportPage onBack={returnToReports} />, 'reports');
  }

  if (route.tab === 'reports' && route.sub === 'operator-activity-report') {
    return renderRoutedPage(<OperatorActivityReportPage onBack={returnToReports} />, 'reports');
  }

  if (route.tab === 'reports' && route.sub === 'notification-delivery-report') {
    return renderRoutedPage(<NotificationDeliveryReportPage onBack={returnToReports} />, 'reports');
  }


  // ------------------------------------------------------
  // OPERATOR ENTRY
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'operator-entry'
  ) {
    return renderRoutedPage(<OperatorEntryPage onBack={returnToMore} initialReviewOperation={reviewOperation} onReviewConsumed={() => setReviewOperation(null)} />, 'more');
  }


  // ------------------------------------------------------
  // INTERRUPTION ENTRY
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'interruption-entry'
  ) {
    return renderRoutedPage(<InterruptionEntryPage onBack={returnToMore} />, 'more');
  }


  // ------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------

  if (
    route.tab === 'more' &&
    route.sub === 'settings'
  ) {
    return renderRoutedPage(<SettingsPage onBack={returnToMore} onReviewOperation={(operation) => {
      const body = operation.body && typeof operation.body === 'object' && !Array.isArray(operation.body) ? operation.body as Record<string, unknown> : {};
      if (typeof body.station_id === 'string') setActiveStationId(body.station_id);
      setReviewOperation(operation);
      go({ tab: 'more', sub: operation.table === 'interruptions' ? 'interruption-entry' : 'operator-entry' });
    }} />, 'more');
  }

  const moreRouteShellTitle = route.tab === 'more' && route.sub
    ? MORE_ROUTE_SHELL_TITLES[route.sub as MoreDestination]
    : undefined;

  if (moreRouteShellTitle) {
    return renderRoutedPage(<MoreRouteShell title={moreRouteShellTitle} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'current-shift') {
    return renderRoutedPage(<CurrentShiftPage onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'shift-schedule') {
    return renderRoutedPage(<ShiftSchedulePage role={role} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'profile') {
    return renderRoutedPage(<MyProfilePage user={auth.user!} role={role} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'users-access') {
    return renderRoutedPage(<UsersAccessPage role={role} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'system-configuration') {
    return renderRoutedPage(<SystemConfigurationPage role={role} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub === 'audit-activity') {
    return renderRoutedPage(<AuditActivityPage role={role} onBack={returnToMore} />, 'more');
  }

  if (route.tab === 'more' && route.sub && ['organisation-structure', 'network-master-data'].includes(route.sub)) {
    return renderRoutedPage(<AdministrationPage destination={route.sub as 'organisation-structure' | 'network-master-data'} role={role} onBack={returnToMore} />, 'more');
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
          initialTab={({ 'load-demand': 'Load / Energy Analysis', interruptions: 'Interruption Analysis', indices: 'Indices' } as Record<string, AnalyticsView>)[route.sub ?? ''] ?? 'Load / Energy Analysis'}
          onTabChange={isNativeApp() ? undefined : (tab) => go({ tab: 'analytics', sub: ({ 'Load / Energy Analysis': 'load-demand', 'Interruption Analysis': 'interruptions', Indices: 'indices' } as Record<AnalyticsView, string>)[tab] })}
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
          initialFilter={({ all: 'ALL', critical: 'CRITICAL', warning: 'WARNING', info: 'INFO' } as Record<string, AlertFilter>)[route.sub ?? ''] ?? 'ALL'}
          onFilterChange={isNativeApp() ? undefined : (filter) => go({ tab: 'alerts', sub: filter.toLowerCase() })}
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
          fullName={shellIdentity.fullName}
          userEmail={auth.user?.email ?? null}
          avatarUrl={auth.user?.user_metadata?.avatar_url ?? null}
          designation={shellIdentity.designation}
          employeeCode={shellIdentity.employeeCode}
          assignedOffices={shellIdentity.assignedOffices}
          accessibleStationCount={shellIdentity.accessibleStationCount}
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

  return renderRoutedPage(page);
}


// ========================================================
// APP
// ========================================================

export default function App() {
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);

  const showShiftTokenHelper = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('shift-token-helper') === '1';

  if (showShiftTokenHelper && DevShiftTestTokenPage) {
    return <Suspense fallback={null}><DevShiftTestTokenPage /></Suspense>;
  }

  useEffect(() => {
    if (!isAndroidApp()) return;
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void addAndroidBackButtonListener(() => setShowExitConfirmation(true)).then((handle) => {
      if (!handle) return;
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });

    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, []);

  return (
    <>
      <AppProvider>
        <Shell />
      </AppProvider>
      {isAndroidApp() && <ExitAppConfirmationDialog open={showExitConfirmation} onCancel={() => setShowExitConfirmation(false)} onConfirm={() => { setShowExitConfirmation(false); void minimizeAndroidApp(); }} />}
    </>
  );
}
