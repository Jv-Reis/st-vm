// Tela de criar/editar em seções recolhíveis: padrões de abertura, resumos,
// cenas recolhidas e grade de ícones. Executa o public/app.js real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser } from './app-harness.js';

const existing = {
  owner_id: 'owner', event_title: 'Casamento Ana', event_date: '2026-10-10T10:00',
  event_end_date: '2026-10-10T18:00', event_location: 'Salão Jardim', notes: '',
  member_emails: ['equipe@example.com'], calendar_guests: ['convidado@example.com'],
  allow_member_edit: false, drive_folder_id: 'drive-1', drive_folders: ['Cerimônia'],
  phases: [{ key: 'p1', label: 'Cerimônia', icon: 'heart' }],
  scenes: [{ id: 'c1', phase: 'p1', title: 'Entrada', icon: 'pin', formato: 'Reels', capture: ['Noiva', 'Pais'], speech: '', can: [], cannot: [] }],
  missions: [], revision: 2,
  access: { role: 'owner', basis: 'team', can_write_progress: true, share_mode: 'view' }
};

const editPage = () => browser({
  path: '/e/existing/editar',
  routes: url => url === '/api/events/existing/share'
    ? { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ share_mode: 'view', share_path: '/s/' + 'T'.repeat(32) }) }
    : null,
  event: existing
});

test('reservar uma data: só Evento aberto, Roteiro vazio com convite pra adicionar', async () => {
  const b = await browser({ path: '/' });
  await b.click('quickCreateBtn');
  assert.equal(b.element('sectionEvent').open, true);
  assert.equal(b.element('sectionRoteiro').open, false);
  assert.equal(b.element('sectionTeam').open, false);
  assert.equal(b.element('sectionGoogle').open, false);
  assert.equal(b.element('roteiroEmpty').hidden, false);
  assert.equal(b.element('sectionEventSummary').textContent, 'Sem data e local');
  assert.equal(b.element('sectionRoteiroSummary').textContent, 'Sem roteiro ainda');
  assert.equal(b.element('sectionGoogleSummary').textContent, 'Nada configurado');
  assert.match(b.element('sectionTeamSummary').textContent, /^Nenhum membro · Link para colaborar$/);
});

test('editar evento com roteiro: Roteiro aberto, equipe e Google recolhidos com resumo', async () => {
  const b = await editPage();
  assert.equal(b.element('sectionRoteiro').open, true);
  assert.equal(b.element('sectionTeam').open, false);
  assert.equal(b.element('roteiroEmpty').hidden, true);
  assert.equal(b.element('sectionEventSummary').textContent, '10/10 às 10:00 · Salão Jardim');
  assert.equal(b.element('sectionRoteiroSummary').textContent, '1 fase · 1 cena');
  assert.equal(b.element('sectionTeamSummary').textContent, '1 membro · Link para visualizar');
  assert.equal(b.element('sectionGoogleSummary').textContent, '1 convidado · pasta criada no Drive');
});

test('cenas começam recolhidas mostrando título e quantidade de itens', async () => {
  const b = await editPage();
  const html = b.element('previewPhasesContainer').innerHTML;
  assert.match(html, /class="scene-toggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="scene-body-0" hidden/);
  assert.match(html, /scene-toggle-title" id="scene-title-0">Entrada</);
  assert.match(html, /Cena 1 · 2 itens de captura/);
});

test('ícones aparecem como grade com nomes em português, sem select em inglês', async () => {
  const b = await editPage();
  const html = b.element('previewPhasesContainer').innerHTML;
  assert.doesNotMatch(html, /<option value="pin"/);
  assert.match(html, /type="radio" name="edit-scene-0-icon" value="pin" data-scope="scene" data-idx="0" data-field="icon" checked/);
  assert.match(html, /<span class="sr-only">Momento especial<\/span>/);
  assert.match(html, /id="edit-scene-0-icon-name">Local</);
  assert.match(html, /id="edit-phase-0-icon-name">Momento especial</);
  assert.match(html, /<legend class="sr-only">Ícone da cena<\/legend>/);
});

test('trocar ícone e título atualiza o rascunho, a linha da cena e o que é salvo', async () => {
  const b = await editPage();
  const change = b.element('previewPhasesContainer').handlers.change;
  change({ target: { dataset: { scope: 'scene', idx: '0', field: 'icon' }, value: 'heart' } });
  change({ target: { dataset: { scope: 'scene', idx: '0', field: 'title' }, value: 'Entrada da noiva' } });
  change({ target: { dataset: { scope: 'phase', idx: '0', field: 'icon' }, value: 'cup' } });
  assert.equal(b.element('edit-scene-0-icon-name').textContent, 'Momento especial');
  assert.equal(b.element('edit-phase-0-icon-name').textContent, 'Brinde');
  assert.equal(b.element('scene-title-0').textContent, 'Entrada da noiva');
  await b.click('publishBtn');
  const body = JSON.parse(b.calls.find(c => c.method === 'PATCH').body);
  assert.equal(body.scenes[0].icon, 'heart');
  assert.equal(body.scenes[0].title, 'Entrada da noiva');
  assert.equal(body.phases[0].icon, 'cup');
});

test('término antes do início abre a seção Evento pra mostrar o aviso', async () => {
  const b = await editPage();
  b.element('sectionEvent').open = false;
  b.element('previewEventDate').value = '2026-10-10T18:00';
  b.element('previewEventEndDate').value = '2026-10-10T10:00';
  b.element('previewEventEndDate').handlers.input({ target: b.element('previewEventEndDate') });
  assert.equal(b.element('eventDateWarning').hidden, false);
  assert.equal(b.element('sectionEvent').open, true);
});

test('cena nova entra aberta; abrir/fechar uma cena não re-renderiza a lista', async () => {
  const b = await editPage();
  await b.clickAction({ action: 'add-scene', phaseIdx: '0' });
  const html = b.element('previewPhasesContainer').innerHTML;
  assert.match(html, /preview-scene-card is-open[\s\S]*Nova cena/);
  assert.match(html, /id="scene-body-1">/, 'corpo da cena nova sem hidden');
  assert.match(html, /id="scene-body-0" hidden/, 'as outras continuam recolhidas');

  const before = b.element('previewPhasesContainer').innerHTML;
  const attrs = await b.clickAction({ action: 'toggle-scene', sceneId: 'c1' }, { 'aria-controls': 'scene-body-0', 'aria-expanded': 'false' });
  assert.equal(attrs['aria-expanded'], 'true');
  assert.equal(b.element('scene-body-0').hidden, false);
  assert.equal(b.element('previewPhasesContainer').innerHTML, before);
});

test('cena ou seção aberta continua aberta depois de re-render (adicionar fase)', async () => {
  const b = await editPage();
  await b.clickAction({ action: 'toggle-scene', sceneId: 'c1' }, { 'aria-controls': 'scene-body-0', 'aria-expanded': 'false' });
  await b.click('addPhaseBtn');
  assert.match(b.element('previewPhasesContainer').innerHTML, /aria-expanded="true"/);
  b.element('sectionTeam').open = true;
  await b.click('addPhaseBtn');
  assert.equal(b.element('sectionTeam').open, true, 're-render não fecha o que a pessoa abriu');
});
