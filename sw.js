const CACHE = 'baseball-tracker-pro-v4.0.0';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './supabase-config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Supabase API의 POST/PATCH/DELETE 등은 절대 캐시하지 않습니다.
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 설정 파일은 온라인일 때 항상 최신 값을 우선합니다.
  if (sameOrigin && url.pathname.endsWith('/supabase-config.js')) {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // 앱 정적 파일: cache-first. 새 배포는 CACHE 버전 변경으로 갱신됩니다.
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
    return;
  }

  // 외부 GET(예: Supabase JS CDN)은 한 번 성공하면 오프라인 재사용.
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      return response;
    }))
  );
});
