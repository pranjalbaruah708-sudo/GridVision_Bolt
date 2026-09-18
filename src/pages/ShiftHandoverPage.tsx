import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Loader2, RefreshCw, Send, ShieldAlert } from 'lucide-react';

import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { HandoverAccountability } from '@/components/HandoverAccountability';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { useApp } from '@/context/AppContext';
import { useShiftStationScope } from '@/context/ShiftStationScopeContext';
import { useAuth } from '@/hooks/useAuth';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import { api, type ShiftHandover, type ShiftHandoverDraftItemInput, type ShiftHandoverItem, type ShiftHandoverSourceType, type StationShift } from '@/services/api';
import { beginShiftHandoverDraftSession, deleteShiftHandoverLocalDraft, readShiftHandoverLocalDraft, type ShiftHandoverLocalDraft, writeShiftHandoverLocalDraft } from '@/services/operationalDrafts';

type SummaryItem = {
  key: string;
  sourceType: Exclude<ShiftHandoverSourceType, 'OPERATIONAL_NOTE'>;
  sourceId: string;
  label: string;
  detail: string;
  occurredAt: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  unresolved: boolean;
};

type SummaryState = { logbookCount: number; interruptions: SummaryItem[]; alerts: SummaryItem[]; logbook: SummaryItem[]; error: string | null; loading: boolean };
const emptySummary: SummaryState = { logbookCount: 0, interruptions: [], alerts: [], logbook: [], error: null, loading: false };

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function statusLabel(status: ShiftHandover['status']) { return status === 'SUBMITTED' ? 'Awaiting Acceptance' : status.replace('_', ' '); }
function message(_cause: unknown, fallback: string) { return fallback; }
function sourceKey(type: string, id: string | null) { return `${type}:${id ?? 'note'}`; }
function sameSourceKeys(left: Iterable<string>, right: Iterable<string>) {
  const leftKeys = new Set(left);
  const rightKeys = new Set(right);
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}
function windowEnd(shift: StationShift) { return new Date(Math.min(new Date(shift.scheduled_end).getTime(), Date.now())).toISOString(); }

export function ShiftHandoverPage({ onBack }: { onBack: () => void }) {
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const auth = useAuth();
  const shiftDuty = useShiftDuty(shiftScope.selectedStationId || null);
  const summaryRequestRef = useRef(0);
  const handoverRequestRef = useRef(0);
  const contextGenerationRef = useRef(0);
  const contextRef = useRef<string | null>(null);
  const [handover, setHandover] = useState<ShiftHandover | null>(null);
  const [items, setItems] = useState<ShiftHandoverItem[]>([]);
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<SummaryState>(emptySummary);
  const [loadingHandover, setLoadingHandover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localDraftStatus, setLocalDraftStatus] = useState<'NONE' | 'SAVED' | 'CONFLICT'>('NONE');
  const [localConflictDraft, setLocalConflictDraft] = useState<ShiftHandoverLocalDraft | null>(null);
  const [reviewOutgoing, setReviewOutgoing] = useState<StationShift | null>(null);
  const currentShift = shiftDuty.currentShift;
  const pendingIncoming = shiftDuty.pendingIncomingHandover;
  const incomingReview = Boolean(
    currentShift
    && shiftDuty.myDutySession?.status === 'ON_DUTY'
    && ((pendingIncoming?.incoming_shift_id === currentShift.id) || handover?.incoming_shift_id === currentShift.id),
  );
  const outgoing = incomingReview ? reviewOutgoing : currentShift;
  const incoming = incomingReview ? currentShift : shiftDuty.nextShift;
  const outgoingEligible = Boolean(!incomingReview && outgoing && incoming && shiftDuty.myDutySession?.status === 'ON_DUTY');
  const incomingEligible = Boolean(incomingReview && handover?.status === 'SUBMITTED' && shiftDuty.myDutySession?.status === 'ON_DUTY');
  const editable = handover?.status === 'DRAFT' && outgoingEligible;
  const canSaveServerDraft = Boolean(editable && online);
  const contextKey = [
    auth.user?.id ?? 'none',
    shiftDuty.station?.id ?? 'none',
    currentShift?.id ?? 'none',
    shiftDuty.nextShift?.id ?? 'none',
    pendingIncoming?.id ?? 'none',
    pendingIncoming?.outgoing_shift_id ?? 'none',
    pendingIncoming?.incoming_shift_id ?? 'none',
    shiftDuty.myDutySession?.status ?? 'none',
  ].join(':');
  const isCurrentContext = useCallback((generation: number) => contextGenerationRef.current === generation, []);

  useEffect(() => {
    if (contextRef.current === contextKey) return;
    contextRef.current = contextKey;
    contextGenerationRef.current += 1;
    summaryRequestRef.current += 1;
    handoverRequestRef.current += 1;
    setHandover(null);
    setItems([]);
    setNotes('');
    setSelected(new Set());
    setSummary(emptySummary);
    setReviewOutgoing(null);
    setLoadingHandover(false);
    setSaving(false);
    setSubmitting(false);
    setAccepting(false);
    setConfirmSubmit(false);
    setConfirmAccept(false);
    setError(null);
    setLocalDraftStatus('NONE');
    setLocalConflictDraft(null);
  }, [contextKey]);

  const loadSummary = useCallback(async () => {
    const generation = contextGenerationRef.current;
    const request = ++summaryRequestRef.current;
    const isCurrent = () => isCurrentContext(generation) && request === summaryRequestRef.current;
    if (!outgoing) { if (isCurrent()) setSummary(emptySummary); return; }
    const end = windowEnd(outgoing);
    if (new Date(end) <= new Date(outgoing.scheduled_start)) { if (isCurrent()) setSummary(emptySummary); return; }
    setSummary((current) => ({ ...current, loading: true, error: null }));
    try {
      const [logbook, periodInterruptions, openInterruptions, periodAlerts, currentAlerts] = await Promise.all([
        api.getLogBookForPeriod(outgoing.station_id, outgoing.scheduled_start, end),
        api.getInterruptionsForPeriod(outgoing.station_id, outgoing.scheduled_start, end),
        api.getOpenInterruptionsForStation(outgoing.station_id),
        api.getParameterAlerts(outgoing.station_id, outgoing.scheduled_start, end),
        api.getCurrentParameterAlerts(outgoing.station_id),
      ]);
      if (!isCurrent()) return;
      const interruptions = [...periodInterruptions, ...openInterruptions.filter((item) => !periodInterruptions.some((existing) => existing.id === item.id))]
        .map((item) => ({
          key: sourceKey('INTERRUPTION', item.id), sourceType: 'INTERRUPTION' as const, sourceId: item.id,
          label: item.current_status === 'OPEN' ? 'Open interruption' : 'Restored interruption',
          detail: `${item.cause ?? 'Operational interruption'}${item.remarks ? ` — ${item.remarks}` : ''}`,
          occurredAt: item.interruption_start, priority: item.current_status === 'OPEN' ? 'HIGH' as const : 'MEDIUM' as const,
          unresolved: item.current_status === 'OPEN',
        }));
      const alerts = [...periodAlerts, ...currentAlerts.filter((item) => !periodAlerts.some((existing) => existing.id === item.id))]
        .map((item) => ({
          key: sourceKey('PARAMETER_ALERT', item.id), sourceType: 'PARAMETER_ALERT' as const, sourceId: item.id,
          label: `${item.parameter_code} ${item.breach_type.replace('_', ' ')}`,
          detail: `${item.feeder_name ?? 'Station equipment'} · value ${item.actual_value}`,
          occurredAt: item.triggered_at, priority: 'HIGH' as const,
          unresolved: item.is_current,
        }));
      const logbookItems = logbook.map((item) => ({
        key: sourceKey('LOGBOOK_ENTRY', item.id), sourceType: 'LOGBOOK_ENTRY' as const, sourceId: item.id,
        label: item.feeder_id ? 'Feeder logbook entry' : 'Station logbook entry',
        detail: item.remarks?.trim() || 'Operational reading recorded', occurredAt: item.actual_event_time,
        priority: 'LOW' as const, unresolved: false,
      }));
      setSummary({ logbookCount: logbook.length, interruptions, alerts, logbook: logbookItems, loading: false, error: null });
    } catch (cause) {
      if (isCurrent()) setSummary((current) => ({ ...current, loading: false, error: message(cause, 'Could not load the automatic operational summary.') }));
    }
  }, [isCurrentContext, outgoing]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const localDraftContext = useCallback((current: ShiftHandover) => {
    const userId = auth.user?.id;
    if (!userId) return null;
    return { userId, stationId: current.station_id, outgoingShiftId: current.outgoing_shift_id, incomingShiftId: current.incoming_shift_id, handoverId: current.id };
  }, [auth.user?.id]);

  const refreshHandover = useCallback(async (current: ShiftHandover, generation = contextGenerationRef.current) => {
    const latest = await api.getShiftHandover(current.id);
    if (!isCurrentContext(generation)) return false;
    if (!latest) throw new Error('Handover is no longer available.');
    current = latest;
    const currentItems = await api.getShiftHandoverItems(current.id);
    if (!isCurrentContext(generation)) return false;
    const context = localDraftContext(current);
    const localDraft = context && current.status === 'DRAFT' ? await readShiftHandoverLocalDraft(context).catch(() => null) : null;
    if (!isCurrentContext(generation)) return false;
    setHandover(current);
    setItems(currentItems);
    const serverSelected = new Set(currentItems.filter((item) => item.source_id).map((item) => sourceKey(item.source_type, item.source_id)));
    const localDraftDiffersFromServer = Boolean(localDraft && (
      localDraft.outgoingNotes !== (current.outgoing_notes ?? '')
      || !sameSourceKeys(localDraft.selectedSourceKeys, serverSelected)
    ));
    if (localDraft && !localDraftDiffersFromServer) {
      void deleteShiftHandoverLocalDraft(context!).catch(() => undefined);
      setNotes(current.outgoing_notes ?? '');
      setSelected(serverSelected);
      setLocalDraftStatus('NONE');
      setLocalConflictDraft(null);
    } else if (localDraft && localDraft.baseServerUpdatedAt === current.updated_at) {
      setNotes(localDraft.outgoingNotes);
      setSelected(new Set(localDraft.selectedSourceKeys));
      setLocalDraftStatus('SAVED');
      setLocalConflictDraft(null);
    } else {
      setNotes(current.outgoing_notes ?? '');
      setSelected(serverSelected);
      setLocalDraftStatus(localDraft ? 'CONFLICT' : 'NONE');
      setLocalConflictDraft(localDraft);
    }
    return true;
  }, [isCurrentContext, localDraftContext]);

  useEffect(() => {
    if (!pendingIncoming || !currentShift || pendingIncoming.incoming_shift_id !== currentShift.id || shiftDuty.myDutySession?.status !== 'ON_DUTY') return;
    const generation = contextGenerationRef.current;
    const request = ++handoverRequestRef.current;
    const isCurrent = () => isCurrentContext(generation) && request === handoverRequestRef.current;
    setLoadingHandover(true);
    void (async () => {
      try {
        const [current, history] = await Promise.all([
          api.getShiftHandover(pendingIncoming.id),
          api.getStationShiftHistory(pendingIncoming.station_id, 50),
        ]);
        if (!isCurrent()) return;
        if (!current || current.incoming_shift_id !== currentShift.id) {
          setError('The submitted incoming handover is no longer available. Refresh to load the latest server state.');
          return;
        }
        setReviewOutgoing(history.find((shift) => shift.id === current.outgoing_shift_id) ?? null);
        await refreshHandover(current, generation);
      } catch (cause) {
        if (isCurrent()) setError(message(cause, 'Could not load the incoming handover. Refresh and try again.'));
      } finally {
        if (isCurrent()) setLoadingHandover(false);
      }
    })();
  }, [currentShift, isCurrentContext, pendingIncoming, refreshHandover, shiftDuty.myDutySession?.status, shiftDuty.station?.id]);

  const refreshAuthoritativeHandover = useCallback(async (generation = contextGenerationRef.current) => {
    if (!handover) return;
    try {
      if (incomingReview) {
        const current = await api.getShiftHandover(handover.id);
        if (current) await refreshHandover(current, generation);
      } else if (outgoing && incoming && outgoingEligible) {
        await refreshHandover(await api.getOrCreateShiftHandover(outgoing.id, incoming.id), generation);
      }
    } catch {
      // Preserve the original mutation failure when a fresh read is unavailable.
    }
  }, [handover, incoming, incomingReview, outgoing, outgoingEligible, refreshHandover]);

  const startOrReopen = async () => {
    if (!outgoing || !incoming || !outgoingEligible || !online) return;
    const generation = contextGenerationRef.current;
    setLoadingHandover(true);
    setError(null);
    try {
      await refreshHandover(await api.getOrCreateShiftHandover(outgoing.id, incoming.id), generation);
    } catch (cause) {
      if (isCurrentContext(generation)) setError(message(cause, 'Could not start the shift handover. Confirm your active duty and try again.'));
    } finally {
      if (isCurrentContext(generation)) setLoadingHandover(false);
    }
  };

  const sourceItems = useMemo(() => [...summary.interruptions, ...summary.alerts, ...summary.logbook], [summary]);
  const unresolved = useMemo(() => [...summary.interruptions, ...summary.alerts].filter((item) => item.unresolved), [summary]);
  const draftItems = useCallback((): ShiftHandoverDraftItemInput[] => {
    const sourceByKey = new Map(sourceItems.map((item) => [item.key, item]));
    const chosen = sourceItems.filter((item) => selected.has(item.key)).map((item) => ({ source_type: item.sourceType, source_id: item.sourceId, priority: item.priority }));
    const retained = items.filter((item) => !item.source_id || !sourceByKey.has(sourceKey(item.source_type, item.source_id))).map((item) => ({ source_type: item.source_type, source_id: item.source_id, description: item.description, priority: item.priority }));
    return [...chosen, ...retained];
  }, [items, selected, sourceItems]);

  useEffect(() => {
    const serverSelected = new Set(items.filter((item) => item.source_id).map((item) => sourceKey(item.source_type, item.source_id)));
    const hasUnsavedLocalChanges = Boolean(
      handover
      && (
        notes !== (handover.outgoing_notes ?? '')
        || !sameSourceKeys(selected, serverSelected)
      ),
    );
    if (!handover || handover.status !== 'DRAFT' || !outgoingEligible || !hasUnsavedLocalChanges) {
      if (localDraftStatus === 'SAVED') setLocalDraftStatus('NONE');
      return;
    }
    const context = localDraftContext(handover);
    if (!context) return;
    const generation = contextGenerationRef.current;
    const epoch = beginShiftHandoverDraftSession(context);
    const timer = window.setTimeout(() => {
      void writeShiftHandoverLocalDraft({ ...context, baseServerUpdatedAt: handover.updated_at, outgoingNotes: notes, selectedSourceKeys: [...selected] }, epoch)
        .then(() => { if (isCurrentContext(generation)) setLocalDraftStatus('SAVED'); })
        .catch(() => { if (isCurrentContext(generation)) setError('Your handover draft could not be saved on this device. Keep this page open and retry when storage is available.'); });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [handover, isCurrentContext, items, localDraftContext, localDraftStatus, notes, outgoingEligible, selected]);

  const saveDraft = async () => {
    if (!handover || !canSaveServerDraft) return;
    const generation = contextGenerationRef.current;
    setSaving(true); setError(null);
    try {
      const saved = await api.saveShiftHandoverDraft(handover.id, notes, draftItems());
      const context = localDraftContext(saved);
      if (context) await deleteShiftHandoverLocalDraft(context).catch(() => undefined);
      await refreshHandover(saved, generation);
    }
    catch (cause) {
      await refreshAuthoritativeHandover(generation);
      if (isCurrentContext(generation)) setError(message(cause, 'Draft was not saved. Refresh and try again.'));
    }
    finally { if (isCurrentContext(generation)) setSaving(false); }
  };

  const submit = async () => {
    if (!handover || !canSaveServerDraft) return;
    const generation = contextGenerationRef.current;
    setConfirmSubmit(false); setSubmitting(true); setError(null);
    try {
      const submitted = await api.submitShiftHandover(handover.id, notes);
      const context = localDraftContext(submitted);
      if (context) await deleteShiftHandoverLocalDraft(context).catch(() => undefined);
      await refreshHandover(submitted, generation);
    }
    catch (cause) {
      await refreshAuthoritativeHandover(generation);
      if (isCurrentContext(generation)) setError(message(cause, 'Handover was not submitted. The latest server state has not been changed.'));
    }
    finally { if (isCurrentContext(generation)) setSubmitting(false); }
  };

  const accept = async () => {
    if (!handover || !incomingEligible || !online) return;
    const generation = contextGenerationRef.current;
    setConfirmAccept(false); setAccepting(true); setError(null);
    try {
      const refreshed = await refreshHandover(await api.acceptShiftHandover(handover.id), generation);
      if (refreshed && isCurrentContext(generation)) await shiftDuty.refresh();
    } catch (cause) {
      await refreshAuthoritativeHandover(generation);
      const latest = await api.getShiftHandover(handover.id).catch(() => null);
      if (!isCurrentContext(generation)) return;
      if (latest?.status === 'ACCEPTED') {
        const refreshed = await refreshHandover(latest, generation);
        if (refreshed && isCurrentContext(generation)) await shiftDuty.refresh();
      } else if (isCurrentContext(generation)) {
        setError(message(cause, 'Handover acceptance was not confirmed. The latest server state has been reloaded.'));
      }
    } finally { if (isCurrentContext(generation)) setAccepting(false); }
  };

  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return <Screen showStatusBar={false}>
    <AppHeader title="Shift Handover" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Shift Handover" subtitle={incomingReview ? 'Incoming handover review, confirmed by the server' : 'Outgoing operational handover, confirmed by the server'} />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-6xl space-y-4 lg:max-w-none">
      {!online && <Notice tone="amber">You can continue editing a local DRAFT, but saving it to the shared handover, submission, and acceptance require an online server connection.</Notice>}
      {localDraftStatus === 'SAVED' && handover?.status === 'DRAFT' && <Notice tone="amber">Draft saved on this device. It is not submitted and will not change the server until you save it online.</Notice>}
      {localDraftStatus === 'CONFLICT' && <section className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"><p>A local draft exists, but the server draft changed. The server version is shown to prevent an accidental overwrite.</p><button type="button" onClick={() => { if (localConflictDraft) { setNotes(localConflictDraft.outgoingNotes); setSelected(new Set(localConflictDraft.selectedSourceKeys)); setLocalDraftStatus('SAVED'); } }} className="mt-2 min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-900">Review local draft</button></section>}
      {error && <Notice tone="red">{error}</Notice>}
      {!currentShift && !shiftDuty.loading && <Empty title="No current shift" detail="A handover can be prepared only from an active, server-confirmed current shift." />}
      {currentShift && !incomingReview && !incoming && <Empty title="No next shift" detail="The server has not scheduled a valid incoming shift for this station yet." />}
      {outgoing && incoming && <Transition station={shiftDuty.station?.name ?? 'Current station'} outgoing={outgoing} incoming={incoming} handover={handover} />}
      {!incomingReview && handover?.accountability && handover.status !== 'DRAFT' && <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><h2 className="font-bold text-slate-900">{incomingReview ? handover.status === 'ACCEPTED' ? 'Handover Accepted' : 'Incoming Handover' : 'Handover Submitted'}</h2><HandoverAccountability value={handover.accountability} side={incomingReview ? 'incoming' : 'outgoing'} /></section>}
      {currentShift && !incomingReview && incoming && !outgoingEligible && <Notice tone="amber">Start Duty on the outgoing shift before preparing its handover. Server authorization remains required.</Notice>}
      {outgoingEligible && !handover && <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-900">Start shift handover</h2><p className="mt-1 text-sm leading-6 text-slate-600">There is one shared handover for this station transition. Starting it opens the existing draft when another outgoing participant has already created one.</p><button type="button" disabled={!online || loadingHandover} onClick={() => void startOrReopen()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60"><ClipboardCheck className="h-4 w-4" />{loadingHandover ? 'Opening…' : 'Start or reopen handover'}</button></section>}
      {incomingReview && !handover && loadingHandover && <section className="grid min-h-40 place-items-center rounded-2xl bg-white shadow-sm"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></section>}
      {handover && <><div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]"><Summary summary={summary} selected={selected} editable={editable} onToggle={toggle} onRefresh={() => void loadSummary()} /><section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-900">Outgoing remarks</h2><p className="text-xs text-slate-500">Saved with the shared handover draft</p></div></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!editable || saving || submitting} placeholder="Station condition, coordination note, expected restoration, or operating caution" className="mt-4 min-h-40 w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800 outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-600" />{handover.status !== 'DRAFT' && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">This handover is read-only because it is {statusLabel(handover.status).toLowerCase()}.</p>}<div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{editable && <button type="button" disabled={!online || saving || submitting} onClick={() => void saveDraft()} className="min-h-11 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save Draft'}</button>}{editable && <button type="button" disabled={!online || saving || submitting} onClick={() => setConfirmSubmit(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60"><Send className="h-4 w-4" />{submitting ? 'Submitting…' : 'Submit Handover'}</button>}</div></section></div><Matters items={unresolved} selected={selected} editable={editable} onToggle={toggle} /></>}
      {handover && incomingReview && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Incoming review</p><h2 className="mt-1 text-lg font-bold text-slate-900">{handover.status === 'ACCEPTED' ? 'Handover Accepted' : 'Awaiting Acceptance'}</h2><p className="mt-1 text-sm leading-6 text-slate-700">{handover.status === 'ACCEPTED' ? `Accepted ${formatDateTime(handover.accepted_at)} by an authorized incoming operator.` : `Submitted ${formatDateTime(handover.submitted_at)}. Review the outgoing information before accepting it on behalf of the incoming shift.`}</p></div>{incomingEligible && <button type="button" disabled={!online || accepting} onClick={() => setConfirmAccept(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{accepting ? 'Accepting…' : 'Accept Handover'}</button>}</div>{handover.accountability && <HandoverAccountability value={handover.accountability} side="incoming" />}{handover.status === 'SUBMITTED' && !online && <p className="mt-3 text-sm font-medium text-amber-800">Internet connection is required to accept this handover.</p>}</section>}
    </div></PageBody>
    {confirmSubmit && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">Submit handover?</h2><p className="mt-2 text-sm leading-6 text-slate-600">After submission, the outgoing handover is frozen for normal editing and sent to the incoming shift for review. This does not resolve operational issues.</p><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setConfirmSubmit(false)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={() => void submit()} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white">Submit</button></div></div></div>}
    {confirmAccept && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">Accept handover?</h2><p className="mt-2 text-sm leading-6 text-slate-600">This records that you have reviewed and accepted the outgoing shift information on behalf of the incoming shift. It does not resolve or close any operational matter.</p><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={accepting} onClick={() => setConfirmAccept(false)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" disabled={accepting} onClick={() => void accept()} className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60">{accepting ? 'Accepting…' : 'Accept'}</button></div></div></div>}
  </Screen>;
}

function Transition({ station, outgoing, incoming, handover }: { station: string; outgoing: StationShift; incoming: StationShift; handover: ShiftHandover | null }) { return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Station transition</p><h2 className="mt-1 text-lg font-bold text-slate-900">{station}</h2></div>{handover && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{statusLabel(handover.status)}</span>}</div><div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><ShiftInfo title="Outgoing shift" shift={outgoing} /><ShiftInfo title="Incoming shift" shift={incoming} /></div></section>; }
function ShiftInfo({ title, shift }: { title: string; shift: StationShift }) { return <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 font-semibold text-slate-900">{shift.shift_name}</p><p className="text-sm text-slate-600">Logical date: {shift.shift_date}</p><p className="mt-1 text-sm text-slate-600">{formatDateTime(shift.scheduled_start)} – {formatDateTime(shift.scheduled_end)}</p></div>; }
function Summary({ summary, selected, editable, onToggle, onRefresh }: { summary: SummaryState; selected: Set<string>; editable: boolean; onToggle: (key: string) => void; onRefresh: () => void }) { const sources = [...summary.interruptions, ...summary.alerts, ...summary.logbook]; const visibleSources = sources.slice(0, 50); return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">Automatic operational summary</h2><p className="mt-1 text-xs leading-5 text-slate-500">Bounded records from the outgoing shift period; source records remain authoritative.</p></div><button type="button" onClick={onRefresh} disabled={summary.loading} className="rounded-xl border border-slate-200 p-2 text-blue-700 disabled:opacity-60" aria-label="Refresh operational summary"><RefreshCw className={`h-4 w-4 ${summary.loading ? 'animate-spin' : ''}`} /></button></div>{summary.error && <Notice tone="red">{summary.error}</Notice>}{summary.loading ? <div className="grid min-h-36 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : <><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Logbook" value={summary.logbookCount} /><Metric label="Interruptions" value={summary.interruptions.length} /><Metric label="Alerts" value={summary.alerts.length} /></div><div className="mt-4 space-y-2">{visibleSources.length ? visibleSources.map((item) => <SourceRow key={item.key} item={item} checked={selected.has(item.key)} editable={editable} onToggle={onToggle} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No operational records were found in the outgoing shift period.</p>}</div>{sources.length > visibleSources.length && <p className="mt-3 text-xs text-slate-500">Showing the most recent 50 source records.</p>}</>}</section>; }
function SourceRow({ item, checked, editable, onToggle }: { item: SummaryItem; checked: boolean; editable: boolean; onToggle: (key: string) => void }) { return <label className={`flex gap-3 rounded-xl border p-3 ${checked ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white'} ${editable ? 'cursor-pointer' : ''}`}><input type="checkbox" checked={checked} disabled={!editable} onChange={() => onToggle(item.key)} className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-800">{item.label}</span>{item.unresolved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Needs attention</span>}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">{item.detail}</span><span className="mt-1 block text-[11px] text-slate-500">{formatDateTime(item.occurredAt)}</span></span></label>; }
function Matters({ items, selected, editable, onToggle }: { items: SummaryItem[]; selected: Set<string>; editable: boolean; onToggle: (key: string) => void }) { const visibleItems = items.slice(0, 50); return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /><div><h2 className="font-bold text-slate-900">Matters requiring attention</h2><p className="text-xs text-slate-500">Including a source in the handover does not change its operational status.</p></div></div><div className="mt-4 space-y-2">{visibleItems.length ? visibleItems.map((item) => <SourceRow key={item.key} item={item} checked={selected.has(item.key)} editable={editable} onToggle={onToggle} />) : <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">No open interruptions or current parameter alerts were found.</p>}</div>{items.length > visibleItems.length && <p className="mt-3 text-xs text-slate-500">Showing the most recent 50 unresolved matters.</p>}</section>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p></div>; }
function Notice({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) { return <p role="alert" className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{children}</p>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <section className="rounded-2xl bg-white p-6 text-center shadow-sm"><ShieldAlert className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-3 text-base font-bold text-slate-800">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{detail}</p></section>; }
