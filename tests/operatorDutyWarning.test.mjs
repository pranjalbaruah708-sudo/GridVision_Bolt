import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  dutyWarningAcknowledgementKey,
  millisecondsUntil,
  shouldShowScheduledDutyWarning,
} from '../src/services/operatorDutyWarning.ts';

const start = '2026-09-20T08:30:00.000Z';
const end = '2026-09-20T16:30:00.000Z';

test('scheduled warning crosses the duty start boundary without a reload', () => {
  assert.equal(shouldShowScheduledDutyWarning({ assigned: true, dutyStarted: false, scheduledStart: start, scheduledEnd: end, now: Date.parse(start) - 1 }), false);
  assert.equal(millisecondsUntil(start, Date.parse(start) - 1), 1);
  assert.equal(shouldShowScheduledDutyWarning({ assigned: true, dutyStarted: false, scheduledStart: start, scheduledEnd: end, now: Date.parse(start) }), true);
});

test('warning is limited to the assigned operator and clears when duty starts or shift ends', () => {
  assert.equal(shouldShowScheduledDutyWarning({ assigned: false, dutyStarted: false, scheduledStart: start, scheduledEnd: end, now: Date.parse(start) }), false);
  assert.equal(shouldShowScheduledDutyWarning({ assigned: true, dutyStarted: true, scheduledStart: start, scheduledEnd: end, now: Date.parse(start) }), false);
  assert.equal(shouldShowScheduledDutyWarning({ assigned: true, dutyStarted: false, scheduledStart: start, scheduledEnd: end, now: Date.parse(end) }), false);
});

test('modal acknowledgement is isolated by user and shift', () => {
  assert.notEqual(dutyWarningAcknowledgementKey('operator-a', 'shift-1'), dutyWarningAcknowledgementKey('operator-b', 'shift-1'));
  assert.notEqual(dutyWarningAcknowledgementKey('operator-a', 'shift-1'), dutyWarningAcknowledgementKey('operator-a', 'shift-2'));
});

test('startup prompt contains no legacy start-duty or reason mutation controls', async () => {
  const source = await readFile(new URL('../src/components/OperatorDutyStartupPrompt.tsx', import.meta.url), 'utf8');
  assert.match(source, /Scheduled duty has started/);
  assert.match(source, /Duty not started — go to Current Shift/);
  assert.doesNotMatch(source, /Continue Without Starting Duty/);
  assert.doesNotMatch(source, /recordShiftDutyWarningAcknowledgement/);
  assert.doesNotMatch(source, /reasonCode|reasonText|startShiftDuty/);
});
