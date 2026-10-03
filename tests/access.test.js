import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, isValidShareToken, isValidEventId, normalizeShareMode, stripPrivateFields, canResetProgress } from '../lib/access.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const FUTURE = '2026-11-01T00:00:00Z';
const PAST = '2026-09-01T00:00:00Z';

test('equipe sempre lê e altera progresso, em qualquer modo', () => {
  for (const shareMode of ['team', 'view', 'collab', null, 'lixo']) {
    for (const role of ['owner', 'editor', 'member']) {
      assert.deepEqual(decideAccess({ role, via: 'id', shareMode, now: NOW }), { canRead: true, canWriteProgress: true, basis: 'team' });
    }
  }
});

test('matriz de acesso por link (token) para quem não é da equipe', () => {
  const cases = [
    ['team', true, false, false],
    ['view', true, true, false],
    ['collab', true, true, true],
    ['view', false, false, false],
    ['collab', false, false, false]
  ];
  for (const [shareMode, tokenMatches, canRead, canWrite] of cases) {
    const r = decideAccess({ via: 'token', shareMode, tokenMatches, now: NOW });
    assert.equal(r.canRead, canRead, `${shareMode}/${tokenMatches}`);
    assert.equal(r.canWriteProgress, canWrite, `${shareMode}/${tokenMatches}`);
    if (canRead) assert.equal(r.basis, 'link');
  }
});

test('endereço antigo /e/<id> só abre durante o período de compatibilidade', () => {
  assert.deepEqual(decideAccess({ via: 'id', shareMode: 'collab', legacyUntil: FUTURE, now: NOW }), { canRead: true, canWriteProgress: true, basis: 'legacy' });
  assert.equal(decideAccess({ via: 'id', shareMode: 'view', legacyUntil: FUTURE, now: NOW }).canWriteProgress, false);
  assert.equal(decideAccess({ via: 'id', shareMode: 'collab', legacyUntil: PAST, now: NOW }).canRead, false);
  assert.equal(decideAccess({ via: 'id', shareMode: 'collab', legacyUntil: null, now: NOW }).canRead, false);
  assert.equal(decideAccess({ via: 'id', shareMode: 'collab', legacyUntil: 'não é data', now: NOW }).canRead, false);
  // Somente equipe fecha o endereço antigo mesmo dentro do prazo.
  assert.equal(decideAccess({ via: 'id', shareMode: 'team', legacyUntil: FUTURE, now: NOW }).canRead, false);
});

test('modo desconhecido ou ausente falha fechado', () => {
  assert.equal(decideAccess({ via: 'token', shareMode: undefined, tokenMatches: true, now: NOW }).canRead, false);
  assert.equal(decideAccess({ via: 'token', shareMode: 'public', tokenMatches: true, now: NOW }).canRead, false);
  assert.equal(decideAccess({ via: 'outro', shareMode: 'collab', tokenMatches: true, now: NOW }).canRead, false);
});

test('validação de token e de ID', () => {
  assert.equal(isValidShareToken('a'.repeat(32)), true);
  assert.equal(isValidShareToken('Ab-_'.repeat(8)), true);
  assert.equal(isValidShareToken('a'.repeat(31)), false);
  assert.equal(isValidShareToken('a'.repeat(129)), false);
  assert.equal(isValidShareToken('a'.repeat(31) + '='), false);
  assert.equal(isValidShareToken(null), false);
  assert.equal(isValidEventId('3f2a-99'), true);
  assert.equal(isValidEventId('../etc'), false);
  assert.equal(isValidEventId(''), false);
  assert.equal(normalizeShareMode('view'), 'view');
  assert.equal(normalizeShareMode('VIEW'), null);
});

test('quem entra por link não recebe emails da equipe nem dos convidados', () => {
  const data = { event_title: 'X', member_emails: ['a@b.co'], calendar_guests: ['c@d.co'] };
  assert.deepEqual(stripPrivateFields(data, false), { event_title: 'X' });
  assert.deepEqual(stripPrivateFields(data, true), data);
  assert.deepEqual(data.member_emails, ['a@b.co'], 'não altera o original');
});

test('reiniciar o checklist: só dono e editor', () => {
  assert.equal(canResetProgress('owner'), true);
  assert.equal(canResetProgress('editor'), true);
});

test('reiniciar o checklist: membro sem edição, quem só tem o link e valores estranhos não podem', () => {
  assert.equal(canResetProgress('member'), false);
  assert.equal(canResetProgress(null), false);
  assert.equal(canResetProgress(undefined), false);
  assert.equal(canResetProgress('OWNER'), false);
  assert.equal(canResetProgress('admin'), false);
});

test('o modo colaborar deixa o link marcar progresso, mas nunca reiniciar', () => {
  const link = decideAccess({ role: null, via: 'token', shareMode: 'collab', tokenMatches: true, now: NOW });
  assert.equal(link.canWriteProgress, true);
  assert.equal(canResetProgress(null), false);
});
