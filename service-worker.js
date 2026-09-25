const BUILD='20260926-v44';
const CACHE=`furusato-manager-${BUILD}`;
const ASSETS=['./','./index.html','./details.html','./donations.html','./settings.html','./year-history.html','./year-2024.html','./year-2025.html','./year-2026.html','./year-detail.html','./limit-2024.html','./limit-2025.html','./limit-2026.html','./year-detail.js','./yearly-page.js','./yearly-history.js','./data-database.html','./import_readout.html','./style.css','./app.js','./calculator.js','./data-model.js','./integration.js','./manifest.json'];
const LOCAL_SCHEME=/^(https?:)?\/\//;
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('furusato-manager-')&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

// The old worker was cache-first for HTML/JS. That allowed an old integration.js
// to survive after a new GitHub Pages deployment, which made the app display a
// newer settings page while executing older PDF parsing code. This worker is
// deliberately network-first for same-origin application files. Cache remains
// only as an offline fallback.
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(req,{cache:'no-store'});
      if(fresh&&fresh.ok){const copy=fresh.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});return fresh;}
    }catch{}
    const cached=await caches.match(req);
    return cached||caches.match('./index.html');
  })());
});
