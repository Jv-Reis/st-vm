const CACHE_NAME = 'captura-v8';
const APP_SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

function isAppShellAsset(pathname) {
  return APP_SHELL.includes(pathname) || pathname.startsWith('/icons/');
}

function isSingleEventGet(pathname) {
  return /^\/api\/events\/[^/]+$/.test(pathname);
}

// cache-first, com atualização em segundo plano (stale-while-revalidate)
function cacheFirst(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((res) => { cache.put(request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
}

// network-first, com fallback pro cache quando offline
function networkFirst(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    fetch(request)
      .then((res) => { cache.put(request, res.clone()); return res; })
      .catch(() => cache.match(request))
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca intercepta escrita (progress/save/permissions/etc)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // stream de progresso em tempo real (SSE) — nunca cachear/interceptar
  if (url.pathname.endsWith('/stream')) return;

  if (req.mode === 'navigate') {
    // só trata como "casco" da SPA as rotas que de fato pertencem a ela. Uma
    // navegação de página inteira pra algo em /api/ (ex: o redirect de volta
    // do OAuth do Google pra /api/google/oauth/callback) tem que chegar de
    // verdade no servidor — nunca pode ser respondida com o HTML em cache.
    // Páginas estáticas próprias (ex: /privacidade.html) também não são a
    // SPA — sem esse filtro, quem já tem o service worker instalado nunca
    // conseguiria abrir essa página, sempre caindo de volta no app.
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.html') && url.pathname !== '/index.html') return;
    event.respondWith(cacheFirst(new Request('/')));
    return;
  }
  if (isAppShellAsset(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (isSingleEventGet(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }
  // qualquer outra rota (histórico, config, etc) — direto pra rede, sem cache
});
