// Checklist ao vivo no celular: card com status no topo, menu "Mais",
// "só pendentes", "próxima cena" e prévia das observações. Executa o
// public/app.js real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, jsonResponse } from './app-harness.js';

const TOKEN = 'T'.repeat(32);
const event = (extra = {}) => ({
  id: 'ev1', owner_id: 'owner', event_title: 'Casamento Ana', event_date: '2026-10-10T16:00',
  event_location: 'Villa Verde', notes: 'Sem flash na igreja.\nChegar 14h.',
  phases: [{ key: 'p1', label: 'Making of', icon: 'film' }, { key: 'p2', label: 'Cerimônia', icon: 'heart' }],
  scenes: [
    { id: 's1', phase: 'p1', title: 'Vestido', formato: 'Reels', capture: ['Detalhe da renda'], speech: '', can: [], cannot: [] },
    { id: 's2', phase: 'p2', title: 'Entrada', formato: 'Story', capture: ['Noiva'], speech: 'Que emoção!', can: ['Celular'], cannot: ['Flash'] },
    { id: 's3', phase: 'p2', title: 'Votos', formato: 'Story', capture: [], speech: '', can: [], cannot: ['Falar alto'] }
  ],
  missions: [], revision: 1,
  progress: { recorded: { s1: { status: 'feito', feitoAt: '2026-10-10T15:00:00.000Z' } }, missionsDone: {} },
  access: { role: 'owner', basis: 'team', can_write_progress: true, share_mode: 'collab' },
  ...extra
});

const live = (opts = {}) => browser({
  path: '/e/ev1',
  routes: url => (url === '/api/events/ev1' ? jsonResponse(event(opts.extra)) : null),
  ...opts
});

const statusClick = (b, id, status) => b.clickAction({ id, status }, {}, '.status-btn');

test('card começa pelo status; fala e regras ficam recolhidas', async () => {
  const b = await live();
  const html = b.element('phasesContainer').innerHTML;
  const card = html.slice(html.indexOf('id="card-s2"'));
  assert.ok(card.indexOf('status-btn-group') < card.indexOf('capture-list'), 'status antes do que capturar');
  assert.match(card, /<details class="card-details"><summary>Fala sugerida e regras<\/summary>/);
  assert.match(html, /<p class="card-meta">Cena 01\/03 · Reels<\/p>/);
  assert.match(html, /<summary>Regras: pode e não pode<\/summary>/, 'só regras');
  assert.doesNotMatch(html, /time-row|Momento do evento/);
  assert.match(html, /<h2 class="phase-name" id="phase-title-p1" tabindex="-1">Making of<\/h2>/);
  const s1 = html.slice(html.indexOf('id="card-s1"'), html.indexOf('id="card-s2"'));
  assert.doesNotMatch(s1, /card-details/, 'sem fala nem regras, sem bloco recolhido');
});

test('começo da página mostra data, local e prévia das observações', async () => {
  const b = await live();
  assert.equal(b.element('eventSub').textContent, '10/10 às 16:00 · Villa Verde');
  assert.equal(b.element('notesPreview').hidden, false);
  assert.equal(b.element('notesPreviewText').textContent, 'Sem flash na igreja. Chegar 14h.');
});

test('sem observações, sem prévia; sem data e local, mostra o tamanho do roteiro', async () => {
  const b = await live({ extra: { notes: '', event_date: '', event_location: '' } });
  assert.equal(b.element('notesPreview').hidden, true);
  assert.equal(b.element('eventSub').textContent, '3 cenas em 2 fases');
});

test('"só pendentes" esconde capturadas, marca fase concluída e é lembrado no aparelho', async () => {
  const b = await live();
  await b.click('pendingFilterBtn');
  assert.equal(b.element('pendingFilterBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(b.element('appView').classList.contains('pending-only'), true);
  assert.equal(b.element('card-s1').classList.contains('is-filtered'), true);
  assert.equal(b.element('card-s2').classList.contains('is-filtered'), false);
  assert.equal(b.element('p1').classList.contains('is-complete'), true);
  assert.equal(b.element('p2').classList.contains('is-complete'), false);
  assert.equal(b.storage.get('captura_pending_only:/e/ev1'), '1');

  const again = await live({ storage: { 'captura_pending_only:/e/ev1': '1' } });
  assert.equal(again.element('card-s1').classList.contains('is-filtered'), true, 'reabrir mantém o filtro');
});

test('cena marcada com o filtro ligado fica à vista até tocar em "Próxima"', async () => {
  const b = await live({ storage: { 'captura_pending_only:/e/ev1': '1' } });
  await statusClick(b, 's2', 'feito');
  assert.equal(b.element('card-s2').classList.contains('is-done'), true);
  assert.equal(b.element('card-s2').classList.contains('is-filtered'), false, 'não some debaixo do dedo');
  await b.click('nextSceneBtn');
  assert.equal(b.element('card-s2').classList.contains('is-filtered'), true);
  assert.equal(b.element('card-s3').classList.contains('is-highlight'), true, 'foi pra próxima pendente');
});

test('voltar uma cena pra pendente faz ela reaparecer na hora', async () => {
  const b = await live({ storage: { 'captura_pending_only:/e/ev1': '1' } });
  await statusClick(b, 's1', 'nao_iniciado');
  assert.equal(b.element('card-s1').classList.contains('is-filtered'), false);
  assert.equal(b.element('p1').classList.contains('is-complete'), false);
});

test('"Próxima" some quando não falta nada; com o filtro, aparece o aviso de vazio', async () => {
  const b = await live({ storage: { 'captura_pending_only:/e/ev1': '1' } });
  assert.equal(b.element('nextSceneBtn').hidden, false);
  await statusClick(b, 's2', 'feito');
  await statusClick(b, 's3', 'postado');
  assert.equal(b.element('nextSceneBtn').hidden, true);
  await b.click('pendingFilterBtn');
  await b.click('pendingFilterBtn');
  assert.equal(b.element('pendingEmpty').hidden, false);
});

test('menu "Mais" abre, fecha ao escolher uma ação e com Esc', async () => {
  const b = await live();
  const menu = b.element('moreMenu');
  await b.click('moreMenuBtn');
  assert.equal(menu.hidden, false);
  assert.equal(b.element('moreMenuBtn').getAttribute('aria-expanded'), 'true');
  const item = { closest: sel => (sel === '.menu-item' ? {} : null) };
  menu.handlers.click({ target: item });
  assert.equal(menu.hidden, true);
  assert.equal(b.element('moreMenuBtn').getAttribute('aria-expanded'), 'false');

  await b.click('moreMenuBtn');
  await b.documentEvent('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
});

test('quem não pode reiniciar não vê "Reiniciar" no menu', async () => {
  const b = await live({ extra: { access: { role: 'member', basis: 'team', can_write_progress: true, share_mode: 'collab' } } });
  assert.equal(b.element('resetBtn').hidden, true);
});

test('depois de publicar, o link pra equipe aparece no resumo', async () => {
  const b = await browser({
    path: '/',
    routes: (url, options) => (url === '/api/events' && options.method === 'POST'
      ? jsonResponse({ id: 'novo', revision: 1, share: { share_mode: 'collab', share_path: '/s/' + TOKEN }, members: null })
      : null)
  });
  b.element('roteiroInput').value = 'Roteiro de um evento totalmente novo para gerar.';
  await b.click('generateBtn');
  await b.click('publishBtn');
  assert.equal(b.element('publishSummary').hidden, false);
  assert.equal(b.element('publishShare').hidden, false);
  assert.equal(b.element('publishSummaryTitle').textContent, 'Evento publicado');
  assert.equal(b.element('publishShareInput').value, 'https://captura.example/s/' + TOKEN);
});
