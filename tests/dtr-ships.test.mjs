import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Navigator } from '../trade-core/navigation.mjs';
import {
  DEFAULT_SHIP_ID,DEFAULT_FAVORITES,DOCK_CLASSES,FALLBACK_SHIPS,
  normalizeShipRegistry,findProfile,searchShipProfiles,resolveSavedFavorites,
  validateCustomProfile,restoreCustomProfiles,storageCustomProfiles,
  blockedShipDocks,dockEligibility,verifyShipProfile
} from '../dtr-ship-profiles.mjs';
import { createShipController } from '../dtr-ship-controller.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [partial,route,controller,css,sw]=await Promise.all(
  ['dtr-trade-panel.html','dtr-trade-routes.mjs','dtr-ship-controller.mjs','dtr-ships.css','sw.js']
    .map(p=>readFile(join(root,p),'utf8'))
);
assert.deepEqual(DEFAULT_FAVORITES,[
  'ship:dsy_tribun','ship:dsy_corsair_transport','ship:dsy_bsgalactica'
],'three default favorites must be actual named Corsair ships');
assert.equal(DEFAULT_SHIP_ID,'ship:dsy_corsair_transport');
assert.deepEqual(Array.from(FALLBACK_SHIPS.map(({name,cargo,cruise,dockType})=>
  [name,cargo,cruise,dockType])),[
  ['Correo',600,500,1],['Raba',3150,500,2],['Armicustos',3600,500,2],
  ['Essedarius',4450,350,2],['Pilgrim',4300,415,3],['Bulwark',4300,415,3],
  ['Advanced Train',5000,350,2]
]);
assert.equal(DOCK_CLASSES[1].nav,'berth');
assert.equal(DOCK_CLASSES[2].nav,'medium');
assert.equal(DOCK_CLASSES[3].nav,'large');
const raws=[
 {nickname:'dsy_tribun',name:'Hogosha Frigate',type:'transport',hold_size:3150,cruise_speed:500,dock_type:2},
 {nickname:'dsy_corsair_transport',name:'Corsair Transport',type:'transport',hold_size:3600,cruise_speed:500,dock_type:2},
 {nickname:'dsy_bsgalactica',name:'Corsair Train',type:'transport',hold_size:4450,cruise_speed:350,dock_type:2},
 {nickname:'dsy_mercatante',name:'Correo',type:'freighter',hold_size:600,cruise_speed:500,dock_type:1},
 {nickname:'pilgrim_liner',name:'Pilgrim Liner',type:'capital',hold_size:4300,cruise_speed:415,dock_type:3},
 {nickname:'bristol_transport',name:'Bristol Heavy Explorer',type:'capital',hold_size:4300,cruise_speed:415,dock_type:3},
 {nickname:'dsy_advanced_train',name:'Advanced Train',type:'transport',hold_size:5000,cruise_speed:350,dock_type:2},
 {nickname:'dsy_slaveliner',name:'Pilgrim Liner',type:'capital',hold_size:4300,cruise_speed:350,dock_type:2},
 {nickname:'dsy_pi_freighter',name:'Mule',type:'freighter',hold_size:225,cruise_speed:500,dock_type:1},
 {nickname:'npc_ship',name:'NPC Ship',type:'fighter',hold_size:300,cruise_speed:0,dock_type:3},
 {nickname:'unknown_dock',name:'Unknown Ship',type:'transport',hold_size:5000,cruise_speed:500,dock_type:0}
];
const ships=normalizeShipRegistry(raws);
assert.equal(ships.length,7,'only seven valid, user-approved ship records must remain');
assert.equal(findProfile(ships,'ship:dsy_tribun').cargo,3150,'live Raba cargo');
assert.equal(findProfile(ships,'ship:pilgrim_liner').cruise,415,'live Pilgrim cruise');
assert.equal(findProfile(ships,'ship:bristol_transport').dock,'large','Bulwark must inherit real Large mooring');
assert.equal(findProfile(ships,'ship:pilgrim_liner').dock,'large');
assert.equal(findProfile(ships,'ship:dsy_mercatante').dock,'berth','Correo must have ring/berth docking');
assert.equal(findProfile(ships,'ship:dsy_bsgalactica').cargo,4450);
assert.equal(searchShipProfiles(ships,'Raba')[0].nickname,'dsy_tribun');
assert.equal(searchShipProfiles(ships,'Hogosha')[0].nickname,'dsy_tribun');
assert.equal(searchShipProfiles(ships,'Coreo')[0].nickname,'dsy_mercatante');
assert.equal(searchShipProfiles(ships,'Armicustos')[0].nickname,'dsy_corsair_transport');
assert.equal(searchShipProfiles(ships,'Essedarius')[0].nickname,'dsy_bsgalactica');
assert.equal(searchShipProfiles(ships,'Bulwark')[0].nickname,'bristol_transport');
assert.equal(searchShipProfiles(ships,'Bristol Heavy')[0].nickname,'bristol_transport');
assert.equal(searchShipProfiles(ships,'pilgrim_liner')[0].nickname,'pilgrim_liner');
assert.equal(searchShipProfiles(ships,'dsy_slaveliner').length,0,'the ignored Pilgrim version must not appear in search');
assert.throws(()=>normalizeShipRegistry(null),'API invalid should be rejected');
assert.throws(()=>normalizeShipRegistry([{name:'bad'}]),'a malformed registry may not replace cached ships');
assert.deepEqual(resolveSavedFavorites(null,ships),DEFAULT_FAVORITES);
const custom=validateCustomProfile({
  name:'My Cargo Custom',cargo:'4900',cruise:'420',dockType:'3'
},'custom:myfreighter');
assert.equal(custom.cargo,4900);
assert.equal(custom.cruise,420);
assert.equal(custom.dock,'large');
assert(verifyShipProfile(custom));
assert.deepEqual(restoreCustomProfiles(storageCustomProfiles([custom])).map(x=>x.id),[custom.id]);
assert.deepEqual(resolveSavedFavorites([custom.id,DEFAULT_FAVORITES[1],DEFAULT_FAVORITES[2]],[custom,...ships]),
  [custom.id,DEFAULT_FAVORITES[1],DEFAULT_FAVORITES[2]]);
assert.throws(()=>validateCustomProfile({...custom,dockType:0},'custom:test-id'),'unknown docking must not be auto-guessed');
assert.throws(()=>validateCustomProfile({...custom,cargo:0},'custom:test-id'));
assert.throws(()=>validateCustomProfile({...custom,cruise:0},'custom:test-id'));
assert.deepEqual(restoreCustomProfiles([{id:'not-custom',cargo:100}]),[]);
const nav={schema:1,nodes:[
  {id:'planet',kind:'base',system:'s',pos:[0,0,0],allows:['berth']},
  {id:'outpost',kind:'base',system:'s',pos:[1000,0,0],allows:['medium']},
  {id:'capital-dock',kind:'base',system:'s',pos:[2000,0,0],allows:['large']},
  {id:'unknown',kind:'base',system:'s',pos:[3000,0,0],allows:[]}],
  links:[],baseNodes:{ring:'planet',mid:'outpost',large:'capital-dock',unknown:'unknown'}};
const names=['ring','mid','large','unknown'].map(id=>({id}));
const ring=findProfile(ships,'ship:dsy_mercatante');
const mid=findProfile(ships,'ship:dsy_corsair_transport');
const large=findProfile(ships,'ship:pilgrim_liner');
assert.deepEqual(blockedShipDocks(names,ring,nav),['mid','large']);
assert.deepEqual(blockedShipDocks(names,mid,nav),['ring','large']);
assert.deepEqual(blockedShipDocks(names,large,nav),['ring','mid']);
assert.deepEqual(blockedShipDocks([...names,{id:'unmapped'}],mid,nav,{blockUnknown:true}),
 ['ring','large','unknown','unmapped'],'unknown ship docks need their own explicit opt-in');
assert.equal(dockEligibility('unknown',mid,nav),'unknown','missing docking spheres must not claim permission');
assert.equal(dockEligibility('missing',mid,nav),'unknown','unmapped POBs must remain unverified');
const ringNav=new Navigator(nav,[],ring,{charge:0,lane:0});
const midNav=new Navigator(nav,[],mid,{charge:0,lane:0});
const largeNav=new Navigator(nav,[],large,{charge:0,lane:0});
assert.equal(ringNav.route('mid','ring'),null,'ring ship cannot start from mid-only mooring');
assert.equal(midNav.route('ring','mid'),null,'mid ship cannot dock at ring-only planet');
assert.equal(largeNav.route('mid','large'),null,'large-only ship cannot originate from mid dock');
assert.equal(largeNav.route('large','unknown'),null,'navigation may not assume permission when no docking spheres are defined');

assert(partial.includes('id="dtrRoutesFavorites"'),'favorite profile UI is required');
assert(partial.includes('id="dtrRoutesShipPickerOpen"'),'ship search must be accessible');
assert(partial.includes('id="dtrRoutesShipDialog"'),'ship picker modal must exist');
assert(partial.includes('id="dtrRoutesCustomForm"'),'custom ship form must exist');
assert(partial.includes('id="dtrRoutesCustomDelete"'),'custom profiles must be removable');
assert(partial.includes('id="dtrRoutesCargo"')&&partial.includes('form="dtrRoutesForm"'),'available cargo must be independently editable');
assert(!partial.includes('data-dtr-cargo="freighter-'),'legacy generic cargo cards must be removed');
assert(route.includes("import { createShipController }"),'trade runtime should use controller');
assert(route.includes("blockedShipDocks(dataset?.bases||[],profile,navigation,"),'ship-specific physical dock blocking is mandatory');
assert(route.includes("dockEligibility(origin.id,profile,navigation)==='blocked'"),'origin must respect selected ship type');
assert(route.includes("readJson('ships',{},controller.signal)")||controller.includes("readJson('ships',{},controller.signal)"),'API ship registry must be fetched');
assert(controller.includes('getRegistryStatus'),'ship catalogue source must be distinguishable');
assert(controller.includes('FALLBACK_SHIPS'),'verified last-good fallback needs to exist offline');
assert(controller.includes('selectProfile(id)'),'active profile must be selectable');
assert(css.includes('@media(max-width:760px)'),'ship selector must be mobile responsive');
assert(sw.includes('./dtr-ship-controller.mjs')&&sw.includes('./dtr-ship-profiles.mjs'),
  'PWA must include offline ship selector code');
// Constructor is browser-neutral before mount, making its initial preset choice testable.
const instance=createShipController({readJson:async()=>[],onChange:()=>{}});
assert.equal(instance.getCurrent().id,DEFAULT_SHIP_ID);
assert.equal(instance.getCurrent().cruise,500);
assert.deepEqual(instance.getFavorites(),DEFAULT_FAVORITES);
console.log('DTR ship selection audit passed (aliases, Raba, Bulwark/Pilgrim, custom, favorites, Ring/Mid/Large docking and mobile UI).');
