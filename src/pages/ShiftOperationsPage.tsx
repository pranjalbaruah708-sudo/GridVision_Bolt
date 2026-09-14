import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Clock3, FileText, Loader2, RefreshCw, UsersRound, X } from 'lucide-react';

import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { ReportActions } from '@/components/reports/ReportActions';
import type { ReportColumn } from '@/components/reports/types';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { deriveShiftCompliance, handoverLabel } from '@/features/shifts/compliance';
import { useApp } from '@/context/AppContext';
import { api, type ShiftComplianceRow, type ShiftHandoverItem } from '@/services/api';

export type ShiftOperationsView = 'overview' | 'history' | 'attendance-report' | 'handover-report' | 'compliance-report';

const DAY = 86_400_000;
function dateInput(value: Date) { return value.toISOString().slice(0, 10); }
function display(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—'; }
function statusTone(status: string) { return status === 'ACCEPTED' || status === 'ENDED' ? 'bg-emerald-50 text-emerald-700' : status === 'SUBMITTED' || status === 'ACTIVE' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700'; }
function viewTitle(view: ShiftOperationsView) {
  if (view === 'overview') return ['Shift Operations', 'Current station attendance, handover, and operational attention'];
  if (view === 'history') return ['Shift History & Compliance', 'Read-only, server-confirmed shift audit history'];
  if (view === 'attendance-report') return ['Shift Attendance Report', 'Planned roster and actual duty participation'];
  if (view === 'handover-report') return ['Shift Handover Report', 'Server-confirmed outgoing handover lifecycle'];
  return ['Shift Compliance Report', 'Explainable operational exceptions from server data'];
}

type Props = { view: ShiftOperationsView; onBack: () => void };

export function ShiftOperationsPage({ view, onBack }: Props) {
  const { stations, activeStationId, setActiveStationId, online } = useApp();
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 6 * DAY)));
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [rows, setRows] = useState<ShiftComplianceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ShiftComplianceRow | null>(null);
  const [items, setItems] = useState<ShiftHandoverItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const [title, subtitle] = viewTitle(view);

  const load = useCallback(async () => {
    if (!activeStationId || !from || !to) { setRows([]); return; }
    if (from > to) {
      setRows([]);
      setError('Choose a start date on or before the end date.');
      return;
    }
    if (Date.parse(to) - Date.parse(from) > 93 * DAY) {
      setRows([]);
      setError('Choose a date range of 93 days or fewer.');
      return;
    }
    setLoading(true); setError(null);
    try { setRows(await api.getStationShiftCompliance(activeStationId, from, to)); }
    catch { setError('Could not load the bounded shift history. Check your connection and try again.'); }
    finally { setLoading(false); }
  }, [activeStationId, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(null); setItems([]); }, [activeStationId]);

  const current = useMemo(() => rows.find((row) => new Date(row.scheduled_start) <= new Date() && new Date(row.scheduled_end) > new Date() && row.status !== 'CANCELLED') ?? null, [rows]);
  const visibleRows = useMemo(() => {
    if (view === 'overview') return current ? [current] : [];
    if (view === 'handover-report') return rows.filter((row) => row.handover);
    if (view === 'compliance-report') return rows.filter((row) => deriveShiftCompliance(row).some((finding) => finding.code !== 'COMPLIANT'));
    return rows;
  }, [current, rows, view]);

  const openDetail = async (row: ShiftComplianceRow) => {
    setSelected(row); setItems([]);
    if (!row.handover) return;
    setDetailLoading(true);
    try { setItems(await api.getShiftHandoverItems(row.handover.id)); }
    catch { setError('Could not load the handover source references.'); }
    finally { setDetailLoading(false); }
  };

  const columns: ReportColumn<ShiftComplianceRow>[] = useMemo(() => [
    { id: 'date', label: 'Shift date', value: (row) => row.shift_date, csvValue: (row) => row.shift_date },
    { id: 'shift', label: 'Shift', value: (row) => <span className="font-semibold">{row.shift_name}</span>, csvValue: (row) => row.shift_name },
    { id: 'window', label: 'Scheduled window', value: (row) => <span className="text-xs">{display(row.scheduled_start)} – {display(row.scheduled_end)}</span>, csvValue: (row) => `${display(row.scheduled_start)} – ${display(row.scheduled_end)}` },
    { id: 'planned', label: 'Planned', value: (row) => String(row.roster.length), csvValue: (row) => row.roster.length, align: 'right' },
    { id: 'actual', label: 'Actual', value: (row) => String(row.duty_sessions.length), csvValue: (row) => row.duty_sessions.length, align: 'right' },
    { id: 'handover', label: 'Handover', value: (row) => handoverLabel(row.handover?.status), csvValue: (row) => handoverLabel(row.handover?.status) },
    { id: 'compliance', label: 'Compliance', value: (row) => deriveShiftCompliance(row).map((finding) => finding.label).join('; '), csvValue: (row) => deriveShiftCompliance(row).map((finding) => finding.label).join('; ') },
  ], []);

  return <Screen showStatusBar={false}>
    <AppHeader title={title} onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title={title} subtitle={subtitle} />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-6xl space-y-4 lg:max-w-none" ref={reportRef}>
      {!online && <Notice tone="amber">Shift operations data is server-confirmed and available only while connected.</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      <section className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]"><label className="min-w-0 text-xs font-semibold text-slate-600 sm:col-span-2 lg:col-span-1">Station<select value={activeStationId} onChange={(event) => setActiveStationId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">{stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label className="min-w-0 text-xs font-semibold text-slate-600">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="min-w-0 text-xs font-semibold text-slate-600">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label></div><div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end lg:flex-nowrap"><button type="button" onClick={() => void load()} disabled={!online || loading} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>{view !== 'overview' && <ReportActions title={title} contentRef={reportRef} rows={visibleRows} columns={columns} disabled={loading} showPdfLabel />}</div></div></section>
      {view === 'overview' && <Overview row={current} loading={loading} onOpen={() => current && void openDetail(current)} />}
      {view !== 'overview' && <History rows={visibleRows} loading={loading} onOpen={(row) => void openDetail(row)} />}
    </div></PageBody>
    {selected && <Detail row={selected} items={items} loading={detailLoading} onClose={() => setSelected(null)} />}
  </Screen>;
}

function Overview({ row, loading, onOpen }: { row: ShiftComplianceRow | null; loading: boolean; onOpen: () => void }) {
  if (loading) return <Loading />;
  if (!row) return <Empty title="No current shift" detail="There is no current server-scheduled shift for the selected station." />;
  const onDuty = row.duty_sessions.filter((session) => session.status === 'ON_DUTY').length;
  const unplanned = row.duty_sessions.filter((session) => !row.roster.some((member) => member.user_id === session.user_id)).length;
  const inCharge = row.roster.find((member) => member.duty_role === 'IN_CHARGE');
  return <><section className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current shift</p><h2 className="mt-1 text-xl font-bold text-slate-900">{row.shift_name}</h2><p className="mt-1 text-sm text-slate-600">{display(row.scheduled_start)} – {display(row.scheduled_end)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>{row.status}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-4"><Metric icon={UsersRound} label="Planned" value={row.roster.length} detail={inCharge ? `In-charge: ${inCharge.full_name}` : 'No in-charge rostered'} /><Metric icon={Clock3} label="On duty" value={onDuty} detail={`${Math.max(row.roster.length - row.duty_sessions.length, 0)} not started`} /><Metric icon={ClipboardCheck} label="Handover" value={handoverLabel(row.handover?.status)} detail={row.handover?.submitted_at ? `Submitted ${display(row.handover.submitted_at)}` : 'No outgoing handover'} /><Metric icon={AlertTriangle} label="Attention" value={deriveShiftCompliance(row).filter((finding) => finding.code !== 'COMPLIANT').length} detail={unplanned ? `${unplanned} unplanned participant` : 'See operational checks'} /></div><button type="button" onClick={onOpen} className="mt-5 min-h-10 rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-700">View shift audit</button></section><Compliance findings={deriveShiftCompliance(row)} /></>;
}

function History({ rows, loading, onOpen }: { rows: ShiftComplianceRow[]; loading: boolean; onOpen: (row: ShiftComplianceRow) => void }) {
  if (loading) return <Loading />;
  if (!rows.length) return <Empty title="No matching shifts" detail="No server-confirmed shifts match this bounded filter." />;
  return <section className="overflow-hidden rounded-2xl bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><h2 className="font-bold text-slate-900">Shift records</h2><p className="mt-1 text-xs text-slate-500">Read-only attendance, handover, and compliance information</p></div><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Shift</th><th className="px-4 py-3">Window</th><th className="px-4 py-3">Planned / Actual</th><th className="px-4 py-3">Handover</th><th className="px-4 py-3">Compliance</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.shift_name}</p><p className="text-xs text-slate-500">{row.shift_date} · {row.status}</p></td><td className="px-4 py-3 text-xs text-slate-600">{display(row.scheduled_start)}<br />{display(row.scheduled_end)}</td><td className="px-4 py-3">{row.roster.length} / {row.duty_sessions.length}</td><td className="px-4 py-3"><Badge text={handoverLabel(row.handover?.status)} /></td><td className="px-4 py-3"><ComplianceSummary row={row} /></td><td className="px-4 py-3"><button type="button" onClick={() => onOpen(row)} className="rounded-lg px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50">Audit</button></td></tr>)}</tbody></table></div><div className="divide-y divide-slate-100 lg:hidden">{rows.map((row) => <button key={row.id} type="button" onClick={() => onOpen(row)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{row.shift_name}</p><p className="mt-1 text-xs text-slate-500">{display(row.scheduled_start)}</p></div><Badge text={handoverLabel(row.handover?.status)} /></div><p className="mt-3 text-sm text-slate-700">Planned {row.roster.length} · Actual {row.duty_sessions.length}</p><div className="mt-2"><ComplianceSummary row={row} /></div></button>)}</div></section>;
}

function Detail({ row, items, loading, onClose }: { row: ShiftComplianceRow; items: ShiftHandoverItem[]; loading: boolean; onClose: () => void }) { return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/40 p-4 sm:grid sm:place-items-center"><section role="dialog" aria-modal="true" aria-label="Shift audit detail" className="mx-auto my-5 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl sm:my-0"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Shift audit</p><h2 className="mt-1 text-lg font-bold text-slate-900">{row.shift_name}</h2><p className="mt-1 text-sm text-slate-600">{display(row.scheduled_start)} – {display(row.scheduled_end)}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-4 lg:grid-cols-2"><section><h3 className="font-bold text-slate-900">Planned roster</h3><Rows values={row.roster.map((member) => `${member.full_name} · ${member.duty_role === 'IN_CHARGE' ? 'Shift In-Charge' : 'Member'}`)} empty="No planned roster." /></section><section><h3 className="font-bold text-slate-900">Actual duty</h3><Rows values={row.duty_sessions.map((session) => `${session.full_name} · ${session.status === 'ON_DUTY' ? 'On Duty' : `Ended ${display(session.ended_at)}`}`)} empty="No duty participant." /></section><section className="lg:col-span-2"><h3 className="font-bold text-slate-900">Handover</h3>{row.handover ? <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p><Badge text={handoverLabel(row.handover.status)} /></p><p className="mt-2">Submitted: {row.handover.submitted_by_name ?? '—'} · {display(row.handover.submitted_at)}</p><p>Accepted: {row.handover.accepted_by_name ?? '—'} · {display(row.handover.accepted_at)}</p><p className="mt-2 whitespace-pre-wrap">{row.handover.outgoing_notes ?? 'No outgoing remarks recorded.'}</p>{loading ? <p className="mt-3 text-xs text-slate-500">Loading source references…</p> : <Rows values={items.map((item) => `${item.source_type.replace(/_/g, ' ')}${item.description ? ` · ${item.description}` : ''}`)} empty="No source-linked matters." />}</div> : <p className="mt-2 text-sm text-slate-600">No outgoing handover was created for this shift.</p>}</section><section className="lg:col-span-2"><h3 className="font-bold text-slate-900">Operational checks</h3><Compliance findings={deriveShiftCompliance(row)} /></section></div></section></div>; }

function Compliance({ findings }: { findings: ReturnType<typeof deriveShiftCompliance> }) { return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><h2 className="font-bold text-slate-900">Operational checks</h2><div className="mt-3 space-y-2">{findings.map((finding) => <div key={finding.code} className={`rounded-xl px-3 py-2 text-sm ${finding.tone === 'green' ? 'bg-emerald-50 text-emerald-800' : finding.tone === 'red' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}><p className="font-semibold">{finding.label}</p><p className="mt-0.5 text-xs leading-5">{finding.detail}</p></div>)}</div></section>; }
function ComplianceSummary({ row }: { row: ShiftComplianceRow }) { const finding = deriveShiftCompliance(row).find((item) => item.code !== 'COMPLIANT') ?? deriveShiftCompliance(row)[0]; return <span className={`text-xs font-semibold ${finding.tone === 'green' ? 'text-emerald-700' : finding.tone === 'red' ? 'text-red-700' : 'text-amber-800'}`}>{finding.label}</span>; }
function Metric({ icon: Icon, label, value, detail }: { icon: typeof UsersRound; label: string; value: string | number; detail: string }) { return <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-slate-500"><Icon className="h-4 w-4" /><p className="text-xs font-bold uppercase tracking-wide">{label}</p></div><p className="mt-2 text-lg font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>; }
function Badge({ text }: { text: string }) { return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(text.toUpperCase().replace(/ /g, '_'))}`}>{text}</span>; }
function Rows({ values, empty }: { values: string[]; empty: string }) { return values.length ? <ul className="mt-2 space-y-1 text-sm text-slate-700">{values.map((value) => <li key={value} className="rounded-lg bg-slate-50 px-3 py-2">{value}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">{empty}</p>; }
function Loading() { return <div className="grid min-h-44 place-items-center rounded-2xl bg-white"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <section className="rounded-2xl bg-white p-7 text-center shadow-sm"><Clock3 className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-3 font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-600">{detail}</p></section>; }
function Notice({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) { return <p role="alert" className={`rounded-xl px-4 py-3 text-sm font-medium ${tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{children}</p>; }
