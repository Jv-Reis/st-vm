// Dois caches: o do app (versionado, trocado a cada deploy) e o de dados
// (configuração e eventos abertos), que sobrevive às atualizações do app —
// assim atualizar o CAPTURA não apaga os eventos disponíveis offline.
const SHELL_CACHE = 'captura-shell-v16';
const DATA_CACHE = 'captura-data-v1';
const APP_SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/roteiro-draft.js',
  '/event-diff.js',
  '/progress-time.js',
  '/checklist-nav.js',
  '/vendor/supabase.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

function isEventDataPath(pathname) {
  return /^\/api\/events\/[^/]+$/.test(pathname) || /^\/api\/share\/[^/]+$/.test(pathname);
}

// Caches antigos (antes da separação guardavam app + eventos juntos): os
// eventos e a configuração são copiados pro cache de dados antes de apagar.
async function migrateOldCache(name) {
  if (!name.startsWith('captura-v')) return;
  const [oldCache, dataCache] = await Promise.all([caches.open(name), caches.open(DATA_CACHE)]);
  for (const request of await oldCache.keys()) {
    const path = new URL(request.url).pathname;
    if (path !== '/api/config' && !isEventDataPath(path)) continue;
    const response = await oldCache.match(request);
    if (response && response.ok) await dataCache.put(path, response);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name === SHELL_CACHE || name === DATA_CACHE) continue;
      try { await migrateOldCache(name); } catch (err) { /* segue apagando */ }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function isAppShellAsset(pathname) {
  return APP_SHELL.includes(pathname) || pathname.startsWith('/icons/');
}

function offlineResponse(message) {
  return new Response(JSON.stringify({ error: message, offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'X-Captura-Offline': '1' }
  });
}

function isValidConfig(cfg) {
  return !!cfg && typeof cfg.supabaseUrl === 'string' && /^https?:\/\//.test(cfg.supabaseUrl)
    && typeof cfg.supabaseAnonKey === 'string' && cfg.supabaseAnonKey.length > 0;
}

// Configuração: responde na hora com a última versão válida e atualiza em
// segundo plano. Resposta inválida (chave ausente, erro do servidor) nunca
// substitui a que funcionava.
function configResponse(event) {
  return (async () => {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match('/api/config');
    const network = fetch(event.request).then(async (res) => {
      if (res.ok) {
        const body = await res.clone().json().catch(() => null);
        if (isValidConfig(body)) await cache.put('/api/config', res.clone());
      }
      return res;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try {
      return await network;
    } catch (err) {
      return offlineResponse('Sem conexão com a internet.');
    }
  })();
}

// Evento (por ID ou por link): rede primeiro, cache quando offline. Se o
// servidor disser que o acesso acabou (link revogado, evento excluído,
// restrito à equipe), a cópia local também é apagada.
function eventDataResponse(event) {
  return (async () => {
    const cache = await caches.open(DATA_CACHE);
    const key = new URL(event.request.url).pathname;
    try {
      const res = await fetch(event.request);
      if (res.ok) await cache.put(key, res.clone());
      else if ([403, 404, 410].includes(res.status)) await cache.delete(key);
      else if (res.status >= 500) {
        const cached = await cache.match(key);
        if (cached) return cached;
      }
      return res;
    } catch (err) {
      const cached = await cache.match(key);
      return cached || offlineResponse('Sem conexão e esse evento ainda não foi aberto neste aparelho.');
    }
  })();
}

// App: cache primeiro, atualização em segundo plano (stale-while-revalidate).
function shellResponse(event, request) {
  return (async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca intercepta escrita (progresso, salvar, permissões)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // stream de progresso em tempo real (SSE) — nunca cachear/interceptar
  if (url.pathname.endsWith('/stream')) return;

  if (req.mode === 'navigate') {
    // Só as rotas da SPA recebem o casco em cache. Navegação pra /api/ (ex:
    // retorno do OAuth do Google) e páginas estáticas próprias
    // (ex: /privacidade.html) precisam chegar de verdade no servidor.
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.html') && url.pathname !== '/index.html') return;
    event.respondWith(shellResponse(event, new Request('/')));
    return;
  }
  if (url.pathname === '/api/config') {
    event.respondWith(configResponse(event));
    return;
  }
  if (isAppShellAsset(url.pathname)) {
    event.respondWith(shellResponse(event, req));
    return;
  }
  if (isEventDataPath(url.pathname)) {
    event.respondWith(eventDataResponse(event));
    return;
  }
  // qualquer outra rota (histórico, convites, compartilhamento...) — direto pra rede
});
