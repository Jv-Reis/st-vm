// Testes de lógica pura — sem banco, sem rede, sem servidor. Rodam em
// milissegundos (com exceção dos dois testes de janela de tempo do rate
// limiter, que esperam um período curto de verdade). Complementam
// tests/rls.test.js: aqueles cobrem autorização, esses cobrem bug de lógica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldProgress, validEventPayload, splitDriveFolderPath, makeRateLimiter } from '../lib/pure.js';

// ---------- foldProgress ----------

test('foldProgress: status "feito" registra a cena com os horários', () => {
  const { recorded } = foldProgress([
    { action: 'status', payload: { sceneId: 'a', status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' } }
  ]);
  assert.deepEqual(recorded.a, { status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' });
});

test('foldProgress: status "nao_iniciado" remove a cena do registro', () => {
  const { recorded } = foldProgress([
    { action: 'status', payload: { sceneId: 'a', status: 'feito', feitoAt: '14:10' } },
    { action: 'status', payload: { sceneId: 'a', status: 'nao_iniciado' } }
  ]);
  assert.equal('a' in recorded, false);
});

test('foldProgress: ações legadas "record"/"unrecord" continuam funcionando', () => {
  const { recorded } = foldProgress([
    { action: 'record', payload: { sceneId: 'a', time: '14:10' } }
  ]);
  assert.deepEqual(recorded.a, { status: 'feito', andamentoAt: null, feitoAt: '14:10' });

  const { recorded: recorded2 } = foldProgress([
    { action: 'record', payload: { sceneId: 'a', time: '14:10' } },
    { action: 'unrecord', payload: { sceneId: 'a' } }
  ]);
  assert.equal('a' in recorded2, false);
});

test('foldProgress: mission/unmission alternam missionsDone', () => {
  const { missionsDone } = foldProgress([
    { action: 'mission', payload: { cat: 'flagra', idx: 0 } },
    { action: 'mission', payload: { cat: 'flagra', idx: 1 } },
    { action: 'unmission', payload: { cat: 'flagra', idx: 0 } }
  ]);
  assert.deepEqual(missionsDone, { 'flagra-1': true });
});

test('foldProgress: reset limpa cenas e missões registradas até ali', () => {
  const { recorded, missionsDone } = foldProgress([
    { action: 'status', payload: { sceneId: 'a', status: 'feito' } },
    { action: 'mission', payload: { cat: 'x', idx: 0 } },
    { action: 'reset', payload: {} },
    // depois do reset, uma missão nova continua sendo registrada normalmente
    { action: 'mission', payload: { cat: 'y', idx: 0 } }
  ]);
  assert.deepEqual(recorded, {});
  assert.deepEqual(missionsDone, { 'y-0': true });
});

// ---------- validEventPayload ----------

test('validEventPayload: preenche os defaults quando só "scenes" vem no body', () => {
  const payload = validEventPayload({ scenes: [] });
  assert.deepEqual(payload, {
    event_title: 'Evento sem nome',
    phases: [],
    scenes: [],
    missions: [],
    event_date: '',
    event_end_date: '',
    event_location: '',
    drive_folders: []
  });
});

test('validEventPayload: rejeita quando "scenes" não é array', () => {
  assert.equal(validEventPayload({ event_title: 'x' }), null);
  assert.equal(validEventPayload({ scenes: 'não é array' }), null);
});

test('validEventPayload: rejeita body vazio/ausente', () => {
  assert.equal(validEventPayload(null), null);
  assert.equal(validEventPayload(undefined), null);
});

test('validEventPayload: "drive_folders" cai pra array vazio se não vier como array', () => {
  const payload = validEventPayload({ scenes: [], drive_folders: 'oops' });
  assert.deepEqual(payload.drive_folders, []);
});

test('validEventPayload: preserva os valores mandados quando presentes', () => {
  const payload = validEventPayload({
    event_title: 'Ana & Bruno',
    scenes: [{ id: 's1' }],
    phases: [{ key: 'p1' }],
    missions: [{ key: 'm1' }],
    event_date: '2026-10-10T14:00',
    drive_folders: ['Cerimônia']
  });
  assert.equal(payload.event_title, 'Ana & Bruno');
  assert.equal(payload.scenes.length, 1);
  assert.equal(payload.phases.length, 1);
  assert.equal(payload.drive_folders[0], 'Cerimônia');
});

// ---------- splitDriveFolderPath ----------

test('splitDriveFolderPath: separa caminho aninhado por "/"', () => {
  assert.deepEqual(splitDriveFolderPath('Final/Fotos finais'), ['Final', 'Fotos finais']);
});

test('splitDriveFolderPath: ignora espaço em volta e segmento vazio (barra dupla, no início/fim)', () => {
  assert.deepEqual(splitDriveFolderPath(' Final / /Fotos finais/ '), ['Final', 'Fotos finais']);
});

test('splitDriveFolderPath: sem barra vira um segmento só', () => {
  assert.deepEqual(splitDriveFolderPath('Cerimônia'), ['Cerimônia']);
});

test('splitDriveFolderPath: string vazia vira lista vazia', () => {
  assert.deepEqual(splitDriveFolderPath(''), []);
});

// ---------- makeRateLimiter ----------

function fakeReqRes(overrides = {}) {
  const req = { ip: '1.2.3.4', ...overrides };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
  return { req, res };
}

test('makeRateLimiter: libera até o limite, depois bloqueia com 429', () => {
  const limiter = makeRateLimiter(60000, 2, 'limite atingido');
  const { req, res } = fakeReqRes();

  let nextCalls = 0;
  const next = () => { nextCalls++; };

  limiter(req, res, next);
  limiter(req, res, next);
  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, null); // ainda não bloqueou

  limiter(req, res, next);
  assert.equal(nextCalls, 2); // terceira chamada não passa
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: 'limite atingido' });
});

test('makeRateLimiter: chaves diferentes (ex: IPs diferentes) têm contadores independentes', () => {
  const limiter = makeRateLimiter(60000, 1, 'limite atingido');
  const a = fakeReqRes({ ip: '1.1.1.1' });
  const b = fakeReqRes({ ip: '2.2.2.2' });
  const next = () => {};

  limiter(a.req, a.res, next);
  assert.equal(a.res.statusCode, null);
  limiter(a.req, a.res, next);
  assert.equal(a.res.statusCode, 429); // 1.1.1.1 já usou a cota

  limiter(b.req, b.res, next);
  assert.equal(b.res.statusCode, null); // 2.2.2.2 tem cota própria
});

test('makeRateLimiter: usa keyFn customizada (ex: por conta, não por IP)', () => {
  const limiter = makeRateLimiter(60000, 1, 'limite atingido', (req) => req.user.id);
  const { res } = fakeReqRes();
  const next = () => {};

  limiter({ user: { id: 'user-1' } }, res, next);
  assert.equal(res.statusCode, null);
  const res2 = fakeReqRes().res;
  limiter({ user: { id: 'user-1' } }, res2, next);
  assert.equal(res2.statusCode, 429); // mesma conta, cota já usada

  const res3 = fakeReqRes().res;
  limiter({ user: { id: 'user-2' } }, res3, next);
  assert.equal(res3.statusCode, null); // conta diferente, cota própria
});

test('makeRateLimiter: libera de novo depois que a janela passa', async () => {
  const limiter = makeRateLimiter(50, 1, 'limite atingido');
  const { req, res } = fakeReqRes();
  const next = () => {};

  limiter(req, res, next);
  assert.equal(res.statusCode, null);
  limiter(req, res, next);
  assert.equal(res.statusCode, 429);

  await new Promise((resolve) => setTimeout(resolve, 70));

  const res2 = fakeReqRes().res;
  limiter(req, res2, next);
  assert.equal(res2.statusCode, null); // janela de 50ms já passou
});
