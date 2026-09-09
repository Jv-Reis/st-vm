// Testes de lógica pura — sem banco, sem rede, sem servidor. Rodam em
// milissegundos (com exceção dos dois testes de janela de tempo do rate
// limiter, que esperam um período curto de verdade). Complementam
// tests/rls.test.js: aqueles cobrem autorização, esses cobrem bug de lógica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldProgress, computeMinimalProgressRows, validEventPayload, splitDriveFolderPath, makeRateLimiter, filterValidEmails, formatDelay } from '../lib/pure.js';

// ---------- foldProgress ----------

test('foldProgress: status "feito" registra a cena com os horários', () => {
  const { recorded } = foldProgress([
    { action: 'status', payload: { sceneId: 'a', status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' } }
  ]);
  assert.deepEqual(recorded.a, { status: 'feito', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: null });
});

test('foldProgress: status "postado" registra a cena com os três horários', () => {
  const { recorded } = foldProgress([
    { action: 'status', payload: { sceneId: 'a', status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' } },
    { action: 'status', payload: { sceneId: 'a', status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' } }
  ]);
  assert.deepEqual(recorded.a, { status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' });
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
  assert.deepEqual(recorded.a, { status: 'feito', andamentoAt: null, feitoAt: '14:10', postadoAt: null });

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

test('foldProgress: mission/unmission com "itemKey" (id estável do item) funciona igual ao "idx" legado', () => {
  const { missionsDone } = foldProgress([
    { action: 'mission', payload: { cat: 'flagra', itemKey: 'item_abc' } },
    { action: 'mission', payload: { cat: 'flagra', itemKey: 'item_def' } },
    { action: 'unmission', payload: { cat: 'flagra', itemKey: 'item_abc' } }
  ]);
  assert.deepEqual(missionsDone, { 'flagra-item_def': true });
});

test('foldProgress: evento antigo com "idx" e novo com "itemKey" coexistem sem conflito', () => {
  const { missionsDone } = foldProgress([
    { action: 'mission', payload: { cat: 'flagra', idx: 0 } }, // linha antiga, de antes do id estável existir
    { action: 'mission', payload: { cat: 'flagra', itemKey: 'item_novo' } } // linha nova, já com id estável
  ]);
  assert.deepEqual(missionsDone, { 'flagra-0': true, 'flagra-item_novo': true });
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

// ---------- computeMinimalProgressRows ----------
// A invariante que importa de verdade: dobrar o histórico original tem que
// dar EXATAMENTE o mesmo resultado que dobrar a versão compactada — é o que
// garante que compactar o log nunca perde nem altera nenhum estado visível.

function assertSameFoldedState(originalRows) {
  const minimalRows = computeMinimalProgressRows(originalRows);
  assert.deepEqual(foldProgress(minimalRows), foldProgress(originalRows));
  return minimalRows;
}

test('computeMinimalProgressRows: reduz várias mudanças de status na mesma cena pra uma linha só', () => {
  const original = [
    { action: 'status', payload: { sceneId: 'a', status: 'andamento', andamentoAt: '14:00' } },
    { action: 'status', payload: { sceneId: 'a', status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 1);
  assert.equal(minimal[0].payload.status, 'feito');
});

test('computeMinimalProgressRows: cena que avançou até "postado" compacta preservando os três horários', () => {
  const original = [
    { action: 'status', payload: { sceneId: 'a', status: 'andamento', andamentoAt: '14:00' } },
    { action: 'status', payload: { sceneId: 'a', status: 'feito', andamentoAt: '14:00', feitoAt: '14:10' } },
    { action: 'status', payload: { sceneId: 'a', status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 1);
  assert.deepEqual(minimal[0].payload, { sceneId: 'a', status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' });
});

test('computeMinimalProgressRows: cena voltada pra "não iniciado" não aparece mais no resultado', () => {
  const original = [
    { action: 'status', payload: { sceneId: 'a', status: 'feito', feitoAt: '14:10' } },
    { action: 'status', payload: { sceneId: 'a', status: 'nao_iniciado' } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 0);
});

test('computeMinimalProgressRows: preserva missão marcada com "itemKey" e com "idx" legado ao mesmo tempo', () => {
  const original = [
    { action: 'mission', payload: { cat: 'flagra', idx: 0 } },
    { action: 'mission', payload: { cat: 'flagra', itemKey: 'item_novo' } },
    { action: 'unmission', payload: { cat: 'flagra', idx: 0 } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 1);
  assert.deepEqual(minimal[0].payload, { cat: 'flagra', itemKey: 'item_novo' });
});

test('computeMinimalProgressRows: um "reset" no meio do histórico não deixa rastro de antes dele', () => {
  const original = [
    { action: 'status', payload: { sceneId: 'a', status: 'feito' } },
    { action: 'mission', payload: { cat: 'x', idx: 0 } },
    { action: 'reset', payload: {} },
    { action: 'status', payload: { sceneId: 'b', status: 'andamento', andamentoAt: '15:00' } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 1);
  assert.equal(minimal[0].payload.sceneId, 'b');
});

test('computeMinimalProgressRows: histórico já vazio (só reset, ou nada) compacta pra zero linhas', () => {
  assert.deepEqual(computeMinimalProgressRows([]), []);
  assertSameFoldedState([{ action: 'reset', payload: {} }]);
});

test('computeMinimalProgressRows: ações legadas "record"/"unrecord" também compactam certo', () => {
  const original = [
    { action: 'record', payload: { sceneId: 'a', time: '14:10' } },
    { action: 'status', payload: { sceneId: 'b', status: 'andamento', andamentoAt: '14:20' } },
    { action: 'unrecord', payload: { sceneId: 'a' } }
  ];
  const minimal = assertSameFoldedState(original);
  assert.equal(minimal.length, 1);
  assert.equal(minimal[0].payload.sceneId, 'b');
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
    drive_folders: [],
    calendar_guests: []
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

test('validEventPayload: "drive_folders" e "calendar_guests" caem pra array vazio se não vierem como array', () => {
  const payload = validEventPayload({ scenes: [], drive_folders: 'oops', calendar_guests: 'oops' });
  assert.deepEqual(payload.drive_folders, []);
  assert.deepEqual(payload.calendar_guests, []);
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

// ---------- filterValidEmails ----------

test('filterValidEmails: mantém só o que parece email de verdade', () => {
  assert.deepEqual(
    filterValidEmails(['fulana@gmail.com', 'texto qualquer', 'beltrano@empresa.com.br', '', 'sem-arroba.com']),
    ['fulana@gmail.com', 'beltrano@empresa.com.br']
  );
});

test('filterValidEmails: tira espaço em volta antes de validar', () => {
  assert.deepEqual(filterValidEmails(['  fulana@gmail.com  ']), ['fulana@gmail.com']);
});

test('filterValidEmails: lista vazia ou não-array vira lista vazia', () => {
  assert.deepEqual(filterValidEmails([]), []);
  assert.deepEqual(filterValidEmails(undefined), []);
  assert.deepEqual(filterValidEmails('fulana@gmail.com'), []);
});

// ---------- formatDelay ----------

test('formatDelay: menos de uma hora vira "Xmin"', () => {
  assert.equal(formatDelay('14:10', '14:33'), '23min');
});

test('formatDelay: uma hora ou mais vira "XhYY"', () => {
  assert.equal(formatDelay('14:10', '16:15'), '2h05');
});

test('formatDelay: horário que vira meia-noite soma 24h', () => {
  assert.equal(formatDelay('23:50', '00:20'), '30min');
});

test('formatDelay: sem um dos dois horários (ainda não postado) retorna null', () => {
  assert.equal(formatDelay('14:10', null), null);
  assert.equal(formatDelay(null, '14:10'), null);
  assert.equal(formatDelay(undefined, undefined), null);
});

test('formatDelay: horário em formato inválido retorna null', () => {
  assert.equal(formatDelay('14:10', 'não é hora'), null);
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
