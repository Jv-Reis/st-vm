// Fluxos novos do app (abertura resiliente, links, somente leitura, conflito
// de edição e resumo de convites), executando o public/app.js real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, jsonResponse } from './app-harness.js';

const TOKEN = 'T'.repeat(32);
const eventData = (extra = {}) => ({
  id: 'ev1', owner_id: 'owner', event_title: 'Casamento Ana', event_date: '2026-10-10T10:00',
  phases: [{ key: 'p1', label: 'Cerimônia' }], scenes: [{ id: 'c1', phase: 'p1', title: 'Entrada' }], missions: [],
  revision: 4, notes: 'nota', member_emails: [], ...extra
});
const fakeCaches = cached => ({ match: async url => (cached.includes(url) ? { ok: true } : undefined) });
const offlineStorage = { captura_offline_events: JSON.stringify([
  { path: '/s/' + TOKEN, title: 'Casamento Ana', at: 1 },
  { path: '/e/sem-cache', title: 'Sem cópia', at: 0 }
]) };

test('offline sem configuração: tela de erro com eventos salvos, nunca "Carregando…"', async () => {
  let online = false;
  const b = await browser({
    online: false, storage: offlineStorage, caches: fakeCaches(['/api/share/' + TOKEN]),
    routes: url => {
      if (url === '/api/config') return online ? null : Promise.reject(new TypeError('Failed to fetch'));
      if (url === '/api/share/' + TOKEN) return jsonResponse(eventData({ access: { role: null, basis: 'link', can_write_progress: true, share_mode: 'collab' } }));
    }
  });
  assert.equal(b.element('initErrorView').hidden, false);
  assert.equal(b.element('loadingView').hidden, true);
  assert.match(b.element('initErrorMessage').textContent, /eventos que já abriu/);
  assert.equal(b.element('initOfflineBtn').hidden, false);
  const list = b.element('initOfflineList').innerHTML;
  assert.match(list, /Casamento Ana/);
  assert.doesNotMatch(list, /Sem cópia/, 'só lista o que está em cache');

  await b.click('initOfflineBtn');
  assert.equal(b.element('initOfflineList').hidden, false);
  const button = { dataset: { offlinePath: '/s/' + TOKEN } };
  b.element('initOfflineList').handlers.click({ target: { closest: () => button } });
  await b.settle();
  assert.equal(b.location.pathname, '/s/' + TOKEN);
  assert.equal(b.element('appView').hidden, false, 'abre o evento salvo mesmo sem o cliente de login');
  assert.equal(b.element('eventTitle').textContent, 'Casamento Ana');
});

test('primeiro acesso offline explica que precisa de internet e "Tentar novamente" recupera', async () => {
  let online = false;
  const b = await browser({
    online: false,
    routes: url => (url === '/api/config' && !online ? Promise.reject(new TypeError('Failed to fetch')) : null)
  });
  assert.equal(b.element('initErrorView').hidden, false);
  assert.match(b.element('initErrorMessage').textContent, /primeira vez/);
  assert.equal(b.element('initOfflineBtn').hidden, true);
  online = true;
  await b.click('initRetryBtn');
  assert.equal(b.element('initErrorView').hidden, true);
  assert.equal(b.element('importView').hidden, false);
});

test('resposta offline do service worker conta como sem conexão', async () => {
  const b = await browser({
    routes: url => url === '/api/config' ? jsonResponse({ error: 'offline' }, { ok: false, status: 503, headers: { 'X-Captura-Offline': '1' } }) : null
  });
  assert.equal(b.element('initErrorView').hidden, false);
  assert.match(b.element('initErrorMessage').textContent, /Sem conexão/);
});

test('configuração inválida é problema do servidor, não conexão', async () => {
  const b = await browser({ config: { supabaseUrl: '' }, storage: offlineStorage, caches: fakeCaches(['/api/share/' + TOKEN]) });
  assert.equal(b.element('initErrorView').hidden, false);
  assert.match(b.element('initErrorTitle').textContent, /configuração/);
  assert.match(b.element('initErrorMessage').textContent, /não é problema da sua conexão/);
  assert.equal(b.element('initOfflineBtn').hidden, true);
});

test('erro do servidor mostra o código e permite tentar de novo', async () => {
  const b = await browser({ routes: url => url === '/api/config' ? jsonResponse({}, { ok: false, status: 500 }) : null });
  assert.match(b.element('initErrorMessage').textContent, /erro 500/);
});

test('link desativado/substituído mostra aviso claro e esquece a cópia offline', async () => {
  const b = await browser({
    path: '/s/' + TOKEN, storage: offlineStorage,
    routes: url => url === '/api/share/' + TOKEN
      ? jsonResponse({ code: 'link_invalid', error: 'Este link foi desativado ou substituído.' }, { ok: false, status: 404 }) : null
  });
  assert.equal(b.element('accessView').hidden, false);
  assert.equal(b.element('accessTitle').textContent, 'Este link não funciona mais');
  assert.equal(b.element('accessLoginBtn').hidden, true);
  assert.doesNotMatch(b.storage.get('captura_offline_events'), new RegExp('/s/' + TOKEN));
});

test('evento "Somente equipe" pede login a quem não está logado', async () => {
  const b = await browser({
    path: '/e/ev1', session: null,
    routes: url => url === '/api/events/ev1' ? jsonResponse({ code: 'team_only', login_required: true, error: 'Restrito' }, { ok: false, status: 403 }) : null
  });
  assert.equal(b.element('accessView').hidden, false);
  assert.equal(b.element('accessTitle').textContent, 'Este evento é restrito à equipe');
  assert.equal(b.element('accessLoginBtn').hidden, false);
  await b.click('accessLoginBtn');
  assert.equal(b.storage.get('captura_return_to'), '/e/ev1');
});

test('link para visualizar: somente leitura, sem enviar progresso', async () => {
  const b = await browser({
    path: '/s/' + TOKEN, session: null,
    routes: url => url === '/api/share/' + TOKEN
      ? jsonResponse(eventData({ access: { role: null, basis: 'link', can_write_progress: false, share_mode: 'view' } })) : null
  });
  assert.equal(b.element('appView').hidden, false);
  assert.equal(b.element('readonlyNotice').hidden, false, 'aviso visível de somente visualização');
  assert.equal(b.element('resetBtn').hidden, true);
  assert.equal(b.calls.some(c => /progress/.test(c.url) && c.method === 'POST'), false);
});

test('edição simultânea: 409 abre o conflito, bloqueia novo save e recarregar usa a versão atual', async () => {
  const current = eventData({ event_title: 'Título da outra pessoa', revision: 5 });
  let patches = 0;
  const b = await browser({
    path: '/e/ev1/editar',
    routes: (url, options) => {
      if (url === '/api/events/ev1' && !options.method) return jsonResponse(eventData({ access: { role: 'owner', basis: 'team', can_write_progress: true, share_mode: 'collab' } }));
      if (url === '/api/events/ev1/share') return jsonResponse({ share_mode: 'collab', share_path: '/s/' + TOKEN });
      if (url === '/api/events/ev1' && options.method === 'PATCH') {
        patches++;
        const body = JSON.parse(options.body);
        if (body.base_revision === 4) return jsonResponse({ code: 'conflict', error: 'Este evento foi alterado por outra pessoa.', current }, { ok: false, status: 409 });
        return jsonResponse({ id: 'ev1', revision: 6, members: null });
      }
    }
  });
  b.element('previewEventTitle').value = 'Meu título';
  await b.click('publishBtn');
  assert.equal(patches, 1);
  assert.equal(b.element('conflictPanel').hidden, false);
  assert.equal(b.element('previewView').hidden, false, 'continua na edição, nada perdido');
  assert.match(b.storage.get('captura_conflict_draft:ev1'), /Meu título/, 'rascunho guardado');

  await b.click('publishBtn');
  assert.equal(patches, 1, 'não sobrescreve enquanto o conflito está aberto');
  assert.match(b.alerts.at(-1), /alterado por outra pessoa/);

  await b.click('conflictCompareBtn');
  assert.match(b.element('conflictDiff').innerHTML, /Meu título/);
  assert.match(b.element('conflictDiff').innerHTML, /Título da outra pessoa/);

  await b.click('conflictCopyBtn');
  assert.match(b.clipboard[0], /Meu título/);

  await b.click('conflictReloadBtn');
  assert.equal(b.element('conflictPanel').hidden, true);
  assert.equal(b.element('previewEventTitle').value, 'Título da outra pessoa');
  await b.click('publishBtn');
  assert.equal(patches, 2);
  const last = JSON.parse(b.calls.filter(c => c.method === 'PATCH').at(-1).body);
  assert.equal(last.base_revision, 5);
  assert.equal(b.location.pathname, '/e/ev1');
});

test('resumo pós-salvamento mostra adicionados, convites, inválidos e falhas; reenvia só falhas', async () => {
  const b = await browser({
    path: '/',
    routes: (url, options) => {
      if (url === '/api/events' && options.method === 'POST') return jsonResponse({
        id: 'novo', revision: 1, share: { share_mode: 'collab', share_path: '/s/' + TOKEN },
        members: { added: ['a@x.co'], invited: ['b@x.co', 'c@x.co'], existing: [], pending: [], invalid: ['ruim'], failed: [{ email: 'd@x.co', error: 'Limite de envio de emails atingido.' }], skipped: [] }
      });
      if (url === '/api/events/novo/invites/retry') return jsonResponse({ summary: { added: [], invited: ['d@x.co'], existing: [], pending: [], invalid: [], failed: [], skipped: [] } });
    }
  });
  b.element('roteiroInput').value = 'Roteiro de um evento totalmente novo para gerar.';
  await b.click('generateBtn');
  await b.click('publishBtn');
  assert.equal(b.element('publishSummary').hidden, false);
  const html = b.element('publishSummaryList').innerHTML;
  assert.match(html, /1 pessoa adicionada/);
  assert.match(html, /2 convites enviados/);
  assert.match(html, /ruim não pôde ser convidado: email inválido/);
  assert.match(html, /d@x\.co não pôde ser convidado: Limite de envio/);
  assert.equal(b.element('retryInvitesBtn').hidden, false);
  assert.equal(b.element('eventLinkInput').value, 'https://captura.example/s/' + TOKEN, 'link público usa o token, não o ID');

  await b.click('retryInvitesBtn');
  assert.ok(b.calls.some(c => c.url === '/api/events/novo/invites/retry' && c.method === 'POST'));
  assert.match(b.element('publishSummaryList').innerHTML, /1 convite enviado/);
  assert.equal(b.element('retryInvitesBtn').hidden, true);
});

test('aba antiga sem versão: 428 vira tela de conflito em vez de erro', async () => {
  const b = await browser({
    path: '/', pending: undefined,
    storage: { captura_pending_draft: JSON.stringify({ draft: eventData({ event_title: 'Rascunho antigo' }), editingEventId: 'ev1' }) },
    routes: (url, options) => {
      if (url === '/api/events/ev1' && options.method === 'PATCH') return jsonResponse({ code: 'revision_required', error: 'Recarregue' }, { ok: false, status: 428 });
      if (url === '/api/events/ev1') return jsonResponse(eventData({ revision: 9 }));
    }
  });
  await b.click('publishBtn');
  assert.equal(b.element('conflictPanel').hidden, false);
  assert.deepEqual(b.alerts, []);
});

// ---------- reiniciar o checklist ----------

const FEITO = '2026-10-12T21:00:00.000Z';
const progressData = (access) => eventData({
  id: 'ev1', access,
  missions: [{ key: 'm1', emoji: '', label: 'Flagras', items: [{ key: 'item_a', text: 'Choro' }] }],
  progress: {
    recorded: { c1: { status: 'feito', andamentoAt: null, feitoAt: FEITO, postadoAt: null } },
    missionsDone: { 'm1-item_a': true }
  }
});
const OWNER = { role: 'owner', basis: 'team', can_write_progress: true, share_mode: 'collab' };
const progressPosts = (b) => b.calls.filter(c => /\/progress$/.test(c.url) && c.method === 'POST').map(c => ({ url: c.url, body: JSON.parse(c.body) }));
const openEvent = (access, extra = {}) => browser({
  path: '/e/ev1',
  routes: (url, options) => (url === '/api/events/ev1' && !options.method ? jsonResponse(progressData(access)) : (extra.routes ? extra.routes(url, options) : null))
});

test('reiniciar: botão só pra dono e editor; membro sem edição e quem tem só o link não veem', async () => {
  for (const [access, visible] of [
    [OWNER, true],
    [{ ...OWNER, role: 'editor' }, true],
    [{ ...OWNER, role: 'member' }, false],
    [{ role: null, basis: 'link', can_write_progress: true, share_mode: 'collab' }, false]
  ]) {
    const b = await openEvent(access);
    assert.equal(b.element('resetBtn').hidden, !visible, 'role ' + access.role);
  }
});

test('reiniciar: um toque não apaga nada, só abre o diálogo dizendo o que será apagado', async () => {
  const b = await openEvent(OWNER);
  await b.click('resetBtn');
  assert.equal(b.element('resetDialog').open, true);
  assert.match(b.element('resetDialogText').textContent, /1 cena com progresso e 1 missão marcada/);
  assert.match(b.element('resetDialogText').textContent, /pra toda a equipe/);
  assert.deepEqual(progressPosts(b), [], 'nada foi enviado ainda');
  // o segundo toque não confirma mais nada: o botão do diálogo é outro
  await b.click('resetBtn');
  assert.deepEqual(progressPosts(b), []);
});

test('reiniciar: cancelar fecha o diálogo sem enviar nada', async () => {
  const b = await openEvent(OWNER);
  await b.click('resetBtn');
  await b.click('resetCancelBtn');
  assert.equal(b.element('resetDialog').open, false);
  assert.deepEqual(progressPosts(b), []);
});

test('reiniciar: confirmar envia o reinício pelo endereço do evento, com login, e oferece desfazer', async () => {
  const b = await openEvent(OWNER);
  await b.click('resetBtn');
  await b.click('resetConfirmBtn');
  const posts = progressPosts(b);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/events/ev1/progress');
  assert.deepEqual(posts[0].body, { action: 'reset', payload: {} });
  assert.equal(b.calls.find(c => /\/progress$/.test(c.url)).headers.Authorization, 'Bearer test');
  assert.equal(b.element('resetDialog').open, false);
  assert.equal(b.element('appToast').hidden, false);
  assert.match(b.element('appToastText').textContent, /Checklist reiniciado/);
  assert.equal(b.element('appToastAction').hidden, false);
  assert.equal(b.element('appToastAction').textContent, 'Desfazer');
});

test('reiniciar: desfazer reenvia as marcações com os horários originais', async () => {
  const b = await openEvent(OWNER);
  await b.click('resetBtn');
  await b.click('resetConfirmBtn');
  await b.click('appToastAction');
  const posts = progressPosts(b).slice(1);
  assert.deepEqual(posts.map(p => p.body.action).sort(), ['mission', 'status']);
  const status = posts.find(p => p.body.action === 'status').body.payload;
  assert.deepEqual(status, { sceneId: 'c1', status: 'feito', andamentoAt: null, feitoAt: FEITO, postadoAt: null });
  assert.deepEqual(posts.find(p => p.body.action === 'mission').body.payload, { cat: 'm1', itemKey: 'item_a' });
  assert.match(b.element('appToastText').textContent, /restaurado/);
});

test('reiniciar: o servidor recusou (403), nada é apagado e a mensagem do servidor aparece', async () => {
  const b = await openEvent(OWNER, {
    routes: (url, options) => (/\/progress$/.test(url) && options.method === 'POST'
      ? jsonResponse({ code: 'reset_forbidden', error: 'Só o dono e quem edita o evento podem reiniciar o checklist.' }, { ok: false, status: 403 })
      : null)
  });
  await b.click('resetBtn');
  await b.click('resetConfirmBtn');
  assert.match(b.element('appToastText').textContent, /Só o dono e quem edita/);
  assert.equal(b.element('appToastAction').hidden, true, 'sem "Desfazer": nada foi apagado');
  assert.equal(b.element('resetDialog').open, false);
});

test('reiniciar: sem internet não reinicia', async () => {
  const b = await openEvent(OWNER);
  b.navigator.onLine = false;
  await b.click('resetBtn');
  assert.equal(b.element('resetDialog').open, undefined, 'diálogo nem abre');
  assert.match(b.element('appToastText').textContent, /Sem conexão/);
  assert.deepEqual(progressPosts(b), []);
});

test('reiniciar: sem nada marcado, avisa em vez de abrir o diálogo', async () => {
  const b = await browser({
    path: '/e/ev1',
    routes: (url, options) => (url === '/api/events/ev1' && !options.method
      ? jsonResponse(eventData({ id: 'ev1', access: OWNER, progress: { recorded: {}, missionsDone: {} } })) : null)
  });
  await b.click('resetBtn');
  assert.equal(b.element('resetDialog').open, undefined);
  assert.match(b.element('appToastText').textContent, /nada marcado/);
});

test('reiniciar: a equipe vê um aviso quando outra pessoa reinicia, mas quem reiniciou vê só o próprio aviso', async () => {
  const b = await openEvent(OWNER);
  const message = { data: JSON.stringify({ action: 'reset', payload: {} }) };
  b.streams[0].onmessage(message);
  assert.match(b.element('appToastText').textContent, /reiniciado por alguém da equipe/);

  await b.click('resetBtn');
  await b.click('resetConfirmBtn');
  b.streams[0].onmessage(message); // o tempo real devolve o reinício de quem acabou de reiniciar
  assert.match(b.element('appToastText').textContent, /Checklist reiniciado\./);
  assert.doesNotMatch(b.element('appToastText').textContent, /alguém da equipe/);
});
