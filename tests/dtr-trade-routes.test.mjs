import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PROFILES, normalizeDarkstat } from '../trade-core/trade.mjs';
import { Navigator,validateNavigation } from '../trade-core/navigation.mjs';
import { search } from '../trade-core/search.mjs';
import { groupRoutes } from '../trade-core/variants.mjs';
import { findPlanetCrete,assessAccess,setLaneSpeed,LANE_SPEED } from '../dtr-route-policy.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [html,partial,css,app,quality,route,worker,sw]=await Promise.all([
 ...['index.html','dtr-trade-panel.html','dtr-trade-routes.css','app.js','dtr-quality.js',
   'dtr-trade-routes.mjs','trade-core/worker.mjs','sw.js'].map(p=>readFile(join(root,p),'utf8'))
]);
assert(html.includes('data-view="trade-routes"'),'Trade Routes main section must be navigable');
assert(html.includes('id="pobTabs"'),'POB network must have own sub navigation');
assert(html.includes('id="tradeRoutesView"'),'Trade Routes must have own workspace');
assert(route.includes("fetch('./dtr-trade-panel.html')"),'workspace must lazy load actual DTR styled panel');
assert(partial.includes('id="dtrRoutesPobs"')&&!partial.includes('id="dtrRoutesPobs" checked'),'POB checkbox must default OFF');
assert(partial.includes('id="dtrRoutesCorsair" checked'),'Corsair profile must default ON');
assert(partial.includes('PLANET CRETE'),'planet Crete must be the selected default');
assert(partial.includes('dtrRoutesStartPicker'),'starting base must remain selectable');
assert(partial.includes('dtrRoutesFavorites')&&partial.includes('dtrRoutesShipDialog'),'the new UI must expose favorites and searchable ships');
assert(partial.includes('id="dtrRoutesCustomForm"')&&partial.includes('dtrRoutesCustomDock'),'custom profiles must edit cargo/cruise/docking');
assert(partial.includes('dtrRoutesShipMaxCargo')&&partial.includes('dtrRoutesShipCruise')&&partial.includes('dtrRoutesShipDocking'),'live ship metrics must be visible');
assert(!partial.includes('data-dtr-cargo="freighter-'),'deprecated generic cargo classes must be replaced');
assert(!partial.includes('WAYPOINT'),'DTR route workspace must not reuse WAYPOINT branding');
assert(css.includes('var(--red-bright)')&&css.includes('var(--gold)'),'routes should use established DTR palette');
assert(css.includes('flex:0 0 auto'),'mobile telemetry must drop original 330px flex basis');
assert(css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),'mobile nav must have four main sections');
assert(route.includes('new Worker('),'route searches must run in a worker');
assert(route.includes("normalizeDarkstat(pobs,commodities)"),'route market data must be normalized');
assert(route.includes("readJson('npc_bases',{},controller.signal)"),'NPC base endpoint must receive an explicit JSON body');
assert(route.includes("readJson('factions',{include_reputations:false"),'factions only provide names for ID owner mapping');
assert(route.includes("readJson('tractors',{include_rephacks:true,filter_nicknames:[CORSAIR_ID_NICKNAME]}"),
  'actual Corsairs ID rephacks must be requested by exact equipment nickname');
assert(route.includes('tractors:corsairIds'),
  'the route access evaluator must use the Corsairs ID rephacks, not NPC faction diplomacy');
assert(route.includes('corsairIds=Array.isArray(cached.corsairIds)'),
  'cached old faction-only market snapshots must not silently grant ID docking');
assert(route.includes('cacheWrite({dataset,factions,corsairIds,loadedAt,pobLoadedAt})'),
  'cached market data must store the matching ID reputation snapshot');
assert(route.includes("markResultsStale()"),'changing a profile or filter must invalidate outdated trade results');
assert(route.includes("assessAccess(dataset.bases"),'Corsair access profile must actually affect search');
assert(partial.includes('id="dtrRoutesUnverified"')&&!partial.includes('id="dtrRoutesUnverified" checked'),
  'include unknown docking must require explicit consent');
assert(route.includes('includeUnverified:'),'ID dock override must be wired into route assessment');
assert(route.includes('access?.blocked.includes(origin.id)'),'starting bases must be checked with the full blocked set');
assert(route.includes('access?.blocked.includes(b.id)'),'the base picker must not offer prohibited starting bases');
assert(!partial.includes('VERIFIED OPPORTUNITIES'),'route candidates must not be falsely described as guaranteed docking');
assert(route.includes("...($('dtrRoutesCorsair').checked?block:[])"),'Corsair filter must remain disableable');
assert(route.includes('blockedShipDocks(dataset.bases,profile,navigation)'),'known incompatible ship docks must be excluded');
assert(route.includes("dockEligibility(origin.id,profile,navigation)==='blocked'"),'origin must obey selected ship docking class');
assert(route.includes('shipController.mount()'),'ship selector should activate with the DTR workspace');
assert(route.includes('returnScope:'),'return mode must be user-changeable');
assert(route.includes('groupRoutes('),'route variants must be grouped, not dumped as a giant list');
assert(worker.includes('optimizeTour'),'original WAYPOINT engine must be the calculation core');
assert(quality.includes("short: 'ROUTES'")&&quality.includes("short: 'POBS'"),'mobile main nav must group categories');
assert(quality.includes("short: 'CALC'"),'calculator needs own bottom entry');
assert(sw.includes('./trade-core/worker.mjs'),'PWA must cache trade calculation worker');
assert(sw.includes('./trade-core/data/navigation.json.gz'),'navigation data should work offline');
const nav=JSON.parse(gunzipSync(await readFile(join(root,'trade-core/data/navigation.json.gz'))).toString('utf8'));
assert(nav.nodes.length>2000&&nav.links.length>2000,'bundled navigation graph should include whole game universe');
assert(validateNavigation(nav));
const overridden=setLaneSpeed(nav);
assert(overridden.links.some(l=>l.kind==='lane'));
assert(overridden.links.filter(l=>l.kind==='lane').every(l=>l.speed===2500),'all trade lanes must use 2500');
assert.equal(LANE_SPEED,2500);
assert.deepEqual(Array.from(PROFILES,p=>[p.cargo,p.cruise]),[[5000,350],[4300,410],[3600,500]]);
const sampleNav=validateNavigation({schema:1,nodes:[
 {id:'c',system:'gamma',pos:[0,0,0]}, {id:'shop',system:'gamma',pos:[2000,0,0]},
 {id:'b',system:'gamma',pos:[3000,0,0]}],links:[],baseNodes:{crete:'c',shop:'shop',buyer:'b'},systemMultipliers:{}});
const testBases=[
{id:'crete',name:'Planet Crete',system:'gamma',systemName:'Omicron Gamma',pos:[0,0,0],kind:'npc',offers:[
 {id:'good',name:'Test Goods',buy:null,sell:8,volume:1,originalVolume:1}]},
{id:'shop',name:'Market A',system:'gamma',systemName:'Omicron Gamma',pos:[2000,0,0],kind:'npc',offers:[
 {id:'good',name:'Test Goods',buy:5,sell:null,volume:1,originalVolume:1}]},
{id:'buyer',name:'Market B',system:'gamma',systemName:'Omicron Gamma',pos:[3000,0,0],kind:'npc',offers:[
 {id:'good',name:'Test Goods',buy:null,sell:9,volume:1,originalVolume:1}]}
];
assert.equal(findPlanetCrete(testBases).id,'crete');
const sample={schema:1,source:'test-fixture',asOf:new Date().toISOString(),bases:testBases};
const routeResults=await search(sample,sampleNav,PROFILES[0],{
 mode:'one',start:'crete',cargo:100,capital:1000,excludePobs:true,
 blocked:[],allowUnknownTime:false,returnScope:'system',returnSystem:'',
 flexiblePickups:true,allowEmptyReturn:false,mixedCargo:false,
 maxMinutes:60,sort:'profit',breadth:18,maxChecks:100,searchMs:1500,
 timeModel:{dock:30,jump:15,lane:10,charge:5}
});
assert(routeResults.results.length>=1,'test search should find a profitable trade');
assert(routeResults.results[0].legs[0].source==='crete','Crete travel approach must be included from actual start');
const groups=groupRoutes(routeResults.results,new Map(testBases.map(b=>[b.id,b])));
assert(groups.length>0);
const access=assessAccess(testBases,true,[]);
assert.deepEqual(Array.from(access.blocked),['crete','shop','buyer'],
  'missing faction data must exclude unknown docking candidates by default');
const transportNav=new Navigator(sampleNav,testBases,PROFILES[0]);
assert(transportNav.route('crete','shop').seconds>0,'navigator must count approach to first trade');
console.log('DTR Trade Routes runtime test passed (navigation, full graph, 2500 lanes, Crete approach, UI, worker and cargo classes).');
