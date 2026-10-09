const V = 'plata-v51';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'llm.js', 'assistant.js', 'calc.js', 'items.js', 'import.js', 'onboarding.js', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-mono-512.png', 'fonts/outfit.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
// Solo archivos propios de la app (nunca las llamadas a los proveedores de IA). Red primero; si la red tarda más de 4 s o falla, se usa la copia guardada.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const c = r.clone(); e.waitUntil(caches.open(V).then(ch => ch.put(e.request, c))); } return r; });
    if (!cached) return net;
    e.waitUntil(net.catch(() => { }));
    return Promise.race([net, new Promise(res => setTimeout(() => res(cached), 4000))]).catch(() => cached);
  })());
});
