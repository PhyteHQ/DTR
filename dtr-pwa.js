/* DTR POB Network · RHW-style PWA controller.
   Owns install UI, service-worker registration and app update handoff. */
(()=>{
  'use strict';
  if(window.DTRPWA)return;

  const state={installPrompt:null,registration:null,updateWorker:null,reloading:false,primaryAction:null};
  const $=id=>document.getElementById(id);
  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const isAndroid=(ua=navigator.userAgent)=>/Android/i.test(ua);
  const isIos=(ua=navigator.userAgent,platform=navigator.platform,maxTouchPoints=navigator.maxTouchPoints)=>/iPad|iPhone|iPod/i.test(ua)||(platform==='MacIntel'&&maxTouchPoints>1);

  function installStyles(){
    if($('dtrPwaStyle'))return;
    const style=document.createElement('style');
    style.id='dtrPwaStyle';
    style.textContent=`
      @media(max-width:760px){
        #installSheet{width:calc(100% - 28px)!important;max-width:660px!important;padding:18px!important;gap:18px!important}
        #installSheet .install-actions{display:grid!important;grid-template-columns:1fr!important;width:100%!important;gap:8px!important}
        #installSheet .install-actions button{width:100%!important;min-height:68px!important;font-size:10px!important;letter-spacing:.12em!important}
        #installSheet #installPrimary{border-color:rgba(200,174,130,.42)!important;color:var(--gold)!important;background:linear-gradient(180deg,rgba(200,174,130,.09),rgba(157,48,57,.035))!important}
        #installSheet #installClose{color:#8a7b84!important;background:rgba(20,24,31,.56)!important}
        #installSheet strong{font-size:18px!important;letter-spacing:.035em!important}
        #installSheet span{font-size:10px!important;line-height:1.55!important;letter-spacing:.035em!important}
      }
    `;
    document.head.appendChild(style);
  }

  function elements(){
    const panel=$('installSheet');
    return{
      panel,
      kicker:panel?.querySelector('small')||null,
      title:$('installTitle'),message:$('installMessage'),primary:$('installPrimary'),close:$('installClose'),
      header:$('installButton'),system:$('systemInstall')
    };
  }

  function showPanel({kicker,title,message,primaryLabel,onPrimary}){
    const e=elements();
    if(!e.panel)return;
    if(e.kicker)e.kicker.textContent=kicker;
    if(e.title)e.title.textContent=title;
    if(e.message)e.message.textContent=message;
    if(e.primary){e.primary.textContent=primaryLabel;e.primary.disabled=false;}
    state.primaryAction=onPrimary;
    e.panel.hidden=false;
    document.body.classList.add('modal-open');
  }

  function hidePanel(){
    const e=elements();
    if(e.panel)e.panel.hidden=true;
    state.primaryAction=null;
    document.body.classList.remove('modal-open');
  }

  async function requestInstall(){
    const prompt=state.installPrompt;
    if(!prompt)return showManualInstructions();
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      hidePanel();
      if(choice?.outcome==='accepted')document.documentElement.dataset.dtrPwaInstall='accepted';
    }catch(error){
      document.documentElement.dataset.dtrPwaInstall='prompt-failed';
      console.warn('DTR APP INSTALL PROMPT FAILED:',String(error?.message||error));
      showManualInstructions();
    }finally{
      state.installPrompt=null;
      syncInstallState();
    }
  }

  function manualInstructions(ua=navigator.userAgent,platform=navigator.platform,maxTouchPoints=navigator.maxTouchPoints){
    if(isIos(ua,platform,maxTouchPoints))return{title:'INSTALL DTR ON IPHONE / IPAD',message:'OPEN DTR IN SAFARI, TAP SHARE (SQUARE WITH UP ARROW), THEN CHOOSE ADD TO HOME SCREEN.'};
    if(/SamsungBrowser/i.test(ua))return{title:'INSTALL DTR IN SAMSUNG INTERNET',message:'OPEN THE SAMSUNG INTERNET MENU (☰), THEN CHOOSE ADD PAGE TO → HOME SCREEN.'};
    if(isAndroid(ua))return{title:'INSTALL DTR ON ANDROID',message:'OPEN THE BROWSER MENU (⋮), THEN CHOOSE INSTALL APP OR ADD TO HOME SCREEN.'};
    return{title:'ADD DTR TO HOME SCREEN',message:'OPEN YOUR BROWSER MENU AND CHOOSE INSTALL APP OR ADD TO HOME SCREEN.'};
  }

  function showManualInstructions(){
    const instructions=manualInstructions();
    showPanel({kicker:'MANUAL INSTALL',...instructions,primaryLabel:'GOT IT',onPrimary:hidePanel});
  }

  function showInstallHelp(){
    if(isStandalone())return;
    if(!state.installPrompt)return showManualInstructions();
    showPanel({
      kicker:'DTR COMMAND APP',title:'INSTALL ON THIS DEVICE',
      message:'ADD DTR TO YOUR HOME SCREEN FOR A DEDICATED APP WINDOW AND AN OFFLINE-READY APP SHELL.',
      primaryLabel:'INSTALL APP',onPrimary:requestInstall
    });
  }

  function syncInstallState(){
    const e=elements(),installed=isStandalone();
    [e.header,e.system].forEach(button=>{
      if(!button)return;
      button.hidden=installed;
      button.dataset.installReady=state.installPrompt?'true':'false';
      button.setAttribute('aria-label',installed?'DTR is running as an installed app':'Install DTR command app');
    });
    document.documentElement.dataset.dtrPwa=installed?'installed':state.installPrompt?'install-ready':'browser';
  }

  function intercept(node,handler){
    node?.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handler();
    },true);
  }

  function bindUi(){
    const e=elements();
    intercept(e.header,showInstallHelp);
    intercept(e.system,showInstallHelp);
    intercept(e.primary,()=>state.primaryAction?.());
    intercept(e.close,hidePanel);
  }

  function announceUpdate(worker){
    if(!worker||state.updateWorker===worker)return;
    state.updateWorker=worker;
    showPanel({
      kicker:'APP UPDATE READY',title:'RESTART WITH LATEST DTR',
      message:'YOUR LOCAL WATCHLISTS AND SETTINGS STAY ON THIS DEVICE. UPDATE WHEN YOU ARE READY.',
      primaryLabel:'UPDATE NOW',onPrimary:()=>worker.postMessage({type:'SKIP_WAITING'})
    });
  }

  function watchRegistration(registration){
    if(registration.waiting&&navigator.serviceWorker.controller)announceUpdate(registration.waiting);
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener('statechange',()=>{
        if(worker.state==='installed'&&navigator.serviceWorker.controller)announceUpdate(worker);
      });
    });
  }

  async function register(){
    installStyles();
    bindUi();
    syncInstallState();
    if(!('serviceWorker'in navigator)){
      document.documentElement.dataset.dtrPwa='unsupported';
      return;
    }
    try{
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      state.registration=registration;
      document.documentElement.dataset.dtrPwa=isStandalone()?'installed':'ready';
      watchRegistration(registration);
      window.setInterval(()=>registration.update().catch(()=>{}),60*60*1000);
    }catch(error){
      document.documentElement.dataset.dtrPwa='unavailable';
      console.warn('DTR PWA registration unavailable:',String(error?.message||error));
    }
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    state.installPrompt=event;
    syncInstallState();
  });
  window.addEventListener('appinstalled',()=>{state.installPrompt=null;hidePanel();syncInstallState();});
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(state.reloading)return;
    state.reloading=true;
    window.location.reload();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')state.registration?.update().catch(()=>{});});

  window.DTRPWA={state,register,showInstallHelp,showManualInstructions,manualInstructions,syncInstallState,isStandalone};
  /* Compatibility for existing diagnostics/bootstrap: prevents the older dynamic updater from loading. */
  window.DTRPWAUpdates={state,checkForUpdate:()=>state.registration?.update().catch(()=>{}),applyUpdate:()=>state.updateWorker?.postMessage({type:'SKIP_WAITING'})};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',register,{once:true});
  else register();
})();