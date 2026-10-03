import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowStamp, isFullStamp, isLegacyStamp, formatStamp, formatStampFull, formatDelay } from '../public/progress-time.js';

// Horários construídos no fuso local da máquina, então os testes valem em qualquer fuso.
const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute).toISOString();

test('nowStamp devolve ISO completo com data', () => {
  const stamp = nowStamp(new Date(2026, 9, 12, 10, 5));
  assert.equal(isFullStamp(stamp), true);
  assert.equal(new Date(stamp).getHours(), 10);
});

test('distingue horário com data do formato antigo HH:MM', () => {
  assert.equal(isFullStamp('2026-10-12T10:00:00.000Z'), true);
  assert.equal(isFullStamp('10:00'), false);
  assert.equal(isLegacyStamp('10:00'), true);
  assert.equal(isLegacyStamp('9:05'), true);
  assert.equal(isLegacyStamp('2026-10-12T10:00:00.000Z'), false);
  assert.equal(isFullStamp(null), false);
});

// ---------- formatDelay: o bug original ----------

test('formatDelay: menos de uma hora vira "Xmin"', () => {
  assert.equal(formatDelay(at(12, 14, 10), at(12, 14, 33)), '23min');
});

test('formatDelay: menos de um dia vira "XhYY"', () => {
  assert.equal(formatDelay(at(12, 14, 10), at(12, 16, 15)), '2h05');
});

test('formatDelay: 48 h depois mostra 2d 0h (antes mostrava 0min)', () => {
  assert.equal(formatDelay(at(12, 14, 0), at(14, 14, 0)), '2d 0h');
});

test('formatDelay: 40 h depois mostra 1d 16h (antes mostrava 16h)', () => {
  assert.equal(formatDelay(at(12, 18, 0), at(14, 10, 0)), '1d 16h');
});

test('formatDelay: virada de meia-noite conta certo', () => {
  assert.equal(formatDelay(at(12, 23, 50), at(13, 0, 20)), '30min');
});

test('formatDelay: zero minutos é "0min", não vazio', () => {
  assert.equal(formatDelay(at(12, 10, 0), at(12, 10, 0)), '0min');
});

test('formatDelay: com horário antigo (só HH:MM), sem data, não chuta: devolve null', () => {
  assert.equal(formatDelay('18:00', '10:00'), null);
  assert.equal(formatDelay('14:00', '14:00'), null);
});

test('formatDelay: par misto (um antigo, um com data) devolve null', () => {
  assert.equal(formatDelay('18:00', at(14, 10, 0)), null);
  assert.equal(formatDelay(at(12, 18, 0), '10:00'), null);
});

test('formatDelay: ordem invertida (voltou de Postado pra Feito) devolve null', () => {
  assert.equal(formatDelay(at(14, 10, 0), at(12, 18, 0)), null);
});

test('formatDelay: sem um dos horários devolve null', () => {
  assert.equal(formatDelay(at(12, 10, 0), null), null);
  assert.equal(formatDelay(undefined, undefined), null);
  assert.equal(formatDelay('lixo', at(12, 10, 0)), null);
});

// ---------- exibição ----------

test('formatStamp: hoje mostra só a hora; outro dia mostra dia/mês e hora', () => {
  const now = new Date(2026, 9, 12, 20, 0);
  assert.equal(formatStamp(at(12, 10, 5), now), '10:05');
  assert.equal(formatStamp(at(9, 10, 5), now), '09/10 10:05');
});

test('formatStamp: mantém o formato antigo como está', () => {
  assert.equal(formatStamp('14:35', new Date()), '14:35');
});

test('formatStamp: valor vazio ou inválido não quebra', () => {
  assert.equal(formatStamp(null), '');
  assert.equal(formatStamp(undefined), '');
  assert.equal(formatStamp('lixo'), 'lixo');
});

test('formatStampFull: sempre com a data (relatório), formato antigo intacto', () => {
  assert.equal(formatStampFull(at(12, 10, 5)), '12/10 10:05');
  assert.equal(formatStampFull('14:35'), '14:35');
  assert.equal(formatStampFull(null), '');
});
