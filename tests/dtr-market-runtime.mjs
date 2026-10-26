import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {normalizeDarkstat} from '../trade-core/trade.mjs';
import {groupRoutes} from '../trade-core/variants.mjs';
import {findPlanetCrete,enrichBaseOwners,assessAccess,verifiedCorsairIds,setLaneSpeed,LANE_SPEED,CORSAIR_ID_NICKNAME} from '../dtr-route-policy.mjs';
import {blockedShipDocks,dockEligibility,verifyShipProfile} from '../dtr-ship-profiles.mjs';

const [routeSource,appSource]=await Promise.all([
 readFile(new URL('../dtr-trade-routes.mjs',import.meta.url),'utf8'),
 readFile(new URL('../app.js',import.meta.url),'utf8')
]);
const start=appSource.indexOf('  function validateTelemetry(source)');
const end=appSource.indexOf('  function verifiedSnapshot(',start);
assert(start>0&&end>start);
const validateTelemetry=runInNewContext(appSource.slice(start,end)+'validateTelemetry;');
const profile={id:'test',name:'Test Hauler',cargo:1000,cruise:350,dock:'medium',dockType:2,dockLabel:'MID'};
const now=Date.now();
const npc=(id,name,system)=>({id,name,kind:'npc',system,systemName:system,
 factionName:'Corsairs',offers:[{id:'commodity_test',name:'Test Goods',buy:10,sell:20,
 volume:1,originalVolume:1,volumes:{freighter:3}}]});
const initial={schema:1,source:'darkstat',asOf:new Date(now-600000).toISOString(),bases:[
 {...npc('crete','Planet Crete','Omicron Gamma')},npc('buyer','Buyer','Other System'),npc('third','Third','Third System'),
 {id:'old-pob',name:'Old POB',kind:'pob',system:'gamma',cash:50,space:50,offers:[]}
]};
const freshPobs=[{nickname:'new-pob',name:'New POB',system_nickname:'gamma',system_name:'Omicron Gamma',
 base_pos:[0,0,0],money:12345,cargospace:6789,faction_name:'Corsairs',shop_items:[
  {nickname:'commodity_test',name:'Test Goods',category:'commodity',price:14,sell_price:21,
   quantity:400,min_stock:10,max_stock:1000,original_volume:2}
 ]}];
const route=(target,profit,hourly)=>({legs:[{source:'crete',target,good:'commodity_test'}],
 profit,hourly,seconds:600,tradeCount:1,jumps:0,capitalNeeded:100,roundTrip:false});
const routes=[route('buyer',100,1000),route('third',200,500)];

function runtime({includePobs=false,age=600000,telemetry={},reply=async()=>freshPobs,
 corsair=false,includeUnverified=false,market=initial,ownerFactions=[],ids=[],nav=null}={}){
 const elements=new Map(),storage=new Map(),apiCalls=[],messages=[],workers=[],snapshots=[];
 class Element{
  constructor(id){this.id=id;this.value='';this.checked=false;this.options=[];this.dataset={};
   this.innerHTML='';this.textContent='';this.listeners=new Map();this.span={textContent:''};this.open=false;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  fire(type,target=this){
   const event={target,preventDefault(){}};
   for(let node=this;node;node=node.parent)for(const fn of node.listeners.get(type)||[])fn(event);
  }
  querySelector(){return this.span;}
  reportValidity(){return true;}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
 }
 const node=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 const win={addEventListener(){},DTRApp:{validateTelemetry,
  getState(){return {view:'overview',mode:'none',...telemetry};}}};
 const box={console,Intl,Date,Map,Set,AbortController,URLSearchParams,JSON,
  window:win,document:{readyState:'loading',getElementById:node,querySelectorAll(){return[];},addEventListener(){},
   body:{classList:{add(){},remove(){}}}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  setTimeout(){return 1;},clearTimeout(){},
  normalizeDarkstat,groupRoutes,findPlanetCrete,enrichBaseOwners,assessAccess,verifiedCorsairIds,setLaneSpeed,LANE_SPEED,CORSAIR_ID_NICKNAME,
  FALLBACK_SHIPS:[profile],DEFAULT_SHIP_ID:profile.id,verifyShipProfile,
  blockedShipDocks,dockEligibility,validateNavigation:value=>value,
  createShipController:()=>({getCurrent:()=>profile,getRegistryStatus:()=>({mode:'test'}),getFavorites:()=>[]}),
  seedFactions:ownerFactions,seedIds:ids,seedNavigation:nav||{nodes:market.bases.map(base=>({id:base.id,allows:['medium']})),
   baseNodes:Object.fromEntries(market.bases.map(base=>[base.id,base.id]))},
  Worker:class{
   constructor(){workers.push(this);}
   postMessage(value){messages.push(value);}
  },
  fetch:async(url,options)=>{
   const path=String(url).split('/').at(-1);apiCalls.push(path);
   return {ok:true,status:200,text:async()=>JSON.stringify(await reply(path,options))};
  },
  snapshots
 };
 const source=routeSource.split('\n').filter(line=>!line.startsWith('import ')).join('\n');
 runInNewContext(source+`
  cacheWrite=async value=>{snapshots.push(JSON.parse(JSON.stringify(value)));};
  bind();
  globalThis.audit={
   seed(value,at){dataset=value;navigation=seedNavigation;loadedAt=${now-600000};pobLoadedAt=at;
    factions=seedFactions;corsairIds=seedIds;idLoadedAt=${now-600000};idDataMode='cached';ownerDataMode='cached';
    startId='crete';dataMode='live';syncAccess();},
   setResults(value,running=false){results=value;lastStats={checked:1};busy=running;renderResults();},
   renderResults,refreshPobMarket,renderPicker,selectOrigin,openDetail,accessTag,
   inspect:()=>({dataset,busy,resultCount:results.length,lastStats,pobLoadedAt,access,idLoadedAt,idDataMode,ownerDataMode})
  };`,box);
 for(const [id,value] of Object.entries({dtrRoutesCargo:'1000',dtrRoutesCapital:'5000000',dtrRoutesMaxTime:'60',
  dtrRoutesLegs:'auto',dtrRoutesReturn:'system',dtrRoutesDepth:'18',dtrRoutesSort:'hourly'}))node(id).value=value;
 node('dtrRoutesPobs').checked=includePobs;node('dtrRoutesCorsair').checked=corsair;
 node('dtrRoutesUnverified').checked=includeUnverified;
 node('dtrRoutesSort').parent=node('tradeRoutesView');node('dtrRoutesCargo').parent=node('tradeRoutesView');
 for(const id of ['dtrRoutesCorsair','dtrRoutesUnverified','dtrRoutesPobs'])node(id).parent=node('tradeRoutesView');
 box.audit.seed(market,now-age);
 return {audit:box.audit,app:win.DTRTradeRoutes,node,apiCalls,messages,workers,snapshots};
}

const sorting=runtime();sorting.audit.setResults(routes);
assert(sorting.node('dtrRoutesResults').innerHTML.indexOf('$100')<sorting.node('dtrRoutesResults').innerHTML.indexOf('$200'));
sorting.node('dtrRoutesSort').value='profit';sorting.node('dtrRoutesSort').fire('change');
assert.equal(sorting.audit.inspect().resultCount,2,'sorting must keep the existing routes');
assert(sorting.audit.inspect().lastStats,'sorting must retain the completed search metadata');
assert(sorting.node('dtrRoutesResults').innerHTML.indexOf('$200')<sorting.node('dtrRoutesResults').innerHTML.indexOf('$100'),
 'a bubbled sort change must actually reorder the rendered route families');
assert.equal(sorting.messages.length,0,'sorting must not start or cancel a worker');
sorting.audit.setResults(routes,true);sorting.node('dtrRoutesSort').fire('change');
assert.equal(sorting.audit.inspect().busy,true,'sorting must not cancel a calculation in progress');
sorting.audit.setResults(routes);sorting.node('dtrRoutesCargo').fire('input');
assert.equal(sorting.audit.inspect().resultCount,0,'a real cargo change must still invalidate results');

const npcOnly=runtime();await npcOnly.app.runSearch();
assert.deepEqual(npcOnly.apiCalls,[],'NPC-only searches must not automatically refresh market endpoints');
assert.equal(npcOnly.messages.at(-1).options.excludePobs,true);
assert.equal(npcOnly.messages.at(-1).dataset,initial);

const recent=runtime({includePobs:true,age:60000});await recent.app.runSearch();
assert.deepEqual(recent.apiCalls,[],'a POB snapshot under five minutes old needs no extra request');

const refreshed=runtime({includePobs:true});await refreshed.app.runSearch();
assert.deepEqual(refreshed.apiCalls,['pobs'],'automatic refresh must fetch POBs only');
const posted=refreshed.messages.at(-1);
assert.equal(posted.type,'search');assert.equal(posted.options.excludePobs,false);
assert.equal(posted.dataset.bases.find(base=>base.id==='crete'),initial.bases[0],
 'NPC offers and owner metadata must be retained exactly');
assert(!posted.dataset.bases.some(base=>base.id==='old-pob'),'removed POBs must disappear from the refreshed market');
const added=posted.dataset.bases.find(base=>base.id==='new-pob');
assert.equal(added.cash,12345);assert.equal(added.space,6789);assert.equal(added.factionName,'Corsairs');
assert.equal(added.offers[0].buy,14);assert.equal(added.offers[0].sell,21);assert.equal(added.offers[0].stock,400);
assert.equal(added.offers[0].min,10);assert.equal(added.offers[0].max,1000);
assert.equal(added.offers[0].originalVolume,2);assert.equal(added.offers[0].volume,1);
assert.equal(added.offers[0].volumes.freighter,3,'POB refresh must preserve ship-specific commodity volume data');
assert.equal(posted.dataset.asOf,initial.asOf,'NPC market time must not be falsely advanced by a POB-only refresh');
assert(refreshed.snapshots.at(-1).pobLoadedAt>now-60000,'the POB cache needs its own freshness timestamp');

const sharedAt=new Date(now-30000);
const shared=runtime({includePobs:true,telemetry:{mode:'live',last:sharedAt,data:freshPobs}});
await shared.app.runSearch();
assert.deepEqual(shared.apiCalls,[],'fresh dashboard telemetry must be reused instead of requesting it twice');
assert.equal(shared.messages.at(-1).dataset.bases.find(base=>base.id==='new-pob').cash,12345);
assert.equal(shared.audit.inspect().pobLoadedAt,sharedAt.getTime());

for(const reply of [async()=>[null],async()=>[{name:'Incomplete market record'}],async()=>{throw Error('Network unavailable');}]){
 const offline=runtime({includePobs:true,reply});await offline.app.runSearch();
 assert.equal(offline.messages.at(-1).dataset,initial,'bad refreshes must retain the previous route-market snapshot');
 assert.equal(offline.snapshots.length,0,'bad refreshes must not overwrite the route-market cache');
 assert.match(offline.node('dtrRoutesNotice').textContent,/POB UPLINK UNAVAILABLE/,
  'using an old POB snapshot after a failed refresh must stay visibly disclosed');
 offline.workers[0].onmessage({data:{id:offline.messages.at(-1).id,type:'result',result:{results:[],stats:{partial:true}}}});
 assert.match(offline.node('dtrRoutesNotice').textContent,/POB UPLINK UNAVAILABLE/,
  'a search-budget notice must not hide the warning about older POB data');
}

let release;
const waiting=new Promise(resolve=>{release=resolve;});
const concurrent=runtime({includePobs:true,reply:()=>waiting});
const first=concurrent.app.runSearch(),second=concurrent.app.runSearch();
assert.equal(concurrent.node('dtrRoutesSearch').disabled,true,'search must wait while stock is being refreshed');
assert.equal(concurrent.node('dtrRoutesRefresh').disabled,true);
concurrent.node('dtrRoutesCargo').value='700';
release(freshPobs);await Promise.all([first,second]);
assert.deepEqual(concurrent.apiCalls,['pobs']);
assert.equal(concurrent.messages.filter(message=>message.type==='search').length,1,'double submit must start only one search');
assert.equal(concurrent.messages.at(-1).options.cargo,700,'settings must be read again after the asynchronous refresh');

const manual=runtime({reply:async path=>{
 if(path==='pobs')return freshPobs;
 if(path==='commodities')return [{nickname:'commodity_test',name:'Test Goods',volume:1,market_goods:[
  {base_nickname:'crete',base_name:'Planet Crete',system_nick:'gamma',system_name:'Omicron Gamma',
   base_sells:true,price_base_sells_for:32,price_base_buys_for:30,volume:1}
 ]}];
 return [];
}});
assert.equal(await manual.app.marketRefresh(),true);
assert.deepEqual(manual.apiCalls,['pobs','commodities','npc_bases','factions','tractors'],
 'the explicit force-market action must still refresh the full market');
assert.equal(manual.audit.inspect().dataset.bases.find(base=>base.id==='crete').offers[0].buy,32);

// Use the public API capture to test the actual controller -> worker -> manifest
// boundary. The worker is deliberately made to return prohibited stops so that
// a stale/mismatched worker cannot silently reintroduce them into the UI.
const dockFixture=JSON.parse(await readFile(new URL('./fixtures/corsair-docking-2026-10-26.json',import.meta.url),'utf8'));
const deniedIds=dockFixture.bases.map(row=>row.base_nickname);
const dockingMarket={...initial,bases:[npc('crete','Planet Crete','gamma'),npc('buyer','Friendly Buyer','gamma'),
 ...dockFixture.bases.map(row=>({...npc(row.base_nickname,row.base_name,'gamma'),factionName:row.faction_name})),
 npc('ring-only','Ring-only Station','gamma'),npc('unknown-ship','Unknown Ship Dock','gamma'),
 {id:'private-pob',name:'Private POB',kind:'pob',system:'gamma',offers:[]}
]};
const dockingNav={schema:1,nodes:dockingMarket.bases.filter(base=>base.id!=='unknown-ship').map((base,i)=>({
 id:base.id,kind:'base',system:'gamma',pos:[i*1000,0,0],allows:base.id==='ring-only'?['berth']:['medium']
})),links:[],baseNodes:Object.fromEntries(dockingMarket.bases.filter(base=>base.id!=='unknown-ship').map(base=>[base.id,base.id])),systemMultipliers:{}};
const dockingOptions={corsair:true,market:dockingMarket,ownerFactions:dockFixture.factions,ids:[dockFixture.id],nav:dockingNav};
for(const includeUnverified of [false,true]){
 const env=runtime({...dockingOptions,includeUnverified});
 await env.app.runSearch();
 const request=env.messages.at(-1);
 assert.equal(request.type,'search');
 for(const id of deniedIds)assert(request.options.blocked.includes(id),id+' must reach the worker as blocked');
 assert(request.options.blocked.includes('ring-only'),'unknown docking opt-in never bypasses an incompatible ship');
 assert.equal(request.options.blocked.includes('unknown-ship'),!includeUnverified);
 env.audit.renderPicker('thebes');
 assert.match(env.node('dtrRoutesPickerList').innerHTML,/data-route-start-id="st08_01_base"[^>]*disabled/,
  'the same Order prohibition must also disable the start picker');
 env.audit.selectOrigin('st08_01_base');
 assert.equal(env.app.getState().startId,'crete','a blocked Order station cannot become the starting base');
 env.audit.selectOrigin('ring-only');assert.equal(env.app.getState().startId,'crete');
 const returned=[route('buyer',100,1000),route('st08_01_base',9999,99999),route('li12_07_base',8888,88888),
  route('ring-only',7777,77777),route('unknown-ship',300,3000),route('not-in-dataset',400,4000),
  route('private-pob',500,5000),null,{legs:[null]}];
 env.workers[0].onmessage({data:{id:request.id,type:'result',result:{results:returned,stats:{partial:true}}}});
 assert.equal(env.audit.inspect().resultCount,includeUnverified?2:1,
  'only currently permitted worker results may reach the displayed routes');
 assert.match(env.node('dtrRoutesNotice').textContent,/DOCKING WERE REMOVED/);
 assert(!/Thebes|Cochrane|Ring-only/.test(env.node('dtrRoutesResults').innerHTML));
 env.audit.openDetail(0);assert(env.node('dtrRoutesDetailDialog').open);
 if(includeUnverified){
  assert.match(env.audit.accessTag('unknown-ship'),/SHIP DOCKING UNVERIFIED/,
   'unknown physical access must not be displayed as likely just because ID reputation permits it');
 }
 env.node('dtrRoutesCorsair').checked=false;env.node('dtrRoutesCorsair').fire('change');
 assert.equal(env.node('dtrRoutesDetailDialog').open,false,'changing filters must close the now-stale manifest');
 assert.equal(env.audit.inspect().resultCount,0);
}

const otherId=runtime({...dockingOptions,corsair:false});
otherId.node('dtrRoutesUnknown').checked=true;
await otherId.app.runSearch();
for(const id of deniedIds)assert(!otherId.messages.at(-1).options.blocked.includes(id),'Corsair OFF preserves other-ID searches');
assert(otherId.messages.at(-1).options.blocked.includes('ring-only'),'Corsair OFF and unknown flight time do not bypass physical ship restrictions');
assert(otherId.messages.at(-1).options.blocked.includes('unknown-ship'),'unknown flight time is not consent to unknown docking');
const oldRequest=otherId.messages.at(-1);
otherId.node('dtrRoutesCorsair').checked=true;otherId.node('dtrRoutesCorsair').fire('change');
otherId.workers[0].onmessage({data:{id:oldRequest.id,type:'result',result:{results:[route('li12_07_base',100,1000)],stats:{}}}});
assert.equal(otherId.audit.inspect().resultCount,0,'turning Corsair ON must reject the previous worker response');

const unknownOrigin=runtime({...dockingOptions,corsair:false});
unknownOrigin.audit.selectOrigin('unknown-ship');
assert.equal(unknownOrigin.app.getState().startId,'crete');
unknownOrigin.node('dtrRoutesUnverified').checked=true;unknownOrigin.node('dtrRoutesUnverified').fire('change');
unknownOrigin.audit.selectOrigin('unknown-ship');
assert.equal(unknownOrigin.app.getState().startId,'unknown-ship','unknown physical access is selectable only with explicit opt-in');

const marketGoods=dockingMarket.bases.filter(base=>base.kind==='npc').map(base=>({
 base_nickname:base.id,base_name:base.name,system_nick:base.system,system_name:base.systemName,
 base_sells:true,price_base_sells_for:10,price_base_buys_for:20,volume:1
}));
for(const brokenIdReply of [null,[{nickname:'fc_c_grp',reputations:[{nickname:'fc_lh_grp',rep:0.9}]}],
 [{...dockFixture.id,rephacks:[...dockFixture.id.rephacks,{faction_nickname:'fc_or_grp',reputation:0.5,rep_type:0}]}]]){
 const cached=runtime({...dockingOptions,reply:async path=>{
  if(path==='pobs')return freshPobs;
  if(path==='commodities')return [{nickname:'commodity_test',name:'Test Goods',volume:1,market_goods:marketGoods}];
  if(path==='npc_bases')throw Error('Owner metadata unavailable');
  if(path==='factions')return [];
  if(path==='tractors')return brokenIdReply;
  throw Error('Unexpected endpoint '+path);
 }});
 const previousIdTime=cached.audit.inspect().idLoadedAt;
 assert.equal(await cached.app.marketRefresh(),true,'valid new prices may load while docking metadata is unavailable');
 const state=cached.audit.inspect();
 assert.equal(state.idDataMode,'cached');assert.equal(state.ownerDataMode,'cached');
 assert.equal(state.idLoadedAt,previousIdTime,'a failed ID response must not falsely advance ID freshness');
 assert.equal(cached.snapshots.at(-1).idLoadedAt,previousIdTime);
 assert.equal(cached.snapshots.at(-1).corsairIds[0].rephacks.length,81);
 for(const id of deniedIds)assert(state.access.blocked.includes(id),'previously known restrictions must survive a metadata outage');
 assert.match(cached.node('dtrRoutesAccessNote').textContent,/CACHED CORSAIR ID RULES/);
 await cached.app.runSearch();
 for(const id of deniedIds)assert(cached.messages.at(-1).options.blocked.includes(id));
 assert.match(cached.node('dtrRoutesNotice').textContent,/CACHED NPC OWNERS/);
}
const noId=runtime({...dockingOptions,ids:[]});await noId.app.runSearch();
assert.equal(noId.messages.length,0,'faction metadata alone must never authorize a strict Corsair search');

console.log('DTR market/docking runtime passed (sort, POB freshness, all captured Order/Lane Hacker stops, worker screening, picker, manifests, physical/unknown docks, metadata fallback and filter races).');
