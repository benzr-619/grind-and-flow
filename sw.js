// sw.js — Grind & Flow service worker
// Caches the app shell so the PWA launches reliably from the home screen.
// Supabase API calls are always sent to the network (never cached).

const CACHE = 'gf-shell-v3';

const SHELL = [
  '/grind-and-flow/',
  '/grind-and-flow/index.html',
  '/grind-and-flow/style.css',
  '/grind-and-flow/app.js',
  '/grind-and-flow/auth.js',
  '/grind-and-flow/data.js',
  '/grind-and-flow/manifest.json',
  '/grind-and-flow/icon-192.png',
  '/grind-and-flow/icon-512.png',
  '/grind-and-flow/icon-180.png',
];

// ── Install: pre-cache the app shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: drop old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for the app shell, network-only for everything else ──
// Network-first means new deploys show up on the next online refresh; the cache
// is only a fallback when offline. (The old cache-first strategy served stale
// app.js/style.css/index.html forever unless sw.js itself changed.)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Cross-origin (Supabase API + auth, CDN libs) — let the browser handle it
  if (url.origin !== self.location.origin) return;

  // Same-origin app shell: network-first, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('/grind-and-flow/index.html')))
  );
});
