import { useCallback, useEffect, useState } from 'react';

import { useApp } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { useShiftDuty } from '@/hooks/useShiftDuty';
import { api, type EqualOperatorHandoverDetail, type ShiftDutyHandoverState } from '@/services/api';

function previousCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function useLateShiftHandover(stationId: string | null) {
  const { online } = useApp();
  const { user } = useAuth();
  const duty = useShiftDuty(stationId);
  const [detail, setDetail] = useState<EqualOperatorHandoverDetail | null>(null);
  const [individualState, setIndividualState] = useState<ShiftDutyHandoverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const shift = duty.currentShift;
    const session = duty.myDutySession;
    if (!online || !user?.id || !shift || !session || session.status !== 'ON_DUTY') {
      if (!session || session.status !== 'ON_DUTY') { setDetail(null); setIndividualState(null); setError(null); }
      setLoading(false);
      return;
    }
    setLoading(true); setError(null);
    try {
      const rows = await api.getStationShiftCompliance(shift.station_id, previousCalendarDate(shift.shift_date), shift.shift_date, 100);
      const handover = rows.map((row) => row.handover).find((item) => item?.incoming_shift_id === shift.id) ?? null;
      if (!handover) { setDetail(null); setIndividualState(null); return; }
      const nextDetail = await api.getEqualOperatorHandover(handover.id);
      if (nextDetail.handover.workflow_version !== 2) { setDetail(null); setIndividualState(null); return; }
      setDetail(nextDetail);
      setIndividualState(nextDetail.individual_states.find((state) => state.side === 'INCOMING' && state.duty_session_id === session.id && state.user_id === user.id) ?? null);
    } catch {
      setError('Late handover status could not be refreshed. Reconnect and try again.');
    } finally { setLoading(false); }
  }, [duty.currentShift, duty.myDutySession, online, user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  return {
    detail,
    individualState,
    pending: individualState?.state === 'LATE_HANDOVER_REVIEW_REQUIRED',
    accepted: individualState?.state === 'LATE_HANDOVER_ACCEPTED',
    loading,
    error,
    refresh,
  };
}
