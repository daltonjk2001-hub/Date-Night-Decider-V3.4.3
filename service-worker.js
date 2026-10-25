/* Date Night Decider service worker v3.1.2-remediation2 */
'use strict';
const CACHE_NAME = 'date-night-decider-v3.1.2-remediation2';
const LEGACY_CACHE_PREFIX = 'date-night-decider-';
const CORE_ASSETS = [
  './', './index.html', './styles.css?v=3.1.2-remediation2', './manifest.json',
  './boot.js?v=3.1.2-remediation2', './db.js?v=3.1.2-remediation2',
  './store.js?v=3.1.2-remediation2', './p2p.js?v=3.1.2-remediation2',
  './ui.js?v=3.1.2-remediation2', './app.js?v=3.1.2-remediation2',
  './privacy.html', './support.html'
];
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
];
const OPTIONAL_ASSETS = ['./icon-192.png','./icon-512.png','./vendor/dexie.min.js','./vendor/peerjs.min.js'];
const CDN_HOSTS = new Set(['cdn.jsdelivr.net']);
async function cacheSafely(cache, request, response) {
  try { await cache.put(request, response.clone()); }
  catch (error) { console.warn('Cache update failed:', request.url, error); }
}
async function findCachedResponse(cache, request, cacheKey) {
  return await cache.match(request, {ignoreSearch:true}) || await cache.match(cacheKey, {ignoreSearch:true}) || null;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(CORE_ASSETS); }
    catch (error) { await caches.delete(CACHE_NAME); throw error; }
    await Promise.all(CDN_ASSETS.map(asset => cache.add(asset).catch(() => {})));
    await Promise.all(OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => key.startsWith(LEGACY_CACHE_PREFIX) && key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, {ignoreSearch:true});
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') { await cacheSafely(cache, request, response); return response; }
        return cached || response;
      } catch (error) { if (cached) return cached; throw error; }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = request.mode === 'navigate' ? new URL('./index.html', scopeUrl).href : request;
    try {
      const response = await fetch(request);
      if (response.ok) { await cacheSafely(cache, cacheKey, response); return response; }
      return await findCachedResponse(cache, request, cacheKey) || response;
    } catch (error) {
      const fallback = await findCachedResponse(cache, request, cacheKey);
      if (fallback) return fallback;
      if (request.mode === 'navigate') {
        const indexFallback = await cache.match(new URL('./index.html', scopeUrl).href);
        if (indexFallback) return indexFallback;
      }
      throw error;
    }
  })());
});
