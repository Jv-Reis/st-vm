import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientGatewayError, createWorkerLogger } from '../lib/transient.js';
import { createCalendarWorker } from '../lib/calendar-sync.js';

const MIN = 60000;

function fixture(overrides = {}) {
  const clock = { t: 1_000_000 };
  const errors = [], warns = [];
  const log = createWorkerLogger({
    logError: (...args) => errors.push(args), warn: (...args) => warns.push(args), now: () => clock.t, ...overrides
  });
  return { clock, errors, warns, log };
}

test('reconhece erro de gateway do Supabase (objeto sem status), status 5xx de gateway e falha de rede', () => {
  assert.equal(isTransientGatewayError({ message: 'Gateway Timeout' }), true);
  assert.equal(isTransientGatewayError({ message: 'Bad Gateway' }), true);
  assert.equal(isTransientGatewayError({ message: ' service unavailable ' }), true);
  assert.equal(isTransientGatewayError(Object.assign(new Error('Google Calendar: HTTP 503'), { status: 503 })), true);
  assert.equal(isTransientGatewayError(new TypeError('fetch failed')), true);
  assert.equal(isTransientGatewayError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(isTransientGatewayError(Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), true);
});

test('não trata erro de verdade como passageiro', () => {
  assert.equal(isTransientGatewayError(null), false);
  assert.equal(isTransientGatewayError({ message: 'duplicate key value', code: '23505' }), false);
  assert.equal(isTransientGatewayError({ message: 'permission denied for table events', code: '42501' }), false);
  assert.equal(isTransientGatewayError(Object.assign(new Error('Google Calendar: HTTP 403'), { status: 403 })), false);
  assert.equal(isTransientGatewayError(Object.assign(new Error('Google Calendar: HTTP 500'), { status: 500 })), false);
  assert.equal(isTransientGatewayError(new Error('Não foi possível renovar o acesso ao Google.')), false);
});

test('erro que não é passageiro vai pro logError na hora, inalterado', () => {
  const f = fixture();
  const err = { message: 'permission denied', code: '42501' };
  f.log('Fila do Calendar indisponível:', err);
  assert.deepEqual(f.errors, [['Fila do Calendar indisponível:', err]]);
  assert.equal(f.warns.length, 0);
});

test('queda curta (o caso real de 2 minutos) vira só aviso no log, sem Sentry', () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) { f.log('Fila de convites indisponível:', { message: 'Gateway Timeout' }); f.clock.t += 20000; }
  assert.equal(f.errors.length, 0);
  assert.equal(f.warns.length, 8);
});

test('queda que dura o limite seguido avisa o Sentry uma vez só', () => {
  const f = fixture();
  const err = { message: 'Bad Gateway' };
  for (let elapsed = 0; elapsed <= 12 * MIN; elapsed += 20000) { f.log('Fila do Calendar indisponível:', err); f.clock.t += 20000; }
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0][0], /^Fila do Calendar indisponível: \(falhando há 5 min\)$/);
  assert.equal(f.errors[0][1], err); // erro original preservado pro Sentry
});

test('intervalo sem falha maior que a tolerância recomeça a contagem', () => {
  const f = fixture();
  const err = { message: 'Gateway Timeout' };
  f.log('x:', err);
  f.clock.t += 4 * MIN;
  f.log('x:', err); // 4 min depois do primeiro, mas com intervalo > 90s: é outra queda
  f.clock.t += 2 * MIN;
  f.log('x:', err);
  assert.equal(f.errors.length, 0);
});

test('mensagens diferentes contam separado', () => {
  const f = fixture();
  const err = { message: 'Gateway Timeout' };
  for (let elapsed = 0; elapsed < 6 * MIN; elapsed += 30000) { f.log('a:', err); f.clock.t += 30000; }
  f.log('b:', err);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0][0], /^a:/);
});

test('worker do Calendar com o Supabase fora do ar: silencioso na queda curta, alerta na longa', async () => {
  const f = fixture();
  const down = { data: null, error: { message: 'Gateway Timeout' } };
  const run = createCalendarWorker({ db: { rpc: async () => down }, getToken: async () => null, baseUrl: 'https://x.test', logError: f.log });
  for (let i = 0; i < 6; i++) { await run(); f.clock.t += 15000; }
  assert.equal(f.errors.length, 0);
  assert.ok(f.warns.length >= 6);
  for (let i = 0; i < 30; i++) { await run(); f.clock.t += 15000; }
  assert.equal(f.errors.length, 1);
});
