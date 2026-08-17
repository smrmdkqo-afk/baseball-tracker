const CACHE='baseball-tracker-pro-v6.5.0';
const CORE=['./','./index.html','./styles.css?v=6.5.0','./js/storage.js?v=6.5.0','./js/analytics.js?v=6.5.0','./js/app.js?v=6.5.0','./manifest.webmanifest?v=6.5.0','./icon-192.png','./icon-512.png','./supabase-config.js?v=6.5.0'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('baseball-tracker-pro-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;
  // Navigations are network-first. Versioned assets cannot collide with an older release.
  e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
