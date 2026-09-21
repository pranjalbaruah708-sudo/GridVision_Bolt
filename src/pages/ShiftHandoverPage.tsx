import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Loader2, Pencil, RefreshCw, Send, ShieldAlert, Trash2, WifiOff } from 'lucide-react';

import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { HandoverAccountability } from '@/components/HandoverAccountability';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';
import { useApp } from '@/context/AppContext';
import { useShiftStationScope } from '@/context/ShiftStationScopeContext';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import { api, type EqualOperatorHandoverEntry, type ShiftDutyHandoverState, type ShiftHandover, type ShiftHandoverDraftItemInput, type ShiftHandoverItem, type ShiftHandoverSourceType, type StationShift } from '@/services/api';
import { beginShiftHandoverDraftSession, deleteShiftHandoverLocalDraft, readShiftHandoverLocalDraft, type ShiftHandoverLocalDraft, writeShiftHandoverLocalDraft } from '@/services/operationalDrafts';
import { notifyShiftDutyStateChanged } from '@/services/operatorDutyWarning';

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
const HANDOVER_REALTIME_TABLES = ['shift_handovers', 'shift_handover_entries', 'shift_duty_handover_states', 'notification_events', 'notification_recipients'] as const;

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
function remainingShiftTime(scheduledEnd: string): string | null {
  const remainingMinutes = Math.ceil((new Date(scheduledEnd).getTime() - Date.now()) / 60_000);
  if (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0) return null;
  return `${Math.floor(remainingMinutes / 60)} hr, ${remainingMinutes % 60} min`;
}

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

  // The version-2 outgoing workflow is deliberately isolated from the legacy
  // incoming review below. Incoming acceptance remains on its existing path
  // until its own migration stage replaces it.
  if (!incomingReview || pendingIncoming?.workflow_version === 2 || handover?.workflow_version === 2) {
    return <EqualOperatorHandoverRouter onBack={onBack} />;
  }

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

type IncomingHandoverCandidate = {
  id: string;
  submittedByName: string | null;
  acceptedByName: string | null;
  lateReviewRequired: boolean;
};

function previousCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function EqualOperatorHandoverRouter({ onBack }: { onBack: () => void }) {
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const auth = useAuth();
  const shiftDuty = useShiftDuty(shiftScope.selectedStationId || null);
  const [checking, setChecking] = useState(true);
  const [availabilityKnown, setAvailabilityKnown] = useState(false);
  const [candidate, setCandidate] = useState<IncomingHandoverCandidate | null>(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const availabilityRequestRef = useRef(0);
  const currentShift = shiftDuty.currentShift;
  const currentShiftId = currentShift?.id ?? null;
  const currentStationId = currentShift?.station_id ?? null;
  const currentShiftDate = currentShift?.shift_date ?? null;
  const currentDutySessionId = shiftDuty.myDutySession?.status === 'ON_DUTY' ? shiftDuty.myDutySession.id : null;
  const rosteredForCurrentShift = Boolean(currentShiftId && auth.user?.id && shiftDuty.plannedRoster.some((member) => member.user_id === auth.user?.id));

  const checkAvailability = useCallback(async (showLoading = false) => {
    const request = ++availabilityRequestRef.current;
    if (!currentShiftId || !currentStationId || !currentShiftDate || !rosteredForCurrentShift) {
      setCandidate(null); setLegacyAvailable(false); setAvailabilityKnown(true); setChecking(false); return;
    }
    if (!online) {
      setCandidate(null); setLegacyAvailable(false); setAvailabilityKnown(false); setChecking(false); return;
    }
    if (showLoading) setChecking(true);
    try {
      // Reuse the bounded server-side history contract to locate the handover
      // for this incoming shift, including a team handover already accepted.
      const rows = await api.getStationShiftCompliance(currentStationId, previousCalendarDate(currentShiftDate), currentShiftDate, 100);
      const reported = rows.map((row) => row.handover).find((handover) => handover?.incoming_shift_id === currentShiftId) ?? null;
      if (request !== availabilityRequestRef.current) return;
      if (!reported) { setCandidate(null); setLegacyAvailable(false); setAvailabilityKnown(true); setAvailabilityVersion((value) => value + 1); return; }
      const detail = await api.getEqualOperatorHandover(reported.id);
      if (request !== availabilityRequestRef.current) return;
      if (detail.handover.workflow_version !== 2) { setCandidate(null); setLegacyAvailable(true); setAvailabilityKnown(true); setAvailabilityVersion((value) => value + 1); return; }
      if (!['SUBMITTED', 'ACCEPTED'].includes(detail.handover.status)) { setCandidate(null); setLegacyAvailable(false); setAvailabilityKnown(true); setAvailabilityVersion((value) => value + 1); return; }
      const lateReviewRequired = Boolean(currentDutySessionId && detail.individual_states.some((state) => (
        state.side === 'INCOMING'
        && state.user_id === auth.user?.id
        && state.duty_session_id === currentDutySessionId
        && state.state === 'LATE_HANDOVER_REVIEW_REQUIRED'
      )));
      setCandidate((current) => current?.id === reported.id
        && current.submittedByName === reported.submitted_by_name
        && current.acceptedByName === reported.accepted_by_name
        && current.lateReviewRequired === lateReviewRequired
        ? current
        : { id: reported.id, submittedByName: reported.submitted_by_name, acceptedByName: reported.accepted_by_name, lateReviewRequired });
      setLegacyAvailable(false);
      setAvailabilityKnown(true);
      setAvailabilityVersion((value) => value + 1);
    } catch {
      if (request === availabilityRequestRef.current) setAvailabilityKnown(false);
    } finally { setChecking(false); }
  }, [auth.user?.id, currentDutySessionId, currentShiftDate, currentShiftId, currentStationId, online, rosteredForCurrentShift]);

  useEffect(() => {
    setChecking(true);
    setAvailabilityKnown(false);
    setCandidate(null);
    setLegacyAvailable(false);
    void checkAvailability(true);
  }, [checkAvailability, currentShiftId, rosteredForCurrentShift]);
  useEffect(() => {
    if (!shiftDuty.loaded || shiftDuty.loading || shiftDuty.refreshing) return;
    void checkAvailability(false);
  }, [checkAvailability, shiftDuty.loaded, shiftDuty.loading, shiftDuty.refreshing]);
  useRealtimeRefresh({
    channelName: `handover-availability-${auth.user?.id ?? 'anonymous'}-${currentShift?.id ?? 'none'}`,
    tables: HANDOVER_REALTIME_TABLES,
    onRefresh: () => { void shiftDuty.refresh().then(() => checkAvailability(false)); },
  });

  if (checking && !availabilityKnown && rosteredForCurrentShift) return <IncomingEqualOperatorHandoverPage onBack={onBack} handover={null} availabilityKnown={false} checkingAvailability availabilityVersion={availabilityVersion} onRefreshAvailability={() => checkAvailability(true)} />;
  if (rosteredForCurrentShift && legacyAvailable && !shiftDuty.myDutySession) return <LegacyIncomingHandoverFallback onBack={onBack} />;
  // A completed incoming acceptance belongs to this operator's already-active
  // duty. It must not redirect them away from the outgoing handover for the
  // same shift. Only a genuine late-handover obligation stays on the incoming
  // review screen after duty has begun.
  if (rosteredForCurrentShift && (!shiftDuty.myDutySession || candidate?.lateReviewRequired)) {
    return <IncomingEqualOperatorHandoverPage onBack={onBack} handover={candidate} availabilityKnown={availabilityKnown} checkingAvailability={false} availabilityVersion={availabilityVersion} onRefreshAvailability={() => checkAvailability(false)} />;
  }
  return <OutgoingEqualOperatorHandoverPage onBack={onBack} />;
}

function LegacyIncomingHandoverFallback({ onBack }: { onBack: () => void }) {
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const duty = useShiftDuty(shiftScope.selectedStationId || null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startLegacyDuty = async () => {
    if (!online || starting) return;
    setStarting(true);
    setError(null);
    try {
      await duty.startDuty();
      onBack();
    } catch (cause) {
      setError(message(cause, 'Duty start was not confirmed. Refresh and retry.'));
    } finally {
      setStarting(false);
    }
  };
  return <Screen showStatusBar={false}>
    <AppHeader title="Shift Handover" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Shift Handover" subtitle="Existing handover workflow" />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-3xl lg:max-w-none"><section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-900">Legacy handover available</h2><p className="mt-2 text-sm leading-6 text-slate-600">This record explicitly uses the earlier handover workflow. Its legacy duty start is retained for compatibility only.</p>{error && <Notice tone="red">{error}</Notice>}<div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={!online || starting} onClick={() => void startLegacyDuty()} className="min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60">{starting ? 'Starting…' : 'Start Duty for Legacy Handover'}</button><button type="button" onClick={onBack} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">Back</button></div></section></div></PageBody>
  </Screen>;
}

function IncomingEqualOperatorHandoverPage({ onBack, handover: candidate, availabilityKnown, checkingAvailability, availabilityVersion, onRefreshAvailability }: { onBack: () => void; handover: IncomingHandoverCandidate | null; availabilityKnown: boolean; checkingAvailability: boolean; availabilityVersion: number; onRefreshAvailability: () => Promise<void> }) {
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const auth = useAuth();
  const shiftDuty = useShiftDuty(shiftScope.selectedStationId || null);
  const currentShift = shiftDuty.currentShift;
  const requestRef = useRef(0);
  const commandKeyRef = useRef<string | null>(null);
  const lateAcceptanceKeyRef = useRef<string | null>(null);
  const [handover, setHandover] = useState<ShiftHandover | null>(null);
  const [entries, setEntries] = useState<EqualOperatorHandoverEntry[]>([]);
  const [individualStates, setIndividualStates] = useState<ShiftDutyHandoverState[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [startedWithoutHandover, setStartedWithoutHandover] = useState(false);
  const [startedAndAccepted, setStartedAndAccepted] = useState(false);
  const [acceptingLate, setAcceptingLate] = useState(false);
  const [confirmLate, setConfirmLate] = useState(false);
  const [lateFailed, setLateFailed] = useState(false);
  const [updatedByAnotherOperator, setUpdatedByAnotherOperator] = useState(false);
  const detailVersionRef = useRef<number | null>(null);
  const candidateId = candidate?.id ?? null;

  const refreshHandover = useCallback(async (background = false) => {
    if (!candidateId) { setHandover(null); setEntries([]); setIndividualStates([]); return; }
    const request = ++requestRef.current;
    if (!background) setLoading(true);
    try {
      const detail = await api.getEqualOperatorHandover(candidateId);
      if (request !== requestRef.current) return;
      setHandover(detail.handover); setEntries(detail.entries); setIndividualStates(detail.individual_states);
    } catch (cause) {
      if (request === requestRef.current) setError(message(cause, 'Could not load the submitted handover. Refresh and retry.'));
    } finally { if (request === requestRef.current && !background) setLoading(false); }
  }, [candidateId]);

  useEffect(() => {
    commandKeyRef.current = null;
    lateAcceptanceKeyRef.current = null;
    detailVersionRef.current = null;
    setError(null); setFailed(false); setLateFailed(false); setStartedWithoutHandover(false); setStartedAndAccepted(false); setUpdatedByAnotherOperator(false);
    void refreshHandover();
  }, [candidateId, refreshHandover]);
  useEffect(() => {
    if (detailVersionRef.current === null) {
      detailVersionRef.current = availabilityVersion;
      return;
    }
    if (detailVersionRef.current === availabilityVersion) return;
    detailVersionRef.current = availabilityVersion;
    if (!candidateId) return;
    setUpdatedByAnotherOperator(true);
    void refreshHandover(true);
  }, [availabilityVersion, candidateId, refreshHandover]);

  const myIndividualState = individualStates.find((state) => state.side === 'INCOMING' && state.user_id === auth.user?.id) ?? null;
  const latePending = myIndividualState?.state === 'LATE_HANDOVER_REVIEW_REQUIRED';
  const individuallyAccepted = myIndividualState?.state === 'ACCEPTED_AND_STARTED' || myIndividualState?.state === 'LATE_HANDOVER_ACCEPTED';
  const alreadyOnDuty = shiftDuty.myDutySession?.status === 'ON_DUTY';
  const beforeScheduledStart = Boolean(currentShift && Date.now() < new Date(currentShift.scheduled_start).getTime());
  const canStartWithHandover = Boolean(handover && !individuallyAccepted && !alreadyOnDuty && online && !starting);
  const canStartWithoutHandover = Boolean(!candidate && !beforeScheduledStart && availabilityKnown && acknowledged && !alreadyOnDuty && online && !starting);
  const incomingComments = individualStates.filter((state) => state.side === 'INCOMING' && state.acceptance_comments);
  const rosterNames = useMemo(() => new Map(shiftDuty.plannedRoster.map((member) => [member.user_id, member.full_name])), [shiftDuty.plannedRoster]);

  const reviewAndStart = async () => {
    if (!currentShift || starting || !online || (!handover && !canStartWithoutHandover)) return;
    const idempotencyKey = commandKeyRef.current ?? crypto.randomUUID();
    commandKeyRef.current = idempotencyKey;
    setConfirmStart(false); setStarting(true); setError(null); setFailed(false);
    try {
      const result = await api.reviewHandoverAndStartDuty({
        shiftId: currentShift.id,
        handoverId: handover?.id ?? null,
        acknowledgeNoHandover: handover ? false : true,
        acceptanceComments: comments.trim() || null,
        idempotencyKey,
      });
      if (result.handover) {
        setHandover(result.handover);
        setStartedAndAccepted(result.duty_session.status === 'ON_DUTY');
        await refreshHandover();
      } else {
        setStartedWithoutHandover(result.duty_session.status === 'ON_DUTY');
      }
      if (result.duty_session.status === 'ON_DUTY') notifyShiftDutyStateChanged();
      await shiftDuty.refresh();
      await onRefreshAvailability();
      if (result.duty_session.status === 'ON_DUTY') onBack();
    } catch (cause) {
      setFailed(true);
      setError(message(cause, 'Duty start was not confirmed. The latest server state has been reloaded; retry only if your duty is still not active.'));
      await refreshHandover();
      await shiftDuty.refresh();
    } finally { setStarting(false); }
  };

  const acceptLate = async () => {
    if (!handover || !shiftDuty.myDutySession || !latePending || acceptingLate || !online) return;
    const idempotencyKey = lateAcceptanceKeyRef.current ?? crypto.randomUUID();
    lateAcceptanceKeyRef.current = idempotencyKey;
    setConfirmLate(false); setAcceptingLate(true); setLateFailed(false); setError(null);
    try {
      await api.acceptLateShiftHandover({
        dutySessionId: shiftDuty.myDutySession.id,
        handoverId: handover.id,
        acceptanceComments: comments.trim() || null,
        idempotencyKey,
      });
      setComments('');
      await Promise.all([refreshHandover(), shiftDuty.refresh(), onRefreshAvailability()]);
    } catch (cause) {
      setLateFailed(true);
      setError(message(cause, 'Late handover acceptance was not confirmed. Your duty remains active and ending duty remains blocked until the server confirms your individual acceptance.'));
      await Promise.all([refreshHandover(), shiftDuty.refresh()]);
    } finally { setAcceptingLate(false); }
  };

  const originalEntries = entries.filter((entry) => entry.phase === 'INITIAL');
  const amendments = entries.filter((entry) => entry.phase === 'AMENDMENT');
  const draftEntries = entries.filter((entry) => entry.phase === 'DRAFT');
  const showStarted = startedAndAccepted || individuallyAccepted;

  return <Screen showStatusBar={false}>
    <AppHeader title="Shift Handover" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Shift Handover" subtitle={latePending ? 'Late handover review and individual acceptance' : 'Review the shared handover before starting your individual duty'} />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-6xl space-y-4 lg:max-w-none">
      {!online && <Notice tone="amber"><span className="inline-flex items-center gap-2"><WifiOff className="h-4 w-4" />A connection is required to review, accept, or start duty. These lifecycle actions are never queued for offline replay.</span></Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      {updatedByAnotherOperator && <Notice tone="blue"><span className="inline-flex items-center gap-2">Handover updated by another operator.<button type="button" onClick={() => setUpdatedByAnotherOperator(false)} className="font-bold underline">Dismiss</button></span></Notice>}
      {!currentShift && !shiftDuty.loading && <Empty title="No current shift" detail="There is no active server-confirmed shift to start." />}
      {currentShift && <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Incoming shift</p><h2 className="mt-1 text-lg font-bold text-slate-900">{currentShift.shift_name}</h2><p className="mt-1 text-sm text-slate-600">{shiftDuty.station?.name ?? 'Current station'} · {formatDateTime(currentShift.scheduled_start)} – {formatDateTime(currentShift.scheduled_end)}</p></section>}
      {checkingAvailability && <section className="grid min-h-32 place-items-center rounded-2xl bg-white shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-blue-600" />Checking for a submitted handover…</div></section>}
      {!checkingAvailability && !availabilityKnown && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><h2 className="font-bold text-slate-900">Handover availability could not be confirmed</h2><p className="mt-1 text-sm leading-6 text-slate-700">Reconnect and refresh before starting duty. The system will not assume that no handover exists.</p><button type="button" onClick={() => void onRefreshAvailability()} disabled={!online} className="mt-3 min-h-10 rounded-xl border border-amber-300 px-4 text-sm font-bold text-amber-900 disabled:opacity-60">Retry availability check</button></section>}
      {handover && <>
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Submitted team handover</p><h2 className="mt-1 text-lg font-bold text-slate-900">{handover.status === 'ACCEPTED' ? 'Team handover accepted' : 'Awaiting team acceptance'}</h2><p className="mt-1 text-sm leading-6 text-slate-600">Submitted {formatDateTime(handover.submitted_at)} by {candidate?.submittedByName ?? `Operator ${handover.submitted_by_user_id?.slice(0, 8) ?? '—'}`}.</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${handover.status === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{handover.status === 'ACCEPTED' ? 'ACCEPTED' : 'SUBMITTED'}</span></div><div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><p className="text-sm text-slate-700"><span className="font-semibold">Team acceptance:</span> {handover.status === 'ACCEPTED' ? `Accepted ${formatDateTime(handover.accepted_at)} by ${candidate?.acceptedByName ?? `Operator ${handover.accepted_by_user_id?.slice(0, 8) ?? '—'}`}` : 'Awaiting the first incoming operator'}</p><p className="text-sm text-slate-700"><span className="font-semibold">Your acceptance:</span> {individuallyAccepted ? `Accepted ${formatDateTime(myIndividualState?.accepted_at)}` : latePending ? 'Late handover review required before ending duty' : 'Required before your duty starts'}</p></div></section>
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><h2 className="font-bold text-slate-900">Original submitted handover</h2><p className="mt-1 text-xs text-slate-500">The original snapshot is immutable. Amendments and individual comments remain separately attributed.</p><HandoverEntryList entries={originalEntries.length ? originalEntries : draftEntries} currentUserId={auth.user?.id ?? null} editable={false} onEdit={() => undefined} onRemove={() => undefined} />{amendments.length > 0 && <><h3 className="mt-5 font-bold text-slate-900">Amendments</h3><HandoverEntryList entries={amendments} currentUserId={auth.user?.id ?? null} editable={false} onEdit={() => undefined} onRemove={() => undefined} /></>}</section>
        {incomingComments.length > 0 && <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><h2 className="font-bold text-slate-900">Incoming operator comments</h2><div className="mt-3 space-y-2">{incomingComments.map((state) => <article key={state.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm text-slate-800">{state.acceptance_comments}</p><p className="mt-1 text-xs text-slate-500">{state.user_id === auth.user?.id ? 'You' : rosterNames.get(state.user_id) ?? `Operator ${state.user_id.slice(0, 8)}`} · {formatDateTime(state.accepted_at)}</p></article>)}</div></section>}
      </>}
      {handover && latePending && <section className="rounded-2xl border border-amber-300 bg-amber-100 p-4 shadow-sm lg:p-5"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" /><div><h2 className="text-lg font-bold text-slate-900">Late handover received — review and acceptance required.</h2><p className="mt-1 text-sm leading-6 text-amber-950">You started duty without a handover. You may continue operational work, but duty ending is blocked until this handover is individually accepted.</p></div></div><textarea value={comments} onChange={(event) => setComments(event.target.value)} disabled={acceptingLate || !online} placeholder="Optional individual late-handover acceptance comment" className="mt-4 min-h-24 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm outline-none focus:border-amber-600 disabled:bg-slate-50" /><div className="mt-3 flex justify-end"><button type="button" onClick={() => setConfirmLate(true)} disabled={acceptingLate || !online} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-800 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{acceptingLate ? 'Accepting…' : lateFailed ? 'Retry Accept Late Handover' : 'Accept Late Handover'}</button></div></section>}
      {availabilityKnown && !candidate && !beforeScheduledStart && <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm lg:p-5"><h2 className="text-lg font-bold text-slate-900">Start Duty Without Handover</h2><p className="mt-1 text-sm leading-6 text-slate-700">No submitted handover is available for this incoming shift. You must acknowledge this before starting duty.</p><label className="mt-4 flex gap-3 rounded-xl bg-white p-3 text-sm font-medium text-slate-800"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={alreadyOnDuty || starting || !online} className="mt-0.5 h-4 w-4" /><span>I acknowledge that no handover was received.</span></label>{startedWithoutHandover && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">Started Without Handover</p>}</section>}
      {(handover && !showStarted && !alreadyOnDuty) && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:p-5"><h2 className="text-lg font-bold text-slate-900">Review Handover</h2><p className="mt-1 text-sm leading-6 text-slate-700">Add an optional individual comment, then explicitly accept the handover and start your duty in one server-confirmed action.</p><textarea value={comments} onChange={(event) => setComments(event.target.value)} disabled={starting || !online} placeholder="Optional individual acceptance comment" className="mt-4 min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" /><div className="mt-3 flex justify-end"><button type="button" onClick={() => setConfirmStart(true)} disabled={!canStartWithHandover} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{starting ? 'Starting…' : failed ? 'Retry Accept Handover and Start Duty' : 'Accept Handover and Start Duty'}</button></div></section>}
      {availabilityKnown && !candidate && !beforeScheduledStart && !alreadyOnDuty && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:p-5"><div className="flex justify-end"><button type="button" onClick={() => setConfirmStart(true)} disabled={!canStartWithoutHandover} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{starting ? 'Starting…' : failed ? 'Retry Start Duty Without Handover' : 'Start Duty Without Handover'}</button></div></section>}
      {(showStarted || startedWithoutHandover || alreadyOnDuty) && !latePending && <section className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 shadow-sm">{myIndividualState?.state === 'LATE_HANDOVER_ACCEPTED' ? 'Late handover accepted. Your individual duty-end restriction has been cleared.' : showStarted ? 'Your handover acceptance and duty start are server-confirmed.' : startedWithoutHandover ? 'Started Without Handover' : 'Your duty is already active. Review status is shown from the latest server data.'}</section>}
    </div></PageBody>
    {confirmStart && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">{handover ? 'Accept Handover and Start Duty?' : 'Start Duty Without Handover?'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{handover ? 'This records your individual acceptance and starts your duty atomically. If you are the first incoming operator, the team handover also becomes accepted.' : 'This records your acknowledgement that no handover was received and starts your duty atomically.'}</p><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setConfirmStart(false)} disabled={starting} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={() => void reviewAndStart()} disabled={starting} className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60">{starting ? 'Starting…' : handover ? 'Accept Handover and Start Duty' : 'Start Duty Without Handover'}</button></div></div></div>}
    {confirmLate && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">Accept late handover?</h2><p className="mt-2 text-sm leading-6 text-slate-600">This records only your individual acceptance. Other on-duty operators must accept the same handover separately.</p><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setConfirmLate(false)} disabled={acceptingLate} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={() => void acceptLate()} disabled={acceptingLate} className="min-h-10 rounded-xl bg-amber-800 px-4 text-sm font-bold text-white disabled:opacity-60">{acceptingLate ? 'Accepting…' : 'Accept'}</button></div></div></div>}
  </Screen>;
}

function OutgoingEqualOperatorHandoverPage({ onBack }: { onBack: () => void }) {
  const { online } = useApp();
  const shiftScope = useShiftStationScope();
  const auth = useAuth();
  const shiftDuty = useShiftDuty(shiftScope.selectedStationId || null);
  const currentShift = shiftDuty.currentShift;
  const incomingShift = shiftDuty.nextShift;
  const dutySession = shiftDuty.myDutySession;
  const currentShiftId = currentShift?.id ?? null;
  const incomingShiftId = incomingShift?.id ?? null;
  const currentStationId = currentShift?.station_id ?? null;
  const currentShiftStart = currentShift?.scheduled_start ?? null;
  const currentShiftEnd = currentShift?.scheduled_end ?? null;
  const eligible = Boolean(currentShift && incomingShift && dutySession?.status === 'ON_DUTY');
  const requestRef = useRef(0);
  const handoverRef = useRef<ShiftHandover | null>(null);
  const endIdempotencyKeyRef = useRef<string | null>(null);
  const [handover, setHandover] = useState<ShiftHandover | null>(null);
  const [entries, setEntries] = useState<EqualOperatorHandoverEntry[]>([]);
  const [summary, setSummary] = useState<SummaryState>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [entryBusy, setEntryBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmEnding, setConfirmEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionFailed, setSubmissionFailed] = useState(false);
  const [dutyEnded, setDutyEnded] = useState(false);
  const [amendmentAdded, setAmendmentAdded] = useState(false);
  const [entryKind, setEntryKind] = useState<'COMMENT' | 'SOURCE_REFERENCE'>('COMMENT');
  const [entryBody, setEntryBody] = useState('');
  const [sourceKeyValue, setSourceKeyValue] = useState('');
  const [editingEntry, setEditingEntry] = useState<EqualOperatorHandoverEntry | null>(null);
  const [amendment, setAmendment] = useState('');
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [endingWithoutNext, setEndingWithoutNext] = useState(false);
  const [confirmEndWithoutNext, setConfirmEndWithoutNext] = useState(false);
  const [endWithoutNextNote, setEndWithoutNextNote] = useState('');
  const [endedWithoutNext, setEndedWithoutNext] = useState(false);
  const [updatedByAnotherOperator, setUpdatedByAnotherOperator] = useState(false);
  const endWithoutNextKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async (create = false, background = false) => {
    if (!currentShiftId || !incomingShiftId) return;
    const request = ++requestRef.current;
    if (!background) setLoading(true);
    try {
      const current = handoverRef.current ?? (create ? await api.getOrCreateEqualOperatorHandover(currentShiftId, incomingShiftId) : null);
      if (!current) return;
      const detail = await api.getEqualOperatorHandover(current.id);
      if (request !== requestRef.current) return;
      handoverRef.current = detail.handover;
      setHandover(detail.handover);
      setEntries(detail.entries);
    } catch (cause) {
      if (request === requestRef.current) setError(message(cause, 'Could not load the shared handover. Confirm your active duty and retry.'));
    } finally {
      if (request === requestRef.current && !background) setLoading(false);
    }
  }, [currentShiftId, incomingShiftId]);

  useEffect(() => {
    requestRef.current += 1;
    endIdempotencyKeyRef.current = null;
    handoverRef.current = null;
    setHandover(null); setEntries([]); setError(null); setSubmissionFailed(false); setDutyEnded(false); setAmendmentAdded(false); setUpdatedByAnotherOperator(false);
  }, [currentShiftId, incomingShiftId]);

  useEffect(() => {
    if (!eligible || !online || dutyEnded) return;
    void refresh(true);
  }, [dutyEnded, eligible, online, refresh]);

  useRealtimeRefresh({
    channelName: `outgoing-handover-${auth.user?.id ?? 'anonymous'}-${currentShiftId ?? 'none'}-${incomingShiftId ?? 'none'}`,
    tables: HANDOVER_REALTIME_TABLES,
    onRefresh: () => {
      if (!handoverRef.current) return;
      setUpdatedByAnotherOperator(true);
      void refresh(false, true);
    },
  });

  const loadSummary = useCallback(async () => {
    if (!currentStationId || !currentShiftStart || !currentShiftEnd) { setSummary(emptySummary); return; }
    const end = new Date(Math.min(new Date(currentShiftEnd).getTime(), Date.now())).toISOString();
    if (new Date(end) <= new Date(currentShiftStart)) { setSummary(emptySummary); return; }
    setSummary((value) => ({ ...value, loading: true, error: null }));
    try {
      const [logbook, periodInterruptions, openInterruptions, periodAlerts, currentAlerts] = await Promise.all([
        api.getLogBookForPeriod(currentStationId, currentShiftStart, end),
        api.getInterruptionsForPeriod(currentStationId, currentShiftStart, end),
        api.getOpenInterruptionsForStation(currentStationId),
        api.getParameterAlerts(currentStationId, currentShiftStart, end),
        api.getCurrentParameterAlerts(currentStationId),
      ]);
      const interruptions = [...periodInterruptions, ...openInterruptions.filter((item) => !periodInterruptions.some((existing) => existing.id === item.id))].map((item) => ({
        key: sourceKey('INTERRUPTION', item.id), sourceType: 'INTERRUPTION' as const, sourceId: item.id,
        label: item.current_status === 'OPEN' ? 'Open interruption' : 'Restored interruption',
        detail: `${item.cause ?? 'Operational interruption'}${item.remarks ? ` — ${item.remarks}` : ''}`,
        occurredAt: item.interruption_start, priority: item.current_status === 'OPEN' ? 'HIGH' as const : 'MEDIUM' as const, unresolved: item.current_status === 'OPEN',
      }));
      const alerts = [...periodAlerts, ...currentAlerts.filter((item) => !periodAlerts.some((existing) => existing.id === item.id))].map((item) => ({
        key: sourceKey('PARAMETER_ALERT', item.id), sourceType: 'PARAMETER_ALERT' as const, sourceId: item.id,
        label: `${item.parameter_code} ${item.breach_type.replace('_', ' ')}`,
        detail: `${item.feeder_name ?? 'Station equipment'} · value ${item.actual_value}`,
        occurredAt: item.triggered_at, priority: 'HIGH' as const, unresolved: item.is_current,
      }));
      const logbookItems = logbook.map((item) => ({
        key: sourceKey('LOGBOOK_ENTRY', item.id), sourceType: 'LOGBOOK_ENTRY' as const, sourceId: item.id,
        label: item.feeder_id ? 'Feeder logbook entry' : 'Station logbook entry', detail: item.remarks?.trim() || 'Operational reading recorded',
        occurredAt: item.actual_event_time, priority: 'LOW' as const, unresolved: false,
      }));
      setSummary({ logbookCount: logbook.length, interruptions, alerts, logbook: logbookItems, loading: false, error: null });
    } catch (cause) {
      setSummary((value) => ({ ...value, loading: false, error: message(cause, 'Could not load available operational source entries.') }));
    }
  }, [currentShiftEnd, currentShiftStart, currentStationId]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  const sourceItems = useMemo(() => [...summary.interruptions, ...summary.alerts, ...summary.logbook], [summary]);
  const selectedSource = useMemo(() => sourceItems.find((item) => item.key === sourceKeyValue) ?? null, [sourceItems, sourceKeyValue]);
  const isDraft = handover?.status === 'DRAFT';
  const ownDraftEntry = (entry: EqualOperatorHandoverEntry) => isDraft && entry.phase === 'DRAFT' && entry.author_user_id === auth.user?.id;

  const clearComposer = () => { setEntryKind('COMMENT'); setEntryBody(''); setSourceKeyValue(''); setEditingEntry(null); };
  const saveEntry = async () => {
    if (!handover || !isDraft || entryBusy || !online) return;
    if (entryKind === 'COMMENT' && !entryBody.trim()) { setError('Enter a comment before adding it to the shared draft.'); return; }
    if (entryKind === 'SOURCE_REFERENCE' && !selectedSource) { setError('Choose an operational source entry before adding it.'); return; }
    setEntryBusy(true); setError(null);
    try {
      // Version-2 keeps an immutable per-entry identity. Replacing an edited
      // draft entry is therefore a delete followed by a new attributed entry.
      if (editingEntry) await api.deleteEqualOperatorHandoverEntry(handover.id, editingEntry.id, crypto.randomUUID());
      await api.saveEqualOperatorHandoverEntry({
        handoverId: handover.id, clientEntryId: crypto.randomUUID(), entryKind,
        body: entryKind === 'COMMENT' ? entryBody.trim() : null,
        sourceType: entryKind === 'SOURCE_REFERENCE' ? selectedSource!.sourceType : null,
        sourceId: entryKind === 'SOURCE_REFERENCE' ? selectedSource!.sourceId : null,
        priority: entryKind === 'SOURCE_REFERENCE' ? selectedSource!.priority : null,
        expectedHandoverVersion: handover.row_version,
      });
      clearComposer();
      await refresh();
    } catch (cause) {
      setError(message(cause, editingEntry ? 'The draft entry could not be replaced. Refresh the shared draft and retry.' : 'The draft entry could not be added. Refresh the shared draft and retry.'));
      await refresh();
    } finally { setEntryBusy(false); }
  };

  const removeEntry = async (entry: EqualOperatorHandoverEntry) => {
    if (!handover || !ownDraftEntry(entry) || entryBusy || !online) return;
    setEntryBusy(true); setError(null);
    try {
      await api.deleteEqualOperatorHandoverEntry(handover.id, entry.id, crypto.randomUUID());
      if (editingEntry?.id === entry.id) clearComposer();
      await refresh();
    } catch (cause) {
      setError(message(cause, 'The draft entry could not be removed. Refresh the shared draft and retry.'));
      await refresh();
    } finally { setEntryBusy(false); }
  };

  const beginEdit = (entry: EqualOperatorHandoverEntry) => {
    if (!ownDraftEntry(entry)) return;
    setEditingEntry(entry);
    setEntryKind(entry.entry_kind);
    setEntryBody(entry.body ?? '');
    setSourceKeyValue(entry.source_type && entry.source_id ? sourceKey(entry.source_type, entry.source_id) : '');
    setError(null);
  };

  const addAmendment = async () => {
    if (!handover || handover.status === 'DRAFT' || !amendment.trim() || entryBusy || !online) return;
    setEntryBusy(true); setError(null);
    try {
      await api.addShiftHandoverAmendment({ handoverId: handover.id, body: amendment.trim(), clientEntryId: crypto.randomUUID() });
      setAmendment(''); setAmendmentAdded(true);
      await refresh();
    } catch (cause) {
      setError(message(cause, 'The amendment could not be added. The submitted handover remains unchanged.'));
      await refresh();
    } finally { setEntryBusy(false); }
  };

  const endDutyAndSubmit = async () => {
    if (!dutySession || !incomingShift || !handover || ending || !online) return;
    const idempotencyKey = endIdempotencyKeyRef.current ?? crypto.randomUUID();
    endIdempotencyKeyRef.current = idempotencyKey;
    setConfirmEnding(false); setEnding(true); setSubmissionFailed(false); setError(null);
    try {
      const result = await api.endDutyAndHandoverShift({ dutySessionId: dutySession.id, incomingShiftId: incomingShift.id, idempotencyKey, finalComment: amendment.trim() || null });
      handoverRef.current = result.handover ?? handover;
      setHandover(result.handover ?? handover);
      setDutyEnded(result.duty_session.status === 'ENDED');
      setCompletionNotice(result.official_submission
        ? 'Final handover released to the incoming shift.'
        : 'Provisional handover recorded. Other outgoing operators remain on duty.');
      if (result.duty_session.status === 'ENDED') notifyShiftDutyStateChanged();
      await refresh();
      await shiftDuty.refresh();
      if (result.duty_session.status === 'ENDED') onBack();
    } catch (cause) {
      setSubmissionFailed(true);
      setError(message(cause, 'The combined handover and end-duty request was not confirmed. Your duty is still shown as active until a successful server response is received.'));
      await refresh();
    } finally { setEnding(false); }
  };

  const endDutyWithoutNextShift = async () => {
    if (!dutySession || endingWithoutNext || !online) return;
    const idempotencyKey = endWithoutNextKeyRef.current ?? crypto.randomUUID();
    endWithoutNextKeyRef.current = idempotencyKey;
    setConfirmEndWithoutNext(false);
    setEndingWithoutNext(true);
    setError(null);
    try {
      const result = await api.endDutyWithoutNextShift({
        dutySessionId: dutySession.id,
        idempotencyKey,
        note: endWithoutNextNote.trim() || null,
      });
      if (result.duty_session.status !== 'ENDED') {
        throw new Error('Duty end was not confirmed by the server.');
      }
      setEndedWithoutNext(true);
      notifyShiftDutyStateChanged();
      await shiftDuty.refresh();
      onBack();
    } catch (cause) {
      setError(message(cause, 'Duty end without handover was not confirmed. Your duty remains active until a successful server response is received.'));
      await shiftDuty.refresh();
    } finally {
      setEndingWithoutNext(false);
    }
  };

  const canEnd = Boolean(eligible && handover && online && !ending && !entryBusy && !dutyEnded);
  const canEndWithoutNext = Boolean(
    currentShift
    && !incomingShift
    && dutySession?.status === 'ON_DUTY'
    && online
    && !endingWithoutNext
  );
  const isProvisional = handover?.status === 'PROVISIONAL';
  const teamSubmitted = Boolean(handover && handover.status !== 'DRAFT');
  const lastActiveOutgoing = shiftDuty.operatorsOnDuty.filter((session) => session.status === 'ON_DUTY').length <= 1;
  const draftEntries = entries.filter((entry) => entry.phase === 'DRAFT');
  const originalEntries = entries.filter((entry) => entry.phase === 'INITIAL');
  const amendmentEntries = entries.filter((entry) => entry.phase === 'AMENDMENT');
  const remainingTime = currentShift ? remainingShiftTime(currentShift.scheduled_end) : null;

  return <Screen showStatusBar={false}>
    <AppHeader title="Shift Handover" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="Shift Handover" subtitle="Shared outgoing handover and individual end-duty confirmation" />
    <PageBody className="bg-[#F4F7FB] pb-28 lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8"><div className="mx-auto max-w-6xl space-y-4 lg:max-w-none">
      {!online && <Notice tone="amber"><span className="inline-flex items-center gap-2"><WifiOff className="h-4 w-4" />A connection is required for shared draft changes and handover duty completion. These actions are never queued for offline replay.</span></Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      {updatedByAnotherOperator && <Notice tone="blue"><span className="inline-flex items-center gap-2">Handover updated by another operator.<button type="button" onClick={() => setUpdatedByAnotherOperator(false)} className="font-bold underline">Dismiss</button></span></Notice>}
      {!currentShift && !shiftDuty.loading && <Empty title="No current shift" detail="A handover can be prepared only from an active, server-confirmed current shift." />}
      {endedWithoutNext && <Notice tone="amber">Duty ended without handover. No next shift was scheduled, and the server recorded this exception.</Notice>}
      {currentShift && !incomingShift && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:p-5"><p className="text-xs font-bold uppercase tracking-wide text-amber-800">No next shift scheduled</p><h2 className="mt-1 text-lg font-bold text-slate-900">End Duty Without Handover</h2><p className="mt-2 text-sm leading-6 text-slate-700">No incoming shift is scheduled for this station, so a handover cannot be created. You may end only your individual duty. The system records the reason as <b>No next shift scheduled</b>.</p><label className="mt-4 block text-sm font-semibold text-slate-800">Optional operational note<textarea value={endWithoutNextNote} onChange={(event) => setEndWithoutNextNote(event.target.value)} disabled={endingWithoutNext || endedWithoutNext || !online} maxLength={2000} placeholder="Optional note for the duty-end audit record" className="mt-2 min-h-24 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm font-normal outline-none focus:border-amber-600 disabled:bg-slate-50" /></label><div className="mt-4 flex justify-end"><button type="button" onClick={() => setConfirmEndWithoutNext(true)} disabled={!canEndWithoutNext || endedWithoutNext} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{endingWithoutNext ? 'Ending duty…' : 'End Duty Without Handover'}</button></div></section>}
      {currentShift && incomingShift && <Transition station={shiftDuty.station?.name ?? 'Current station'} outgoing={currentShift} incoming={incomingShift} handover={handover} />}
      {currentShift && incomingShift && !eligible && !dutyEnded && <Notice tone="amber">Start Duty on the outgoing shift before preparing its handover. Server authorization remains required.</Notice>}
      {loading && !handover && <section className="grid min-h-40 place-items-center rounded-2xl bg-white shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-blue-600" />Opening shared handover…</div></section>}
      {handover && <>
          <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Team handover</p><h2 className="mt-1 text-lg font-bold text-slate-900">{isDraft ? 'Draft in progress' : isProvisional ? 'Provisional handover recorded' : 'Final handover released'}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{isDraft ? 'All outgoing operators can add attributed comments or operational source entries.' : isProvisional ? 'Initial content is frozen. Only outgoing operators may view this provisional handover until the last active outgoing operator ends duty.' : `Final handover released ${formatDateTime(handover.final_released_at ?? handover.submitted_at)} and retained as read-only.`}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${isDraft ? 'bg-blue-50 text-blue-700' : isProvisional ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{isDraft ? 'DRAFT' : statusLabel(handover.status).toUpperCase()}</span></div>
          {dutyEnded && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">{completionNotice ?? 'Current operator duty ended.'}</p>}
          {submissionFailed && <p className="mt-4 rounded-xl bg-red-50 px-3 py-3 text-sm font-semibold text-red-700">Submission failed. Retry is available; no local end-duty state has been assumed.</p>}
          {amendmentAdded && <p className="mt-4 rounded-xl bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-800">Amendment added to the handover audit trail.</p>}
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Shared handover entries</h2><p className="mt-1 text-xs text-slate-500">Every entry is attributed to the operator who added it. Source records remain authoritative.</p></div><button type="button" onClick={() => void refresh()} disabled={loading || ending} className="rounded-xl border border-slate-200 p-2 text-blue-700 disabled:opacity-60" aria-label="Refresh shared handover"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
          {isDraft && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setEntryKind('COMMENT')} disabled={entryBusy} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${entryKind === 'COMMENT' ? 'bg-blue-700 text-white' : 'bg-white text-blue-700'}`}>Comment</button><button type="button" onClick={() => setEntryKind('SOURCE_REFERENCE')} disabled={entryBusy} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${entryKind === 'SOURCE_REFERENCE' ? 'bg-blue-700 text-white' : 'bg-white text-blue-700'}`}>Source entry</button></div>
            {entryKind === 'COMMENT' ? <textarea value={entryBody} onChange={(event) => setEntryBody(event.target.value)} disabled={entryBusy || !online} placeholder="Station condition, coordination note, expected restoration, or operating caution" className="mt-3 min-h-28 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-blue-500 disabled:bg-slate-50" /> : <select value={sourceKeyValue} onChange={(event) => setSourceKeyValue(event.target.value)} disabled={entryBusy || !online || summary.loading} className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:bg-slate-50"><option value="">Select an operational source entry</option>{sourceItems.slice(0, 100).map((item) => <option key={item.key} value={item.key}>{item.label} — {item.detail}</option>)}</select>}
            <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={clearComposer} disabled={entryBusy || !editingEntry} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-600 disabled:opacity-50">Cancel edit</button><button type="button" onClick={() => void saveEntry()} disabled={entryBusy || !online} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-60"><Send className="h-4 w-4" />{entryBusy ? 'Saving…' : editingEntry ? 'Replace my entry' : 'Add to shared draft'}</button></div>
          </div>}
          <HandoverEntryList entries={isDraft ? draftEntries : [...originalEntries, ...amendmentEntries]} currentUserId={auth.user?.id ?? null} editable={isDraft && !dutyEnded} onEdit={beginEdit} onRemove={removeEntry} />
          {!isDraft && <p className="mt-4 rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-700">The original submitted handover is frozen. Later comments are preserved as amendments.</p>}
        </section>
        {teamSubmitted && !dutyEnded && <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-900">Optional addendum</h2><p className="text-xs text-slate-500">Add a separately attributed note without changing the frozen initial snapshot.</p></div></div><textarea value={amendment} onChange={(event) => setAmendment(event.target.value)} disabled={entryBusy || !online} placeholder="Optional addendum or individual final remark" className="mt-4 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" /><div className="mt-3 flex justify-end"><button type="button" onClick={() => void addAmendment()} disabled={!amendment.trim() || entryBusy || !online} className="min-h-10 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700 disabled:opacity-60">{entryBusy ? 'Saving…' : 'Add addendum'}</button></div></section>}
        {!dutyEnded && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Individual duty completion</p><h2 className="mt-1 text-lg font-bold text-slate-900">{isDraft ? 'Handover Shift and End Duty' : amendment.trim() ? 'Submit Addendum and End Duty' : 'Confirm Handover and End Duty'}</h2><p className="mt-1 text-sm leading-6 text-slate-700">{isDraft ? 'This freezes a provisional handover and ends only your duty.' : isProvisional && lastActiveOutgoing ? 'You are the last active outgoing operator. This action will release the final handover to the incoming shift.' : 'This ends only your duty. The frozen handover remains available only to the outgoing team until final release.'}</p></div><button type="button" onClick={() => setConfirmEnding(true)} disabled={!canEnd} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{ending ? 'Submitting…' : amendment.trim() ? 'Submit Addendum and End Duty' : isDraft ? 'Handover Shift and End Duty' : 'Confirm Handover and End Duty'}</button></div></section>}
      </>}
    </div></PageBody>
    {confirmEnding && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">{isDraft ? 'Handover Shift and End Duty?' : 'Confirm Handover and End Duty?'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{isDraft ? 'This will submit the common handover exactly once and end your individual duty. The submitted original will be frozen; later corrections are recorded as amendments.' : 'This will end only your duty and link it to the existing submitted handover. It does not create another handover.'}</p>{remainingTime && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950"><b>Scheduled duty time remains: {remainingTime}.</b><br />Your shift is scheduled to end later. Do you want to continue and end duty now?</div>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={ending} onClick={() => setConfirmEnding(false)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" disabled={ending} onClick={() => void endDutyAndSubmit()} className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60">{ending ? 'Submitting…' : remainingTime ? 'Yes, End Duty Now' : isDraft ? 'Handover Shift and End Duty' : 'Confirm Handover and End Duty'}</button></div></div></div>}
    {confirmEndWithoutNext && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-5"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-bold text-slate-900">End Duty Without Handover?</h2><p className="mt-2 text-sm leading-6 text-slate-600">No next shift is scheduled. This will end only your duty and record <b>No next shift scheduled</b> in the audit trail. No handover will be created.</p><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={endingWithoutNext} onClick={() => setConfirmEndWithoutNext(false)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700">Cancel</button><button type="button" disabled={endingWithoutNext} onClick={() => void endDutyWithoutNextShift()} className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-60">{endingWithoutNext ? 'Ending duty…' : 'End Duty Without Handover'}</button></div></div></div>}
  </Screen>;
}

function HandoverEntryList({ entries, currentUserId, editable, onEdit, onRemove }: { entries: EqualOperatorHandoverEntry[]; currentUserId: string | null; editable: boolean; onEdit: (entry: EqualOperatorHandoverEntry) => void; onRemove: (entry: EqualOperatorHandoverEntry) => void }) {
  if (!entries.length) return <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No entries have been added yet.</p>;
  return <div className="mt-4 space-y-2">{entries.map((entry) => { const own = entry.author_user_id === currentUserId; const label = entry.entry_kind === 'SOURCE_REFERENCE' ? `${entry.source_type?.replace('_', ' ') ?? 'Operational'} source entry` : entry.body || 'Comment'; return <article key={entry.id} className="rounded-xl border border-slate-100 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-800">{label}</p>{entry.entry_kind === 'SOURCE_REFERENCE' && entry.source_id && <p className="mt-1 break-all text-xs text-slate-500">Source reference: {entry.source_id}</p>}<p className="mt-1 text-xs text-slate-500">{own ? 'You' : `Operator ${entry.author_user_id.slice(0, 8)}`} · {formatDateTime(entry.created_at)}{entry.phase === 'AMENDMENT' ? ' · Amendment' : ''}</p></div>{editable && own && entry.phase === 'DRAFT' && <div className="flex gap-1"><button type="button" onClick={() => onEdit(entry)} className="rounded-lg p-2 text-blue-700" aria-label="Edit my draft entry"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => onRemove(entry)} className="rounded-lg p-2 text-red-700" aria-label="Remove my draft entry"><Trash2 className="h-4 w-4" /></button></div>}</div></article>; })}</div>;
}

function Transition({ station, outgoing, incoming, handover }: { station: string; outgoing: StationShift; incoming: StationShift; handover: ShiftHandover | null }) { return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Station transition</p><h2 className="mt-1 text-lg font-bold text-slate-900">{station}</h2></div>{handover && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{statusLabel(handover.status)}</span>}</div><div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><ShiftInfo title="Outgoing shift" shift={outgoing} /><ShiftInfo title="Incoming shift" shift={incoming} /></div></section>; }
function ShiftInfo({ title, shift }: { title: string; shift: StationShift }) { return <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 font-semibold text-slate-900">{shift.shift_name}</p><p className="text-sm text-slate-600">Logical date: {shift.shift_date}</p><p className="mt-1 text-sm text-slate-600">{formatDateTime(shift.scheduled_start)} – {formatDateTime(shift.scheduled_end)}</p></div>; }
function Summary({ summary, selected, editable, onToggle, onRefresh }: { summary: SummaryState; selected: Set<string>; editable: boolean; onToggle: (key: string) => void; onRefresh: () => void }) { const sources = [...summary.interruptions, ...summary.alerts, ...summary.logbook]; const visibleSources = sources.slice(0, 50); return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">Automatic operational summary</h2><p className="mt-1 text-xs leading-5 text-slate-500">Bounded records from the outgoing shift period; source records remain authoritative.</p></div><button type="button" onClick={onRefresh} disabled={summary.loading} className="rounded-xl border border-slate-200 p-2 text-blue-700 disabled:opacity-60" aria-label="Refresh operational summary"><RefreshCw className={`h-4 w-4 ${summary.loading ? 'animate-spin' : ''}`} /></button></div>{summary.error && <Notice tone="red">{summary.error}</Notice>}{summary.loading ? <div className="grid min-h-36 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : <><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Logbook" value={summary.logbookCount} /><Metric label="Interruptions" value={summary.interruptions.length} /><Metric label="Alerts" value={summary.alerts.length} /></div><div className="mt-4 space-y-2">{visibleSources.length ? visibleSources.map((item) => <SourceRow key={item.key} item={item} checked={selected.has(item.key)} editable={editable} onToggle={onToggle} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No operational records were found in the outgoing shift period.</p>}</div>{sources.length > visibleSources.length && <p className="mt-3 text-xs text-slate-500">Showing the most recent 50 source records.</p>}</>}</section>; }
function SourceRow({ item, checked, editable, onToggle }: { item: SummaryItem; checked: boolean; editable: boolean; onToggle: (key: string) => void }) { return <label className={`flex gap-3 rounded-xl border p-3 ${checked ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white'} ${editable ? 'cursor-pointer' : ''}`}><input type="checkbox" checked={checked} disabled={!editable} onChange={() => onToggle(item.key)} className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-800">{item.label}</span>{item.unresolved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Needs attention</span>}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">{item.detail}</span><span className="mt-1 block text-[11px] text-slate-500">{formatDateTime(item.occurredAt)}</span></span></label>; }
function Matters({ items, selected, editable, onToggle }: { items: SummaryItem[]; selected: Set<string>; editable: boolean; onToggle: (key: string) => void }) { const visibleItems = items.slice(0, 50); return <section className="rounded-2xl bg-white p-4 shadow-sm lg:p-5"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /><div><h2 className="font-bold text-slate-900">Matters requiring attention</h2><p className="text-xs text-slate-500">Including a source in the handover does not change its operational status.</p></div></div><div className="mt-4 space-y-2">{visibleItems.length ? visibleItems.map((item) => <SourceRow key={item.key} item={item} checked={selected.has(item.key)} editable={editable} onToggle={onToggle} />) : <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">No open interruptions or current parameter alerts were found.</p>}</div>{items.length > visibleItems.length && <p className="mt-3 text-xs text-slate-500">Showing the most recent 50 unresolved matters.</p>}</section>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p></div>; }
function Notice({ tone, children }: { tone: 'amber' | 'blue' | 'red'; children: React.ReactNode }) {
  const classes = tone === 'red'
    ? 'bg-red-50 text-red-700'
    : tone === 'blue'
      ? 'bg-blue-50 text-blue-800'
      : 'bg-amber-50 text-amber-800';
  return <p role={tone === 'red' ? 'alert' : 'status'} className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${classes}`}>{children}</p>;
}
function Empty({ title, detail }: { title: string; detail: string }) { return <section className="rounded-2xl bg-white p-6 text-center shadow-sm"><ShieldAlert className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-3 text-base font-bold text-slate-800">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{detail}</p></section>; }
