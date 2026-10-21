// Migração do endereço antigo (captura-checklist.onrender.com) para o domínio
// próprio (APP_BASE_URL). Páginas vão para o domínio novo com o mesmo caminho;
// a API continua respondendo no endereço antigo, pra que apps antigos ainda
// abertos consigam enviar marcações que estavam na fila offline; e o service
// worker antigo é trocado por um que se desinstala (o navegador não segue
// redirecionamento no script do service worker, então sem isso o app instalado
// continuaria abrindo a cópia em cache).

export function legacyHostAction({ host, path, method, appBaseUrl, legacyHosts = [] }) {
  if (!appBaseUrl || !host) return null;
  let target;
  try { target = new URL(appBaseUrl); } catch { return null; }
  const hostname = String(host).toLowerCase().split(':')[0];
  if (hostname === target.hostname) return null;
  const isLegacy = hostname.endsWith('.onrender.com') || legacyHosts.map(h => String(h).toLowerCase()).includes(hostname);
  if (!isLegacy) return null;
  if (path === '/sw.js') return { action: 'retire-sw' };
  if (path === '/api' || path.startsWith('/api/')) return null;
  if (method !== 'GET' && method !== 'HEAD') return null;
  return { action: 'redirect', location: target.origin + path };
}

// Service worker de despedida, servido só no endereço antigo.
export const RETIRE_SW_SCRIPT = `// O CAPTURA mudou de endereço: este service worker se desinstala, apaga o
// cache do endereço antigo e recarrega as abas, que vão para o domínio novo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.navigate(client.url);
  })());
});
`;
