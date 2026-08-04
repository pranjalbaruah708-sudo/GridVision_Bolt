// Minimal hash-based router so we don't pull in a router dependency.
import { useCallback, useEffect, useState } from 'react';
import type { Tab } from '@/components/BottomNav';

export type Route = {
  tab: Tab;
  sub?: string; // sub-page within a tab, e.g. 'log-book-report', 'operator-entry', 'settings'
};

const VALID_TABS: Tab[] = ['dashboard', 'analytics', 'alerts', 'reports', 'more'];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [tab = 'dashboard', sub] = raw.split('/');
  const t = VALID_TABS.includes(tab as Tab) ? (tab as Tab) : 'dashboard';
  return sub ? { tab: t, sub } : { tab: t };
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((r: Route) => {
    if (r.tab === 'dashboard' && !r.sub) {
      window.location.hash = '';
      return;
    }
    window.location.hash = r.sub ? `#/${r.tab}/${r.sub}` : `#/${r.tab}`;
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  return { route, go, back };
}
