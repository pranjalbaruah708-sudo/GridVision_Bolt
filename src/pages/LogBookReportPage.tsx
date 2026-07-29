import { useCallback, useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { api } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/State';
import type { LogBookEntry } from '@/types';

export function LogBookReportPage({ onBack }: { onBack: () => void }) {
  const { activeStationId, activeStation, activeFeeders } = useApp();
  const [rows, setRows] = useState<LogBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeStationId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLogBook(activeStationId, 200);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load log book');
    } finally {
      setLoading(false);
    }
  }, [activeStationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadCsv = () => {
    const header = ['Date', 'Time', 'Feeder', 'MW', 'Voltage (kV)', 'Current (A)', 'Remarks'];
    const lines = rows.map((r) => [
      r.entry_date,
      r.entry_time,
      activeFeeders.find((f) => f.id === r.feeder_id)?.name ?? '—',
      r.mw,
      r.voltage_kv,
      r.current_a,
      `"${r.remarks.replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-book-${activeStation?.name ?? 'station'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Screen>
      <AppHeader
        title="Log Book Report"
        subtitle={`${activeStation?.name ?? ''} · ${rows.length} entries`}
        onBack={onBack}
        right={
          <button
            onClick={downloadCsv}
            disabled={!rows.length}
            className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </button>
        }
      />
      <PageBody>
        {loading ? (
          <LoadingState label="Building report…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState message="No log entries for this station." />
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Time</th>
                    <th className="px-3 py-2 font-semibold">Feeder</th>
                    <th className="px-3 py-2 font-semibold text-right">MW</th>
                    <th className="px-3 py-2 font-semibold text-right">kV</th>
                    <th className="px-3 py-2 font-semibold text-right">A</th>
                    <th className="px-3 py-2 font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-blue-50/40">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.entry_date}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.entry_time}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {activeFeeders.find((f) => f.id === r.feeder_id)?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">{r.mw}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.voltage_kv}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.current_a}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {r.remarks === 'Normal' ? (
                          <span className="text-gray-500">Normal</span>
                        ) : (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{r.remarks}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-gray-400">
            <FileText className="h-3.5 w-3.5" />
            {rows.length} rows · generated {new Date().toLocaleString()}
          </div>
        )}
      </PageBody>
    </Screen>
  );
}
