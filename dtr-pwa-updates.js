/* DTR POB Network · controlled PWA updates inspired by RHW. */
(()=>{
  'use strict';
  if(window.DTRPWAUpdates)return;

  const state={registration:null,updateWorker:null,reloading:false,announcedWorker:null};
  const $=id=>document.getElementById(id);

  function elements(){
    return{sheet:$('updateSheet'),title:$('updateTitle'),message:$('updateMessage'),primary:$('updatePrimary'),close:$('updateClose')};
  }

  function showUpdate(worker){
    if(!worker||state.announcedWorker===worker)return;
    state.updateWorker=worker;
    state.announcedWorker=worker;
    const e=elements();
    if(!e.sheet)return;
    e.title.textContent='RESTART WITH LATEST DTR';
    e.message.textContent='A NEW DTR COMMAND BUILD IS READY. LOCAL WATCHLISTS AND SETTINGS STAY ON THIS DEVICE.';
    e.primary.textContent='UPDATE NOW';
    e.sheet.hidden=false;
    document.body.classList.add('modal-open');
  }

  function hideUpdate(){
    const e=elements();
    if(e.sheet)e.sheet.hidden=true;
    document.body.classList.remove('modal-open');
  }

  function applyUpdate(){
    const worker=state.updateWorker||state.registration?.waiting;
    if(!worker)return;
    const e=elements();
    if(e.primary){e.primary.disabled=true;e.primary.textContent='UPDATING…';}
    worker.postMessage({type:'SKIP_WAITING'});
  }

  function inspectWaiting(){
    const waiting=state.registration?.waiting;
    if(waiting&&navigator.serviceWorker.controller)showUpdate(waiting);
  }

  function watchRegistration(registration){
    inspectWaiting();
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed'&&navigator.serviceWorker.controller){
          showUpdate(registration.waiting||worker);
        }
      });
    });
  }

  async function checkForUpdate(){
    const registration=state.registration;
    if(!registration||!navigator.onLine)return;
    try{await registration.update();}catch{}
    inspectWaiting();
  }

  async function register(){
    const e=elements();
    e.primary?.addEventListener('click',applyUpdate);
    e.close?.addEventListener('click',hideUpdate);
    e.sheet?.addEventListener('click',event=>{if(event.target===e.sheet)hideUpdate();});

    if(!('serviceWorker'in navigator))return;
    try{
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      state.registration=registration;
      watchRegistration(registration);
      window.setInterval(checkForUpdate,60*60*1000);
    }catch(error){
      console.warn('DTR PWA UPDATE CHECK UNAVAILABLE:',String(error?.message||error));
    }
  }

  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(state.reloading)return;
    state.reloading=true;
    window.location.reload();
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')checkForUpdate();
  });
  window.addEventListener('online',checkForUpdate);

  window.DTRPWAUpdates={state,checkForUpdate,applyUpdate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',register,{once:true});
  else register();
})();
