// Executa o app real (public/app.js) com DOM, autenticação e HTTP simulados.
// Não acessa contas, IA nem Calendar. Os testes acionam os mesmos handlers
// dos botões da página.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { mergeGeneratedRoteiro, hasRoteiro } from '../public/roteiro-draft.js';
import { diffEventDrafts, draftToText } from '../public/event-diff.js';
import { nowStamp, formatStamp, formatStampFull, formatDelay, isLegacyStamp } from '../public/progress-time.js';
import { isPendingStatus, countPending, nextPendingId } from '../public/checklist-nav.js';

export const VALID_CONFIG = { supabaseUrl: 'https://captura-test.supabase.co', supabaseAnonKey: 'anon-test-key' };

function jsonResponse(data, { ok = true, status = ok ? 200 : 400, headers = {} } = {}) {
  return { ok, status, headers: { get: k => headers[k] ?? null }, json: async () => data };
}
export { jsonResponse };

// routes(url, options, calls) pode devolver uma resposta pra sobrescrever o padrão.
export async function browser({
  event, path = '/', parse, confirm = true, pending, storage: initialStorage = {},
  session = { user: { id: 'owner', email: 'dono@example.com' }, access_token: 'test' },
  config = VALID_CONFIG, routes, caches, supabaseGlobal = true, generated, online = true
} = {}) {
  const elements = new Map(), calls = [], alerts = [], confirmations = [], clipboard = [], streams = [], documentHandlers = {};
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
      id, value: '', hidden: false, disabled: false, checked: false, readOnly: false, innerHTML: '', textContent: '', style: {}, dataset: {}, handlers: {}, attrs: {},
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle(c, force) { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; },
        contains: c => classes.has(c)
      },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
      querySelectorAll() { return []; }, focus() {}, replaceChildren() {}, select() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; }
      });
    }
    return elements.get(id);
  }
  const storage = new Map(Object.entries(initialStorage));
  if (pending) storage.set('captura_pending_roteiro', JSON.stringify(pending));
  const location = { pathname: path, search: '', origin: 'https://captura.example' };
  const sessionState = { current: session };
  const context = {
    mergeGeneratedRoteiro: (existing, result) => mergeGeneratedRoteiro(existing, result, () => webcrypto.randomUUID()),
    hasRoteiro, diffEventDrafts, draftToText,
    nowStamp, formatStamp, formatStampFull, formatDelay, isLegacyStamp,
    isPendingStatus, countPending, nextPendingId,
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, addEventListener(type, fn) { (documentHandlers[type] ||= []).push(fn); }, activeElement: null, visibilityState: 'visible' },
    window: { location, addEventListener() {}, scrollTo() {} },
    navigator: { onLine: online, clipboard: { writeText: async text => { clipboard.push(text); } } },
    history: { pushState(a, b, url) { location.pathname = url; }, replaceState(a, b, url) { location.pathname = url; } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    supabase: supabaseGlobal ? { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: sessionState.current } }),
      onAuthStateChange() {}, signOut: async () => {}, signInWithOtp: async () => ({ error: null })
    } }) } : undefined,
    fetch: async (url, options = {}) => {
      calls.push({ url, ...options });
      if (routes) {
        const custom = await routes(url, options, calls);
        if (custom) return custom;
      }
      if (url === '/api/config') return jsonResponse(config);
      if (url === '/api/parse-roteiro') return parse ? parse(options) : jsonResponse(generated || {
        event_title: 'Título da IA', phases: [{ key: 'p1', label: 'Cerimônia' }],
        scenes: [{ id: 'c1', phase: 'p1', title: 'Entrada' }], missions: []
      });
      if (event && url === '/api/events/existing' && !options.method) return jsonResponse(event);
      if (options.method === 'PATCH' || options.method === 'POST') return jsonResponse({ id: 'created', revision: 2 });
      return jsonResponse({});
    },
    alert: text => alerts.push(text), confirm: text => { confirmations.push(text); return confirm; },
    URLSearchParams, AbortController, console, setInterval() {}, clearInterval() {}, clearTimeout,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; },
    EventSource: class { constructor(url) { this.url = url; this.readyState = 0; streams.push(this); } close() {} }
  };
  if (caches) context.caches = caches;
  const code = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(code, context);
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return {
    element, calls, alerts, confirmations, clipboard, location, settle, storage, sessionState, streams, navigator: context.navigator,
    click: async id => { await element(id).handlers.click({ target: element(id), preventDefault() {} }); await settle(); },
    // clique delegado no document (botões gerados com data-action)
    clickAction: async (dataset, extra = {}, selector = '[data-action]') => {
      const button = { dataset, getAttribute: k => extra[k] ?? null, setAttribute(k, v) { extra[k] = v; }, closest: () => null, focus() {} };
      const target = { closest: sel => (sel === selector ? button : null) };
      for (const fn of documentHandlers.click || []) await fn({ target, preventDefault() {} });
      await settle();
      return extra;
    },
    documentEvent: async (type, event) => {
      for (const fn of documentHandlers[type] || []) await fn(event);
      await settle();
    }
  };
}
