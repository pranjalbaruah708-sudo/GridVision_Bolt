import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileDown, Loader2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { shutdownService } from '@/features/shutdown/shutdownService';
import type { ShutdownRecord, ShutdownReportFilters, ShutdownStatus } from '@/features/shutdown/types';
import { ShutdownStatusBadge } from '@/features/shutdown/ShutdownStatusBadge';
import { downloadCsvFile } from '@/services/platform/webReportFiles';
import { Pager, Results, ShutdownShell } from './ShutdownDashboardPage';

const SIZE = 8;
const labels: Record<ShutdownStatus | 'ALL', string> = { ALL: 'All', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const dt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const initial: ShutdownReportFilters = { fromDate: '', toDate: '', stationId: '', status: 'ALL', feederId: '', equipmentName: '', requestedByUserId: '', limit: SIZE, offset: 0 };
const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
const field = 'h-10 rounded-lg border bg-white px-3 text-sm';

export function ShutdownReportsPage({ onBack }: { onBack: () => void }) {
  const { stations, feeders } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [rows, setRows] = useState<ShutdownRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await shutdownService.listReport({ ...filters, limit: SIZE, offset: page * SIZE }); setRows(result.rows); setTotal(result.total); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Shutdown reports are temporarily unavailable.'); }
    finally { setLoading(false); }
  }, [filters, page]);
  useEffect(() => { void load(); }, [load]);
  const requesters = useMemo(() => [...new Map(rows.map(row => [row.requestedByUserId, row.requestedByName])).entries()], [rows]);
  const set = <K extends keyof ShutdownReportFilters>(key: K, value: ShutdownReportFilters[K]) => setDraft(current => ({ ...current, [key]: value }));
  const allRows = () => shutdownService.listReport({ ...filters, limit: 500, offset: 0 }).then(result => result.rows);
  const pdf = async () => {
    if (!ref.current) return; setExporting(true);
    try { await allRows(); const { exportElementToPdf } = await import('@/utils/pdfExport'); await exportElementToPdf(ref.current, 'Shutdown Report'); }
    catch (cause) { window.alert(cause instanceof Error ? cause.message : 'Could not export PDF.'); }
    finally { setExporting(false); }
  };
  const csv = async () => {
    setExporting(true);
    try {
      const data = await allRows();
      const headers = ['SD No.', 'Station', 'Equipment / Feeder', 'Shutdown Type', 'Requested Date', 'Planned Start', 'Expected Restoration', 'Requested By', 'Decision By', 'Status'];
      const lines = data.map(row => [row.sdNumber, row.stationName, row.equipmentName || row.feederName || '', row.shutdownType, row.requestedAt, dt.format(new Date(row.plannedStart)), dt.format(new Date(row.expectedRestoration)), row.requestedByName, row.decisionByName || '—', labels[row.status]].map(cell).join(','));
      await downloadCsvFile([headers.map(cell).join(','), ...lines].join('\n'), 'shutdown-report.csv');
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : 'Could not export CSV.'); }
    finally { setExporting(false); }
  };
  return <ShutdownShell title="Shutdown Reports" onBack={onBack}>
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select disabled className={field}><option>Shutdown List</option></select>
        <input aria-label="From date" type="date" value={draft.fromDate} onChange={event => set('fromDate', event.target.value)} className={field}/>
        <input aria-label="To date" type="date" value={draft.toDate} onChange={event => set('toDate', event.target.value)} className={field}/>
        <select value={draft.stationId} onChange={event => set('stationId', event.target.value)} className={field}><option value="">All Stations</option>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select>
        <select value={draft.status} onChange={event => set('status', event.target.value as ShutdownStatus | 'ALL')} className={field}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={draft.feederId} onChange={event => set('feederId', event.target.value)} className={field}><option value="">All Feeders</option>{feeders.filter(feeder => !draft.stationId || feeder.station_id === draft.stationId).map(feeder => <option key={feeder.id} value={feeder.id}>{feeder.name}</option>)}</select>
        <input placeholder="Equipment" value={draft.equipmentName} onChange={event => set('equipmentName', event.target.value)} className={field}/>
        <select value={draft.requestedByUserId} onChange={event => set('requestedByUserId', event.target.value)} className={field}><option value="">All Requesters</option>{requesters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button onClick={() => { setFilters(draft); setPage(0); }} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Generate</button>
        <button disabled={!total || exporting} onClick={() => void pdf()} className="inline-flex gap-2 rounded-lg border px-4 py-2 text-sm"><FileDown className="h-4 w-4"/>PDF</button>
        <button disabled={!total || exporting} onClick={() => void csv()} className="inline-flex gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white">{exporting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Download className="h-4 w-4"/>}CSV</button>
      </div>
    </section>
    <div ref={ref} className="mt-5 overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="border-b p-4"><h2 className="font-bold">Shutdown Report</h2><p className="text-xs text-slate-500">Server-authorised results · {total} record{total === 1 ? '' : 's'}</p></div>
      <Results loading={loading} error={error} retry={load} empty="No shutdown records match the selected filters.">
        {rows.length > 0 && <>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1220px] text-left text-xs"><thead className="bg-slate-50"><tr>{['SD No.', 'Station', 'Equipment / Feeder', 'Type', 'Requested', 'Planned Start', 'Restoration', 'Requested By', 'Decision By', 'Status'].map(heading => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody>{rows.map(row => <Row key={row.id} row={row}/>)}</tbody></table></div>
          <div className="space-y-3 p-3 lg:hidden">{rows.map(row => <article key={row.id} className="rounded-xl border p-4"><div className="flex justify-between"><b className="text-blue-700">{row.sdNumber}</b><ShutdownStatusBadge status={row.status}/></div><p>{row.stationName}</p><p className="text-sm">{row.equipmentName || row.feederName}</p><p className="mt-2 text-xs">{dt.format(new Date(row.plannedStart))} · {row.requestedByName}</p></article>)}</div>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / SIZE))} total={total} setPage={setPage}/>
        </>}
      </Results>
    </div>
  </ShutdownShell>;
}

function Row({ row }: { row: ShutdownRecord }) {
  return <tr className="border-t"><td className="px-3 py-3 text-blue-700">{row.sdNumber}</td><td className="px-3">{row.stationName}</td><td className="px-3">{row.equipmentName || row.feederName}</td><td className="px-3">{row.shutdownType}</td><td className="px-3">{dt.format(new Date(row.requestedAt))}</td><td className="px-3">{dt.format(new Date(row.plannedStart))}</td><td className="px-3">{dt.format(new Date(row.expectedRestoration))}</td><td className="px-3">{row.requestedByName}</td><td className="px-3">{row.decisionByName || '—'}</td><td className="px-3"><ShutdownStatusBadge status={row.status}/></td></tr>;
}
