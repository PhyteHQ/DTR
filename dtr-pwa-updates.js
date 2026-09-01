/* DTR POB Network · visible UPDATE NOW flow inspired by RHW. */
(()=>{
  'use strict';
  if(window.DTRPWAUpdates)return;

  const FINGERPRINT_KEY='dtr:pwa:shell-fingerprint:v1';
  const CACHE_PREFIX='dtr-pob-network-pwa-';
  const PROBE_ASSETS=['./index.html','./styles.css','./enhancements.css','./dtr-quality.css','./dtr-uplink.css','./app.js','./enhancements.js','./dtr-quality.js','./dtr-uplink.js','./dtr-pwa-updates.js','./manifest.webmanifest','./sw.js'];
  const state={registration:null,pendingFingerprint:'',checking:false,dismissed:false,applying:false};
  const $=id=>document.getElementById(id);

  function mount(){
    if($('dtrUpdateSheet'))return;
    document.body.insertAdjacentHTML('beforeend',`<aside class="install-sheet" id="dtrUpdateSheet" role="dialog" aria-modal="true" aria-labelledby="dtrUpdateTitle" hidden><div><small>APP UPDATE READY</small><strong id="dtrUpdateTitle">RESTART WITH LATEST DTR</strong><span id="dtrUpdateMessage">A NEW DTR COMMAND BUILD IS READY. LOCAL WATCHLISTS AND SETTINGS STAY ON THIS DEVICE.</span></div><div class="install-actions"><button id="dtrUpdatePrimary" type="button">UPDATE NOW</button><button id="dtrUpdateClose" type="button">LATER</button></div></aside>`);
    $('dtrUpdatePrimary')?.addEventListener('click',applyUpdate);
    $('dtrUpdateClose')?.addEventListener('click',()=>{state.dismissed=true;hideUpdate();});
  }

  function showUpdate(fingerprint){
    if(!fingerprint||state.dismissed||state.applying)return;
    state.pendingFingerprint=fingerprint;
    mount();
    const sheet=$('dtrUpdateSheet');
    if(sheet)sheet.hidden=false;
    document.body.classList.add('modal-open');
  }

  function hideUpdate(){
    const sheet=$('dtrUpdateSheet');
    if(sheet)sheet.hidden=true;
    document.body.classList.remove('modal-open');
  }

  async function digestText(text){
    if(globalThis.crypto?.subtle){
      const bytes=new TextEncoder().encode(text);
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
    }
    let hash=2166136261;
    for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return(hash>>>0).toString(16);
  }

  async function probeAsset(path,stamp){
    const url=new URL(path,location.href);
    url.searchParams.set('dtr_update_probe',stamp);
    const response=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!response.ok)throw new Error(`${path} HTTP ${response.status}`);
    const etag=response.headers.get('etag'),modified=response.headers.get('last-modified'),length=response.headers.get('content-length');
    if(etag||modified)return`${path}|${etag||''}|${modified||''}|${length||''}`;
    return`${path}|${await digestText(await response.text())}`;
  }

  async function shellFingerprint(){
    const stamp=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const parts=await Promise.all(PROBE_ASSETS.map(path=>probeAsset(path,stamp)));
    return digestText(parts.join('\n'));
  }

  async function checkForUpdate(){
    if(state.checking||state.applying||!navigator.onLine)return;
    state.checking=true;
    try{
      try{await state.registration?.update();}catch{}
      const latest=await shellFingerprint();
      const applied=localStorage.getItem(FINGERPRINT_KEY);
      if(!applied){localStorage.setItem(FINGERPRINT_KEY,latest);return;}
      if(latest!==applied)showUpdate(latest);
    }catch(error){console.warn('DTR UPDATE PROBE FAILED:',String(error?.message||error));}
    finally{state.checking=false;}
  }

  async function clearAppCaches(){
    if(!('caches'in window))return;
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)).map(key=>caches.delete(key)));
  }

  async function applyUpdate(){
    if(state.applying||!state.pendingFingerprint)return;
    if(!navigator.onLine){const message=$('dtrUpdateMessage');if(message)message.textContent='CONNECT TO THE NETWORK BEFORE APPLYING THIS UPDATE.';return;}
    state.applying=true;
    const button=$('dtrUpdatePrimary');
    if(button){button.disabled=true;button.textContent='UPDATING…';}
    try{
      await clearAppCaches();
      localStorage.setItem(FINGERPRINT_KEY,state.pendingFingerprint);
      try{await state.registration?.update();}catch{}
      window.location.reload();
    }catch{
      state.applying=false;
      if(button){button.disabled=false;button.textContent='UPDATE NOW';}
      const message=$('dtrUpdateMessage');if(message)message.textContent='UPDATE FAILED. CHECK THE CONNECTION AND TRY AGAIN.';
    }
  }

  async function register(){
    mount();
    if('serviceWorker'in navigator){
      try{state.registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});}catch(error){console.warn('DTR PWA REGISTRATION UNAVAILABLE:',String(error?.message||error));}
    }
    window.setTimeout(checkForUpdate,2500);
    window.setInterval(checkForUpdate,60*60*1000);
  }

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){state.dismissed=false;checkForUpdate();}});
  window.addEventListener('online',()=>{state.dismissed=false;checkForUpdate();});

  window.DTRPWAUpdates={state,checkForUpdate,applyUpdate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',register,{once:true});else register();
})();