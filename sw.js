/* DTR POB Network · RHW-style offline app shell.
   App assets are available offline. Darkstat telemetry remains network-only. */
const CACHE_PREFIX='dtr-pob-network-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}2026-10-26-v1.0.12-docking-rules-1`;
const APP_SHELL=[
  './','./index.html','./manifest.webmanifest','./styles.css','./enhancements.css','./dtr-quality.css','./dtr-uplink.css','./dtr-responsive.css','./dtr-calculator.css','./dtr-production.css','./dtr-shipyard.css','./dtr-calculator-mobile.css','./dtr-forum.css','./dtr-avatar.css','./dtr-trade-routes.css','./dtr-ships.css',
  './dtr-pwa.js','./recipe-catalog.js','./app.js','./dtr-procurement-prices.js','./dtr-calculator.js','./dtr-production.js','./dtr-shipyard.js','./dtr-forum.js','./dtr-avatar.js','./dtr-quality.js','./dtr-uplink.js',
  './assets/dtr-forum-frame.png','./assets/dtr-forum-window-mask.png','./dtr-trade-panel.html','./dtr-trade-routes.mjs','./dtr-route-policy.mjs',
  './dtr-ship-profiles.mjs','./dtr-ship-controller.mjs',
  './trade-core/trade.mjs','./trade-core/cargo.mjs','./trade-core/navigation.mjs',
  './trade-core/search.mjs','./trade-core/ranking.mjs','./trade-core/variants.mjs',
  './trade-core/worker.mjs','./trade-core/vendor/lp-solver.mjs','./trade-core/vendor/LP-SOLVER-LICENSE.txt',
  './trade-core/data/navigation.json.gz',
  './assets/favicon-64.png','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-512.png',
  './help/guide.html',
  ...["./help/img/attention-mode.webp","./help/img/avatar-tool.webp","./help/img/calculator.webp","./help/img/forum-bbcode.webp","./help/img/forum-preview.webp","./help/img/forum-write.webp","./help/img/header-navigation-help.webp","./help/img/inventory-search.webp","./help/img/inventory.webp","./help/img/mobile-overview.webp","./help/img/mobile-pob.webp","./help/img/network-matrix.webp","./help/img/overview-metrics.webp","./help/img/overview-pob-cards.webp","./help/img/pinned-cargo.webp","./help/img/pob-detail-header.webp","./help/img/pob-maintenance.webp","./help/img/pob-production-invicta.webp","./help/img/pob-production-sanctum.webp","./help/img/pob-production-torrelavega.webp","./help/img/routes-advanced.webp","./help/img/routes-custom-profile.webp","./help/img/routes-flight-plan.webp","./help/img/routes-results-empty.webp","./help/img/routes-ship-deck.webp","./help/img/routes-ship-search.webp","./help/img/shipyard.webp","./help/img/system-panel.webp","./help/img/uplink-panel.webp"]
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request);
    if(!response.ok)throw new Error(`NETWORK RESPONSE ${response.status}`);
    await cache.put(request,response.clone());
    return response;
  }catch(error){
    const cached=await cache.match(request)||await cache.match(fallback);
    if(cached)return cached;
    throw error;
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok)await cache.put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,'./index.html'));
    return;
  }

  if(url.origin===self.location.origin){
    event.respondWith(cacheFirst(request));
    return;
  }

  if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')event.respondWith(cacheFirst(request));
});
