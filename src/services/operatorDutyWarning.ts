export const SHIFT_DUTY_STATE_CHANGED_EVENT = 'gridvision:shift-duty-state-changed';

const ACKNOWLEDGEMENT_PREFIX = 'gridvision:duty-warning:v2:';

export function dutyWarningAcknowledgementKey(userId: string, shiftId: string): string {
  return `${ACKNOWLEDGEMENT_PREFIX}${userId}:${shiftId}`;
}

export function clearDutyWarningAcknowledgements(userId: string): void {
  if (typeof window === 'undefined') return;
  const prefix = `${ACKNOWLEDGEMENT_PREFIX}${userId}:`;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
}

export function notifyShiftDutyStateChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SHIFT_DUTY_STATE_CHANGED_EVENT));
}

export function millisecondsUntil(timestamp: string, now = Date.now()): number {
  const target = new Date(timestamp).getTime();
  return Number.isFinite(target) ? Math.max(0, target - now) : 0;
}

export function shouldShowScheduledDutyWarning(input: {
  assigned: boolean;
  dutyStarted: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const start = new Date(input.scheduledStart).getTime();
  const end = new Date(input.scheduledEnd).getTime();
  return input.assigned && !input.dutyStarted && Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}
