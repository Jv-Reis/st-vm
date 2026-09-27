import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGeneratedRoteiro } from '../public/roteiro-draft.js';
import { browser as harness } from './app-harness.js';

const reserved = {
  owner_id: 'owner', event_title: 'Evento reservado', event_date: '2026-10-10T10:00',
  event_end_date: '2026-10-10T18:00', event_location: 'Salão', notes: 'Chegar cedo',
  member_emails: ['equipe@example.com'], calendar_guests: ['convidado@example.com'],
  allow_member_edit: true, drive_folder_id: 'drive-existing', drive_folders: ['Originais'],
  phases: [], scenes: [], missions: [], revision: 3
};
const generated = {
  event_title: 'Título da IA', phases: [{ key: 'p1', label: 'Cerimônia' }],
  scenes: [{ id: 'c1', phase: 'p1', title: 'Entrada' }], missions: []
};

async function browser({ event = reserved, path = '/e/existing/editar', ...rest } = {}) {
  return harness({ event, path, generated, ...rest });
}

test('Adicionar roteiro preserva dados, equipe, Drive e salva no mesmo evento', async () => {
  const b = await browser();
  assert.equal(b.element('previewBackBtn').textContent, 'Adicionar roteiro');
  await b.click('previewBackBtn');
  b.element('roteiroInput').value = 'Um roteiro de casamento com conteúdo suficiente.';
  await b.click('generateBtn');
  assert.equal(b.confirmations.length, 0);
  assert.equal(b.element('previewEventTitle').value, reserved.event_title);
  assert.equal(b.element('publishBtn').textContent, 'Salvar alterações');
  assert.equal(b.calls.some(c => c.method === 'PATCH'), false);
  await b.click('publishBtn');
  const save = b.calls.find(c => c.method === 'PATCH');
  assert.equal(save.url, '/api/events/existing');
  const payload = JSON.parse(save.body);
  assert.equal(payload.base_revision, 3);
  // Observações não alteradas não vão no save completo (não sobrescrevem notas de outro membro).
  assert.equal('notes' in payload, false);
  for (const field of ['event_title','event_date','event_end_date','event_location','member_emails','calendar_guests','allow_member_edit','drive_folder_id','drive_folders']) {
    assert.deepEqual(payload[field], reserved[field], field);
  }
  assert.equal(payload.scenes[0].title, 'Entrada');
  assert.equal(b.location.pathname, '/e/existing');
  assert.deepEqual(b.alerts, []);
});

test('Substituição avisa e não reutiliza IDs do progresso anterior', async () => {
  const b = await browser({ event: { ...reserved, ...generated } });
  assert.equal(b.element('previewBackBtn').textContent, 'Substituir roteiro');
  await b.click('previewBackBtn');
  b.element('roteiroInput').value = 'Novo roteiro com conteúdo suficiente para gerar.';
  await b.click('generateBtn');
  assert.match(b.confirmations[0], /progresso anterior/);
  await b.click('publishBtn');
  const payload = JSON.parse(b.calls.find(c => c.method === 'PATCH').body);
  assert.notEqual(payload.scenes[0].id, 'c1');
});

test('Recusar substituição não chama IA nem altera evento', async () => {
  const b = await browser({ event: { ...reserved, ...generated }, confirm: false });
  await b.click('previewBackBtn');
  b.element('roteiroInput').value = 'Outro roteiro com conteúdo suficiente para gerar.';
  await b.click('generateBtn');
  assert.equal(b.calls.some(c => c.url === '/api/parse-roteiro'), false);
  await b.click('cancelRoteiroBtn');
  assert.equal(b.element('previewView').hidden, false);
});

test('Falha da IA mantém texto e rascunho e permite tentar novamente', async () => {
  let attempts = 0;
  const b = await browser({ parse: async () => ++attempts === 1
    ? { ok: false, json: async () => ({ error: 'Falha temporária' }) }
    : { ok: true, json: async () => generated } });
  await b.click('previewBackBtn');
  const text = 'Roteiro com texto suficiente para uma nova tentativa.';
  b.element('roteiroInput').value = text;
  await b.click('generateBtn');
  assert.equal(b.element('roteiroInput').value, text);
  assert.equal(b.element('importError').textContent, 'Falha temporária');
  assert.equal(b.element('generateBtn').disabled, false);
  assert.equal(b.calls.some(c => c.method === 'PATCH'), false);
  await b.click('generateBtn');
  assert.equal(b.element('previewEventDate').value, reserved.event_date);
});

test('Cancelar durante geração ignora resposta tardia', async () => {
  let resolveResponse;
  const b = await browser({ parse: () => new Promise(resolve => { resolveResponse = resolve; }) });
  await b.click('previewBackBtn');
  b.element('roteiroInput').value = 'Roteiro de um evento com conteúdo para gerar.';
  const pending = b.click('generateBtn'); await b.settle();
  await b.click('cancelRoteiroBtn');
  resolveResponse({ ok: true, json: async () => generated });
  await pending;
  assert.equal(b.element('previewBackBtn').textContent, 'Adicionar roteiro');
  assert.equal(b.element('previewEventTitle').value, reserved.event_title);
});

test('Novo evento continua usando título da IA e POST', async () => {
  const b = await browser({ path: '/' });
  b.element('roteiroInput').value = 'Roteiro de um evento totalmente novo para gerar.';
  await b.click('generateBtn');
  assert.equal(b.element('previewEventTitle').value, generated.event_title);
  await b.click('publishBtn');
  assert.ok(b.calls.some(c => c.url === '/api/events' && c.method === 'POST'));
  assert.equal(b.calls.some(c => c.method === 'PATCH'), false);
});

test('Retorno do login recupera roteiro e vínculo com evento em edição', async () => {
  const b = await browser({ path: '/', pending: {
    text: 'Roteiro preservado durante o login para gerar depois.', draft: reserved, editingEventId: 'existing'
  } });
  assert.equal(b.element('previewEventDate').value, reserved.event_date);
  await b.click('publishBtn');
  assert.equal(b.calls.find(c => c.method === 'PATCH').url, '/api/events/existing');
});

test('Novo evento após editar não reaproveita ID nem metadados anteriores', async () => {
  const b = await browser();
  await b.click('previewBackBtn');
  await b.click('historyNewBtn');
  b.element('roteiroInput').value = 'Roteiro totalmente novo sem vínculo com a reserva.';
  await b.click('generateBtn');
  assert.equal(b.element('previewEventDate').value, '');
  await b.click('publishBtn');
  assert.ok(b.calls.some(c => c.url === '/api/events' && c.method === 'POST'));
});

test('Resposta inválida da IA não substitui o rascunho', async () => {
  const b = await browser({ parse: async () => ({ ok: true, json: async () => ({}) }) });
  await b.click('previewBackBtn');
  b.element('roteiroInput').value = 'Roteiro com conteúdo suficiente para gerar as cenas.';
  await b.click('generateBtn');
  assert.match(b.element('importError').textContent, /roteiro inválido/);
  await b.click('cancelRoteiroBtn');
  assert.equal(b.element('previewEventDate').value, reserved.event_date);
});

test('Merge mantém pasta vazia intencional e renova IDs de missões sem alterar entrada', () => {
  const old = { ...reserved, drive_folders: [] };
  const result = { ...generated, missions: [{ key: 'm1', items: [{ key: 'i1', text: 'Abraço' }] }] };
  const merged = mergeGeneratedRoteiro(old, result, () => 'fresh');
  assert.deepEqual(merged.drive_folders, []);
  assert.equal(merged.missions[0].key, 'missao_fresh');
  assert.equal(merged.missions[0].items[0].key, 'item_fresh');
  assert.equal(result.missions[0].key, 'm1');
  assert.deepEqual(old.scenes, []);
});


test('Títulos e ações acompanham reserva, edição e geração', async () => {
  const fresh = await browser({ path: '/' });
  await fresh.click('quickCreateBtn');
  assert.equal(fresh.element('previewHeading').textContent, 'Reserve a data do evento');
  assert.equal(fresh.element('publishBtn').textContent, 'Criar evento');
  const edit = await browser();
  assert.equal(edit.element('previewHeading').textContent, 'Atualize os dados do evento');
  assert.equal(edit.element('publishBtn').textContent, 'Salvar alterações');
  await edit.click('previewBackBtn');
  edit.element('roteiroInput').value = 'Um roteiro completo para gerar as cenas do evento.';
  await edit.click('generateBtn');
  assert.equal(edit.element('previewHeading').textContent, 'Revise o roteiro antes de salvar');
  const existing = await browser({ event: { ...reserved, ...generated } });
  assert.equal(existing.element('previewHeading').textContent, 'Edite os dados e o roteiro');
  const create = await browser({ path: '/' });
  create.element('roteiroInput').value = 'Um roteiro completo para gerar um evento novo.';
  await create.click('generateBtn');
  assert.equal(create.element('previewHeading').textContent, 'Revise o roteiro antes de publicar');
  assert.equal(create.element('publishBtn').textContent, 'Publicar checklist');
});
