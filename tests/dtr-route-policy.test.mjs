import assert from 'node:assert/strict';
import {
  CORSAIR_ID_NICKNAME,DOCK_HOSTILE_THRESHOLD,REP_MODE,LANE_SPEED,
  findPlanetCrete,enrichBaseOwners,reputationIndex,baseAccess,assessAccess,setLaneSpeed
} from '../dtr-route-policy.mjs';

assert.equal(CORSAIR_ID_NICKNAME,'dsy_license_fc_c_grp');
assert.equal(DOCK_HOSTILE_THRESHOLD,-0.55);
assert.deepEqual(REP_MODE,{MAX:0,MIN:1,UNCHANGED:2,STATIC:3});
assert.equal(LANE_SPEED,2500);
const baseList=[
 {id:'planet_crete',name:'Planet Crete',system:'om_gamma',systemName:'Omicron Gamma',kind:'npc'},
 {id:'remote',name:'Liberty Fort',system:'li01',kind:'npc'},
 {id:'friend',name:'Zoner Station',kind:'npc'},
 {id:'li12_07_base',name:'Cochrane Depot',system:'li12',systemName:'Ontario',kind:'npc'},
 {id:'unknown',name:'Unnamed Port',kind:'npc'},
 {id:'pob',name:'Private Base',kind:'pob'}
];
assert.equal(findPlanetCrete(baseList)?.id,'planet_crete');
assert.equal(findPlanetCrete([{id:'other',name:'Planet Malta',kind:'npc'}]),null);
const ownerRows=[
 {nickname:'planet_crete',faction_name:'Corsairs'},
 {nickname:'remote',faction_name:'Liberty Navy'},
 {nickname:'friend',faction_nickname:'gd_z_grp'},
 {nickname:'li12_07_base',faction_name:'Lane Hackers'}
];
const owned=enrichBaseOwners({bases:baseList},ownerRows);
const factions=[
 {nickname:'fc_c_grp',name:'Corsairs',reputations:[
    {nickname:'fc_lh_grp',rep:0.9},{nickname:'li_n_grp',rep:0.8}]},
 {nickname:'li_n_grp',name:'Liberty Navy'},
 {nickname:'gd_z_grp',name:'Zoners'},
 {nickname:'fc_lh_grp',name:'Lane Hackers'},
 {nickname:'fc_freelancer',name:'Freelancers'},
 {nickname:'li_p_grp',name:'Liberty Police, Inc.'}
];
const hack=(faction_nickname,reputation,rep_type,faction_name)=>({
 faction_nickname,faction_name,reputation,rep_type
});
const corsairId={nickname:CORSAIR_ID_NICKNAME,name:'Corsairs ID',rephacks:[
 hack('fc_c_grp',1,3,'Corsairs'),
 hack('li_n_grp',-0.65,0,'Liberty Navy'),
 hack('gd_z_grp',0.25,0,'Zoners'),
 hack('fc_lh_grp',-0.7,0,'Lane Hackers'),
 hack('fc_freelancer',0,0,'Freelancers'),
 hack('li_p_grp',-0.65,0,'Liberty Police, Inc.')
]};
const carrier=[corsairId];
const ids={tractors:carrier};
const index=reputationIndex(factions,carrier);
assert(index.ready);
assert.equal(index.source,CORSAIR_ID_NICKNAME);
assert.equal(index.ruleCount,6);
assert.deepEqual(index.relation.get('fc lh grp'),{value:-0.7,mode:REP_MODE.MAX});
const status=assessAccess(owned,true,factions,ids);
assert(status.indexReady,'the actual Corsairs ID rephacks should be used');
assert.equal(status.byId.get('planet_crete').state,'likely');
assert.equal(status.byId.get('remote').state,'restricted');
assert.equal(status.byId.get('friend').state,'likely');
assert.equal(status.byId.get('li12_07_base').state,'restricted',
  'Lane Hackers in Ontario must be rejected based on Corsairs ID rep CAP -0.70');
assert.equal(status.byId.get('li12_07_base').score,-0.7);
assert.equal(status.byId.get('li12_07_base').repType,0);
assert.equal(status.byId.get('pob').state,'unverified');
assert.equal(status.byId.get('unknown').state,'unverified');
assert.deepEqual(status.blocked,['remote','li12_07_base','unknown','pob']);
assert.equal(status.idSource,CORSAIR_ID_NICKNAME);
assert.equal(status.ruleCount,6);
assert.match(status.byId.get('friend').reason,/ACTUAL CHARACTER REP MAY BE LOWER/,
  'a cap above threshold is not proof of the player actual rep');

const noId=assessAccess(owned,true,factions);
assert.equal(noId.indexReady,false,'old faction relations must not masquerade as player ID data');
assert.deepEqual(noId.blocked,baseList.map(b=>b.id),
  'without an ID rephack feed every ordinary NPC and POB must fail closed');
const wrongId=assessAccess(owned,true,factions,{tractors:[{
  nickname:'dsy_license_fc_lh_grp',rephacks:corsairId.rephacks
}]});
assert.deepEqual(wrongId.blocked,baseList.map(b=>b.id),
  'another faction ID must never be used as Corsair ID');
const override=assessAccess(owned,true,factions,{...ids,includeUnverified:true});
assert.deepEqual(override.blocked,['remote','li12_07_base'],
  'opt-in allows UNKNOWN only; confirmed hostile ID caps remain blocked');
assert.equal(assessAccess(owned,false,factions,ids).blocked.length,0,
  'other faction players can turn Corsair ID filtering off');

assert.equal(baseAccess({kind:'npc',factionName:'Lane Hackers'},true,index).state,'restricted');
assert.equal(baseAccess({kind:'npc',factionName:'Lane Hackers'},true,reputationIndex([],carrier)).state,'restricted',
  'ID reps must identify faction names even when the faction metadata endpoint is unavailable');
assert.equal(baseAccess({kind:'pob',factionName:'Corsairs'},true,index).state,'unverified');

function singleRule(mode,value){
 return reputationIndex([],[{nickname:CORSAIR_ID_NICKNAME,rephacks:[hack('test_grp',value,mode,'Test Group')]}]);
}
const ownedTest={kind:'npc',factionName:'Test Group'};
assert.equal(baseAccess(ownedTest,true,singleRule(0,-0.7)).state,'restricted','max rep is hostile');
assert.equal(baseAccess(ownedTest,true,singleRule(0,0.2)).state,'likely','a maximum above cutoff is not automatically hostile');
assert.equal(baseAccess(ownedTest,true,singleRule(1,0.2)).state,'likely','minimum above cutoff allows likely access');
assert.equal(baseAccess(ownedTest,true,singleRule(1,-0.7)).state,'unverified','minimum below cutoff cannot prove hostility');
assert.equal(baseAccess(ownedTest,true,singleRule(2,0.2)).state,'unverified','unchanged does not prove reputation');
assert.equal(baseAccess(ownedTest,true,singleRule(3,-0.7)).state,'restricted','fixed hostile');
assert.equal(baseAccess(ownedTest,true,singleRule(3,0.5)).state,'likely','fixed permitted');
assert.equal(reputationIndex([], [{nickname:CORSAIR_ID_NICKNAME,rephacks:[
  hack('test_grp',0.1,7,'Test Group')
]}]).ready,false,'invalid rep types are not authorized');

const manhattan={id:'li01_01_base',name:'Planet Manhattan',systemName:'New York',
  kind:'npc',factionName:'Liberty Police, Inc.'};
const landing={id:'ew16_01_base',name:'Planet Manhattan, Landing Site',
  systemName:'Planet Manhattan Atmosphere',kind:'npc',factionName:'Freelancers'};
const unknownAlias={id:'x_new',name:'Planet Manhattan, Landing Site',
  systemName:'Planet Manhattan Atmosphere',kind:'npc',factionName:'Freelancers'};
const denied=assessAccess([manhattan,landing,unknownAlias],true,factions,{
 tractors:carrier,includeUnverified:true
});
assert.deepEqual(denied.blocked,['li01_01_base','ew16_01_base','x_new'],
  'explicit unknown opt-in cannot bypass known Manhattan restrictions');
assert.equal(assessAccess([manhattan,landing],false,factions,ids).blocked.length,0);
const renamedNoDocks=[
 {id:'li01_01_base',name:'Renamed Spaceport',kind:'npc',factionName:'Freelancers'},
 {id:'EW16_01_BASE',name:'Another Port',kind:'npc',factionName:'Freelancers'}
];
for(const includeUnverified of [false,true]){
 const checked=assessAccess(renamedNoDocks,true,factions,{tractors:carrier,includeUnverified});
 assert.deepEqual(checked.blocked,renamedNoDocks.map(base=>base.id),
  'known IDs must remain denied without matching names or system metadata');
 assert(renamedNoDocks.every(base=>checked.byId.get(base.id).state==='restricted'));
}
assert.equal(assessAccess(renamedNoDocks,false,factions,ids).blocked.length,0,
 'ID normalization must preserve the Corsair OFF option');
const nav=setLaneSpeed({schema:1,nodes:[],links:[
 {kind:'lane',speed:2250},{kind:'jump'},{kind:'cruise'}
]});
assert.equal(nav.links[0].speed,2500);
assert.equal(nav.links[1].speed,undefined);
assert.throws(()=>setLaneSpeed({links:[]},0));
console.log('DTR Corsair ID reputation test passed (real ID semantics, hostile Lane Hackers, Ontario, modes 0-3, unknown and Manhattan).');
