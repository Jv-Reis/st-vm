import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPendingStatus, countPending, nextPendingId } from '../public/checklist-nav.js';

const statusFrom = map => id => map[id] ?? null;

test('pendente: tudo menos Feito e Postado (Em andamento ainda falta)', () => {
  assert.equal(isPendingStatus(null), true);
  assert.equal(isPendingStatus(undefined), true);
  assert.equal(isPendingStatus('nao_iniciado'), true);
  assert.equal(isPendingStatus('andamento'), true);
  assert.equal(isPendingStatus('feito'), false);
  assert.equal(isPendingStatus('postado'), false);
});

test('conta pendentes', () => {
  assert.equal(countPending(['a', 'b', 'c'], statusFrom({ a: 'feito', b: 'andamento' })), 2);
  assert.equal(countPending([], statusFrom({})), 0);
});

test('próxima pendente depois da atual, pulando as capturadas', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const status = statusFrom({ b: 'feito', c: 'postado' });
  assert.equal(nextPendingId(ids, status, 'a'), 'd');
  assert.equal(nextPendingId(ids, status, 'b'), 'd');
});

test('sem pendente depois da atual, volta ao começo', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(nextPendingId(ids, statusFrom({ b: 'feito', c: 'feito' }), 'c'), 'a');
  assert.equal(nextPendingId(ids, statusFrom({ a: 'feito', c: 'feito' }), 'c'), 'b');
});

test('a própria cena só é escolhida quando é a única que falta', () => {
  assert.equal(nextPendingId(['a', 'b'], statusFrom({ b: 'feito' }), 'a'), 'a');
});

test('sem cena atual (topo da página ou id desconhecido), começa pela primeira pendente', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(nextPendingId(ids, statusFrom({ a: 'feito' }), null), 'b');
  assert.equal(nextPendingId(ids, statusFrom({}), 'sumiu'), 'a');
});

test('tudo capturado ou lista vazia: nenhuma próxima', () => {
  assert.equal(nextPendingId(['a', 'b'], statusFrom({ a: 'feito', b: 'postado' }), 'a'), null);
  assert.equal(nextPendingId([], statusFrom({}), null), null);
});
