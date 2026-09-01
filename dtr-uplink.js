/* DTR POB Network · live uplink control deck. */
(()=>{
  'use strict';
  if(window.DTRUplink)return;

  const REFRESH_MS=5*60*1000;
  const LIVE_KEY='dtr:pobs:live:v2';
  const $=id=>document.getElementById(id);
  let lastSnapshotAt=0;
  let lastForcedAt=0;

  function readSnapshotTime(){
    try{
      const raw=JSON.parse(localStorage.getItem(LIVE_KEY)||'null');
      const at=Date.parse(raw?.savedAt||'');
      return Number.isFinite(at)?at:0;
    }catch{return 0;}
  }

  function formatClock(value){
    if(!value)return'--:--:--';
    return new Date(value).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function formatCountdown(ms){
    if(!Number.isFinite(ms)||ms<=0)return'DUE NOW';
    const total=Math.ceil(ms/1000),minutes=Math.floor(total/60),seconds=total%60;
    return`${minutes}:${String(seconds).padStart(2,'0')}`;
  }

  function linkState(){
    const status=String($('statusText')?.textContent||'').trim().toUpperCase();
    if(!navigator.onLine)return{tone:'danger',connection:'CONNECTION LOST',datalink:'OFFLINE'};
    if(/SYNCING/.test(status))return{tone:'warn',connection:'UPLINK IN PROGRESS',datalink:'SYNCING'};
    if(/CACHE|CACHED/.test(status))return{tone:'warn',connection:'CACHED LINK ACTIVE',datalink:'CACHE'};
    if(/LIVE|NODES LIVE/.test(status))return{tone:'good',connection:'CONNECTION SECURE',datalink:'LIVE'};
    if(/FAIL|ERROR/.test(status))return{tone:'danger',connection:'UPLINK DEGRADED',datalink:'ERROR'};
    return{tone:'muted',connection:'LINK STANDBY',datalink:'STANDBY'};
  }

  function mount(){
    if($('dtrUplinkConsole'))return;
    const metrics=document.querySelector('#overviewView .network-metrics');
    if(!metrics)return;
    metrics.insertAdjacentHTML('afterend',`<section class="dtr-uplink-console" id="dtrUplinkConsole" data-tone="muted">
      <header class="dtr-uplink-head">
        <div class="dtr-uplink-state"><i aria-hidden="true"></i><div><small>UPLINK STATUS</small><strong id="dtrUplinkConnection">LINK STANDBY</strong></div></div>
        <span>DARKSTAT CONTROL CHANNEL</span>
      </header>
      <div class="dtr-uplink-grid">
        <div><small>SYSTEM CLOCK</small><strong id="dtrUplinkClock">[--:--:--]</strong></div>
        <div><small>LATEST SYNC</small><strong id="dtrUplinkLatest">--:--:--</strong></div>
        <div><small>NEXT SYNC</small><strong id="dtrUplinkNext">--:--</strong></div>
        <div><small>REFRESH CYCLE</small><strong>5 MIN</strong></div>
        <div><small>DATALINK</small><strong id="dtrUplinkDatalink">STANDBY</strong></div>
      </div>
      <footer class="dtr-uplink-actions">
        <button id="dtrForceUplink" type="button"><i aria-hidden="true"></i><span>FORCE UPLINK</span></button>
        <span id="dtrUplinkMessage">AUTO CYCLE ARMED</span>
      </footer>
    </section>`);
    $('dtrForceUplink')?.addEventListener('click',forceUplink);
  }

  function setMessage(text,tone='muted'){
    const node=$('dtrUplinkMessage');
    if(!node)return;
    node.textContent=text;
    node.dataset.tone=tone;
  }

  function forceUplink(){
    const source=$('refreshButton'),button=$('dtrForceUplink');
    if(!navigator.onLine){setMessage('NETWORK OFFLINE // UPLINK BLOCKED','danger');return;}
    if(!source||source.disabled){setMessage('UPLINK ALREADY IN PROGRESS','warn');return;}
    lastForcedAt=Date.now();
    if(button)button.disabled=true;
    setMessage('MANUAL UPLINK REQUESTED','warn');
    source.click();
    window.setTimeout(sync,50);
  }

  function sync(){
    mount();
    const consoleNode=$('dtrUplinkConsole');
    if(!consoleNode)return;
    const state=linkState();
    consoleNode.dataset.tone=state.tone;
    const connection=$('dtrUplinkConnection');if(connection)connection.textContent=state.connection;
    const datalink=$('dtrUplinkDatalink');if(datalink){datalink.textContent=state.datalink;datalink.dataset.tone=state.tone;}

    const now=Date.now(),savedAt=readSnapshotTime();
    if(savedAt&&savedAt!==lastSnapshotAt){
      lastSnapshotAt=savedAt;
      if(lastForcedAt&&savedAt>=lastForcedAt-2000){setMessage('MANUAL UPLINK VERIFIED','good');lastForcedAt=0;}
      else setMessage('AUTO CYCLE ARMED','muted');
    }
    const clock=$('dtrUplinkClock');if(clock)clock.textContent=`[${formatClock(now)}]`;
    const latest=$('dtrUplinkLatest');if(latest)latest.textContent=formatClock(savedAt);
    const next=$('dtrUplinkNext');if(next)next.textContent=savedAt?formatCountdown((savedAt+REFRESH_MS)-now):'AWAITING';

    const source=$('refreshButton'),button=$('dtrForceUplink');
    if(button){
      button.disabled=!navigator.onLine||Boolean(source?.disabled);
      button.classList.toggle('busy',Boolean(source?.disabled));
      const label=button.querySelector('span');if(label)label.textContent=source?.disabled?'UPLINKING…':'FORCE UPLINK';
    }
  }

  function init(){
    mount();
    sync();
    const source=$('refreshButton');
    if(source)new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['disabled']});
    const status=$('statusText');
    if(status)new MutationObserver(sync).observe(status,{childList:true,characterData:true,subtree:true});
    window.setInterval(sync,1000);
  }

  window.addEventListener('online',sync);
  window.addEventListener('offline',sync);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync();});
  window.DTRUplink={sync,forceUplink};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
