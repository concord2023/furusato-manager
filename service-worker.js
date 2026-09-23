const CACHE='furusato-manager-2026-09-23-cache21';
const ASSETS=['./','./index.html','./details.html','./donations.html','./settings.html','./year-history.html','./year-2024.html','./year-2025.html','./year-2026.html','./year-detail.html','./yearly-page.js','./yearly-history.js','./import_readout.html','./style.css','./app.js','./calculator.js','./data-model.js','./integration.js','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return r}).catch(()=>caches.match('./index.html'))));});
