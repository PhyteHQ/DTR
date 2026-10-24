import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const boot=source.lastIndexOf('  setInterval(updateClock, 1000);');
assert(boot>0);
const LIVE='dtr:pobs:live:v2',PREVIOUS='dtr:pobs:previous:v2';
const oldAt='2026-10-20T10:00:00.000Z';
const good=[{nickname:'sanctum',name:'Deterrence Sanctum',money:100,
 shop_items:[{nickname:'commodity_food',name:'Food Rations',quantity:null,price:null}]}];
const previous=[{nickname:'sanctum',name:'Deterrence Sanctum',money:90,shop_items:[]}];
const snapshot=(data,savedAt=oldAt)=>JSON.stringify({savedAt,data});

function runtime({latest=snapshot(good),older=snapshot(previous),reply=async()=>good}={}){
 const storage=new Map(),writes=[];
 if(latest!==null)storage.set(LIVE,latest);
 if(older!==null)storage.set(PREVIOUS,older);
 const nodes=new Map(),timers=new Map();let timerId=0;
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,dataset:{},classList:{add(){},remove(){},toggle(){}},
   addEventListener(){},querySelectorAll(){return[];}});
  return nodes.get(id);
 };
 const sandbox={Intl,Date,Map,Set,AbortController,
  localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);writes.push(key);},removeItem:key=>storage.delete(key)},
  document:{getElementById:node,addEventListener(){}},window:{addEventListener(){}},
  setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,ms});return id;},
  clearTimeout(id){timers.delete(id);},
  fetch:async(_url,options)=>({ok:true,json:()=>reply(options.signal)})
 };
 // Keep the real request, validation, persistence and fallback paths. Rendering
 // and the periodic UI boot are unrelated to the cache guarantees under test.
 runInNewContext(source.slice(0,boot)+`
   render=()=>{};emitState=()=>{};hydrateLatest({renderNow:false});
 })();`,sandbox);
 return {app:sandbox.window.DTRApp,storage,writes,timers};
}

for(const bad of [null,{},[],[null],[[]],[{}],
 [{name:'Deterrence Sanctum',shop_items:{}}],
 [{name:'Deterrence Sanctum',shop_items:[null]}],
 [{name:'Deterrence Sanctum',shop_items:[{}]}]]){
 const env=runtime({reply:async()=>bad});
 const beforeLive=env.storage.get(LIVE),beforePrevious=env.storage.get(PREVIOUS);
 await env.app.refresh();
 assert.equal(env.storage.get(LIVE),beforeLive,'bad responses must not overwrite the latest snapshot');
 assert.equal(env.storage.get(PREVIOUS),beforePrevious,'bad responses must not rotate a valid previous snapshot');
 assert.equal(env.writes.length,0);
 const state=env.app.getState();
 assert.equal(state.mode,'cache');
 assert.equal(state.last.toISOString(),oldAt,'a failed response must not reset snapshot age');
 assert.equal(state.bases.get('deterrence-sanctum').money,100);
 assert.match(state.lastError,/Invalid POB response/);
}

const fresh=[{name:'Deterrence Sanctum',money:0,health:null,shop_items:[]}];
const updated=runtime({reply:async()=>fresh});
await updated.app.refresh();
assert.equal(updated.app.getState().mode,'live');
assert.deepEqual(JSON.parse(updated.storage.get(PREVIOUS)).data,good);
assert.deepEqual(JSON.parse(updated.storage.get(LIVE)).data,fresh,
 'valid partial telemetry, unknown quantities and empty inventory are permitted');

const missing=runtime({latest:null,older:null,reply:async()=>[null]});
await missing.app.refresh();
assert.equal(missing.app.getState().mode,'none');
assert.equal(missing.storage.has(LIVE),false,'a malformed cold-start response must not create a cache');

const recovered=runtime({latest:snapshot([null]),older:snapshot(previous),reply:async()=>{throw Error('Network unavailable');}});
assert.equal(recovered.app.getState().bases.get('deterrence-sanctum').money,90,
 'a malformed latest snapshot must fall back to the valid previous snapshot');
await recovered.app.refresh();
assert.equal(recovered.app.getState().last.toISOString(),oldAt);
assert.deepEqual(JSON.parse(recovered.storage.get(PREVIOUS)).data,previous);

const repaired=runtime({latest:snapshot([null]),older:snapshot(previous),reply:async()=>fresh});
await repaired.app.refresh();
assert.deepEqual(JSON.parse(repaired.storage.get(PREVIOUS)).data,previous,
 'replacing a broken cache must preserve its valid recovery snapshot');

const invalidTime=runtime({latest:snapshot(good,'invalid'),older:null});
assert.equal(invalidTime.app.getState().mode,'none',
 'an unverified cache date must not be replaced by the current time');

let bodyStarted;
const readingBody=new Promise(resolve=>{bodyStarted=resolve;});
const stalled=runtime({reply:signal=>new Promise((_resolve,reject)=>{
 bodyStarted();
 signal.addEventListener('abort',()=>{const error=Error('aborted');error.name='AbortError';reject(error);});
})});
const pending=stalled.app.refresh();
await readingBody;
const bodyTimeout=[...stalled.timers.values()].find(timer=>timer.ms===18000);
assert(bodyTimeout,'the request timeout must remain armed until the JSON body finishes');
bodyTimeout.callback();await pending;
assert.equal(stalled.app.getState().mode,'cache');
assert.match(stalled.app.getState().lastError,/timed out/);
assert.deepEqual(JSON.parse(stalled.storage.get(LIVE)).data,good);

console.log('DTR telemetry audit passed (malformed feeds, cache preservation/recovery, unknown values and body timeout).');
