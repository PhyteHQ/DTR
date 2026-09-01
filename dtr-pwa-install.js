/* DTR POB Network · RHW-style install controller for Android / Samsung / iOS. */
(()=>{
  'use strict';
  if(window.DTRPWAInstall)return;

  const REOPEN_KEY='dtr:pwa:reopen-install:v1';
  const VALID_VIEWS=new Set(['overview','deterrence-sanctum','ravenna-invicta','forja-del-vacio','fort-torrelavega']);
  const state={prompt:null,registration:null,rechecking:false};
  const $=id=>document.getElementById(id);
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const samsung=()=>/SamsungBrowser/i.test(navigator.userAgent);
  const ios=()=>/iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=()=>/Android/i.test(navigator.userAgent);

  function elements(){return{sheet:$('installSheet'),title:$('installTitle'),message:$('installMessage'),primary:$('installPrimary'),close:$('installClose'),header:$('installButton'),system:$('systemInstall')};}

  function hide(){const e=elements();if(e.sheet)e.sheet.hidden=true;document.body.classList.remove('modal-open');}

  function manualCopy(){
    if(samsung())return{
      title:'INSTALL DTR IN SAMSUNG INTERNET',
      message:'SAMSUNG HAS NOT EXPOSED THE NATIVE APP INSTALLER YET. TAP RECHECK INSTALL ONCE. IF IT STILL DOES NOT APPEAR: OPEN ☰ → ADD PAGE TO → HOME SCREEN. A CORRECT PWA INSTALL OPENS WITHOUT THE NORMAL BROWSER BAR.'
    };
    if(ios())return{title:'INSTALL DTR ON IPHONE / IPAD',message:'OPEN DTR IN SAFARI, TAP SHARE, THEN CHOOSE ADD TO HOME SCREEN.'};
    if(android())return{title:'INSTALL DTR ON ANDROID',message:'THE NATIVE INSTALL PROMPT IS NOT READY YET. TAP RECHECK INSTALL OR USE THE BROWSER MENU → INSTALL APP / ADD TO HOME SCREEN.'};
    return{title:'INSTALL DTR',message:'THE NATIVE INSTALL PROMPT IS NOT READY YET. USE THE BROWSER MENU → INSTALL APP / ADD TO HOME SCREEN.'};
  }

  function syncButtons(){
    const e=elements(),installed=standalone();
    if(e.header)e.header.hidden=installed;
    if(e.system)e.system.hidden=installed;
    [e.header,e.system].forEach(button=>{if(button)button.dataset.installReady=state.prompt?'true':'false';});
    document.documentElement.dataset.dtrInstall=installed?'installed':state.prompt?'ready':'manual';
  }

  function show(){
    if(standalone())return;
    const e=elements();if(!e.sheet)return;
    if(state.prompt){
      e.title.textContent='INSTALL DTR COMMAND APP';
      e.message.textContent='SAMSUNG / ANDROID NATIVE INSTALLER READY. INSTALL DTR FOR A STANDALONE COMMAND WINDOW AND OFFLINE-READY APP SHELL.';
      e.primary.textContent='INSTALL APP';
    }else{
      const copy=manualCopy();
      e.title.textContent=copy.title;e.message.textContent=copy.message;e.primary.textContent='RECHECK INSTALL';
    }
    e.primary.disabled=false;e.sheet.hidden=false;document.body.classList.add('modal-open');
  }

  async function requestInstall(){
    if(!state.prompt)return recheck();
    const prompt=state.prompt,e=elements();
    try{
      e.primary.disabled=true;e.primary.textContent='OPENING INSTALLER…';
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice?.outcome==='accepted')document.documentElement.dataset.dtrInstall='accepted';
    }catch(error){
      console.warn('DTR NATIVE INSTALL PROMPT FAILED:',String(error?.message||error));
    }finally{
      state.prompt=null;hide();syncButtons();
    }
  }

  async function recheck(){
    if(state.rechecking)return;
    state.rechecking=true;
    const e=elements();
    if(e.primary){e.primary.disabled=true;e.primary.textContent='RECHECKING…';}
    try{
      if('serviceWorker'in navigator){
        state.registration=await navigator.serviceWorker.getRegistration('./')||await navigator.serviceWorker.ready.catch(()=>null);
        try{await state.registration?.update();}catch{}
      }
      try{await fetch('./manifest.webmanifest?install_check='+Date.now(),{cache:'no-store'});}catch{}
      sessionStorage.setItem(REOPEN_KEY,'1');
      window.setTimeout(()=>window.location.reload(),180);
    }catch{
      state.rechecking=false;
      if(e.primary){e.primary.disabled=false;e.primary.textContent='RECHECK INSTALL';}
    }
  }

  function intercept(node,handler){
    node?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();handler();
    },true);
  }

  function repairInvalidView(){
    let stored='overview';
    try{stored=localStorage.getItem('dtr:view:v1')||'overview';}catch{}
    const active=document.querySelector('#tabs .tab.active')?.dataset.view||'';
    const unknown=String($('detailName')?.textContent||'').trim().toUpperCase()==='UNKNOWN POB';
    if(VALID_VIEWS.has(stored)&&active&&!unknown)return;
    try{localStorage.setItem('dtr:view:v1','overview');}catch{}
    document.querySelector('#tabs .tab[data-view="overview"]')?.click();
  }

  async function init(){
    const e=elements();
    intercept(e.header,show);intercept(e.system,show);intercept(e.primary,requestInstall);intercept(e.close,hide);
    repairInvalidView();
    if('serviceWorker'in navigator){
      try{state.registration=await navigator.serviceWorker.getRegistration('./')||await navigator.serviceWorker.ready.catch(()=>null);}catch{}
    }
    syncButtons();
    let reopen=false;try{reopen=sessionStorage.getItem(REOPEN_KEY)==='1';sessionStorage.removeItem(REOPEN_KEY);}catch{}
    if(reopen)window.setTimeout(show,1100);
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();state.prompt=event;syncButtons();
    const e=elements();
    if(e.sheet&&!e.sheet.hidden){e.title.textContent='INSTALL DTR COMMAND APP';e.message.textContent='NATIVE APP INSTALLER READY. DTR CAN NOW BE INSTALLED AS A STANDALONE APP.';e.primary.textContent='INSTALL APP';e.primary.disabled=false;}
  });
  window.addEventListener('appinstalled',()=>{state.prompt=null;hide();syncButtons();});
  window.addEventListener('pageshow',()=>{repairInvalidView();syncButtons();});

  window.DTRPWAInstall={state,show,recheck,requestInstall,isStandalone:standalone};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
