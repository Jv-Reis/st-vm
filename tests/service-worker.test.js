// Service worker (public/sw.js) num contexto simulado: caches em memória e
// rede controlada pelo teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ORIGIN = 'https://captura.example';
const VALID = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };

function memoryCaches() {
  const stores = new Map();
  const keyOf = req => typeof req === 'string' ? new URL(req, ORIGIN).pathname : new URL(req.url).pathname;
  function open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      match: async req => store.get(keyOf(req))?.clone(),
      put: async (req, res) => { store.set(keyOf(req), res); },
      delete: async req => store.delete(keyOf(req)),
      keys: async () => [...store.keys()].map(p => new Request(ORIGIN + p)),
      addAll: async () => {}
    };
  }
  return {
    stores,
    api: {
      open: async name => open(name),
      keys: async () => [...stores.keys()],
      delete: async name => stores.delete(name),
      match: async req => { for (const name of stores.keys()) { const r = await open(name).match(req); if (r) return r; } }
    }
  };
}

async function worker(network) {
  const listeners = {};
  const caches = memoryCaches();
  const context = {
    self: { addEventListener: (t, fn) => { listeners[t] = fn; }, location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: caches.api, fetch: async req => network(new URL(req.url).pathname, req),
    Response, Request, URL, JSON, Promise, console
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  async function get(path, init = {}) {
    let responded = null;
    const waits = [];
    listeners.fetch({ request: new Request(ORIGIN + path, init), respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
    const res = responded ? await responded : null;
    await Promise.all(waits);
    return res;
  }
  async function activate() {
    let done;
    listeners.activate({ waitUntil: p => { done = p; } });
    await done;
  }
  return { get, activate, caches };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('config: responde da cópia válida quando offline e revalida em segundo plano', async () => {
  let mode = 'ok';
  const sw = await worker(path => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'broken') return json({ supabaseUrl: '' });
    return json(VALID);
  });
  assert.deepEqual(await (await sw.get('/api/config')).json(), VALID);
  mode = 'broken';
  assert.deepEqual(await (await sw.get('/api/config')).json(), VALID, 'serve a cópia');
  mode = 'down';
  assert.deepEqual(await (await sw.get('/api/config')).json(), VALID, 'configuração quebrada não substituiu a válida');
});

test('config: primeiro acesso offline recebe 503 marcado como offline', async () => {
  const sw = await worker(() => { throw new TypeError('Failed to fetch'); });
  const res = await sw.get('/api/config');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('X-Captura-Offline'), '1');
});

test('evento: rede primeiro, cópia offline, e link revogado apaga a cópia', async () => {
  let mode = 'ok';
  const path = '/api/share/' + 'T'.repeat(32);
  const sw = await worker(() => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'revoked') return json({ code: 'link_invalid' }, 404);
    if (mode === 'error') return json({ error: 'x' }, 503);
    return json({ event_title: 'Casamento' });
  });
  assert.equal((await (await sw.get(path)).json()).event_title, 'Casamento');
  mode = 'down';
  assert.equal((await (await sw.get(path)).json()).event_title, 'Casamento');
  mode = 'error';
  assert.equal((await sw.get(path)).status, 200, 'erro do servidor usa a cópia');
  mode = 'revoked';
  assert.equal((await sw.get(path)).status, 404);
  mode = 'down';
  const after = await sw.get(path);
  assert.equal(after.status, 503, 'depois de revogado não abre mais offline');
  assert.equal(after.headers.get('X-Captura-Offline'), '1');
});

test('não intercepta escrita, stream nem outras rotas da API', async () => {
  const sw = await worker(() => json({}));
  assert.equal(await sw.get('/api/events/ev1/progress', { method: 'POST', body: '{}' }), null);
  assert.equal(await sw.get('/api/events/ev1/stream'), null);
  assert.equal(await sw.get('/api/share/abc/stream'), null);
  assert.equal(await sw.get('/api/events/ev1/invites'), null);
  assert.equal(await sw.get('/api/events/ev1/share'), null);
});

test('atualização do app preserva eventos e configuração do cache antigo', async () => {
  const sw = await worker(() => json({}));
  const old = await sw.caches.api.open('captura-v11');
  await old.put('/api/events/ev1', json({ event_title: 'Antigo' }));
  await old.put('/api/config', json(VALID));
  await old.put('/app.js', new Response('old'));
  await sw.activate();
  assert.equal(sw.caches.stores.has('captura-v11'), false);
  const data = sw.caches.stores.get('captura-data-v1');
  assert.ok(data.has('/api/events/ev1'));
  assert.ok(data.has('/api/config'));
  assert.equal(data.has('/app.js'), false);
});
