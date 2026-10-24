import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {normalizeDarkstat} from '../trade-core/trade.mjs';
import {groupRoutes} from '../trade-core/variants.mjs';
import {findPlanetCrete,enrichBaseOwners,assessAccess,setLaneSpeed,LANE_SPEED,CORSAIR_ID_NICKNAME} from '../dtr-route-policy.mjs';

const [routeSource,appSource]=await Promise.all([
 readFile(new URL('../dtr-trade-routes.mjs',import.meta.url),'utf8'),
 readFile(new URL('../app.js',import.meta.url),'utf8')
]);
const start=appSource.indexOf('  function validateTelemetry(source)');
const end=appSource.indexOf('  function verifiedSnapshot(',start);
assert(start>0&&end>start);
const validateTelemetry=runInNewContext(appSource.slice(start,end)+'validateTelemetry;');
const profile={id:'test',name:'Test Hauler',cargo:1000,cruise:350,dock:'medium',dockLabel:'MID'};
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

function runtime({includePobs=false,age=600000,telemetry={},reply=async()=>freshPobs}={}){
 const elements=new Map(),storage=new Map(),apiCalls=[],messages=[],workers=[],snapshots=[];
 class Element{
  constructor(id){this.id=id;this.value='';this.checked=false;this.options=[];this.dataset={};
   this.innerHTML='';this.textContent='';this.listeners=new Map();this.span={textContent:''};}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  fire(type,target=this){
   const event={target,preventDefault(){}};
   for(let node=this;node;node=node.parent)for(const fn of node.listeners.get(type)||[])fn(event);
  }
  querySelector(){return this.span;}
  reportValidity(){return true;}
 }
 const node=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 const win={addEventListener(){},DTRApp:{validateTelemetry,
  getState(){return {view:'overview',mode:'none',...telemetry};}}};
 const box={console,Intl,Date,Map,Set,AbortController,URLSearchParams,JSON,
  window:win,document:{readyState:'loading',getElementById:node,querySelectorAll(){return[];},addEventListener(){}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  setTimeout(){return 1;},clearTimeout(){},
  normalizeDarkstat,groupRoutes,findPlanetCrete,enrichBaseOwners,assessAccess,setLaneSpeed,LANE_SPEED,CORSAIR_ID_NICKNAME,
  FALLBACK_SHIPS:[profile],DEFAULT_SHIP_ID:profile.id,verifyShipProfile:()=>true,
  blockedShipDocks:()=>[],dockEligibility:()=> 'allowed',validateNavigation:value=>value,
  createShipController:()=>({getCurrent:()=>profile}),
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
   seed(value,at){dataset=value;navigation={nodes:[]};loadedAt=${now-600000};pobLoadedAt=at;
    startId='crete';dataMode='live';syncAccess();},
   setResults(value,running=false){results=value;lastStats={checked:1};busy=running;renderResults();},
   renderResults,refreshPobMarket,
   inspect:()=>({dataset,busy,resultCount:results.length,lastStats,pobLoadedAt})
  };`,box);
 for(const [id,value] of Object.entries({dtrRoutesCargo:'1000',dtrRoutesCapital:'5000000',dtrRoutesMaxTime:'60',
  dtrRoutesLegs:'auto',dtrRoutesReturn:'system',dtrRoutesDepth:'18',dtrRoutesSort:'hourly'}))node(id).value=value;
 node('dtrRoutesPobs').checked=includePobs;node('dtrRoutesCorsair').checked=false;
 node('dtrRoutesSort').parent=node('tradeRoutesView');node('dtrRoutesCargo').parent=node('tradeRoutesView');
 box.audit.seed(initial,now-age);
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

console.log('DTR market runtime passed (sort bubbling, NPC stability, POB-only refresh/reuse, limits, caching, failure and concurrency).');
