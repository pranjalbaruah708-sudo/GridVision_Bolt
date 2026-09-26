import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, Loader2, Paperclip } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { shutdownService } from '@/features/shutdown/shutdownService';
import { ShutdownStatusBadge } from '@/features/shutdown/ShutdownStatusBadge';
import type { AlternateSourceAvailability, ShutdownPurpose, ShutdownRecord, ShutdownType } from '@/features/shutdown/types';

const purposes: ShutdownPurpose[] = ['Preventive Maintenance', 'Corrective Maintenance', 'Construction / Augmentation', 'Tree Cutting', 'Testing', 'Line Work', 'Transformer Work', 'Protection Work', 'Other'];
const alternateSourceLabels: Record<AlternateSourceAvailability, string> = { YES: 'Yes', NO: 'No', PARTIAL: 'Partial' };
const fmt = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const displayConsumers = (value: number | null) => value === null ? 'Not recorded' : value.toLocaleString('en-IN');
const displayLoad = (value: number | null) => value === null ? 'Not recorded' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 3 })} MW`;
const displayAlternateSource = (value: AlternateSourceAvailability | null) => value ? alternateSourceLabels[value] : 'Not recorded';

export function ShutdownRequestPage({ requestId, onCancel, onComplete }: { requestId?: string; onCancel: () => void; onComplete: () => void }) {
  const { stations, feeders } = useApp();
  const [record, setRecord] = useState<ShutdownRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(requestId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stationId, setStation] = useState('');
  const [feederId, setFeeder] = useState('');
  const [shutdownType, setType] = useState<ShutdownType>('Planned');
  const [purpose, setPurpose] = useState<ShutdownPurpose>('Preventive Maintenance');
  const [work, setWork] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [remarks, setRemarks] = useState('');
  const [affectedConsumers, setAffectedConsumers] = useState('');
  const [affectedLoadMw, setAffectedLoadMw] = useState('');
  const [alternateSourceAvailability, setAlternateSourceAvailability] = useState<AlternateSourceAvailability | ''>('');
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const stationFeeders = useMemo(() => feeders.filter(feeder => feeder.station_id === stationId), [feeders, stationId]);

  useEffect(() => {
    if (!requestId) return;
    let active = true;
    setLoading(true);
    shutdownService.get(requestId).then(value => { if (active) setRecord(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Request unavailable.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestId]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const feeder = feeders.find(value => value.id === feederId);
    const consumers = Number(affectedConsumers);
    const loadMw = Number(affectedLoadMw);
    if (!stationId || !feeder || !work.trim() || !start || !end) { setError('Complete all required fields.'); return; }
    if (!affectedConsumers.trim() || !affectedLoadMw.trim() || !Number.isInteger(consumers) || consumers < 0 || !Number.isFinite(loadMw) || loadMw < 0 || !alternateSourceAvailability) { setError('Enter a non-negative whole number of consumers, a non-negative load in MW, and alternate-source availability.'); return; }
    if (new Date(end) <= new Date(start)) { setError('Expected restoration must be after planned start.'); return; }
    setSaving(true); setError('');
    try {
      await shutdownService.create({ stationId, feederId, equipmentName: feeder.name, shutdownType, purpose, workDescription: work.trim(), plannedStart: new Date(start).toISOString(), expectedRestoration: new Date(end).toISOString(), remarks: remarks.trim(), affectedConsumerCount: consumers, affectedLoadMw: loadMw, alternateSourceAvailability });
      onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request could not be submitted.'); } finally { setSaving(false); }
  };

  const decide = async () => {
    if (!record) return;
    if (decision === 'REJECTED' && !decisionRemarks.trim()) { setError('Rejection remarks are required.'); return; }
    setSaving(true); setError('');
    try { if (decision === 'APPROVED') await shutdownService.approve(record.id, decisionRemarks.trim()); else await shutdownService.reject(record.id, decisionRemarks.trim()); onComplete(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Decision could not be submitted.'); try { setRecord(await shutdownService.get(record.id)); } catch { /* The friendly error is already displayed. */ } }
    finally { setSaving(false); }
  };

  const field = 'mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm';
  if (loading) return <State text="Loading shutdown request…" />;
  if (requestId && !record) return <State text={error || 'This shutdown request is no longer available.'} retry={onCancel} />;
  const approval = Boolean(record?.canDecide);

  return <div className="min-h-screen bg-[#f5f8fc] pb-24"><div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8">
    <div className="flex items-center gap-3"><button onClick={onCancel} className="rounded-lg border bg-white p-2"><ChevronLeft className="h-5 w-5" /></button><div><p className="text-xs font-semibold text-blue-600">Shutdown Management</p><h1 className="text-xl font-bold">{!record ? 'New Shutdown Request' : approval ? 'Approve Shutdown Request' : 'Shutdown Request'}</h1></div>{record && <span className="ml-auto"><ShutdownStatusBadge status={record.status} /></span>}</div>
    {!record ? <form onSubmit={create} className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card title="Request details">
        <label>Station *<select value={stationId} onChange={event => { setStation(event.target.value); setFeeder(''); }} className={field}><option value="">Select station</option>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
        <label>Equipment / Feeder *<select value={feederId} onChange={event => setFeeder(event.target.value)} disabled={!stationId} className={field}><option value="">Select equipment / feeder</option>{stationFeeders.map(feeder => <option key={feeder.id} value={feeder.id}>{feeder.name}</option>)}</select></label>
        <fieldset><legend>Shutdown Type *</legend>{(['Planned', 'Emergency'] as ShutdownType[]).map(value => <label key={value} className="mr-5 inline-flex gap-2"><input type="radio" checked={shutdownType === value} onChange={() => setType(value)} />{value}</label>)}</fieldset>
        <label>Purpose *<select value={purpose} onChange={event => setPurpose(event.target.value as ShutdownPurpose)} className={field}>{purposes.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Work Description *<textarea value={work} onChange={event => setWork(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border p-3" /></label>
      </Card>
      <Card title="Schedule and impact">
        <label>Planned Start *<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} className={field} /></label>
        <label>Expected Restoration *<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} className={field} /></label>
        <label>Consumers Affected *<input type="number" min="0" step="1" inputMode="numeric" value={affectedConsumers} onChange={event => setAffectedConsumers(event.target.value)} className={field} /></label>
        <label>Load Affected (MW) *<input type="number" min="0" step="0.001" inputMode="decimal" value={affectedLoadMw} onChange={event => setAffectedLoadMw(event.target.value)} className={field} /></label>
        <label>Alternate Source Available *<select value={alternateSourceAvailability} onChange={event => setAlternateSourceAvailability(event.target.value as AlternateSourceAvailability | '')} className={field}><option value="">Select availability</option>{Object.entries(alternateSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Remarks<textarea value={remarks} onChange={event => setRemarks(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label>
        <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500"><Paperclip className="mr-2 inline h-4 w-4" />Attachments are not enabled.</p>
      </Card>
      {error && <p className="text-sm text-red-600 lg:col-span-2">{error}</p>}<Actions cancel={onCancel} saving={saving} label="Submit Request" />
    </form> : <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card title="Request details"><dl className="grid grid-cols-2 gap-4 text-sm">{[
        ['SD No.', record.sdNumber], ['Station', record.stationName], ['Equipment / Feeder', record.equipmentName || record.feederName || '—'], ['Shutdown Type', record.shutdownType], ['Purpose', record.purpose], ['Requested By', record.requestedByName], ['Requested Date', fmt(record.requestedAt)], ['Planned Start', fmt(record.plannedStart)], ['Expected Restoration', fmt(record.expectedRestoration)], ['Consumers Affected', displayConsumers(record.affectedConsumerCount)], ['Load Affected', displayLoad(record.affectedLoadMw)], ['Alternate Source Available', displayAlternateSource(record.alternateSourceAvailability)],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd></div>)}<div className="col-span-2"><dt className="text-xs text-slate-500">Work Description</dt><dd>{record.workDescription}</dd></div></dl></Card>
      <Card title={approval ? 'Approval' : 'Decision'}>{approval ? <><fieldset><legend>Action</legend>{([['APPROVED', 'Approve'], ['REJECTED', 'Reject']] as const).map(([value, label]) => <label key={value} className="mr-5 inline-flex gap-2"><input type="radio" checked={decision === value} onChange={() => setDecision(value)} />{label}</label>)}</fieldset><label>Approval Remarks<textarea value={decisionRemarks} onChange={event => setDecisionRemarks(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border p-3" /></label></> : record.decisionAt ? <dl className="space-y-3 text-sm"><div><dt>Decision By</dt><dd className="font-semibold">{record.decisionByName}</dd></div><div><dt>Decision Date</dt><dd>{fmt(record.decisionAt)}</dd></div><div><dt>Remarks</dt><dd>{record.decisionRemarks || '—'}</dd></div></dl> : <p className="text-sm text-slate-500">No decision has been recorded.</p>}</Card>
      {error && <p className="text-sm text-red-600 lg:col-span-2">{error}</p>}<Actions cancel={onCancel} saving={saving} label={approval ? 'Submit Decision' : undefined} submit={approval ? decide : undefined} />
    </div>}
  </div></div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-4 rounded-xl border bg-white p-5 text-sm shadow-sm"><h2 className="font-bold">{title}</h2>{children}</section>; }
function Actions({ cancel, saving, label, submit }: { cancel: () => void; saving: boolean; label?: string; submit?: () => void }) { return <div className="flex gap-3 lg:col-span-2 lg:justify-end"><button type="button" onClick={cancel} className="rounded-lg border px-5 py-3">Close</button>{label && <button type={submit ? 'button' : 'submit'} onClick={submit} disabled={saving} className="inline-flex rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{label}</button>}</div>; }
function State({ text, retry }: { text: string; retry?: () => void }) { return <div className="grid min-h-[60vh] place-items-center bg-[#f5f8fc]"><div className="text-center"><p>{text}</p>{retry && <button onClick={retry} className="mt-3 text-blue-700">Back</button>}</div></div>; }
