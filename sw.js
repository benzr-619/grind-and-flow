// sw.js — Grind & Flow service worker
// Caches the app shell so the PWA launches reliably from the home screen.
// Supabase API calls are always sent to the network (never cached).

const CACHE = 'gf-shell-v2';

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

// ── Fetch: cache-first for shell, network-only for Supabase ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit the network for Supabase API and auth calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io')) {
    return; // let the browser handle it normally
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
