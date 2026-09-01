/* DTR POB Network · compact quality layer inspired by RHW. */
(()=>{
  'use strict';
  if(window.DTRQuality)return;

  const META=Object.freeze({version:'0.5.0',build:'2026.09.02-A'});
  const KEYS=Object.freeze({
    attention:'dtr:attention:v1',
    live:'dtr:pobs:live:v2',
    previous:'dtr:pobs:previous:v2',
    watch:'dtr:watchlist:v1',
    recoveries:'dtr:storage-recoveries:v1'
  });
  const POBS=Object.freeze([
    {view:'overview',index:'00',short:'ALL'},
    {view:'deterrence-sanctum',index:'01',short:'SANCTUM',aliases:['deterrence sanctum']},
    {view:'ravenna-invicta',index:'02',short:'INVICTA',aliases:['ravenna invicta','invicta']},
    {view:'forja-del-vacio',index:'03',short:'FORJA',aliases:['forja del vacio','forja del vacío']},
    {view:'fort-torrelavega',index:'04',short:'TORRE',aliases:['fort torrelavega','torrelavega']}
  ]);
  const runtimeEvents=[];
  const $=id=>document.getElementById(id);
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  let attention=false;
  let scheduled=false;

  function storageAvailable(){
    const key=`dtr:storage-probe:${Date.now()}`;
    try{localStorage.setItem(key,'ok');const ok=localStorage.getItem(key)==='ok';localStorage.removeItem(key);return ok;}catch{return false;}
  }

  function recoveryIndex(){
    try{const raw=JSON.parse(localStorage.getItem(KEYS.recoveries)||'[]');return Array.isArray(raw)?raw:[];}catch{return[];}
  }

  function recoverJsonKey(key){
    let raw;
    try{raw=localStorage.getItem(key);}catch{return null;}
    if(raw===null)return null;
    try{return JSON.parse(raw);}catch(error){
      const at=Date.now();
      const backupKey=`dtr:recovery:${at}:${key.replace(/[^a-z0-9]+/gi,'-')}`;
      try{
        localStorage.setItem(backupKey,JSON.stringify({schemaVersion:1,originalKey:key,recoveredAt:new Date(at).toISOString(),raw}));
        localStorage.removeItem(key);
        const list=recoveryIndex();
        list.push({key,backupKey,at});
        localStorage.setItem(KEYS.recoveries,JSON.stringify(list.slice(-12)));
        return null;
      }catch{return null;}
    }
  }

  function recoverKnownStorage(){
    [KEYS.live,KEYS.previous,KEYS.watch].forEach(recoverJsonKey);
  }

  function loadAttention(){
    try{attention=localStorage.getItem(KEYS.attention)==='true';}catch{attention=false;}
  }

  function saveAttention(){
    try{localStorage.setItem(KEYS.attention,attention?'true':'false');}catch{}
  }

  function mountQuickbar(){
    if($('dtrQuickbar'))return;
    const tabs=$('tabs');
    if(!tabs)return;
    tabs.insertAdjacentHTML('afterend',`<section class="dtr-quickbar" id="dtrQuickbar"><button class="dtr-attention-toggle" id="dtrAttentionToggle" type="button" aria-pressed="false"><span>ATTENTION</span><small>ONLY ISSUES</small><b id="dtrAttentionCount">0</b></button><div class="dtr-quickbar-state"><small>COMMAND FILTER</small><strong id="dtrAttentionSummary">SHOWING ALL NETWORK DATA</strong></div><span class="dtr-build-chip">v${META.version} // ${META.build}</span></section>`);
    $('dtrAttentionToggle')?.addEventListener('click',()=>{
      attention=!attention;
      saveAttention();
      applyAttention();
    });
  }

  function mountMobileNav(){
    if($('dtrMobileNav'))return;
    document.body.insertAdjacentHTML('beforeend',`<nav class="dtr-mobile-nav" id="dtrMobileNav" aria-label="DTR mobile POB navigation">${POBS.map(p=>`<button type="button" data-mobile-view="${p.view}"><small>${p.index}</small><span>${p.short}</span></button>`).join('')}</nav>`);
    $('dtrMobileNav')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-mobile-view]');
      if(!button)return;
      const source=document.querySelector(`#tabs .tab[data-view="${button.dataset.mobileView}"]`);
      source?.click();
      window.scrollTo({top:0,behavior:'smooth'});
    });
    syncMobileNav();
  }

  function syncMobileNav(){
    const active=document.querySelector('#tabs .tab.active')?.dataset.view||'overview';
    document.querySelectorAll('#dtrMobileNav [data-mobile-view]').forEach(button=>{
      const on=button.dataset.mobileView===active;
      button.classList.toggle('active',on);
      button.setAttribute('aria-current',on?'page':'false');
    });
  }

  function globalAlertCount(){
    const metric=Number(String($('metricAlerts')?.textContent||'').replace(/[^0-9]/g,''));
    if(Number.isFinite(metric))return metric;
    let total=0;
    document.querySelectorAll('.base-card-footer b').forEach(node=>{const match=node.textContent.match(/(\d+)\s+ALERT/i);if(match)total+=Number(match[1])||0;});
    return total;
  }

  function issueTone(node){
    const tone=node?.dataset?.tone||'';
    return tone==='warn'||tone==='danger';
  }

  function setManagedHidden(node,hidden){
    if(node)node.classList.toggle('dtr-attention-hidden',Boolean(hidden));
  }

  function applyAttention(){
    document.body.classList.toggle('dtr-attention-mode',attention);
    const toggle=$('dtrAttentionToggle');
    if(toggle)toggle.setAttribute('aria-pressed',attention?'true':'false');
    const count=globalAlertCount();
    if($('dtrAttentionCount'))$('dtrAttentionCount').textContent=String(count);
    if($('dtrAttentionSummary'))$('dtrAttentionSummary').textContent=attention?(count?`${count} ACTIVE CONDITION${count===1?'':'S'} // NORMAL DATA HIDDEN`:'ALL CLEAR // NO ACTIVE CONDITIONS'):'SHOWING ALL NETWORK DATA';

    document.querySelectorAll('#overviewGrid .base-card').forEach(card=>{
      const footer=card.querySelector('.base-card-footer b')?.textContent||'';
      const hasIssue=card.dataset.state==='missing'||!/NOMINAL/i.test(footer);
      setManagedHidden(card,attention&&!hasIssue);
    });
    document.querySelectorAll('#networkMatrix .matrix-row:not(.matrix-head)').forEach(row=>{
      const hasIssue=[...row.querySelectorAll('button[data-tone]')].some(issueTone);
      setManagedHidden(row,attention&&!hasIssue);
    });
    document.querySelectorAll('#maintenanceGrid .maintenance-card').forEach(card=>setManagedHidden(card,attention&&!issueTone(card)));
    document.querySelectorAll('#watchGrid .watch-card').forEach(card=>{
      const level=card.querySelector('.stock-level');
      setManagedHidden(card,attention&&!issueTone(level));
    });
    document.querySelectorAll('#inventoryBody tr').forEach(row=>{
      const level=row.querySelector('.stock-level');
      setManagedHidden(row,attention&&!issueTone(level));
    });
    syncMobileNav();
  }

  function cachedSnapshot(){
    const raw=recoverJsonKey(KEYS.live);
    return raw&&Array.isArray(raw.data)?raw:null;
  }

  function countPobMatches(){
    const snapshot=cachedSnapshot();
    if(!snapshot)return 0;
    return POBS.filter(p=>p.aliases).filter(p=>snapshot.data.some(base=>{
      const hay=norm([base?.name,base?.nickname,base?.base_name,base?.display_name].filter(Boolean).join(' '));
      return p.aliases.some(alias=>{const a=norm(alias);return hay===a||hay.includes(a);});
    })).length;
  }

  function standalone(){
    return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  }

  function diag(key,label,tone,status,detail){return{key,label,tone,status,detail};}

  function collectDiagnostics(){
    const recoveries=recoveryIndex();
    const storageOk=storageAvailable();
    const runtimeOk=['tabs','overviewView','detailView','overviewGrid','networkMatrix','systemPanel'].every(id=>Boolean($(id)))&&runtimeEvents.length===0;
    const status=String($('statusText')?.textContent||'UNKNOWN').trim().toUpperCase();
    const freshness=String($('headerFreshness')?.textContent||'NO SNAPSHOT').trim();
    const matches=countPobMatches();
    const swReady=Boolean(navigator.serviceWorker?.controller||window.DTRPWAUpdates?.state?.registration);
    const updateState=window.DTRPWAUpdates?.state;
    const updateReady=Boolean(updateState?.pendingFingerprint&&!updateState?.applying);
    return[
      diag('build','APP BUILD','good',`v${META.version}`,META.build),
      diag('runtime','APP RUNTIME',runtimeOk?'good':'danger',runtimeOk?'READY':`${runtimeEvents.length||1} ISSUE${runtimeEvents.length===1?'':'S'}`,runtimeOk?'Core UI mounted without recorded runtime errors.':'A runtime or required-shell failure was detected this session.'),
      diag('storage','LOCAL STORAGE',!storageOk?'danger':recoveries.length?'warn':'good',!storageOk?'UNAVAILABLE':recoveries.length?'RECOVERED':'READY',!storageOk?'Browser-local saves are unavailable.':recoveries.length?`${recoveries.length} damaged local entr${recoveries.length===1?'y was':'ies were'} backed up and reset.`:'Watchlist, view state and cache can be saved locally.'),
      diag('network','CONNECTION',navigator.onLine?'good':'warn',navigator.onLine?'ONLINE':'OFFLINE',navigator.onLine?'Network access is available.':'Cached DTR data remains available; live telemetry is paused.'),
      diag('telemetry','DARKSTAT UPLINK',/LIVE/.test(status)?'good':/CACHE/.test(status)?'warn':'danger',status||'UNKNOWN',freshness),
      diag('pobs','POB MATCHES',matches===4?'good':matches?'warn':'danger',`${matches}/4`,matches===4?'All tracked DTR POBs resolve from the last verified snapshot.':'One or more tracked POBs are missing from the local verified snapshot.'),
      diag('pwa','PWA SHELL',swReady?'good':'warn',standalone()?'STANDALONE':swReady?'READY':'CHECKING',standalone()?'DTR is running in its dedicated app window.':swReady?'Offline startup shell is registered.':'Service-worker control is not active yet.'),
      diag('update','APP UPDATE',updateReady?'warn':'good',updateReady?'UPDATE READY':updateState?.applying?'APPLYING':'CURRENT',updateReady?'A newer DTR shell is ready to apply.':'No unapplied DTR build is currently detected.')
    ];
  }

  function renderDiagnostics(){
    const grid=$('systemGrid'),overall=$('systemOverall');
    if(!grid||!overall)return;
    const checks=collectDiagnostics();
    grid.innerHTML=checks.map(check=>`<article class="dtr-diagnostic-card" data-tone="${check.tone}" data-check="${check.key}"><small>${check.label}</small><strong>${check.status}</strong><span>${check.detail}</span></article>`).join('');
    const danger=checks.filter(x=>x.tone==='danger').length;
    const warn=checks.filter(x=>x.tone==='warn').length;
    overall.dataset.tone=danger?'danger':warn?'warn':'good';
    overall.querySelector('strong').textContent=danger?'ATTENTION REQUIRED':warn?'CORE SYSTEMS NOMINAL':'ALL SYSTEMS NOMINAL';
    overall.querySelector('span').textContent=danger?`${danger} blocking check${danger===1?'':'s'} detected.`:warn?`${warn} status notice${warn===1?'':'s'}; no blocking app failure detected.`:'Runtime, storage, telemetry and app shell report ready.';
    mountCopyDiagnostics();
  }

  function diagnosticsReport(){
    const checks=collectDiagnostics();
    return[
      'DTR SYSTEM CHECK',
      `GENERATED: ${new Date().toISOString()}`,
      `APP: v${META.version} // BUILD ${META.build}`,
      `WINDOW: ${standalone()?'STANDALONE APP':'BROWSER'}`,
      '',
      ...checks.map(check=>`${check.label}: ${check.status} // ${check.detail}`),
      '',
      `SESSION RUNTIME EVENTS: ${runtimeEvents.length}`,
      `STORAGE RECOVERIES: ${recoveryIndex().length}`,
      'PRIVACY: No commodity quantities, prices or POB credit balances are included.'
    ].join('\n');
  }

  async function copyDiagnostics(){
    const text=diagnosticsReport();
    let copied=false;
    try{await navigator.clipboard.writeText(text);copied=true;}catch{
      try{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();copied=document.execCommand('copy');area.remove();}catch{}
    }
    const button=$('dtrDiagnosticsCopy');
    if(button){const old=button.textContent;button.textContent=copied?'COPIED':'COPY FAILED';window.setTimeout(()=>button.textContent=old,1400);}
  }

  function mountCopyDiagnostics(){
    const actions=document.querySelector('#systemPanel .system-actions');
    if(!actions||$('dtrDiagnosticsCopy'))return;
    const button=document.createElement('button');
    button.id='dtrDiagnosticsCopy';
    button.type='button';
    button.textContent='COPY DIAGNOSTICS';
    button.addEventListener('click',copyDiagnostics);
    actions.appendChild(button);
  }

  function mountBuildBadge(){
    const footer=document.querySelector('body>footer');
    if(!footer||$('dtrBuildBadge'))return;
    const badge=document.createElement('span');
    badge.id='dtrBuildBadge';
    badge.className='dtr-footer-build';
    badge.textContent=`DTR v${META.version} // ${META.build}`;
    footer.appendChild(badge);
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;applyAttention();});
  }

  function bindDiagnostics(){
    $('systemButton')?.addEventListener('click',()=>setTimeout(renderDiagnostics,0));
    $('systemRefresh')?.addEventListener('click',()=>setTimeout(renderDiagnostics,0));
  }

  function init(){
    recoverKnownStorage();
    loadAttention();
    mountQuickbar();
    mountMobileNav();
    mountBuildBadge();
    bindDiagnostics();
    renderDiagnostics();
    applyAttention();
    const tabs=$('tabs');
    if(tabs)new MutationObserver(()=>{syncMobileNav();schedule();}).observe(tabs,{subtree:true,attributes:true,attributeFilter:['class']});
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  }

  window.addEventListener('error',event=>{runtimeEvents.push({type:'error',at:Date.now(),message:String(event.message||'runtime error')});if(runtimeEvents.length>20)runtimeEvents.shift();});
  window.addEventListener('unhandledrejection',event=>{runtimeEvents.push({type:'promise',at:Date.now(),message:String(event.reason?.message||event.reason||'promise rejection')});if(runtimeEvents.length>20)runtimeEvents.shift();});
  window.addEventListener('online',()=>{schedule();renderDiagnostics();});
  window.addEventListener('offline',renderDiagnostics);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){schedule();renderDiagnostics();}});

  window.DTRQuality={META,get attention(){return attention;},setAttention(value){attention=Boolean(value);saveAttention();applyAttention();},renderDiagnostics,diagnosticsReport,recoverKnownStorage};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
