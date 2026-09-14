import type { ShiftComplianceRow, ShiftHandoverStatus } from '@/services/api';

export type ShiftComplianceCode =
  | 'NO_DUTY_STARTED'
  | 'PLANNED_OPERATOR_MISSING'
  | 'UNPLANNED_PARTICIPANT'
  | 'HANDOVER_NOT_SUBMITTED'
  | 'HANDOVER_AWAITING_ACCEPTANCE'
  | 'DUTY_OPEN_AFTER_SHIFT'
  | 'COMPLIANT';

export type ShiftComplianceFinding = {
  code: ShiftComplianceCode;
  label: string;
  detail: string;
  tone: 'green' | 'amber' | 'red' | 'slate';
};

export function deriveShiftCompliance(shift: ShiftComplianceRow, now = Date.now()): ShiftComplianceFinding[] {
  const ended = new Date(shift.scheduled_end).getTime() <= now;
  const started = new Date(shift.scheduled_start).getTime() <= now;
  const rostered = new Set(shift.roster.map((member) => member.user_id));
  const participants = new Set(shift.duty_sessions.map((session) => session.user_id));
  const findings: ShiftComplianceFinding[] = [];

  if (started && shift.duty_sessions.length === 0) {
    findings.push({ code: 'NO_DUTY_STARTED', label: 'No duty started', detail: 'No duty participant is recorded for this scheduled shift.', tone: 'amber' });
  }
  const missing = shift.roster.filter((member) => !participants.has(member.user_id));
  if (ended && missing.length) {
    findings.push({ code: 'PLANNED_OPERATOR_MISSING', label: 'Planned operator did not start duty', detail: `${missing.length} planned roster member${missing.length === 1 ? '' : 's'} has no duty record.`, tone: 'amber' });
  }
  const unplanned = shift.duty_sessions.filter((session) => !rostered.has(session.user_id));
  if (unplanned.length) {
    findings.push({ code: 'UNPLANNED_PARTICIPANT', label: 'Unplanned participant', detail: `${unplanned.length} duty participant${unplanned.length === 1 ? '' : 's'} is not on the planned roster.`, tone: 'amber' });
  }
  if (ended && shift.duty_sessions.some((session) => session.status === 'ON_DUTY')) {
    findings.push({ code: 'DUTY_OPEN_AFTER_SHIFT', label: 'Duty remains open after shift', detail: 'At least one duty session remains open after the scheduled shift end.', tone: 'red' });
  }
  if (ended && shift.handover && shift.handover.status === 'DRAFT') {
    findings.push({ code: 'HANDOVER_NOT_SUBMITTED', label: 'Handover not submitted', detail: 'The outgoing handover remains a draft after the scheduled shift ended.', tone: 'amber' });
  }
  if (shift.handover?.status === 'SUBMITTED') {
    findings.push({ code: 'HANDOVER_AWAITING_ACCEPTANCE', label: 'Handover awaiting acceptance', detail: 'The outgoing handover has been submitted and awaits incoming acknowledgement.', tone: 'amber' });
  }
  return findings.length ? findings : [{ code: 'COMPLIANT', label: 'No known exception', detail: 'No operational exception was derived from the available server data.', tone: 'green' }];
}

export function handoverLabel(status: ShiftHandoverStatus | undefined): string {
  if (!status) return 'Not started';
  if (status === 'SUBMITTED') return 'Awaiting acceptance';
  return status[0] + status.slice(1).toLowerCase();
}
