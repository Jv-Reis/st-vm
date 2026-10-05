// Acabamento da interface: "Minha conta", estado do Google na edição,
// título do evento, aviso que não bloqueia toques e varredura de emojis e
// travessões no texto visível.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browser, jsonResponse } from './app-harness.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('"Minha conta" mostra email, estado do Google e quem pode adicionar à agenda', async () => {
  const b = await browser({
    path: '/conta',
    routes: url => {
      if (url === '/api/google/status') return jsonResponse({ connected: true, email: 'dono@gmail.com' });
      if (url === '/api/google/permissions') return jsonResponse({ permissions: [{ organizer_id: 'u1', email: 'ana@example.com' }] });
      return null;
    }
  });
  assert.equal(b.element('accountView').hidden, false);
  assert.equal(b.element('accountEmail').textContent, 'dono@example.com');
  assert.equal(b.element('googleAccountStatus').textContent, 'Conectado como dono@gmail.com.');
  assert.match(b.element('googleCalendarConnectBtn').innerHTML, /Desconectar Google/);
  assert.equal(b.element('googleTestingNote').hidden, true, 'conectado: sem aviso de app não verificado');
  assert.match(b.element('calendarPermissionsList').innerHTML, /ana@example\.com/);
});

test('"Minha conta" sem login pede login e volta pra conta depois', async () => {
  const b = await browser({ path: '/conta', session: null });
  assert.equal(b.element('loginView').hidden, false);
  assert.equal(b.storage.get('captura_return_to'), '/conta');
});

test('edição mostra se o Google está conectado, com caminho pra conectar', async () => {
  const b = await browser({ path: '/' });
  await b.click('quickCreateBtn');
  const status = b.element('previewGoogleStatus');
  assert.equal(status.hidden, false);
  assert.match(status.innerHTML, /Google não conectado/);
  assert.match(status.innerHTML, /href="\/conta" target="_blank"/);
});

test('nome do evento é título (h1), não campo editável', async () => {
  const html = await read('public/index.html');
  assert.match(html, /<h1 class="event-title" id="eventTitle"><\/h1>/);
  assert.doesNotMatch(html, /id="eventTitle" type="text"/);
  for (const heading of ['Histórico de roteiros publicados', 'Quem pode editar este evento', 'Minha conta']) {
    assert.match(html, new RegExp('<h1 class="preview-heading">' + heading + '</h1>'));
  }
});

test('barra de progresso anima com transform, não com largura', async () => {
  const b = await browser({
    path: '/e/ev1',
    routes: url => url === '/api/events/ev1' ? jsonResponse({
      id: 'ev1', event_title: 'X', phases: [{ key: 'p', label: 'P' }],
      scenes: [{ id: 'a', phase: 'p', title: 'A' }, { id: 'b', phase: 'p', title: 'B' }], missions: [],
      progress: { recorded: { a: { status: 'feito', feitoAt: '2026-10-10T15:00:00.000Z' } }, missionsDone: {} },
      access: { role: 'owner', basis: 'team', can_write_progress: true, share_mode: 'collab' }
    }) : null
  });
  assert.equal(b.element('progressFill').style.transform, 'scaleX(0.5)');
  assert.equal(b.element('progressFill').style.width, undefined);
});

test('aviso flutuante deixa o toque passar; só o botão dele recebe', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.app-toast\{[^}]*pointer-events:none/);
  assert.match(css, /\.app-toast \.btn\{pointer-events:auto/);
  assert.doesNotMatch(css, /\.auth-strip\{position:sticky/, 'barra de login não fica fixa');
});

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2190}-\u{21FF}\u{2700}-\u{27BF}]/u;

test('sem emoji nem seta de texto na interface; sem travessão no texto visível', async () => {
  for (const file of ['public/index.html', 'public/privacidade.html']) {
    const text = await read(file);
    assert.equal(text.includes('—'), false, 'travessão em ' + file);
    const hit = text.split(/\r?\n/).find(line => EMOJI.test(line));
    assert.equal(hit, undefined, 'emoji em ' + file + ': ' + hit);
  }
  // app.js: ignora comentários; ✓ do relatório impresso e ✨ (emoji padrão
  // de missão, escolhido pelo usuário) são permitidos
  const lines = (await read('public/app.js')).split(/\r?\n/).filter(l => !l.trim().startsWith('//'));
  const dash = lines.find(l => l.includes('—'));
  assert.equal(dash, undefined, 'travessão em app.js: ' + dash);
  const emoji = lines.find(l => EMOJI.test(l.replace(/[✓✨]/g, '')));
  assert.equal(emoji, undefined, 'emoji em app.js: ' + emoji);
});
