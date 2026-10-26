/* DTR // Trade Routes · independent workspace with reused Discovery route calculation engine. */
import { normalizeDarkstat,validateDataset } from './trade-core/trade.mjs';
import { DEFAULT_SHIP_ID,FALLBACK_SHIPS,verifyShipProfile,blockedShipDocks,dockEligibility } from './dtr-ship-profiles.mjs';
import { createShipController } from './dtr-ship-controller.mjs';
import { validateNavigation } from './trade-core/navigation.mjs';
import { groupRoutes } from './trade-core/variants.mjs';
import { findPlanetCrete, enrichBaseOwners, assessAccess, verifiedCorsairIds, setLaneSpeed, LANE_SPEED, CORSAIR_ID_NICKNAME } from './dtr-route-policy.mjs';

const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qty=n=>Number.isFinite(n)?Math.round(n).toLocaleString('en-GB'):'—';
const cash=n=>Number.isFinite(n)?'$'+Math.round(n).toLocaleString('en-GB'):'—';
const duration=n=>Number.isFinite(n)?Math.floor(Math.round(n)/60)+':'+String(Math.round(n)%60).padStart(2,'0')+' MIN':'UNKNOWN';
const dateText=iso=>{try{return new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return 'UNKNOWN';}};
const STORAGE_KEY='dtr:trade-routes:settings:v1';
const DB_NAME='dtr-trade-market-cache-v1';
const API='https://darkstat.dd84ai.com/api';
const POB_MARKET_MAX_AGE_MS=5*60*1000;
let started=false,busy=false,dataset=null,navigation=null,factions=[],corsairIds=[],npcBases=[],pobSource=[];
let dataMode='none',profile=FALLBACK_SHIPS.find(ship=>ship.id===DEFAULT_SHIP_ID),routeMode='auto';
let startId='',startPreferredId='',startTouched=false,worker=null,results=[],lastStats=null,activeOptions=null;
let access=null,requests=0,detailIndex=-1,loadedAt=0,pickerTimer=0;
let pobLoadedAt=0,marketInFlight=null,pobRefreshInFlight=null,preparingSearch=false,pobRefreshError='';
let idLoadedAt=0,idDataMode='none',ownerDataMode='none';
const availableRoutes=()=>window.DTRApp?.getState?.()?.view==='trade-routes';

function readPreferences(){
  try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return value&&typeof value==='object'?value:{};}catch{return{};}
}
const settings=readPreferences();
startPreferredId=typeof settings.startId==='string'?settings.startId:'';
startTouched=Boolean(settings.startTouched);
routeMode=['one','auto','two','three'].includes(settings.mode)?settings.mode:'auto';
const shipController=createShipController({
  readJson,legacySettings:settings,
  onChange(next){
    profile=next;
    markResultsStale();
    refreshControls();
  }
});
profile=shipController.getCurrent();
function savePreferences(){
  const obj={
    profile:profile.id,startId,startTouched,mode:routeMode,
    pobs:$('dtrRoutesPobs').checked,corsair:$('dtrRoutesCorsair').checked,
    includeUnverified:$('dtrRoutesUnverified').checked,
    cargo:$('dtrRoutesCargo').value,capital:$('dtrRoutesCapital').value,
    maxTime:$('dtrRoutesMaxTime').value,legs:$('dtrRoutesLegs').value,
    returnScope:$('dtrRoutesReturn').value,
    mixed:$('dtrRoutesMixed').checked,empty:$('dtrRoutesEmpty').checked,
    unknown:$('dtrRoutesUnknown').checked,depth:$('dtrRoutesDepth').value,
    sort:$('dtrRoutesSort').value
  };
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(obj));}catch{}
}
function restorePreferences(){
  const saved=settings;
  for(const [id,key] of [
    ['dtrRoutesCapital','capital'],['dtrRoutesMaxTime','maxTime'],['dtrRoutesLegs','legs'],
    ['dtrRoutesReturn','returnScope'],['dtrRoutesDepth','depth'],['dtrRoutesSort','sort']]){
    const node=$(id),value=saved[key];
    if(node&&value!==undefined&&[...node.options||[]].some(opt=>opt.value===String(value)))node.value=String(value);
    else if(node&&value!==undefined&&node.type==='number'&&Number(value)>=0)node.value=String(value);
  }
  for(const [id,key,defaultValue] of [
    ['dtrRoutesPobs','pobs',false],['dtrRoutesCorsair','corsair',true],
    ['dtrRoutesMixed','mixed',true],['dtrRoutesEmpty','empty',false],
    ['dtrRoutesUnknown','unknown',false],['dtrRoutesUnverified','includeUnverified',false]]){
    $(id).checked=typeof saved[key]==='boolean'?saved[key]:defaultValue;
  }
  document.querySelectorAll('#tradeRoutesView input[name="dtrRoutesMode"]').forEach(input=>{
    input.checked=input.value===(routeMode==='one'?'one':'auto');
  });
}
function notice(text,tone='warn'){
  const n=$('dtrRoutesNotice');
  n.textContent=text||'';n.hidden=!text;n.dataset.tone=tone;
}
function status(text,tone='warn'){
  const el=$('dtrRoutesState');el.dataset.tone=tone;el.querySelector('span').textContent=text;
}
function isReady(){return Boolean(dataset&&navigation)}
function refreshControls(){
  const updating=Boolean(marketInFlight||pobRefreshInFlight||preparingSearch);
  $('dtrRoutesSearch').disabled=!isReady()||busy||updating;
  $('dtrRoutesRefresh').disabled=busy||updating;
  $('dtrRoutesCancel').hidden=!busy;
  $('dtrRoutesProgress').hidden=!busy;
  $('dtrRoutesSettingsSummary').textContent=[
    profile.name.toUpperCase(),qty(profile.cargo)+' MAX CARGO',profile.cruise+' CRUISE',
    profile.dockLabel+' DOCK',
    $('dtrRoutesPobs').checked?'POBS ON':'POBS OFF',
    $('dtrRoutesCorsair').checked?'CORSAIR ON':'CORSAIR OFF',
    $('dtrRoutesCorsair').checked?$('dtrRoutesUnverified').checked?'UNVERIFIED DOCKS OPT-IN':'STRICT DOCK FILTER':'DOCKING NOT VERIFIED',
    routeMode==='one'?'ONE WAY':'RETURN TRADE',
    qty(Number($('dtrRoutesCapital').value||0))+' $ CAPITAL',
    $('dtrRoutesMixed').checked?'MIXED CARGO':'ONE GOOD PER LEG'
  ].join(' // ');
  const accessNote=$('dtrRoutesAccessNote');
  if(!$('dtrRoutesCorsair').checked)accessNote.textContent='CORSAIR FILTER OFF // NO ID DOCK CHECK. VERIFY ACCESS FOR YOUR OWN FACTION.';
  else if(!access?.indexReady)accessNote.textContent='CORSAIR ON // ID REPHACK DATA UNAVAILABLE. UNKNOWN DOCKS BLOCKED. TRY FORCE MARKET UPLINK OR EXPLICITLY OPT IN TO UNVERIFIED BASES AT YOUR OWN RISK.';
  else accessNote.textContent='CORSAIRS ID REPHACKS // '+qty(access.ruleCount)+' RULES // '+qty(access.counts.restricted)+' RESTRICTED // '+qty(access.counts.unverified)+' UNVERIFIED'+
    (access.includeUnverified?' (MANUALLY INCLUDED)':' (EXCLUDED)')+
    ' // '+qty(access.blocked.length)+' TOTAL FILTERED. '+dockingWarning()+' PERSONAL REP / FR6 / POB ACL MAY STILL DIFFER.';
}
function dockingWarning(){
  if(!$('dtrRoutesCorsair').checked)return '';
  return [idDataMode==='cached'?'CACHED CORSAIR ID RULES':null,
    ownerDataMode==='cached'?'CACHED NPC OWNERS':null].filter(Boolean).join(' // ');
}
function selectedOrigin(){
  return dataset?.bases?.find(b=>b.id===startId)||null;
}
function applyOrigin(){
  if(!dataset)return;
  const candidate=startPreferredId?dataset.bases.find(b=>b.id===startPreferredId):null;
  const fallback=findPlanetCrete(dataset.bases);
  const selected=candidate&&($('dtrRoutesPobs').checked||candidate.kind!=='pob')?candidate:
    startTouched?null:fallback;
  startId=selected?.id||'';
  const el=$('dtrRoutesStartLabel');
  if(el)el.textContent=selected?selected.name.toUpperCase()+' // '+(selected.systemName||selected.system||'UNKNOWN SYSTEM').toUpperCase():
    startTouched?'SELECT A STARTING BASE':'PLANET CRETE NOT FOUND // SELECT BASE';
  if(!selected&&!startTouched&&dataMode!=='none')notice('Planet Crete was not uniquely found in the live market feed. Please select a starting base.','warn');
}
function syncAccess(){
  if(!dataset)return;
  access=assessAccess(dataset.bases,$('dtrRoutesCorsair').checked,factions,{
    includeUnverified:$('dtrRoutesUnverified').checked,tractors:corsairIds
  });
  const origin=selectedOrigin();
  if(origin&&$('dtrRoutesCorsair').checked&&access.blocked.includes(origin.id))
    notice('This start base is restricted or unverified for Corsairs. Choose another base or check your faction and docking settings. Known denied bases stay blocked.','warn');
}
function setRouteMode(mode){
  routeMode=['one','auto','two','three'].includes(mode)?mode:'auto';
  document.querySelectorAll('#tradeRoutesView input[name="dtrRoutesMode"]').forEach(i=>{i.checked=i.value===(routeMode==='one'?'one':'auto')});
  markResultsStale();
  refreshControls();savePreferences();
}
function dbOpen(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(Error('Browser has no IndexedDB'));
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshot');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function cacheRead(){
  const db=await dbOpen();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('snapshot').objectStore('snapshot').get('latest');
    req.onsuccess=()=>{db.close();resolve(req.result||null)};
    req.onerror=()=>{db.close();reject(req.error)};
  });
}
async function cacheWrite(value){
  const db=await dbOpen();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('snapshot','readwrite');
    tx.objectStore('snapshot').put(value,'latest');
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{db.close();reject(tx.error)};
  });
}
async function readJson(path,body,signal){
  const init={method:'POST',headers:{Accept:'application/json'},cache:'no-store',signal};
  if(body!==undefined){init.body=JSON.stringify(body);init.headers['Content-Type']='application/json';}
  let response=await fetch(API+'/'+path,init);
  if(response.status===405){
    const q=body?'?'+new URLSearchParams(Object.entries(body).map(([k,v])=>[k,String(v)])):'';
    response=await fetch(API+'/'+path+q,{headers:{Accept:'application/json'},signal,cache:'no-store'});
  }
  if(!response.ok)throw Error('Darkstat '+path+' HTTP '+response.status);
  const text=await response.text();
  if(text.length>70*1024*1024)throw Error('Market response is too large');
  return JSON.parse(text);
}
async function loadNavigation(){
  const response=await fetch('./trade-core/data/navigation.json.gz');
  if(!response.ok)throw Error('Navigation map '+response.status+' // cannot calculate flight time.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  let text;
  if(bytes[0]===31&&bytes[1]===139){
    if(typeof DecompressionStream!=='function')throw Error('This browser cannot unpack the route map. Update Samsung Internet.');
    text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }else text=new TextDecoder().decode(bytes);
  const raw=JSON.parse(text);
  return validateNavigation(setLaneSpeed(raw,LANE_SPEED));
}
function validatePobFeed(pobs){
  if(typeof window.DTRApp?.validateTelemetry!=='function')throw Error('POB data validation is unavailable. Update the app and retry.');
  return window.DTRApp.validateTelemetry(pobs);
}
async function saveMarketCache(){
  try{await cacheWrite({dataset,factions,corsairIds,loadedAt,pobLoadedAt,idLoadedAt})}catch{}
}
async function marketRefresh(){
  if(busy)return false;
  if(marketInFlight)return marketInFlight;
  if(pobRefreshInFlight){await pobRefreshInFlight;return marketRefresh();}
  marketInFlight=loadMarket();
  refreshControls();
  try{return await marketInFlight;}
  finally{marketInFlight=null;refreshControls();renderSource();}
}
async function loadMarket(){
  status('CONTACTING DARKSTAT','warn');
  const id=++requests;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),22000);
  try{
    const [pobs,commodities,owners,rep,ids]=await Promise.all([
      readJson('pobs',undefined,controller.signal),
      readJson('commodities',{include_market_goods:true,filter_to_useful:true},controller.signal),
      readJson('npc_bases',{},controller.signal).catch(()=>[]),
      readJson('factions',{include_reputations:false,include_bribes:false,filter_to_useful:false},controller.signal).catch(()=>[]),
      readJson('tractors',{include_rephacks:true,filter_nicknames:[CORSAIR_ID_NICKNAME]},controller.signal).catch(()=>[])
    ]);
    if(requests!==id)return;
    validatePobFeed(pobs);
    const parsed=normalizeDarkstat(pobs,commodities);
    if(!parsed.bases.some(b=>b.offers.length))throw Error('Market feed contains no usable offers.');
    const hasOwners=Array.isArray(owners)&&owners.length>0&&owners.every(row=>
      row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.nickname==='string'&&row.nickname.trim());
    const previousOwners=(dataset?.bases||[]).filter(base=>base.kind==='npc').map(base=>({
      nickname:base.id,faction_nickname:base.factionNickname,faction_name:base.factionName,docking:base.dockingMode
    }));
    pobSource=pobs;npcBases=hasOwners?owners:[];
    if(Array.isArray(rep)&&rep.length)factions=rep;
    const freshIds=verifiedCorsairIds(ids),previousIds=verifiedCorsairIds(corsairIds);
    corsairIds=freshIds||previousIds||[];
    idDataMode=freshIds?'live':previousIds?'cached':'none';
    if(freshIds)idLoadedAt=Date.now();
    parsed.bases=enrichBaseOwners(parsed,npcBases,pobs,commodities,previousOwners);
    const npcRows=parsed.bases.filter(base=>base.kind==='npc');
    ownerDataMode=npcRows.some(base=>base.ownerSource==='cache')?'cached':
      hasOwners?'live':npcRows.some(base=>base.ownerSource==='market')?'market':'none';
    closeRouteDetail();
    dataset=parsed;dataMode='live';loadedAt=Date.now();pobLoadedAt=loadedAt;pobRefreshError='';results=[];lastStats=null;
    await saveMarketCache();
    applyOrigin();syncAccess();refreshControls();renderSource();renderResults();
    notice(access.indexReady?[dockingWarning(),'CORSAIRS ID REPHACKS ACTIVE // CHECK PERSONAL REP AND BASE ACCESS IN GAME.'].filter(Boolean).join(' // '):'CORSAIRS ID DATA UNAVAILABLE // UNKNOWN DOCKS BLOCKED BY DEFAULT.','warn');
    status('MARKET UPLINK SECURE','good');
    return true;
  }catch(e){
    if(requests!==id)return;
    if(dataset){dataMode='cached';idDataMode=verifiedCorsairIds(corsairIds)?'cached':'none';ownerDataMode='cached';
      status('CACHED MARKET DATA','warn');notice('Darkstat unavailable. Existing market snapshot retained: '+e.message,'warn');}
    else {dataMode='offline';status('MARKET FEED OFFLINE','danger');notice('Live market unavailable: '+e.message+'. Try FORCE MARKET UPLINK.','danger');}
    return false;
  }finally{
    clearTimeout(timeout);
  }
}
function pobMarketStale(){
  return !pobLoadedAt||Date.now()-pobLoadedAt>=POB_MARKET_MAX_AGE_MS;
}
function mergePobSnapshot(pobs){
  const goods=new Map();
  for(const base of dataset.bases)for(const offer of base.offers){
    const previous=goods.get(offer.id);
    goods.set(offer.id,{volume:previous?.volume??offer.volume,
      volumes:{...previous?.volumes,...offer.volumes}});
  }
  const fresh=normalizeDarkstat(pobs,[]);
  if(!fresh.bases.length)throw Error('POB response contains no usable market records.');
  for(const base of fresh.bases)for(const offer of base.offers){
    const good=goods.get(offer.id);
    offer.volume=offer.volume??good?.volume??null;
    offer.volumes=good?.volumes||{};
  }
  const pobsWithOwners=enrichBaseOwners(fresh,[],pobs);
  const ids=new Set(pobsWithOwners.map(base=>base.id));
  return {...dataset,bases:[...dataset.bases.filter(base=>base.kind!=='pob'&&!ids.has(base.id)),...pobsWithOwners]};
}
async function refreshPobMarket(){
  if(!dataset||!$('dtrRoutesPobs').checked||busy)return false;
  if(marketInFlight)return marketInFlight;
  if(pobRefreshInFlight)return pobRefreshInFlight;
  if(!pobMarketStale())return true;
  pobRefreshInFlight=loadPobMarket();
  refreshControls();
  try{return await pobRefreshInFlight;}
  finally{pobRefreshInFlight=null;refreshControls();renderSource();}
}
async function loadPobMarket(){
  status('UPDATING POB STOCK AND PRICES','warn');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),22000);
  try{
    const telemetry=window.DTRApp?.getState?.();
    const at=telemetry?.last?new Date(telemetry.last).getTime():0;
    const reuse=telemetry?.mode==='live'&&at>0&&Date.now()-at<POB_MARKET_MAX_AGE_MS;
    const pobs=validatePobFeed(reuse?telemetry.data:await readJson('pobs',undefined,controller.signal));
    const updated=mergePobSnapshot(pobs);
    pobSource=pobs;dataset=updated;pobLoadedAt=reuse?at:Date.now();pobRefreshError='';
    closeRouteDetail();
    results=[];lastStats=null;
    applyOrigin();syncAccess();renderResults();
    await saveMarketCache();
    status('POB MARKET UPDATED','good');
    notice('POB STOCK, PRICES, CREDITS AND STORAGE UPDATED. NPC MARKET UNCHANGED.','good');
    return true;
  }catch(e){
    pobRefreshError='POB UPLINK UNAVAILABLE // USING AN OLDER POB SNAPSHOT. VERIFY STOCK AND PRICES IN GAME. '+e.message;
    status('POB MARKET SNAPSHOT RETAINED','warn');notice(pobRefreshError,'warn');
    return false;
  }finally{clearTimeout(timeout);}
}
function renderSource(){
  $('dtrRoutesSource').textContent=!dataset?'AWAITING LIVE MARKET DATA // '+(navigation?'ROUTE MAP READY':'LOADING NAVIGATION'):
    (dataMode==='live'?'LIVE DARKSTAT FEED':'CACHED SNAPSHOT')+' // '+qty(dataset.bases.length)+' BASES // '+dateText(dataset.asOf)+
    ' // '+(navigation?qty(navigation.nodes.length)+' NAV POINTS · LANES 2,500 M/S':'NAVIGATION UNAVAILABLE')+
    ($('dtrRoutesCorsair').checked?' // ID RULES '+(idLoadedAt?dateText(idLoadedAt):'DATE UNKNOWN'):'')+
    ($('dtrRoutesPobs').checked?' // POB SNAPSHOT '+(pobLoadedAt?dateText(pobLoadedAt):'UNKNOWN')+(pobMarketStale()?' · OLDER THAN 5 MIN':''):'');
}
function readParams(){
  if(!isReady())throw Error('Wait for the live market and navigation map.');
  syncAccess();
  if(!verifyShipProfile(profile))throw Error('Select a valid ship profile with cargo, cruise speed and docking class.');
  if(!$('dtrRoutesForm').reportValidity())throw Error('Check input fields.');
  const origin=selectedOrigin();
  if(!origin)throw Error('Please select a valid starting base. Crete may be unavailable in this market snapshot.');
  if(!$('dtrRoutesPobs').checked&&origin.kind==='pob')throw Error('To start at a POB, enable INCLUDE POBs.');
  if($('dtrRoutesCorsair').checked&&access?.blocked.includes(origin.id))
    throw Error('Starting base is excluded by the Corsair dock filter. Known restrictions always stay blocked. Unverified docks require explicit opt-in in Advanced Search.');
  if(dockEligibility(origin.id,profile,navigation)==='blocked')
    throw Error('Selected ship cannot physically dock at the starting base. Choose another ship or start location.');
  if(shipDockBlocked(origin.id))
    throw Error('Ship docking at the starting base is unverified. Choose another base or explicitly include unverified docks.');
  const cargo=Number($('dtrRoutesCargo').value);
  if(!(cargo>0&&cargo<=profile.cargo))throw Error('Cargo volume exceeds selected cargo class.');
  const capital=Number($('dtrRoutesCapital').value);
  if(!(capital>=0))throw Error('Trading capital must not be negative.');
  const mode=routeMode==='one'?'one':$('dtrRoutesLegs').value;
  const block=access?.blocked||[];
  const shipBlocked=shipDockBlocks();
  if($('dtrRoutesCorsair').checked&&!access?.indexReady&&!$('dtrRoutesUnverified').checked)
    throw Error('Corsairs ID rephack data unavailable. Strict screening blocks unknown stations. Try FORCE MARKET UPLINK or deliberately opt in to unverified docks.');
  return {
    mode,start:origin.id,cargo,capital,
    excludePobs:!$('dtrRoutesPobs').checked,
    blocked:[...new Set([...($('dtrRoutesCorsair').checked?block:[]),...shipBlocked])],
    allowUnknownTime:$('dtrRoutesUnknown').checked,
    returnScope:$('dtrRoutesReturn').value,returnSystem:'',
    flexiblePickups:true,allowEmptyReturn:$('dtrRoutesEmpty').checked,
    mixedCargo:$('dtrRoutesMixed').checked,
    maxMinutes:Number($('dtrRoutesMaxTime').value),
    sort:$('dtrRoutesSort').value,breadth:Number($('dtrRoutesDepth').value),
    searchMs:12000,mixedMs:3500,maxChecks:8000,
    timeModel:{dock:30,jump:15,lane:10,charge:5}
  };
}
function shipDockBlocked(id){
  const state=dockEligibility(id,profile,navigation);
  return state==='blocked'||(state==='unknown'&&!$('dtrRoutesUnverified').checked);
}
function shipDockBlocks(){
  return blockedShipDocks(dataset?.bases||[],profile,navigation,{blockUnknown:!$('dtrRoutesUnverified').checked});
}
function screenRoutes(rows){
  if(!Array.isArray(rows)||!dataset||!activeOptions)return [];
  syncAccess();
  const bases=byId(),blocked=new Set([...(activeOptions.blocked||[]),...shipDockBlocks(),
    ...($('dtrRoutesCorsair').checked?access?.blocked||[]:[])]);
  const allowed=id=>bases.has(id)&&!blocked.has(id)&&(!activeOptions.excludePobs||bases.get(id).kind!=='pob');
  return rows.filter(route=>Array.isArray(route?.legs)&&route.legs.length&&
    (!activeOptions.start||route.legs[0]?.source===activeOptions.start)&&
    route.legs.every(leg=>allowed(leg?.source)&&allowed(leg?.target)));
}
function closeRouteDetail(){
  const dialog=$('dtrRoutesDetailDialog');
  if(dialog?.open)dialog.close();
  detailIndex=-1;
}
function searchWorker(){
  if(worker)return worker;
  worker=new Worker('./trade-core/worker.mjs',{type:'module'});
  worker.onmessage=({data})=>{
    if(data.id!==requests)return;
    if(data.type==='progress'){
      $('dtrRoutesProgress').textContent=data.phase==='offers'
        ?'COMPARING '+qty(data.candidates)+' TRADE PAIRS...'
        :'CHECKING '+qty(data.checked||data.considered||0)+' ROUTES // '+qty(data.found||0)+' FOUND';
    }else if(data.type==='result'){
      const received=Array.isArray(data.result?.results)?data.result.results:[];
      busy=false;results=screenRoutes(received);lastStats=data.result?.stats||null;
      status('ROUTE SEARCH COMPLETE','good');
      refreshControls();renderResults();
      const warnings=[];
      if(received.length>results.length)warnings.push('ROUTES WITH RESTRICTED OR UNVERIFIED DOCKING WERE REMOVED. RECALCULATE WITH YOUR CURRENT FILTERS.');
      if(dockingWarning())warnings.push(dockingWarning());
      if(activeOptions?.excludePobs===false&&pobRefreshError)warnings.push(pobRefreshError);
      if(lastStats?.partial)warnings.push('SEARCH BUDGET REACHED // BEST CHECKED CANDIDATES SHOWN. MORE ROUTES MAY EXIST.');
      if(warnings.length)notice(warnings.join(' // '),'warn');
    }else if(data.type==='error'){
      busy=false;status('ROUTE SEARCH FAILED','danger');notice('Calculation failed: '+data.message,'danger');refreshControls();
    }
  };
  worker.onerror=e=>{busy=false;notice('Trade calculation worker failed: '+(e.message||'Unknown error'),'danger');status('WORKER ERROR','danger');refreshControls()};
  return worker;
}
function markResultsStale(){
  closeRouteDetail();
  activeOptions=null;
  if(busy){
    worker?.postMessage({type:'cancel'});
    requests++;busy=false;
    status('FLIGHT PROFILE CHANGED // RECALCULATE','warn');
    refreshControls();
  }
  if(!results.length&&!lastStats)return;
  results=[];lastStats=null;
  renderResults();
  notice('ROUTE SETTINGS CHANGED // RECALCULATE TO APPLY THE NEW FILTERS.','warn');
}
async function runSearch(){
  if(preparingSearch)return;
  if(busy){worker?.postMessage({type:'cancel'});requests++;busy=false;}
  let options;try{options=readParams()}catch(e){notice(e.message,'warn');return;}
  if(marketInFlight||!options.excludePobs){
    preparingSearch=true;refreshControls();
    try{await (marketInFlight||refreshPobMarket());}
    finally{preparingSearch=false;refreshControls();}
    try{options=readParams()}catch(e){notice(e.message,'warn');return;}
  }
  activeOptions=options;savePreferences();notice([dockingWarning(),options.excludePobs?'':pobRefreshError].filter(Boolean).join(' // '), 'warn');
  closeRouteDetail();
  busy=true;results=[];lastStats=null;
  $('dtrRoutesProgress').textContent='EVALUATING PROFITABLE MARKET CONNECTIONS...';
  $('dtrRoutesResults').innerHTML='<div class="dtr-routes-empty"><strong>SEARCHING DISCOVERY MARKETS</strong><p>Evaluating cargo, prices, docking predictions, storage and flight time.</p></div>';
  status('ROUTE CALCULATION ACTIVE','warn');refreshControls();
  searchWorker().postMessage({type:'search',id:++requests,dataset,navigation,profile,options});
}
function abortSearch(){
  if(!busy)return;
  worker?.postMessage({type:'cancel'});requests++;busy=false;
  status('SEARCH CANCELED','warn');notice('Search canceled by operator.','warn');refreshControls();
}
function byId(){return new Map((dataset?.bases||[]).map(b=>[b.id,b]));}
function routeStops(route,baseMap=byId()){
  const stops=[route.legs[0]?.source,...route.legs.map(l=>l.target)];
  return stops.map(id=>baseMap.get(id)?.name||id);
}
function accessTag(id){
  const info=access?.byId.get(id);
  const labels={likely:'LIKELY ACCESS — NOT GUARANTEED',restricted:'NO DOCK / RESTRICTED',unverified:'ACCESS UNVERIFIED'};
  const shipDock=dockEligibility(id,profile,navigation);
  const state=shipDock==='blocked'?'restricted':info?.state==='restricted'?'restricted':
    shipDock==='unknown'?'unverified':info?.state||'unverified';
  const physical=shipDock==='allowed'?'SHIP DOCK COMPATIBLE':shipDock==='blocked'?'SHIP DOCK DENIED':'SHIP DOCKING UNVERIFIED';
  return '<span data-access="'+escape(state)+'" title="'+escape(info?.reason||'PERSONAL REPUTATION UNKNOWN')+'">'+
    escape(labels[state]+' // '+physical)+'</span>';
}
function resultCard(group,index,baseMap){
  const head=group.entries[0],route=head.route;
  const stops=routeStops(route,baseMap);
  const names=group.names.slice(0,5).join(' → ')||stops.join(' → ');
  const label=route.roundTrip?'ROUND TRIP':'ONE WAY';
  const alt=group.entries.slice(1);
  return '<article class="dtr-routes-result">'+
    '<div class="dtr-routes-result-top"><div><small>ROUTE '+String(index+1).padStart(2,'0')+' // '+label+'</small>'+
      '<strong>'+escape(names)+'</strong></div>'+
      '<div class="dtr-routes-result-profit">'+cash(route.profit)+'<small>PROFIT / ROUTE</small></div></div>'+
    '<div class="dtr-routes-result-meta"><span>'+duration(route.seconds)+'</span><span>'+cash(route.hourly)+' / HOUR</span>'+
      '<span>'+qty(route.jumps)+' JUMPS</span><span>'+qty(route.tradeCount)+' TRADE LEGS</span>'+
      (route.mixed?'<span>MIXED CARGO</span>':'')+
    '</div><div class="dtr-routes-result-actions"><button type="button" data-dtr-route-detail="'+head.index+'">OPEN MANIFEST / ROUTE</button></div>'+
    (alt.length?'<details class="dtr-routes-variants"><summary>+'+qty(alt.length)+' ALTERNATIVE'+(alt.length===1?'':'S')+' FOR THIS ROUTE</summary>'+
      alt.slice(0,5).map((item,i)=>variantRow(item,i)).join('')+
      (alt.length>5?'<div class="dtr-routes-variant" data-dtr-variant-more="'+index+'" data-start="5"><span>MORE OPTIONS AVAILABLE</span><button type="button" data-dtr-route-more="'+index+'">SHOW MORE</button></div>':'')+
    '</details>':'')+'</article>';
}
function variantRow(item,i){
  const r=item.route;
  return '<div class="dtr-routes-variant"><span>VARIANT '+(i+2)+' // '+cash(r.profit)+' PROFIT // '+duration(r.seconds)+'</span>'+
    '<button type="button" data-dtr-route-detail="'+item.index+'">VIEW</button></div>';
}
function renderResults(){
  const out=$('dtrRoutesResults');
  if(!dataset){out.innerHTML='<div class="dtr-routes-empty"><strong>NO MARKET FEED</strong><p>Connect to Darkstat to calculate trade routes.</p></div>';return;}
  if(!results.length){
    out.innerHTML='<div class="dtr-routes-empty"><strong>'+ (lastStats?'NO MATCHING ROUTES':'READY TO CALCULATE')+'</strong><p>'+
      (lastStats?'Try increasing the route time, allowing POBs with appropriate access, choosing another start base or checking the selected ship.':'Select your cargo class, then press CALCULATE TRADE ROUTES.')+'</p></div>';
    $('dtrRoutesResultsFoot').textContent=lastStats?'0 MATCHING ROUTES // '+qty(lastStats.excludedBases||0)+' FILTERED':'LIVE MARKET DATA READY // PRESS CALCULATE';
    return;
  }
  const groups=groupRoutes(results,byId(),$('dtrRoutesSort').value);
  out.innerHTML=groups.slice(0,18).map((g,i)=>resultCard(g,i,byId())).join('');
  $('dtrRoutesResultsFoot').textContent=qty(groups.length)+' ROUTE FAMILIES // '+qty(results.length)+' CHECKED VARIANTS // '+
    qty(lastStats?.excludedBases||0)+' MARKET BASES FILTERED // ESTIMATED FLIGHT TIME';
}
function showMore(groupIndex,button){
  const groups=groupRoutes(results,byId(),$('dtrRoutesSort').value);
  const entries=groups[groupIndex]?.entries.slice(1)||[];
  const row=button.closest('[data-dtr-variant-more]');if(!row)return;
  const start=Number(row.dataset.start)||5;
  const newRows=entries.slice(start,start+5);
  row.insertAdjacentHTML('beforebegin',newRows.map((item,i)=>variantRow(item,start+i)).join(''));
  row.dataset.start=String(start+newRows.length);
  if(start+newRows.length>=entries.length)row.remove();
}
function openDetail(idx){
  const route=results[idx];if(!route||!dataset)return;
  if(!screenRoutes([route]).length){
    closeRouteDetail();results=screenRoutes(results);renderResults();
    notice('This route no longer matches your docking filters. Recalculate trade routes.','warn');return;
  }
  detailIndex=idx;
  const bases=byId(),stops=routeStops(route,bases);
  $('dtrRoutesDetailTitle').textContent=route.roundTrip?'Round Trip Manifest':'One Way Manifest';
  const head='<div class="dtr-routes-detail-lead">'+
    '<div><small>EST. PROFIT</small><strong>'+cash(route.profit)+'</strong></div>'+
    '<div><small>PROFIT / HOUR</small><strong>'+cash(route.hourly)+'</strong></div>'+
    '<div><small>FLIGHT TIME</small><strong>'+duration(route.seconds)+'</strong></div>'+
    '</div>';
  const segments=route.legs.map((leg,i)=>{
    const from=bases.get(leg.source),to=bases.get(leg.target);
    const cargo=route.loads?.[i]||[];
    const transfers=cargo.map(item=>'<p>BUY '+qty(item.quantity)+' × '+escape(item.name)+
       ' @ '+cash(item.buy) +' → SELL @ '+cash(item.sell)+' // '+qty(item.quantity*item.volume)+' CARGO VOL.</p>').join('');
    return '<section class="dtr-routes-leg"><small>LEG '+String(i+1).padStart(2,'0')+' // '+(cargo.length?'CARGO TRANSFER':'EMPTY APPROACH / RETURN')+'</small>'+
      '<strong>'+escape(from?.name||leg.source)+' → '+escape(to?.name||leg.target)+'</strong>'+
      '<p>'+escape(from?.systemName||from?.system||'?')+' → '+escape(to?.systemName||to?.system||'?')+'</p>'+
      '<small>DESTINATION DOCKING: '+accessTag(leg.target)+'</small>'+
      (transfers||'<p>NO COMMERCIAL CARGO ON THIS LEG.</p>')+
      '</section>';
  }).join('');
  $('dtrRoutesDetailBody').innerHTML=head+segments+
    '<div class="dtr-routes-detail-note">These are planning estimates using the latest selected market snapshot. '+
    'Personal docking rights, dynamic player reputation, POB whitelists, combat and interruptions are not verified. '+
    'Verify any uncertain destinations before flying. Starting at '+escape(stops[0])+' included.</div>';
  const dialog=$('dtrRoutesDetailDialog');dialog.showModal();document.body.classList.add('modal-open');
}
function openPicker(){
  if(!dataset){notice('Connect to Darkstat before choosing a starting base.','warn');return;}
  $('dtrRoutesPickerSearch').value='';
  renderPicker('');
  $('dtrRoutesPickerDialog').showModal();document.body.classList.add('modal-open');
  $('dtrRoutesPickerSearch').focus();
}
function renderPicker(query){
  if(!dataset)return;
  const words=String(query||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered=dataset.bases.filter(b=>{
    if(!$('dtrRoutesPobs').checked&&b.kind==='pob')return false;
    const haystack=(b.name+' '+(b.systemName||b.system||'')+' '+b.id).toLowerCase();
    return words.every(w=>haystack.includes(w));
  }).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const matches=filtered.slice(0,55);
  $('dtrRoutesPickerList').innerHTML=matches.length?matches.map(b=>{
    const ac=access?.byId.get(b.id);
    const shipDock=dockEligibility(b.id,profile,navigation);
    const state=ac?.state==='restricted'||shipDock==='blocked'?'restricted':
      shipDock==='unknown'?'unverified':ac?.state||'unverified';
    const denied=($('dtrRoutesCorsair').checked&&access?.blocked.includes(b.id))||shipDockBlocked(b.id);
    return '<button type="button" data-route-start-id="'+escape(b.id)+'" data-access="'+state+'"'+
      (denied?' disabled title="Unavailable due to ID or selected ship docking restrictions"':'')+'><strong>'+escape(b.name)+'</strong>'+
      '<small>'+escape(b.systemName||b.system||'')+' // '+(b.kind==='pob'?'POB':'NPC')+' // '+
       state.toUpperCase()+' // '+escape(shipDock==='blocked'?'SHIP DOCK DENIED':shipDock==='allowed'?'SHIP DOCK COMPATIBLE':'SHIP DOCK UNVERIFIED')+'</small></button>';
  }).join('')+'<p>'+qty(filtered.length)+' MATCHES'+(filtered.length>55?' // TYPE MORE TO FILTER':'')+'</p>':
    '<p>NO BASE MATCHES. TRY A SYSTEM OR SHORTER SEARCH TERM.</p>';
}
function selectOrigin(id){
  const base=dataset?.bases.find(b=>b.id===id);if(!base)return;
  if($('dtrRoutesCorsair').checked&&access?.blocked.includes(base.id)){
    notice('This base is excluded by the current Corsair dock filter. Change ID or explicitly include unverified docks, but known no-dock remains blocked.','warn');return;
  }
  if(dockEligibility(base.id,profile,navigation)==='blocked'){
    notice('The selected ship cannot physically dock at that base. Try another ship or start location.','warn');return;
  }
  if(shipDockBlocked(base.id)){
    notice('Ship docking at that base is unverified. Choose another base or explicitly include unverified docks.','warn');return;
  }
  startId=base.id;startPreferredId=id;startTouched=true;
  applyOrigin();syncAccess();markResultsStale();refreshControls();savePreferences();
  $('dtrRoutesPickerDialog').close();document.body.classList.remove('modal-open');
}
function closeDialog(id){
  const dialog=$(id);
  dialog?.close();document.body.classList.remove('modal-open');
}
function bind(){
  restorePreferences();
  $('dtrRoutesForm').addEventListener('submit',e=>{e.preventDefault();runSearch();});
  $('dtrRoutesStartPicker').addEventListener('click',openPicker);
  $('dtrRoutesPickerSearch').addEventListener('input',e=>{clearTimeout(pickerTimer);pickerTimer=setTimeout(()=>renderPicker(e.target.value),110)});
  $('dtrRoutesRefresh').addEventListener('click',marketRefresh);
  $('dtrRoutesCancel').addEventListener('click',abortSearch);
  $('tradeRoutesView').addEventListener('click',e=>{
    const opt=e.target.closest('[data-route-start-id]');
    if(opt){selectOrigin(opt.dataset.routeStartId);return;}
    const details=e.target.closest('[data-dtr-route-detail]');
    if(details){openDetail(Number(details.dataset.dtrRouteDetail));return;}
    const more=e.target.closest('[data-dtr-route-more]');
    if(more){showMore(Number(more.dataset.dtrRouteMore),more);return;}
    const close=e.target.closest('[data-route-close]');
    if(close&&close.dataset.routeClose!=='dtrRoutesShipDialog')closeDialog(close.dataset.routeClose);
  });
  $('tradeRoutesView').addEventListener('change',e=>{
    if(e.target.id==='dtrRoutesSort'){
      savePreferences();
      if(!busy)renderResults();
      return;
    }
    if(e.target.name==='dtrRoutesMode'){setRouteMode(e.target.value);return;}
    if(e.target.id==='dtrRoutesCorsair'||e.target.id==='dtrRoutesUnverified'){syncAccess();renderSource();}
    if(e.target.id==='dtrRoutesPobs'){applyOrigin();renderSource();}
    markResultsStale();
    refreshControls();savePreferences();
  });
  $('tradeRoutesView').addEventListener('input',e=>{
    if(e.target.id==='dtrRoutesPickerSearch'||e.target.id==='dtrRoutesShipSearch')return;
    if(e.target.id==='dtrRoutesCargo')markResultsStale();
    refreshControls();
  });
  for(const id of ['dtrRoutesPickerDialog','dtrRoutesDetailDialog']){
    $(id).addEventListener('close',()=>document.body.classList.remove('modal-open'));
  }
  refreshControls();
}
async function bootstrap(){
  if(started)return;
  started=true;
  // Lazy-load the DTR-themed workspace only when Trade Routes is first opened.
  // Keep the original section node because the main app holds a reference to it.
  const root=$('tradeRoutesView');
  try {
    const response=await fetch('./dtr-trade-panel.html');
    if(!response.ok)throw Error('Trade Routes panel HTTP '+response.status);
    const template=document.createElement('template');
    template.innerHTML=await response.text();
    const section=template.content.querySelector('#tradeRoutesView');
    if(!section)throw Error('Trade Routes panel markup invalid');
    root.replaceChildren(...section.childNodes);
  } catch (error) {
    root.innerHTML='<div class="dtr-routes-empty"><strong>TRADE ROUTES UNAVAILABLE</strong><p>'+escape(error.message)+'</p></div>';
    return;
  }
  bind();
  shipController.mount();
  renderSource();
  status('LOADING ROUTE MAP','warn');
  // Cache can improve cold start; cached trading prices always retain their timestamp.
  try{
    const cached=await cacheRead();
    if(cached?.dataset?.schema===1){
      const restored=validateDataset(cached.dataset);
      if(!restored.bases.some(base=>base.offers.length))throw Error('Cached market has no usable offers.');
      dataset=restored;factions=Array.isArray(cached.factions)?cached.factions:[];
      // Previous cached market snapshots had only NPC faction relationships.
      // They must NOT be interpreted as Corsairs ID rephacks.
      corsairIds=verifiedCorsairIds(cached.corsairIds)||[];
      dataMode='cached';loadedAt=cached.loadedAt||0;
      pobLoadedAt=Number(cached.pobLoadedAt)||loadedAt;
      idLoadedAt=Number(cached.idLoadedAt)||loadedAt;
      idDataMode=corsairIds.length?'cached':'none';ownerDataMode='cached';
      applyOrigin();syncAccess();renderSource();refreshControls();
      status('CACHED MARKET SNAPSHOT','warn');
    }
  }catch{}
  try{
    navigation=await loadNavigation();
    renderSource();refreshControls();
  }catch(e){status('ROUTE MAP UNAVAILABLE','danger');notice(e.message,'danger');}
  if(navigation)await marketRefresh();
}
window.addEventListener('dtr:statechange',()=>{
  if(availableRoutes()&&!started)bootstrap();
});
window.DTRTradeRoutes=Object.freeze({
  bootstrap,marketRefresh,runSearch,getState:()=>({
    started,busy,mode:routeMode,startId,profile:profile.id,
    ship:{name:profile.name,cargo:profile.cargo,cruise:profile.cruise,dock:profile.dockLabel},
    ships:shipController.getRegistryStatus(),favorites:shipController.getFavorites(),
    corsair:$('dtrRoutesCorsair')?.checked,pobs:$('dtrRoutesPobs')?.checked,
    includeUnverified:$('dtrRoutesUnverified')?.checked,blockedByDockPolicy:access?.blocked.length??0,
    idRepSource:access?.idSource||null,idRepRuleCount:access?.ruleCount??0,
    idDataMode,idLoadedAt,ownerDataMode,
    marketMode:dataMode,pobLoadedAt,pobMarketStale:$('dtrRoutesPobs')?.checked?pobMarketStale():false,
    marketUpdating:Boolean(marketInFlight||pobRefreshInFlight),navigationReady:Boolean(navigation),resultCount:results.length,
    accessCounts:access?.counts||null
  })
});
if(document.readyState!=='loading'&&availableRoutes())bootstrap();
