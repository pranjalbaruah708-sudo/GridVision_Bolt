import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HttpRequestError,
  allowedOrigins,
  corsHeadersFor,
  isIsoTimestamp,
  isUuid,
  readJsonObject,
  rejectDisallowedOrigin,
} from '../supabase/functions/_shared/httpSecurity.ts';

test('CORS uses exact configured origins and rejects lookalikes', () => {
  const origins = allowedOrigins('https://gridvision.example, https://staging.gridvision.example/path');
  const allowed = new Request('https://function.example', {
    method: 'POST', headers: { Origin: 'https://gridvision.example' },
  });
  const lookalike = new Request('https://function.example', {
    method: 'POST', headers: { Origin: 'https://gridvision.example.attacker.test' },
  });

  assert.equal(corsHeadersFor(allowed, origins)['Access-Control-Allow-Origin'], 'https://gridvision.example');
  assert.equal(corsHeadersFor(lookalike, origins)['Access-Control-Allow-Origin'], undefined);
  assert.equal(rejectDisallowedOrigin(allowed, origins, corsHeadersFor(allowed, origins)), null);
  assert.equal(rejectDisallowedOrigin(lookalike, origins, corsHeadersFor(lookalike, origins))?.status, 403);
});

test('CORS retains the Capacitor local origin without enabling arbitrary origins', () => {
  const origins = allowedOrigins(undefined);
  assert.equal(origins.has('http://localhost'), true);
  assert.equal(origins.has('capacitor://localhost'), true);
  assert.equal(origins.has('https://untrusted.example'), false);
});

test('bounded JSON reader accepts an object and rejects unsupported media types', async () => {
  const request = new Request('https://function.example', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"ok":true}',
  });
  assert.deepEqual(await readJsonObject(request, 64), { ok: true });

  const textRequest = new Request('https://function.example', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  });
  await assert.rejects(() => readJsonObject(textRequest, 64), (error) => {
    assert.equal(error instanceof HttpRequestError, true);
    assert.equal(error.status, 415);
    return true;
  });
});

test('bounded JSON reader permits a truly empty scheduler request when configured', async () => {
  const emptyRequest = new Request('https://function.example', { method: 'POST' });
  assert.deepEqual(await readJsonObject(emptyRequest, 64, { allowEmpty: true }), {});
});

test('bounded JSON reader rejects oversized, malformed, and array payloads', async () => {
  const oversized = new Request('https://function.example', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(128) }),
  });
  await assert.rejects(() => readJsonObject(oversized, 32), (error) => error instanceof HttpRequestError && error.status === 413);

  for (const body of ['{', '[]']) {
    const invalid = new Request('https://function.example', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    await assert.rejects(() => readJsonObject(invalid, 32), (error) => error instanceof HttpRequestError && error.status === 400);
  }
});

test('identifier and timestamp validators reject ambiguous values', () => {
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isUuid('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isIsoTimestamp('2026-09-29T12:00:00+05:30'), true);
  assert.equal(isIsoTimestamp('2026-09-29T12:00:00'), false);
});
