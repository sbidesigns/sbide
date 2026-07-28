// SBIDE Service Worker - Cache-first strategy for static assets
const CACHE_NAME = 'sbide-v3';

// Use relative paths - works regardless of base URL (github pages subdirectory, etc.)
const STATIC_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './css/fonts.css',
  './css/styles.css',
  './css/themes.css',
  './js/boot.js',
  './js/index.js',
  './js/utils.js',
  './js/utils-sanitize.js',
  './js/storage.js',
  './js/state.js',
  './js/api.js',
  './js/themes.js',
  './js/app.js',
  './js/connections.js',
  './js/offline-kit.js',
  './js/shortcuts.js',
  './js/components/chat-window.js',
  './js/components/code-editor.js',
  './js/components/file-tree.js',
  './js/components/sidebar.js',
  './js/components/llm-manager.js',
  './js/components/settings-panel.js',
  './js/components/memory-panel.js',
  './js/components/version-browser.js',
  './js/components/search-panel.js',
  './js/components/meetings-panel.js',
  './js/components/message-bubble.js',
  './logo.svg',
  './manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v3 - caching all static assets');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache each asset individually so one failure doesn't block all
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v3 - cleaning old caches');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first, network fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // Skip external API calls (DuckDuckGo, LLM APIs, CDNs, etc.)
  if (url.origin !== self.location.origin) return;
  
  // Skip chrome-extension and non-http(s) protocols
  if (!url.protocol.startsWith('http')) return;
  
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        // Return cached version immediately
        if (cached) {
          // Update cache in background (stale-while-revalidate)
          fetchAndCache(event.request);
          return cached;
        }
        
        // Not in cache - fetch from network
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // Offline fallback for HTML requests - serve branded offline page
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./offline.html');
        }
        
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

/**
 * Fetch from network and update cache
 */
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    
    // Only cache successful responses
    if (response.status === 200 || response.status === 0) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => {
        cache.put(request, clone).catch(() => {});
      });
    }
    
    return response;
  } catch (error) {
    // Network failed - try to return cached version (even stale)
    const cached = await caches.match(request);
    if (cached) return cached;
    
    throw error;
  }
}
