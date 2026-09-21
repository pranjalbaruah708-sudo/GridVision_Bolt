import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE,
  OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE,
  OPERATIONAL_WRITE_DUTY_ENDED_MESSAGE,
  OperationalWriteAuthorizationError,
  mapOperationalWriteError,
  offlineOperationalAuthorizationFailure,
  reportOperationalWriteFailure,
} from '../src/services/operationalWriteErrors.ts';

test('online 42501 uses the duty message and retains sanitized diagnostics internally', () => {
  const raw = {
    code: '42501',
    status: 403,
    message: 'new row violates row-level security policy "Operators can insert assigned interruptions"',
  };
  const mapped = mapOperationalWriteError(raw);

  assert.ok(mapped instanceof OperationalWriteAuthorizationError);
  assert.equal(mapped.message, OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE);
  assert.equal(mapped.code, '42501');
  assert.equal(mapped.diagnostic.postgresCode, '42501');
  assert.equal(mapped.diagnostic.httpStatus, 403);
  assert.match(mapped.diagnostic.technicalMessage ?? '', /row-level security policy/);
  assert.doesNotMatch(mapped.message, /policy|interruptions|42501/i);
});

test('a known ended-duty 42501 uses the ended-duty message', () => {
  const mapped = mapOperationalWriteError({ code: '42501', message: 'The operator duty has ended for this shift.' });
  assert.ok(mapped instanceof OperationalWriteAuthorizationError);
  assert.equal(mapped.message, OPERATIONAL_WRITE_DUTY_ENDED_MESSAGE);
});

test('offline 42501 remains NEEDS_ATTENTION with the retained-entry message', () => {
  const failure = offlineOperationalAuthorizationFailure({
    code: '42501',
    message: 'Station write denied. Bearer secret-token-value',
  }, 403);

  assert.equal(failure.failureCategory, 'AUTHORIZATION');
  assert.equal(failure.syncState, 'NEEDS_ATTENTION');
  assert.equal(failure.userMessage, OFFLINE_OPERATIONAL_WRITE_AUTHORIZATION_MESSAGE);
  assert.equal(failure.diagnostic.postgresCode, '42501');
  assert.equal(failure.diagnostic.httpStatus, 403);
  assert.equal(failure.diagnostic.technicalMessage, 'Station write denied. Bearer [redacted]');
  assert.doesNotMatch(failure.userMessage, /policy|function|42501/i);
});

test('non-42501 errors retain their existing error object and handling', () => {
  const validation = { code: '23514', message: 'Validation failed' };
  assert.equal(mapOperationalWriteError(validation), validation);
});

test('expected authorization denials are diagnostics rather than console errors', () => {
  const originalInfo = console.info;
  const originalError = console.error;
  const calls = [];
  console.info = (...args) => calls.push(['info', ...args]);
  console.error = (...args) => calls.push(['error', ...args]);
  try {
    reportOperationalWriteFailure('Restore rejected.', { code: '42501', message: 'Station write access is not authorized' });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'info');
  assert.equal(calls[0][1], 'Restore rejected.');
});
