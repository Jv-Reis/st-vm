import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { mergeGeneratedRoteiro, hasRoteiro } from '../public/roteiro-draft.js';

const reserved = {
  owner_id: 'owner', event_title: 'Evento reservado', event_date: '2026-10-10T10:00',
  event_end_date: '2026-10-10T18:00', event_location: 'Salão', notes: 'Chegar cedo',
  member_emails: ['equipe@example.com'], calendar_guests: ['convidado@example.com'],
  allow_member_edit: true, drive_folder_id: 'drive-existing', drive_folders: ['Originais'],
  phases: [], scenes: [], missions: []
};
const generated = {
  event_title: 'Título da IA', phases: [{ key: 'p1', label: 'Cerimônia' }],
  scenes: [{ id: 'c1', phase: 'p1', title: 'Entrada' }], missions: []
};

// Executa o app real com DOM, autenticação e HTTP simulados. Não acessa contas,
// IA ou Calendar. Os testes acionam os mesmos handlers dos botões da página.
async function browser({ event = reserved, path = '/e/existing/editar', parse, confirm = true, pending } = {}) {
  const elements = new Map(), calls = [], alerts = [], confirmations = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', style: {}, dataset: {}, handlers: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      querySelectorAll() { return []; }, setAttribute() {}, focus() {}, replaceChildren() {}, select() {}
    });
    return elements.get(id);
  }
  const storage = new Map();
  if(pending) storage.set('captura_pending_roteiro', JSON.stringify(pending));
  const location = { pathname: path, search: '', origin: 'https://captura.example' };
  const context = {
    mergeGeneratedRoteiro: (existing, result) => mergeGeneratedRoteiro(existing, result, () => webcrypto.randomUUID()), hasRoteiro,
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    window: { location, addEventListener() {}, scrollTo() {} },
    navigator: { onLine: true },
    history: { pushState(a,b,url) { location.pathname = url; }, replaceState(a,b,url) { location.pathname = url; } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' }, access_token: 'test' } } }), onAuthStateChange() {} } }) },
    fetch: async (url, options = {}) => {
      calls.push({ url, ...options });
      let data = {};
      if (url === '/api/config') data = { googleCalendarEnabled: true };
      else if (url === '/api/parse-roteiro') return parse ? parse(options) : { ok: true, json: async () => generated };
      else if (url === '/api/events/existing' && !options.method) data = event;
      else if (options.method === 'PATCH' || options.method === 'POST') data = { id: 'created' };
      return { ok: true, json: async () => data };
    },
    alert: text => alerts.push(text), confirm: text => { confirmations.push(text); return confirm; },
    URLSearchParams, AbortController, console, setInterval() {}, clearInterval() {}, setTimeout, clearTimeout,
    EventSource: class { close() {} }
  };
  const code = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/, '');
  vm.runInNewContext(code, context);
  const settle = async () => { for (let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return { element, calls, alerts, confirmations, location, settle,
    click: async id => { await element(id).handlers.click({ target: element(id), preventDefault() {} }); await settle(); }
  };
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
  for (const field of ['event_title','event_date','event_end_date','event_location','notes','member_emails','calendar_guests','allow_member_edit','drive_folder_id','drive_folders']) {
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
