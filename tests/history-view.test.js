// "Meus eventos": esqueleto enquanto carrega, tudo aparece junto, e a seção
// de autorizações da agenda fica recolhida com um resumo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, jsonResponse } from './app-harness.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('mostra esqueleto até eventos e autorizações chegarem, depois tudo de uma vez', async () => {
  const events = deferred();
  const permissions = deferred();
  const b = await browser({
    path: '/historico',
    routes: url => {
      if (url === '/api/events') return events.promise;
      if (url === '/api/google/permissions') return permissions.promise;
      if (url === '/api/google/status') return jsonResponse({ connected: false });
      return null;
    }
  });
  assert.equal(b.element('historyView').hidden, false);
  assert.equal(b.element('historyLoading').hidden, false);
  assert.equal(b.element('historyContent').hidden, true, 'nada aparece pela metade');

  events.resolve(jsonResponse({ events: [] }));
  await b.settle();
  assert.equal(b.element('historyContent').hidden, true, 'espera as autorizações também');

  permissions.resolve(jsonResponse({ permissions: [{ organizer_id: 'u1', email: 'ana@example.com' }] }));
  await b.settle();
  assert.equal(b.element('historyLoading').hidden, true);
  assert.equal(b.element('historyContent').hidden, false);
  assert.equal(b.element('calendarPermissionsCount').textContent, '1 pessoa autorizada');
  assert.equal(b.element('calendarPermissionsCount').classList.contains('has-people'), true);
});

test('sem ninguém autorizado, o resumo diz isso; erro nos eventos ainda libera a tela', async () => {
  const b = await browser({
    path: '/historico',
    routes: url => {
      if (url === '/api/events') return jsonResponse({ error: 'Falhou' }, { ok: false, status: 500 });
      if (url === '/api/google/permissions') return jsonResponse({ permissions: [] });
      if (url === '/api/google/status') return jsonResponse({ connected: false });
      return null;
    }
  });
  assert.equal(b.element('historyContent').hidden, false);
  assert.equal(b.element('historyLoading').hidden, true);
  assert.equal(b.element('calendarPermissionsCount').textContent, 'Ninguém autorizado');
  assert.match(b.element('historyList').innerHTML, /Não consegui carregar seu histórico \(Falhou\)/);
});
