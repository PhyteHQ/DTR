/* DTR POB Network · RHW-style offline app shell.
   App assets are available offline. Darkstat telemetry remains network-only. */
const CACHE_PREFIX='dtr-pob-network-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}2026-09-05-v0.7.5`;
const APP_SHELL=[
  './','./index.html','./manifest.webmanifest','./styles.css','./enhancements.css','./dtr-quality.css','./dtr-uplink.css','./dtr-responsive.css','./dtr-calculator.css','./dtr-production.css',
  './dtr-pwa.js','./recipe-catalog.js','./app.js','./dtr-calculator.js','./dtr-production.js','./dtr-quality.js','./dtr-uplink.js',
  './assets/favicon-64.png','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-512.png'
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
