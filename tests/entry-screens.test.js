// Telas de entrada: login sem surpresa (avisado antes, título conforme o
// motivo), "reservar a data" explicado, "não encontrado" sem repetição e
// sem rótulos "Captura ·".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browser, jsonResponse } from './app-harness.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('quem não entrou sabe antes do clique que gerar pede login', async () => {
  const out = await browser({ path: '/', session: null });
  assert.equal(out.element('generateBtn').textContent, 'Entrar e gerar checklist');
  assert.equal(out.element('generateLoginHint').hidden, false);

  const logged = await browser({ path: '/' });
  assert.equal(logged.element('generateBtn').textContent, 'Gerar checklist');
  assert.equal(logged.element('generateLoginHint').hidden, true);
});

test('login diz o motivo e o recado não aparece como erro', async () => {
  const b = await browser({ path: '/', session: null });
  b.element('roteiroInput').value = 'Um roteiro com conteúdo suficiente para gerar.';
  await b.click('generateBtn');
  assert.equal(b.element('loginView').hidden, false);
  assert.equal(b.element('loginTitle').textContent, 'Entre para gerar o checklist');
  assert.match(b.element('loginReason').textContent, /Seu texto fica salvo/);
  assert.equal(b.element('loginReason').hidden, false);
  assert.equal(b.element('loginStatus').hidden, true, 'nada no estilo vermelho de erro');

  const history = await browser({ path: '/historico', session: null });
  assert.equal(history.element('loginTitle').textContent, 'Entre para ver seus eventos');
  assert.equal(history.element('loginReason').hidden, true);
});

test('"link enviado" é confirmação (verde), não erro', async () => {
  const b = await browser({ path: '/', session: null });
  b.element('loginEmailInput').value = 'pessoa@example.com';
  await b.click('loginSubmitBtn');
  assert.match(b.element('loginStatus').textContent, /Link enviado/);
  assert.equal(b.element('loginStatus').classList.contains('import-error--ok'), true);
  b.element('loginEmailInput').value = '';
  await b.click('loginSubmitBtn');
  assert.equal(b.element('loginStatus').classList.contains('import-error--ok'), false);
});

test('"criar só com nome e data" aparece no início e some ao adicionar roteiro a um evento', async () => {
  const fresh = await browser({ path: '/' });
  assert.equal(fresh.element('quickCreateRow').hidden, false);
  const edit = await browser({
    path: '/e/existing/editar',
    event: { owner_id: 'owner', event_title: 'Reserva', phases: [], scenes: [], missions: [], revision: 1 }
  });
  await edit.click('previewBackBtn');
  assert.equal(edit.element('quickCreateRow').hidden, true);
});

test('"evento não encontrado" não repete o título e indica o próximo passo', async () => {
  const b = await browser({
    path: '/e/sumiu',
    routes: url => url === '/api/events/sumiu' ? jsonResponse({ code: 'not_found', error: 'Evento não encontrado.' }, { ok: false, status: 404 }) : null
  });
  assert.equal(b.element('accessTitle').textContent, 'Evento não encontrado');
  assert.doesNotMatch(b.element('accessMessage').textContent, /Evento não encontrado/);
  assert.match(b.element('accessMessage').textContent, /Confira o link/);
  assert.equal(b.element('accessHistoryLink').hidden, false, 'logado: atalho pra Meus eventos');
});

test('sem rótulos "Captura ·", sem estilo inline no carregando e fundo sem repetição', async () => {
  const html = await read('public/index.html');
  assert.equal(html.includes('Captura ·'), false);
  assert.doesNotMatch(html, /id="loadingView">\s*<div style=/);
  assert.match(html, /<div class="import-card vf-frame">/);
  const css = await read('public/styles.css');
  assert.match(css, /transparent 60%\) no-repeat/);
  assert.match(css, /html\{scroll-behavior:smooth; background:var\(--bg\);\}/);
});
