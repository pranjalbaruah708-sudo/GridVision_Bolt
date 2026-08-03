import { useEffect, useState } from 'react';
import { AppProvider } from '@/context/AppContext';
import { useRouter } from '@/hooks/useRouter';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav, type Tab } from '@/components/BottomNav';
import { DashboardPage } from '@/pages/DashboardPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { LogBookReportPage } from '@/pages/LogBookReportPage';
import { OperatorEntryPage } from '@/pages/OperatorEntryPage';
import { MorePage } from '@/pages/MorePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignInPage } from '@/pages/SignInPage';
import { Loader2 } from 'lucide-react';
import { ModuleSelectionPage } from '@/pages/ModuleSelectionPage';


function Shell() {
  const { route, go, back } = useRouter();
  const auth = useAuth();
  const [selectedModule, setSelectedModule] = useState<
  'manual' | 'scada' | null
>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  if (auth.loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#142851]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
      </div>
    );
  }

 if (!auth.session) {
  return <SignInPage auth={auth} />;
}

if (!selectedModule) {
  return (
    <ModuleSelectionPage
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
      onSelectModule={(module) => {
        setSelectedModule(module);
        go({ tab: 'dashboard' });
      }}
    />
  );
}

/*
if (!auth.session) {
  return <SignInPage auth={auth} />;
}

return (
  <div style={{ padding: 40 }}>
    <h1>✅ Login Successful</h1>
    <p>{auth.user?.email}</p>
  </div>
);*/
  // Sub-pages rendered with back buttons
  if (route.tab === 'reports' && route.sub === 'log-book') {
    return (
      <>
        <LogBookReportPage onBack={back} />
        <BottomNav active="reports" onNavigate={(t) => go({ tab: t })} />
      </>
    );
  }
  if (route.tab === 'more' && route.sub === 'operator-entry') {
    return (
      <>
        <OperatorEntryPage onBack={back} />
        <BottomNav active="more" onNavigate={(t) => go({ tab: t })} />
      </>
    );
  }
  if (route.tab === 'more' && route.sub === 'settings') {
    return (
      <>
        <SettingsPage onBack={back} />
        <BottomNav active="more" onNavigate={(t) => go({ tab: t })} />
      </>
    );
  }

 return (
    <>
      {route.tab === 'dashboard' && <DashboardPage onNavigate={(t) => go({ tab: t })} />}
      {route.tab === 'analytics' && <AnalyticsPage />}
      {route.tab === 'alerts' && <AlertsPage />}
      {route.tab === 'reports' && (
        <ReportsPage onOpenReport={() => go({ tab: 'reports', sub: 'log-book' })} />
      )}
      {route.tab === 'more' && (
        <MorePage
          userEmail={auth.user?.email ?? null}
          onSignOut={() => void auth.signOut()}
          onOpen={(id) => {
            if (id === 'operator-entry') go({ tab: 'more', sub: 'operator-entry' });
            else if (id === 'settings') go({ tab: 'more', sub: 'settings' });
            else if (id === 'analytics') go({ tab: 'analytics' });
            else if (id === 'reports') go({ tab: 'reports' });
            else if (id === 'alerts') go({ tab: 'alerts' });
          }}
        />
      )}
      <BottomNav active={route.tab} onNavigate={(t) => go({ tab: t })} />
    </>
  );
  /*
  return (
  <>
    <h1 style={{ padding: "20px" }}>Dashboard Test</h1>
    <BottomNav active={route.tab} onNavigate={(t) => go({ tab: t })} />
  </>
);

*/
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
