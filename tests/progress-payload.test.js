import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProgressPayload } from '../lib/progress-payload.js';

const ok = (action, payload) => {
  const result = sanitizeProgressPayload(action, payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.payload;
};
const bad = (action, payload) => {
  const result = sanitizeProgressPayload(action, payload);
  assert.equal(result.ok, false, 'deveria recusar ' + JSON.stringify(payload));
  return result;
};

// Os formatos abaixo são os que existem de verdade no banco de produção
// (levantados antes de escrever o validador): nenhum pode ser recusado.
test('aceita os formatos reais já gravados: status com horário antigo HH:MM', () => {
  assert.deepEqual(
    ok('status', { sceneId: 'cena_ab12cd', status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' }),
    { sceneId: 'cena_ab12cd', status: 'postado', andamentoAt: '14:00', feitoAt: '14:10', postadoAt: '14:35' }
  );
});

test('aceita status sem postadoAt (telas antigas) e preenche com null', () => {
  assert.deepEqual(
    ok('status', { sceneId: 'a', status: 'feito', andamentoAt: null, feitoAt: '09:05' }),
    { sceneId: 'a', status: 'feito', andamentoAt: null, feitoAt: '09:05', postadoAt: null }
  );
});

test('aceita sceneId numérico (eventos antigos usam 1, 2, 3...)', () => {
  assert.equal(ok('status', { sceneId: 3, status: 'andamento', andamentoAt: '10:00' }).sceneId, 3);
});

test('aceita status "nao_iniciado" com tudo nulo', () => {
  assert.deepEqual(
    ok('status', { sceneId: 'a', status: 'nao_iniciado', andamentoAt: null, feitoAt: null, postadoAt: null }),
    { sceneId: 'a', status: 'nao_iniciado', andamentoAt: null, feitoAt: null, postadoAt: null }
  );
});

test('aceita record, unrecord, mission com idx, unmission com idx e reset', () => {
  assert.deepEqual(ok('record', { sceneId: 'a', time: '14:10' }), { sceneId: 'a', time: '14:10' });
  assert.deepEqual(ok('unrecord', { sceneId: 'a' }), { sceneId: 'a' });
  assert.deepEqual(ok('mission', { cat: 'missao_x1', idx: 0 }), { cat: 'missao_x1', idx: 0 });
  assert.deepEqual(ok('unmission', { cat: 'missao_x1', idx: 12 }), { cat: 'missao_x1', idx: 12 });
  assert.deepEqual(ok('reset', {}), {});
});

test('aceita mission com itemKey (id estável do item)', () => {
  assert.deepEqual(ok('mission', { cat: 'flagra', itemKey: 'item_abc123' }), { cat: 'flagra', itemKey: 'item_abc123' });
});

test('aceita horário ISO completo (formato atual, com data)', () => {
  const stamp = '2026-09-29T18:00:00.000Z';
  assert.equal(ok('status', { sceneId: 'a', status: 'postado', feitoAt: stamp, postadoAt: stamp }).postadoAt, stamp);
  assert.equal(ok('record', { sceneId: 'a', time: stamp }).time, stamp);
});

test('não olha se o horário está perto de "agora" (relógio errado do celular não pode perder ação)', () => {
  assert.equal(ok('status', { sceneId: 'a', status: 'feito', feitoAt: '2019-01-01T00:00:00.000Z' }).feitoAt, '2019-01-01T00:00:00.000Z');
  assert.equal(ok('status', { sceneId: 'a', status: 'feito', feitoAt: '2099-01-01T00:00:00.000Z' }).feitoAt, '2099-01-01T00:00:00.000Z');
});

test('descarta campos extras em vez de gravar (o ataque de payload gigante)', () => {
  const payload = ok('status', { sceneId: 'a', status: 'feito', feitoAt: '10:00', lixo: 'x'.repeat(500000), outro: { a: [1, 2, 3] } });
  assert.deepEqual(Object.keys(payload).sort(), ['andamentoAt', 'feitoAt', 'postadoAt', 'sceneId', 'status']);
  assert.ok(JSON.stringify(payload).length < 200);
});

test('reset ignora qualquer conteúdo mandado junto', () => {
  assert.deepEqual(ok('reset', { grande: 'x'.repeat(100000) }), {});
  assert.deepEqual(ok('reset', undefined), {});
});

test('recusa ação desconhecida', () => {
  bad('drop_table', {});
  bad(undefined, {});
});

test('recusa payload que não é objeto', () => {
  bad('status', 'texto');
  bad('status', [1, 2]);
  bad('status', 42);
});

test('recusa sceneId inválido: vazio, enorme, com caracteres estranhos, objeto', () => {
  bad('status', { sceneId: '', status: 'feito' });
  bad('status', { sceneId: 'x'.repeat(65), status: 'feito' });
  bad('status', { sceneId: '<script>alert(1)</script>', status: 'feito' });
  bad('status', { sceneId: { a: 1 }, status: 'feito' });
  bad('status', { sceneId: -1, status: 'feito' });
  bad('status', { sceneId: 1.5, status: 'feito' });
  bad('status', { status: 'feito' });
});

test('recusa status fora da lista', () => {
  bad('status', { sceneId: 'a', status: 'apagado' });
  bad('status', { sceneId: 'a' });
});

test('recusa horário inválido: texto livre, aninhado, número, data impossível', () => {
  bad('status', { sceneId: 'a', status: 'feito', feitoAt: 'ontem à noite' });
  bad('status', { sceneId: 'a', status: 'feito', feitoAt: { x: 1 } });
  bad('status', { sceneId: 'a', status: 'feito', feitoAt: 1234 });
  bad('status', { sceneId: 'a', status: 'feito', feitoAt: '2026-13-45T99:99:99Z' });
  bad('status', { sceneId: 'a', status: 'feito', postadoAt: 'x'.repeat(10000) });
  bad('record', { sceneId: 'a', time: 'agora' });
});

test('recusa missão sem item, com idx fora da faixa ou categoria inválida', () => {
  bad('mission', { cat: 'flagra' });
  bad('mission', { cat: 'flagra', idx: -1 });
  bad('mission', { cat: 'flagra', idx: 10000 });
  bad('mission', { cat: 'flagra', idx: 1.5 });
  bad('mission', { cat: 'flagra', idx: '1' });
  bad('mission', { cat: '', idx: 0 });
  bad('mission', { cat: 'flagra', itemKey: { a: 1 } });
  bad('unmission', { idx: 0 });
});
