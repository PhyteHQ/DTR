import { normalizeDarkstat } from '../trade-core/trade.mjs';
import { findPlanetCrete, enrichBaseOwners, assessAccess, reputationIndex, verifiedCorsairIds, DOCK_HOSTILE_THRESHOLD, CORSAIR_ID_NICKNAME, REP_MODE, normalize } from '../dtr-route-policy.mjs';
import {blockedShipDocks,dockEligibility,FALLBACK_SHIPS,DEFAULT_SHIP_ID} from '../dtr-ship-profiles.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const API='https://darkstat.dd84ai.com/api';
async function read(path,body){
  const timer=AbortSignal.timeout(20000);
  const args={method:'POST',signal:timer,headers:{Accept:'application/json'}};
  if(body!==undefined){args.body=JSON.stringify(body);args.headers['Content-Type']='application/json'}
  let result=await fetch(API+'/'+path,args);
  if(!result.ok)throw Error(path+' '+result.status);
  return await result.json();
}
const [pobs,commodities,npcs,factions,idFeed]=await Promise.allSettled([
  read('pobs'),read('commodities',{include_market_goods:true,filter_to_useful:true}),
  read('npc_bases',{}),read('factions',{include_reputations:false,include_bribes:false,filter_to_useful:false}),
  read('tractors',{include_rephacks:true,filter_nicknames:[CORSAIR_ID_NICKNAME]})
]);
const all={pobs,commodities,npcs,factions,idFeed};
const status=Object.fromEntries(Object.entries(all).map(([key,result])=>
  [key,result.status==='fulfilled'?{status:'ok',count:Array.isArray(result.value)?result.value.length:'not-array'}:
    {status:'unavailable',reason:String(result.reason)}]));
console.log('DTR TRADE LIVE ENDPOINTS '+JSON.stringify(status));
if(pobs.status!=='fulfilled'||commodities.status!=='fulfilled')process.exitCode=1;
else{
  const appSource=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const validatorStart=appSource.indexOf('  function validateTelemetry(source)');
  const validatorEnd=appSource.indexOf('  function verifiedSnapshot(',validatorStart);
  if(validatorStart<0||validatorEnd<validatorStart)throw Error('POB validator missing from live-data audit');
  const validateTelemetry=runInNewContext(appSource.slice(validatorStart,validatorEnd)+'validateTelemetry;');
  validateTelemetry(pobs.value);
  console.log('DTR LIVE POB VALIDATION PASSED '+pobs.value.length+' BASES');
  const ds=normalizeDarkstat(pobs.value,commodities.value);
  ds.bases=enrichBaseOwners(ds,npcs.status==='fulfilled'?npcs.value:[],pobs.value);
  const candidates=ds.bases.filter(x=>/crete/i.test(x.name||'')).map(x=>({id:x.id,name:x.name,system:x.systemName,kind:x.kind}));
  const origin=findPlanetCrete(ds.bases);
  const liveIds=verifiedCorsairIds(idFeed.status==='fulfilled'?idFeed.value:[])||[];
  const ac=assessAccess(ds.bases,true,factions.status==='fulfilled'?factions.value:[],
    {tractors:liveIds});
  const corsairId=liveIds.find(x=>x.nickname===CORSAIR_ID_NICKNAME);
  const laneHack= corsairId?.rephacks?.find(x=>x.faction_nickname==='fc_lh_grp');
  const orderRule=corsairId?.rephacks?.find(x=>x.faction_nickname==='fc_or_grp');
  console.log('DTR CORSAIR ID VERIFICATION '+JSON.stringify({
    source:ac.idSource,ready:ac.indexReady,rules:ac.ruleCount,laneHackersRephack:laneHack,orderRephack:orderRule
  }));
  if(!ac.indexReady||!laneHack||laneHack.rep_type!==REP_MODE.MAX||
      laneHack.reputation > DOCK_HOSTILE_THRESHOLD){
    console.error('CORSAIR ID REPHACKS MISSING OR LANE HACKER HOSTILITY NOT ACTIVE');
    process.exitCode=1;
  }
  const liveIndex=reputationIndex(factions.status==='fulfilled'?factions.value:[],liveIds);
  const deniedOwners=new Set((corsairId?.rephacks||[]).filter(rule=>
    [REP_MODE.MAX,REP_MODE.STATIC].includes(rule.rep_type)&&rule.reputation<=DOCK_HOSTILE_THRESHOLD
  ).map(rule=>normalize(rule.faction_nickname)));
  const ownerId=base=>normalize(base.factionNickname||liveIndex.names.get(normalize(base.factionName))||'');
  const allDenied=ds.bases.filter(base=>base.kind==='npc'&&deniedOwners.has(ownerId(base)));
  const violations=allDenied.filter(base=>ac.byId.get(base.id)?.state!=='restricted'||!ac.blocked.includes(base.id));
  const focused=allDenied.filter(base=>['fc or grp','fc lh grp'].includes(ownerId(base)));
  console.log('DTR ALL NPC ID DOCKING AUDIT '+JSON.stringify({
    deniedOwnerCount:deniedOwners.size,expectedDeniedBases:allDenied.length,violations:violations.map(base=>base.id),
    orderAndLaneHackers:focused.map(base=>({id:base.id,name:base.name,owner:base.factionName,state:ac.byId.get(base.id)?.state}))
  }));
  if(violations.length||!focused.some(base=>ownerId(base)==='fc or grp')){
    console.error('Known hostile/capped NPC owners must all be filtered, including Order at -0.55');process.exitCode=1;
  }
  // Rebuild from the raw market without NPC metadata or cached owner fields.
  // Real MarketGood records contain both commodity nickname and base_nickname.
  const fallbackDataset=normalizeDarkstat(pobs.value,commodities.value);
  fallbackDataset.bases=enrichBaseOwners(fallbackDataset,[],pobs.value,commodities.value);
  const fallbackAccess=assessAccess(fallbackDataset.bases,true,factions.status==='fulfilled'?factions.value:[],{tractors:liveIds});
  const fallbackFailures=allDenied.filter(base=>fallbackAccess.byId.get(base.id)?.state!=='restricted');
  console.log('DTR LIVE MARKET OWNER FALLBACK '+JSON.stringify({
    expectedDeniedBases:allDenied.length,recoveredDeniedBases:allDenied.length-fallbackFailures.length,
    failures:fallbackFailures.map(base=>base.id)
  }));
  if(fallbackFailures.length){
    console.error('Live market owner fallback lost known hostile NPC restrictions');process.exitCode=1;
  }
  const cochrane=ds.bases.find(b=>b.id==='li12_07_base');
  const cochraneAccess=cochrane?ac.byId.get(cochrane.id):null;
  console.log('DTR ONTARIO CORSAIR DOCKING '+JSON.stringify({
    id:cochrane?.id,name:cochrane?.name,owner:cochrane?.factionName,
    access:cochraneAccess,excluded:ac.blocked.includes('li12_07_base')
  }));
  if(!cochrane||cochraneAccess?.state!=='restricted'||
      cochraneAccess.repType!==REP_MODE.MAX||
      !ac.blocked.includes('li12_07_base')){
    console.error('Cochrane Depot, Ontario must be blocked by Corsairs ID rephacks');
    process.exitCode=1;
  }
  const manhattanBases=ds.bases.filter(b=>/planet manhattan/i.test(b.name));
  const manhattanAudit=manhattanBases.map(b=>({
    id:b.id,name:b.name,owner:b.factionName,docking:ac.byId.get(b.id),excluded:ac.blocked.includes(b.id)
  }));
  console.log('DTR DOCK STRICT MANHATTAN '+JSON.stringify(manhattanAudit));
  if(!manhattanAudit.length||manhattanAudit.some(b=>b.docking?.state!=='restricted'||!b.excluded)){
    console.error('Manhattan docking aliases not completely restricted for Corsairs');
    process.exitCode=1;
  }
  const corsair=factions.status==='fulfilled'?factions.value.find(f=>f.nickname==='fc_c_grp'):null;
  console.log('DTR TRADE LIVE DATA '+JSON.stringify({
    marketBases:ds.bases.length,creteCandidates:candidates.slice(0,12),
    defaultOrigin:origin?{id:origin.id,name:origin.name,system:origin.systemName}:null,
    corsairIdRephacks:ac.indexReady,corsairIdCount:ac.ruleCount,
    npcFactionRelationsAvailable:!!corsair,corsairReputationCount:corsair?.reputations?.length||0,
    corsairExample:corsair?.reputations?.slice(0,2)||[],access:ac.counts,
    creteAccess:origin?ac.byId.get(origin.id):null
  }));
  if(!origin){console.error('PLANET CRETE DEFAULT NOT RESOLVED FROM LIVE FEED');process.exitCode=1;}
  else {
    try {
      const { gunzipSync } = await import('node:zlib');
      const { readFile } = await import('node:fs/promises');
      const { search } = await import('../trade-core/search.mjs');
      const { setLaneSpeed } = await import('../dtr-route-policy.mjs');
      const nav = setLaneSpeed(JSON.parse(gunzipSync(await readFile(new URL('../trade-core/data/navigation.json.gz',import.meta.url))).toString('utf8')));
      const profile=FALLBACK_SHIPS.find(p=>p.id===DEFAULT_SHIP_ID);
      const shipBlocked=blockedShipDocks(ds.bases,profile,nav,{blockUnknown:true});
      const options={mode:'auto',start:origin.id,cargo:profile.cargo,capital:5000000,
        excludePobs:true,blocked:[...new Set([...ac.blocked,...shipBlocked])],allowUnknownTime:false,
        returnScope:'system',returnSystem:'',flexiblePickups:true,
        allowEmptyReturn:false,mixedCargo:true,maxMinutes:60,sort:'hourly',
        breadth:18,searchMs:12000,mixedMs:3500,maxChecks:8000,
        timeModel:{dock:30,jump:15,lane:10,charge:5}};
      const found=await search(ds,nav,profile,options);
      const violation=found.results.flatMap(r=>r.legs.flatMap(l=>[l.source,l.target]))
        .filter(id=>ac.byId.get(id)?.state!=='likely'||dockEligibility(id,profile,nav)!=='allowed');
      if(violation.length){
        console.error('CORSAIR STRICT ROUTES CONTAIN UNVERIFIED OR RESTRICTED DOCKING',violation.slice(0,12));
        process.exitCode=1;
      }
      console.log('DTR TRADE DEFAULT SEARCH '+JSON.stringify({
        count:found.results.length,stats:found.stats,
        top:found.results.slice(0,3).map(r=>({
          profit:r.profit,seconds:r.seconds,tradeCount:r.tradeCount,
          path:[r.legs[0]?.source,...r.legs.map(l=>l.target)]
        }))
      }));
      if(!found.results.length)console.log('DTR TRADE DEFAULT SEARCH HAS NO RESULTS; USER CAN CHANGE FILTERS.');
    } catch(error) {
      console.error('DTR TRADE DEFAULT SEARCH FAILED',error.stack||String(error));
      process.exitCode=1;
    }
  }
}

const params=[
 ['npc_bases',{}],['npc_bases',{filter_to_useful:true}],
 ['factions',{}],['factions',{include_reputations:true,filter_to_useful:false}],
 ['factions',{include_reputations:true,include_bribes:false,filter_to_useful:true}]
];
const checks=await Promise.all(params.map(async ([path,body])=>{
  try{
    const items=await read(path,body);
    return {path,body,ok:true,count:Array.isArray(items)?items.length:'not-array',
      example:Array.isArray(items)&&items[0]?Object.keys(items[0]).slice(0,20):[]};
  }catch(e){return {path,body,ok:false,error:String(e)}}
}));
console.log('DTR TRADE REQUEST BODY PROBES '+JSON.stringify(checks));


if(pobs.status==='fulfilled'&&commodities.status==='fulfilled'&&npcs.status==='fulfilled'&&factions.status==='fulfilled'){
  const names=['manhattan','crete','fort bush','newark','pittsburgh','missouri','rochester'];
  const selected=npcs.value.filter(x=>names.some(k=>String(x.name).toLowerCase().includes(k)));
  const fc=factions.value.find(x=>x.nickname==='fc_c_grp');
  const candidateMap=new Map(factions.value.flatMap(x=>[
    [String(x.name||'').toLowerCase(),x.nickname],[String(x.nickname||'').toLowerCase(),x.nickname]
  ]));
  const selectedBases=selected.map(x=>{
    const fn=candidateMap.get(String(x.faction_name||'').toLowerCase())||x.faction_name;
    const rel=fc?.reputations?.find(v=>String(v.nickname).toLowerCase()===String(fn).toLowerCase());
    const game=commodities.value.flatMap(c=>c.market_goods||[]).filter(m=>m.base_nickname===x.nickname).slice(0,2);
    return {
      id:x.nickname,name:x.name,system:x.system_name,owner:x.faction_name,ownerCode:fn,
      corsairRelation:rel?.rep??null,reputationRow:rel||null,
      statusFields:Object.fromEntries(Object.entries(x).filter(([k])=>/dock|access|allow|reputation|restricted|reachab|blacklist|whitelist/i.test(k))),
      examples:game.map(m=>({nickname:m.base_nickname,keys:Object.keys(m).filter(k=>/dock|access|allow|reputation|restricted|reachab/i.test(k))}))
    };
  });
  console.log('DTR DOCK AUDIT SELECTED BASES '+JSON.stringify(selectedBases));
  console.log('DTR DOCK AUDIT LIBERTY FACTIONS '+JSON.stringify(factions.value.filter(x=>/liberty|police|government|corsair/i.test(x.name||'')).map(x=>({
    name:x.name,nick:x.nickname,corsairRep:fc?.reputations?.find(y=>y.nickname===x.nickname)?.rep??null
  }))));
}


// Read-only live ship registry diagnostic for future DTR cargo-class profiles.
try {
  const ships=await read('ships',{});
  const names=/correo|coreo|essedarius|armicustos|raba|hogosha frigate|corsair train|corsair transport|pilgrim|longhorn/i;
  const fields=ship=>({
    name:ship.name,nickname:ship.nickname,type:ship.type,
    hold_size:ship.hold_size,cruise_speed:ship.cruise_speed,
    dock_type:ship.dock_type,
    class:ship.class
  });
  console.log('DTR SHIP REGISTRY STATUS '+JSON.stringify({
    available:Array.isArray(ships),count:Array.isArray(ships)?ships.length:null,
    sampleKeys:ships?.[0]?Object.keys(ships[0]).slice(0,45):[]
  }));
  if(!Array.isArray(ships))throw Error('Ship registry was not an array');
  console.log('DTR BULWARK/PILGRIM SHIP AUDIT '+JSON.stringify(ships.filter(
    ship=>/bulwark|pilgrim|liner|hogosha|corsair/i.test([ship.name,ship.nickname].join(' ')))
    .map(fields)));
  console.log('DTR CORSAIR SHIP PROFILES '+JSON.stringify(ships.filter(
    ship=>names.test([ship.name,ship.nickname,ship.type].join(' '))).map(fields)));
  console.log('DTR SMALL CARGO QUERY '+JSON.stringify({
    exact250:ships.filter(s=>s.hold_size===250).map(fields),
    from200to350:ships.filter(s=>s.hold_size>=200&&s.hold_size<=350).slice(0,50).map(fields),
    freighterBands:[...new Set(ships.filter(s=>s.type==='freighter').map(s=>s.hold_size))].sort((a,b)=>a-b),
    genericTransports:ships.filter(s=>s.type==='transport'&&s.hold_size>=200).length
  }));
  console.log('DTR FREIGHTER CARGO BANDS '+JSON.stringify(
    ships.filter(ship=>[250,3100,3600,4300,5000].includes(ship.hold_size))
      .filter(ship=>/transport|freighter|frigate|train|hauler|courier|raba|pilgrim|longhorn/i.test(
        [ship.name,ship.nickname,ship.type].join(' ')))
      .slice(0,95).map(fields)));
} catch(error) {
  console.error('DTR SHIP REGISTRY UNAVAILABLE '+String(error));
}


// Audit: ID rephacks (NOT faction-vs-faction relations) for Corsair ID selection.
try {
  const tractors=await read('tractors',{include_rephacks:true,filter_nicknames:[
    'dsy_license_fc_c_grp','dsy_license_fc_lh_grp','dsy_license_fc_lr_grp','dsy_license_fc_ou_grp'
  ]});
  if(!Array.isArray(tractors))throw Error('tractors endpoint did not return a list');
  const names=tractors.filter(x=>/corsair|lane hacker|lanehacker|pirate|piracy|rogue|hessian|outcast/i.test([x.name,x.nickname].join(' ')));
  const factionsFromApi=factions.status==='fulfilled'?factions.value:[];
  const lane=factionsFromApi.filter(x=>/lane.?hacker|corsair|rogue|outcast/i.test(x.name||'')).map(x=>({name:x.name,nickname:x.nickname}));
  const targets=new Set([...lane.map(x=>x.nickname),'fc_c_grp']);
  const fmt=(x)=>({name:x.name,nickname:x.nickname,short_nickname:x.short_nickname,
    rephacksCount:Array.isArray(x.rephacks)?x.rephacks.length:0,
    targetReps:(Array.isArray(x.rephacks)?x.rephacks:[]).filter(v=>
      targets.has(v?.faction_nickname)||/lane.?hacker|corsair|rogue|outcast/i.test(v?.faction_name||'')).map(
        v=>({faction:v.faction_nickname,name:v.faction_name,rep:v.reputation,type:v.rep_type})).slice(0,20)
  });
  console.log('DTR REPHACK ID INDEX '+JSON.stringify({tractorCount:tractors.length,
    possibleCorsairIds:names.map(fmt),laneFactions:lane,
    sampleRaw:tractors[0]?{name:tractors[0].name,nickname:tractors[0].nickname,
      firstRephack:tractors[0].rephacks?.[0], repTypes:[...new Set((tractors[0].rephacks||[]).map(x=>x.rep_type))]}:null
  }));
  const ontario=npcs.status==='fulfilled'?npcs.value.filter(b=>/cochrane|ontario/i.test(b.name||'')):[];
  console.log('DTR ONTARIO BASE AUDIT '+JSON.stringify(ontario.map(b=>({
    name:b.name,nickname:b.nickname,system:b.system_name,owner:b.faction_name
  }))));
} catch(error) {
  console.error('DTR REPHACK ID PROBE FAILED '+String(error));
}
