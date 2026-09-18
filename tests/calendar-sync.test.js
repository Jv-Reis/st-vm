import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarBody, writeGoogleEvent } from '../lib/calendar-sync.js';

test('Calendar preserva timezone, limpa local e usa 4h quando término é inválido', () => {
  const body = calendarBody({ id: 'abc', data: { event_date: '2026-09-18T10:00:00-03:00', event_end_date: 'invalid' } }, 'https://example.com/');
  assert.equal(body.start.dateTime, '2026-09-18T13:00:00.000Z');
  assert.equal(body.end.dateTime, '2026-09-18T17:00:00.000Z');
  assert.equal(body.location, '');
  assert.equal(body.description, 'Checklist do CAPTURA: https://example.com/e/abc');
  assert.equal(body.attendees, undefined);
  assert.equal(calendarBody({ data: {} }, 'https://example.com'), null);
});

test('Cria cópia diretamente sem convidados, preservando ID para repetição', async () => {
  const calls = [];
  const statuses = [404, 200];
  await writeGoogleEvent({ token: 'token', id: 'abc123', body: { summary: 'Evento' }, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); const status = statuses.shift(); return { status, ok: status === 200 };
  } });
  assert.deepEqual(calls.map(c => c.method), ['PATCH', 'POST']);
  assert.equal(JSON.parse(calls[1].body).id, 'abc123');
  assert.ok(calls.every(c => !c.url.includes('sendUpdates')));
});

test('Conflito após timeout reutiliza o evento em vez de duplicar', async () => {
  const methods = [];
  const statuses = [404, 409, 200];
  await writeGoogleEvent({ token: 'token', id: 'abc123', body: {}, fetchImpl: async (url, options) => {
    methods.push(options.method); const status = statuses.shift(); return { status, ok: status === 200 };
  } });
  assert.deepEqual(methods, ['PATCH', 'POST', 'PATCH']);
});

test('Exclusão já realizada é sucesso e falha temporária deve ser repetida', async () => {
  for (const status of [404, 410]) await writeGoogleEvent({ token: 'token', id: 'abc123', remove: true,
    fetchImpl: async () => ({ status, ok: false }) });
  await assert.rejects(writeGoogleEvent({ token: 'token', id: 'abc123', body: {},
    fetchImpl: async () => ({ status: 503, ok: false }) }), /503/);
});
