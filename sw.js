/* Bara Gestion : gardien hors ligne (étape 1 : l'application s'ouvre sans internet).
 *
 * Règles de sécurité :
 *  - On ne garde QUE les fichiers de l'application (page, icônes) et deux ressources publiques
 *    (la bibliothèque Supabase à version fixe, les polices).
 *  - Les appels à Supabase (connexion, données, jetons) ne passent JAMAIS par ici : ils ne sont
 *    ni interceptés ni gardés en mémoire.
 *  - Page d'abord depuis le réseau (pour recevoir les mises à jour), la copie locale ne sert
 *    que si le réseau est absent ou très lent.
 */
const VERSION = 'v1';
const CACHE = 'bg-shell-' + VERSION;
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const STATIC_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);                       // si un fichier manque, l'installation échoue et on réessaiera
    try { await c.add(new Request(LIB, { mode: 'cors' })); } catch (err) { /* sera gardée à la 1re utilisation */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bg-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Réseau d'abord, copie locale si le réseau est absent ou plus lent que le délai.
async function networkFirst(req, fallbackKey) {
  const c = await caches.open(CACHE);
  const fromNet = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      fromNet,
      new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), NET_TIMEOUT_MS)),
    ]);
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true }) || (fallbackKey && await c.match(fallbackKey));
    if (hit) return hit;
    return fromNet;                              // rien en copie : on attend le réseau
  }
}

// Copie locale d'abord (fichiers publics à version fixe), sinon réseau puis on garde.
async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;              // jamais les envois (POST) : ils vont directement au serveur
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, req.mode === 'navigate' ? 'index.html' : null));
  } else if (STATIC_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
  // tout le reste (Supabase, etc.) : pas touché
});
