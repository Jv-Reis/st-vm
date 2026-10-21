import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { legacyHostAction, RETIRE_SW_SCRIPT } from '../lib/legacy-host.js';

const APP = 'https://app.captura-checklist.com.br';
const OLD = 'captura-checklist.onrender.com';
const act = (over) => legacyHostAction({ host: OLD, path: '/', method: 'GET', appBaseUrl: APP, ...over });

test('páginas do endereço antigo vão para o domínio novo com o mesmo caminho', () => {
  assert.deepEqual(act(), { action: 'redirect', location: APP + '/' });
  assert.deepEqual(act({ path: '/e/76d1d688' }), { action: 'redirect', location: APP + '/e/76d1d688' });
  assert.deepEqual(act({ path: '/s/' + 'T'.repeat(32) }), { action: 'redirect', location: APP + '/s/' + 'T'.repeat(32) });
  assert.deepEqual(act({ path: '/privacidade.html', method: 'HEAD' }), { action: 'redirect', location: APP + '/privacidade.html' });
  assert.deepEqual(act({ host: OLD + ':443' }), { action: 'redirect', location: APP + '/' });
});

test('API continua no endereço antigo (fila offline de apps antigos e retorno do Google)', () => {
  assert.equal(act({ path: '/api/events/ev1/progress', method: 'POST' }), null);
  assert.equal(act({ path: '/api/config' }), null);
  assert.equal(act({ path: '/api/google/oauth/callback' }), null);
  assert.equal(act({ path: '/apiary' }).action, 'redirect', 'só o prefixo /api/ exato');
});

test('service worker antigo é trocado pelo de despedida', () => {
  assert.deepEqual(act({ path: '/sw.js' }), { action: 'retire-sw' });
});

test('não age no domínio novo, em localhost nem sem APP_BASE_URL', () => {
  assert.equal(act({ host: 'app.captura-checklist.com.br' }), null);
  assert.equal(act({ host: 'localhost' }), null);
  assert.equal(act({ appBaseUrl: '' }), null);
  assert.equal(act({ appBaseUrl: 'não é url' }), null);
  assert.equal(act({ appBaseUrl: 'https://' + OLD }), null, 'APP_BASE_URL apontando pro próprio onrender não cria laço');
});

test('host antigo informado pelo Render também conta, mesmo fora de onrender.com', () => {
  assert.deepEqual(act({ host: 'antigo.exemplo.com', legacyHosts: ['antigo.exemplo.com'] }), { action: 'redirect', location: APP + '/' });
  assert.equal(act({ host: 'outro.exemplo.com', legacyHosts: ['antigo.exemplo.com'] }), null);
});

test('service worker de despedida: apaga caches, se desinstala e recarrega as abas', async () => {
  const listeners = {};
  const deleted = [];
  const navigated = [];
  let unregistered = false;
  let skipped = false;
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { skipped = true; },
    registration: { unregister: async () => { unregistered = true; } },
    clients: { matchAll: async () => [{ url: 'https://' + OLD + '/e/1', navigate(u) { navigated.push(u); } }] }
  };
  const caches = { keys: async () => ['captura-shell-v18', 'captura-data-v1'], delete: async (k) => { deleted.push(k); } };
  vm.runInNewContext(RETIRE_SW_SCRIPT, { self, caches });
  listeners.install();
  let done;
  listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.equal(skipped, true);
  assert.deepEqual(deleted, ['captura-shell-v18', 'captura-data-v1']);
  assert.equal(unregistered, true);
  assert.deepEqual(navigated, ['https://' + OLD + '/e/1']);
});
