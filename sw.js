const CACHE='baseball-diary-v7.8.1';
const CORE=['./','./index.html','./styles.css?v=7.8.1','./js/storage.js?v=7.8.1','./js/analytics.js?v=7.8.1','./js/analysis-scope.js?v=7.8.1','./js/defense.js?v=7.8.1','./js/defense-training.js?v=7.8.1','./js/app.js?v=7.8.1','./manifest.webmanifest?v=7.8.1','./icon-192-v7.1.0.png','./icon-512-v7.1.0.png','./icon-512-maskable-v7.1.0.png','./vendor/supabase-2.112.3.min.js?v=7.8.1','./supabase-config.js?v=7.8.1'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&(k.startsWith('baseball-tracker-pro-')||k.startsWith('baseball-diary-'))).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;
  // Navigations are network-first. Versioned assets cannot collide with an older release.
  e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
