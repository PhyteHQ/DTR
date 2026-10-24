/* DTR Trade Routes // ID-aware docking policy.
   Darkstat /api/tractors supplies Corsairs ID rephacks. NPC faction relationship
   data must NEVER substitute for the actual equipped-ID restrictions. */
export const CORSAIR_FACTION = 'fc_c_grp';
export const CORSAIR_ID_NICKNAME = 'dsy_license_fc_c_grp';
export const DOCK_HOSTILE_THRESHOLD = -0.55;
export const LANE_SPEED = 2500;

// Discovery playercntl_rephacks:
// 0: cap reputation at MAX, 1: floor at MIN, 2: leave unchanged, 3: static.
export const REP_MODE = Object.freeze({MAX:0, MIN:1, UNCHANGED:2, STATIC:3});
export const normalize = value => String(value??'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const CORSAIR_NO_DOCK_IDS = new Set(['li01_01_base','ew16_01_base'].map(normalize));
const first=(obj,...keys)=>keys.map(k=>obj?.[k]).find(v=>v!==null&&v!==undefined&&v!=='');
const repNumber=value=>{
  if(value===undefined||value===null||value==='')return null;
  const num=Number(value);
  return Number.isFinite(num)&&num>=-1&&num<=1?num:null;
};
const idOf=x=>String(first(x,'nickname','base_nickname','id')??'');

export function findPlanetCrete(bases){
  if(!Array.isArray(bases))return null;
  const likely=bases.filter(b=>b?.kind==='npc'&&/\bcrete\b/.test(normalize(b.name+' '+b.id)));
  const gamma=b=>/omicron gamma|omicron_gamma/.test(normalize([b.systemName,b.system].join(' ')))||/gamma/i.test(String(b.system));
  const exact=likely.filter(b=>normalize(b.name)==='planet crete'&&gamma(b));
  if(exact.length===1)return exact[0];
  const inGamma=likely.filter(gamma);
  if(inGamma.length===1)return inGamma[0];
  const nameExact=likely.filter(b=>normalize(b.name)==='planet crete');
  return nameExact.length===1?nameExact[0]:null;
}

export function enrichBaseOwners(dataset,npcBases=[],pobs=[]){
  const byId=new Map();
  for(const base of [...(Array.isArray(npcBases)?npcBases:[]),...(Array.isArray(pobs)?pobs:[])]){
    const id=idOf(base);
    if(id)byId.set(normalize(id),base);
  }
  return dataset.bases.map(base=>{
    const row=byId.get(normalize(base.id));
    return {...base,
      factionNickname:first(row,'faction_nickname','faction_nick','faction'),
      factionName:first(row,'faction_name','factionName','faction_display_name'),
      dockingMode:first(row,'defense_mode','docking')
    };
  });
}

/** Build the dock-policy index from a SINGLE matched Corsairs ID.
 *  Factions only provide names -> nicknames; their .reputations are NOT used.
 *  Unknown/invalid/missing ID data is not permission to dock. */
export function reputationIndex(factions,tractors=[]){
  const names=new Map(),relation=new Map();
  for(const faction of Array.isArray(factions)?factions:[]){
    const id=first(faction,'nickname');
    if(!id)continue;
    names.set(normalize(id),String(id));
    if(faction.name)names.set(normalize(faction.name),String(id));
  }
  const id=(Array.isArray(tractors)?tractors:[])
    .find(row=>normalize(row?.nickname)===normalize(CORSAIR_ID_NICKNAME));
  if(!id||!Array.isArray(id.rephacks)||!id.rephacks.length)
    return {ready:false,names,relation,source:null,ruleCount:0};
  for(const row of id.rephacks){
    const nick=first(row,'faction_nickname');
    const value=repNumber(row?.reputation),mode=Number(row?.rep_type);
    if(!nick||value===null||!Number.isInteger(mode)||mode<0||mode>3)continue;
    const code=String(nick);
    names.set(normalize(code),code);
    if(row.faction_name)names.set(normalize(row.faction_name),code);
    // Missing, duplicate or explicitly unmodified groups never grant access.
    if(relation.has(normalize(code))){
      relation.delete(normalize(code));
      continue;
    }
    relation.set(normalize(code),{value,mode});
  }
  return {ready:relation.size>0,names,relation,source:CORSAIR_ID_NICKNAME,ruleCount:relation.size};
}

export function baseAccess(base,corsairEnabled,index){
  if(!corsairEnabled)return {state:'unverified',reason:'OTHER ID // PERSONAL REPUTATION UNKNOWN'};
  if(!base)return {state:'unverified',reason:'BASE UNKNOWN'};
  const name=normalize(base.name),system=normalize(base.systemName);
  if(CORSAIR_NO_DOCK_IDS.has(normalize(base.id))||
     (name.startsWith('planet manhattan')&&
      (system==='new york'||system.includes('manhattan atmosphere')||name.includes('landing site'))))
    return {state:'restricted',reason:'KNOWN CORSAIR NO-DOCK // MANHATTAN OR LANDING SITE'};
  if(base.kind==='pob')return {state:'unverified',reason:'POB WHITELIST / OWNER RULES UNKNOWN'};
  const owner=first(base,'factionNickname','factionName');
  if(!owner)return {state:'unverified',reason:'FACTION OWNER NOT REPORTED'};
  const nickname=index?.names?.get(normalize(owner))||String(owner);
  const rule=index?.relation?.get(normalize(nickname));
  if(!rule)return {state:'unverified',reason:'NO CORSAIR ID REPHACK FOR BASE OWNER'};
  const {value,mode}=rule;
  if(mode===REP_MODE.UNCHANGED)
    return {state:'unverified',reason:'CORSAIR ID DOES NOT CHANGE THIS REPUTATION'};
  if(mode===REP_MODE.MAX){
    if(value<DOCK_HOSTILE_THRESHOLD)return {state:'restricted',score:value,repType:mode,
      reason:'CORSAIR ID MAXIMUM REP IS HOSTILE // DOCKING NOT POSSIBLE WITH THIS ID'};
    return {state:'likely',score:value,repType:mode,
      reason:'CORSAIR ID MAXIMUM PERMITS DOCKING // ACTUAL CHARACTER REP MAY BE LOWER'};
  }
  if(mode===REP_MODE.MIN){
    if(value>=DOCK_HOSTILE_THRESHOLD)return {state:'likely',score:value,repType:mode,
      reason:'CORSAIR ID MINIMUM REP ABOVE DOCK THRESHOLD // OTHER RESTRICTIONS POSSIBLE'};
    return {state:'unverified',score:value,repType:mode,
      reason:'CORSAIR ID MINIMUM IS BELOW DOCK THRESHOLD // ACTUAL REP UNKNOWN'};
  }
  if(mode===REP_MODE.STATIC){
    return value<DOCK_HOSTILE_THRESHOLD?
      {state:'restricted',score:value,repType:mode,reason:'CORSAIR ID FIXED REP IS HOSTILE'}:
      {state:'likely',score:value,repType:mode,reason:'CORSAIR ID FIXED REP PERMITS DOCKING // OTHER RESTRICTIONS POSSIBLE'};
  }
  return {state:'unverified',reason:'INVALID CORSAIR REPHACK MODE'};
}

export function assessAccess(bases,corsairEnabled,factions,{includeUnverified=false,tractors=[]}={}){
  const index=reputationIndex(factions,tractors);
  const byId=new Map();
  for(const base of bases||[])byId.set(base.id,baseAccess(base,corsairEnabled,index));
  const counts={likely:[...byId.values()].filter(a=>a.state==='likely').length,
    restricted:[...byId.values()].filter(a=>a.state==='restricted').length,
    unverified:[...byId.values()].filter(a=>a.state==='unverified').length};
  const blocked=corsairEnabled?[...byId].filter(([,a])=>
    a.state==='restricted'||(!includeUnverified&&a.state==='unverified')).map(([id])=>id):[];
  return {byId,indexReady:index.ready,idSource:index.source,ruleCount:index.ruleCount,
    blocked,counts,includeUnverified:Boolean(includeUnverified),
    filteredUnknown:corsairEnabled&&!includeUnverified?counts.unverified:0};
}

export function setLaneSpeed(navigation,speed=LANE_SPEED){
  if(!navigation||!Array.isArray(navigation.links))throw Error('Navigation data missing.');
  if(!(speed>0))throw Error('Invalid lane speed.');
  return {...navigation,links:navigation.links.map(link=>link.kind==='lane'?{...link,speed}:link)};
}
