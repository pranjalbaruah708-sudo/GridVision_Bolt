import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, ShieldAlert, AlertCircle } from 'lucide-react';
import { api } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/State';
import type { Interruption, OverloadAlert } from '@/types';

type AlertKind = 'critical' | 'warning' | 'info';
type AlertItem = {
  id: string;
  kind: AlertKind;
  title: string;
  message: string;
  station: string;
  time: string;
};

const FILTERS = ['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const;
type Filter = (typeof FILTERS)[number];

export function AlertsPage() {
  const { stations } = useApp();
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overloads, ints] = await Promise.all([
        api.getOverloadAlerts(),
        api.getInterruptions(),
      ]);
      const built: AlertItem[] = [
        ...overloads.map((a: OverloadAlert) => ({
          id: `o-${a.id}`,
          kind: (a.value > a.limit_value * 1.1 ? 'critical' : 'warning') as AlertKind,
          title: `Overload: ${a.asset_id}`,
          message: `${a.parameter} ${a.value} (limit ${a.limit_value})`,
          station: stations.find((s) => s.id === a.station_id)?.name ?? '—',
          time: a.alert_time,
        })),
        ...ints.map((i: Interruption) => ({
          id: `i-${i.id}`,
          kind: (i.status === 'open' ? 'critical' : 'info') as AlertKind,
          title: `${i.reason}`,
          message: i.status === 'open' ? 'Supply interrupted — restoration in progress' : `Restored after ${i.duration_hours?.toFixed(1) ?? '—'}h`,
          station: stations.find((s) => s.id === i.station_id)?.name ?? '—',
          time: i.started_at,
        })),
      ];
      built.sort((a, b) => +new Date(b.time) - +new Date(a.time));
      setItems(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [stations]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = filter === 'ALL' ? items : items.filter((i) => i.kind === filter.toLowerCase());

  return (
    <Screen>
      <AppHeader title="Alerts" subtitle="Active notifications & incidents" />
      <PageBody>
        {/* Filter tabs */}
        <div className="mb-4 flex gap-0 border-b border-gray-200">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-[11px] font-semibold border-b-2 transition ${
                filter === f
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingState label="Loading alerts…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState message="No alerts in this category." />
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => {
              const config = KIND_CONFIG[a.kind];
              const Icon = config.icon;
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border bg-white p-3 shadow-sm ${config.border}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${config.bg}`}>
                      <Icon className={`h-4 w-4 ${config.iconColor}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{a.title}</h3>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${config.badge}`}>
                          {a.kind}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">{a.message}</p>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400">
                        <span>{a.station}</span>
                        <span>{new Date(a.time).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </Screen>
  );
}

const KIND_CONFIG: Record<AlertKind, {
  icon: typeof AlertTriangle;
  border: string;
  bg: string;
  iconColor: string;
  badge: string;
}> = {
  critical: {
    icon: ShieldAlert,
    border: 'border-red-200',
    bg: 'bg-red-100',
    iconColor: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    icon: AlertCircle,
    border: 'border-amber-200',
    bg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    icon: Info,
    border: 'border-blue-200',
    bg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
  },
};
