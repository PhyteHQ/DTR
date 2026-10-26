import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessAccess,baseAccess,enrichBaseOwners,reputationIndex,CORSAIR_ID_NICKNAME} from '../dtr-route-policy.mjs';
import {normalizeDarkstat} from '../trade-core/trade.mjs';
import {search} from '../trade-core/search.mjs';
import {FALLBACK_SHIPS,blockedShipDocks,dockEligibility} from '../dtr-ship-profiles.mjs';

const captured=JSON.parse(await readFile(new URL('./fixtures/corsair-docking-2026-10-26.json',import.meta.url),'utf8'));
const fixture={corsairId:captured.id,factions:captured.factions,npcBases:captured.bases.map(b=>({
 nickname:b.base_nickname,name:b.base_name,faction_nick:b.faction_nick,faction_name:b.faction_name,system_name:b.system_name
}))};
const tractors=[fixture.corsairId],factions=fixture.factions;
const idOptions={tractors};
const samples=fixture.npcBases.map(row=>({id:row.nickname,name:row.name,kind:'npc'}));
const owned=enrichBaseOwners({bases:samples},fixture.npcBases);
assert.equal(fixture.corsairId.rephacks.length,81);
assert.equal(owned.filter(b=>b.factionNickname==='fc_or_grp').length,6);
assert.equal(owned.filter(b=>b.factionNickname==='fc_lh_grp').length,5);
for(const includeUnverified of [false,true]){
 const access=assessAccess(owned,true,factions,{...idOptions,includeUnverified});
 assert.equal(access.ruleCount,81);
 for(const base of owned){
  assert.equal(access.byId.get(base.id).state,'restricted',base.name+' must be denied by the actual Corsair ID');
  assert(access.blocked.includes(base.id),base.name+' must stay blocked even with unverified opt-in');
 }
}
const originalIndex=reputationIndex(factions,tractors);
for(const rule of fixture.corsairId.rephacks.filter(r=>r.reputation===-0.55)){
 assert.equal(baseAccess({kind:'npc',factionNickname:rule.faction_nickname},true,originalIndex).state,'restricted',
  'all ten real boundary rules, including static AI and capped Order, must be denied');
}
assert.equal(fixture.corsairId.rephacks.filter(r=>r.reputation===-0.55).length,10);
assert.equal(assessAccess(owned,false,factions,idOptions).blocked.length,0,'other faction players retain Corsair OFF');

const rule=(reputation,rep_type,faction_nickname='test_grp',faction_name='Test Faction')=>
 ({faction_nickname,faction_name,reputation,rep_type});
const indexFor=rephacks=>reputationIndex([],[{nickname:CORSAIR_ID_NICKNAME,rephacks}]);
const testBase={kind:'npc',factionNickname:'test_grp'};
for(const [mode,values] of [
 [0,[[-0.5501,'restricted'],[-0.55,'restricted'],[-0.5499,'likely']]],
 [1,[[-0.5501,'unverified'],[-0.55,'unverified'],[-0.5499,'likely']]],
 [2,[[-0.55,'unverified'],[1,'unverified']]],
 [3,[[-0.5501,'restricted'],[-0.55,'restricted'],[-0.5499,'likely']]]
])for(const [rep,expected] of values)
 assert.equal(baseAccess(testBase,true,indexFor([rule(rep,mode)])).state,expected,`mode ${mode}, rep ${rep}`);
assert.equal(baseAccess(testBase,true,indexFor([rule('0.2','0')])).state,'likely','numeric API strings remain valid');
for(const bad of [null,undefined,'',false,true,[],[0.2],{},NaN,Infinity,-1.01,1.01])
 assert.equal(baseAccess(testBase,true,indexFor([rule(bad,0)])).state,'unverified','malformed reputation cannot grant access');
for(const bad of [null,undefined,'',false,true,[],[0],{},NaN,Infinity,-1,4,0.5])
 assert.equal(baseAccess(testBase,true,indexFor([rule(0.2,bad)])).state,'unverified','malformed mode cannot grant access');
for(const count of [2,3,4]){
 const duplicates=Array.from({length:count},(_,i)=>rule(i%2?-.7:.3,0));
 assert.equal(baseAccess(testBase,true,indexFor(duplicates)).state,'unverified','duplicate rules never recover permission');
}
assert.equal(baseAccess(testBase,true,indexFor([rule(null,0),rule(.3,0)])).state,'unverified');
assert.equal(reputationIndex(factions,[fixture.corsairId,fixture.corsairId]).ready,false,'duplicate matching IDs are ambiguous');
const ambiguous=indexFor([rule(.3,0,'friend_grp','Same Name'),rule(-.7,0,'hostile_grp','Same Name')]);
assert.equal(baseAccess({kind:'npc',factionName:'Same Name'},true,ambiguous).state,'unverified');
assert.equal(baseAccess({kind:'npc',factionNickname:'hostile_grp',factionName:'Same Name'},true,ambiguous).state,'restricted');
assert.equal(baseAccess({kind:'npc',factionNickname:'friend_grp',factionName:'Same Name'},true,ambiguous).state,'likely');

const markets=fixture.npcBases.map(row=>({base_nickname:row.nickname,base_name:row.name,
 faction_nick:row.faction_nick,faction_name:row.faction_name,system_nick:'test',system_name:row.system_name,
 base_pos:[0,0,0],base_sells:true,price_base_sells_for:5,price_base_buys_for:8,volume:1}));
markets.push(...[
 ['crete','Planet Crete','fc_c_grp','Corsairs'],['friend','Friendly Market','gd_z_grp','Zoners']
].map(([base_nickname,base_name,faction_nick,faction_name])=>({base_nickname,base_name,faction_nick,faction_name,
 system_nick:'test',system_name:'Test System',base_pos:[0,0,0],base_sells:true,
 price_base_sells_for:5,price_base_buys_for:8,volume:1})));
const commodities=[{nickname:'commodity_test',name:'Test Goods',volume:1,market_goods:markets}];
const normalized=normalizeDarkstat([],commodities);
const fallback=enrichBaseOwners(normalized,[],[],commodities);
assert.equal(fallback.length,13);
const fallbackAccess=assessAccess(fallback,true,factions,idOptions);
assert.equal(fallbackAccess.byId.get('st08_01_base').state,'restricted','market owner fallback must identify Order');
assert.equal(fallbackAccess.byId.get('li12_07_base').state,'restricted','market owner fallback must identify Lane Hackers');
assert.equal(fallbackAccess.byId.get('crete').state,'likely','valid friendly markets must remain usable without the NPC endpoint');
const staleOwners=[{nickname:'st08_01_base',faction_name:'Corsairs',faction_nick:'fc_c_grp'}];
assert.equal(enrichBaseOwners(normalized,staleOwners,[],commodities).find(b=>b.id==='st08_01_base').factionNickname,'fc_c_grp',
 'explicit NPC metadata takes priority over fallback market metadata');
const contradictory=[...staleOwners,{nickname:'ST08_01_BASE',faction_nick:'fc_or_grp'}];
const conflict=enrichBaseOwners(normalized,contradictory,[],commodities).find(b=>b.id==='st08_01_base');
assert.equal(baseAccess(conflict,true,originalIndex).state,'unverified','conflicting NPC owners must not fall through to a permissive fallback');
const mixedMarkets=[{market_goods:[markets[0],{...markets[0],faction_nick:'fc_c_grp'}]}];
const marketConflict=enrichBaseOwners({bases:[samples[0]]},[],[],mixedMarkets)[0];
assert.equal(baseAccess(marketConflict,true,originalIndex).state,'unverified');
assert.equal(enrichBaseOwners({bases:[{id:'same',kind:'npc'}]},[{nickname:'same',faction_nick:'fc_or_grp'}],
 [{nickname:'same',faction_nick:'fc_c_grp'}])[0].factionNickname,'fc_or_grp','POB nicknames must not overwrite NPC owners');

const profile=FALLBACK_SHIPS.find(p=>p.nickname==='dsy_corsair_transport');
const routeBases=[...fallback.map((base,i)=>({...base,system:'test',pos:[i*100,0,0]})),
 {...fallback.find(b=>b.id==='crete'),id:'wrong-dock',name:'Ring Only',pos:[1400,0,0]},
 {...fallback.find(b=>b.id==='crete'),id:'unmapped',name:'Unmapped',pos:[1500,0,0]}];
const nav={schema:1,nodes:routeBases.filter(b=>b.id!=='unmapped').map(b=>({id:b.id,system:'test',pos:b.pos,kind:'base',
 allows:b.id==='wrong-dock'?['berth']:['berth','medium','large']})),links:[],
 baseNodes:Object.fromEntries(routeBases.filter(b=>b.id!=='unmapped').map(b=>[b.id,b.id])),systemMultipliers:{}};
const routeAccess=assessAccess(routeBases,true,factions,idOptions);
const blocked=[...new Set([...routeAccess.blocked,...blockedShipDocks(routeBases,profile,nav),
 ...routeBases.filter(b=>dockEligibility(b.id,profile,nav)==='unknown').map(b=>b.id)])];
assert(blocked.includes('wrong-dock'));assert(blocked.includes('unmapped'));
let searches=0;
for(const mode of ['one','two','three','auto'])for(const mixedCargo of [false,true])for(const returnScope of ['base','system']){
 const found=await search({...normalized,bases:routeBases},nav,profile,{
  mode,start:'crete',cargo:10,capital:10000,excludePobs:true,blocked,allowUnknownTime:true,
  returnScope,flexiblePickups:true,allowEmptyReturn:true,mixedCargo,maxMinutes:60,sort:mixedCargo?'hourly':'profit',
  breadth:8,maxChecks:200,searchMs:1000,mixedMs:250,timeModel:{dock:30,jump:15,lane:10,charge:5}
 });
 assert(found.results.length>0,`${mode}/${mixedCargo}/${returnScope} must retain valid friendly routes`);
 for(const result of found.results)for(const leg of result.legs)for(const id of [leg.source,leg.target])
  assert(!blocked.includes(id),`${mode} must never contain forbidden dock ${id}`);
 searches++;
}
console.log(`DTR docking audit passed (81 real ID rules, 6 Order and 5 Lane Hacker samples, 10 boundaries, malformed/ambiguous data, owner fallback and ${searches} route searches).`);
