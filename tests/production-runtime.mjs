import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [catalogSource, productionSource] = await Promise.all([
  readFile(join(rootPath, 'recipe-catalog.js'), 'utf8'),
  readFile(join(rootPath, 'dtr-production.js'), 'utf8')
]);

const catalogContext = { window: {} };
runInNewContext(catalogSource, catalogContext);
const catalog = catalogContext.window.DTR_RECIPE_CATALOG;
const listeners = {};
const calculatorCalls = [];
const elements = {
  productionPanel: {
    hidden: true,
    addEventListener(type, listener) { listeners[type] = listener; }
  },
  productionGrid: { innerHTML: '' },
  productionState: { dataset: {}, textContent: '' }
};
const inventory = [
  { nickname: 'commodity_industrial', name: 'Industrial Materials', quantity: 11300, price: 50 },
  { nickname: 'commodity_gold_ore', name: 'Gold Ore', quantity: 900, price: 160 },
  { nickname: 'commodity_mox_fuel', name: 'MOX', quantity: 22533, price: 50 },
  { nickname: 'commodity_gallic_fuel', name: 'Promethene', quantity: 1700, price: 65 },
  { nickname: 'commodity_h_fuel', name: 'H-Fuel', quantity: 0, price: 45 },
  { nickname: 'commodity_pirate_gold', name: 'Wildcat Gold', quantity: 500, price: 500 },
  { nickname: 'commodity_basic_alloys', name: 'Basic Alloy', quantity: 44620, price: 120 },
  { nickname: 'commodity_scrap_metal', name: 'Scrap Metal', quantity: 13850, price: 20 },
  { nickname: 'commodity_iron', name: 'Iron', quantity: 100000, price: 25 },
  { nickname: 'commodity_military_salvage', name: 'Military Salvage', quantity: 3000, price_to_sell_to_base: 50 },
  { nickname: 'commodity_prototype_components', name: 'Prototype Components', quantity: 1000, price_to_sell_to_base: 80 },
  { nickname: 'commodity_water', name: 'Water', quantity: 5000, price_to_sell_to_base: 2 },
  { nickname: 'commodity_fertilizers', name: 'Fertilizers', quantity: 500, price_to_sell_to_base: 4 },
  { nickname: 'commodity_food', name: 'Food Rations', quantity: 1750, price_to_sell_to_base: 8 },
  { nickname: 'commodity_cryocubes', name: 'Cryocubes', quantity: 500, price_to_sell_to_base: 3 },
  { nickname: 'commodity_high_temp_alloys', name: 'High-Temperature Alloy', quantity: 500, price_to_sell_to_base: 10 },
  { nickname: 'commodity_super_alloys', name: 'Super Alloy', quantity: 500, price_to_sell_to_base: 15 },
  { nickname: 'commodity_xeno_relics', name: 'Xeno Relics', quantity: 500, price_to_sell_to_base: 17 },
  { nickname: 'commodity_azurite_gas', name: 'Azurite Gas', quantity: 500, price_to_sell_to_base: 20 },
  { nickname: 'commodity_multiplexors', name: 'Quantum Multiplexors', quantity: 500, price_to_sell_to_base: 22 },
  { nickname: 'commodity_ship_part_exotic', name: 'Exotic Systems', quantity: 10, price_to_sell_to_base: 170 }
];
const base = { shop_items: inventory };
const appState = {
  view: 'fort-torrelavega',
  bases: new Map([['fort-torrelavega', base]])
};
const sandbox = {
  console,
  Intl,
  Map,
  Set,
  document: {
    readyState: 'complete',
    getElementById(id) { return elements[id] || null; }
  },
  window: {
    DTR_RECIPE_CATALOG: catalog,
    DTRApp: { getState() { return appState; }, show() {} },
    DTRCalculator: { openRecipe(options) { calculatorCalls.push(options); } },
    matchMedia() { return { matches: false }; },
    addEventListener() {}
  }
};

runInNewContext(productionSource, sandbox);
const goldRecipe = catalog.recipes.find(entry => entry.id === 'recipe_gold_advanced');
const scrapRecipe = catalog.recipes.find(entry => entry.id === 'recipe_scrap_advanced');
const snapshot = sandbox.window.DTRProduction.createSnapshot(goldRecipe, base, {
  2: 'commodity_mox_fuel'
});
const scrapSnapshot = sandbox.window.DTRProduction.createSnapshot(scrapRecipe, base, {
  1: 'commodity_mox_fuel',
  2: 'commodity_scrap_metal'
});

assert.equal(snapshot.factor, 0.85, 'Torrelavega production must apply the Corsair material factor');
assert.equal(snapshot.output.name, 'Wildcat Gold', 'Corsairs must retain the Wildcat Gold recipe output');
assert.equal(snapshot.outputPerCycle, 800, 'advanced refining must retain its 800-unit output');
assert.deepEqual(
  Array.from(snapshot.rows, row => [row.option.name, row.required]),
  [['Industrial Materials', 85], ['Gold Ore', 425], ['MOX', 170]],
  'Gold production must use the RHW facility materials with Corsair-adjusted quantities'
);
assert.equal(snapshot.cycles, 2, 'maximum cycles must use the tightest live material capacity');
assert.equal(snapshot.estimatedOutput, 1600, 'estimated output must multiply maximum cycles by recipe yield');
assert.equal(snapshot.bottleneck.option.name, 'Gold Ore', 'next-cycle bottleneck must identify the limiting material');
assert.equal(snapshot.bottleneck.gap, 375, 'next-cycle shortage must target exactly one additional cycle');
assert.equal(snapshot.outputStock, 500, 'current Wildcat Gold stock must come from Torrelavega telemetry');
assert.equal(
  sandbox.window.DTRProduction.createSnapshot(goldRecipe, null).rows[2].option.name,
  'MOX',
  'missing telemetry must fall back to the recipe\'s first configured fuel instead of inventing availability'
);
assert(elements.productionGrid.innerHTML.includes('CORSAIR −15% MATERIALS'), 'rendered module must explain the Corsair reduction');
assert(elements.productionGrid.innerHTML.includes('150 Toxic Waste'), 'rendered module must show the recipe byproduct');
assert(elements.productionGrid.innerHTML.includes('100 Crew // NOT CONSUMED'), 'rendered module must distinguish its retained catalyst');
assert(elements.productionGrid.innerHTML.includes('Wildcat Gold'), 'Torrelavega must render its Wildcat Gold module');
assert(elements.productionGrid.innerHTML.includes('Basic Alloy'), 'Torrelavega must render its Scrap Smelter output');
assert(elements.productionGrid.innerHTML.includes('Gold Ore'), 'Gold materials must be immediately present in the rendered card');
assert(elements.productionGrid.innerHTML.includes('Scrap Metal'), 'Scrap Smelter materials must be immediately present in the rendered card');
assert(!elements.productionGrid.innerHTML.includes('<details'), 'production materials must never be hidden behind a disclosure control');

assert.equal(scrapSnapshot.factor, 1, 'Scrap Smelting must not invent a Corsair material discount');
assert.equal(scrapSnapshot.output.name, 'Basic Alloy', 'advanced Scrap Smelting must output Basic Alloy');
assert.equal(scrapSnapshot.outputPerCycle, 750, 'advanced Scrap Smelting must yield 750 Basic Alloy');
assert.deepEqual(
  Array.from(scrapSnapshot.rows, row => [row.option.name, row.required]),
  [['Industrial Materials', 75], ['MOX', 100], ['Scrap Metal', 750]],
  'Scrap Smelter must match the RHW facility recipe exactly'
);
assert.equal(scrapSnapshot.cycles, 18, 'Scrap Metal stock must limit the fixture to 18 cycles');
assert.equal(scrapSnapshot.estimatedOutput, 13500, 'Scrap Smelter estimated output must use 750 per cycle');
assert.equal(scrapSnapshot.outputStock, 44620, 'Basic Alloy stock must come from Torrelavega telemetry');
assert.equal(scrapSnapshot.bottleneck.option.name, 'Scrap Metal', 'Scrap Metal must be the next-cycle bottleneck');
assert.equal(scrapSnapshot.bottleneck.gap, 400, 'the 19th Scrap Smelter cycle must need 400 additional Scrap Metal');

listeners.click({
  target: {
    closest(selector) {
      return selector === '[data-production-calculate]'
        ? { dataset: { productionCalculate: 'recipe_scrap_advanced' } }
        : null;
    }
  }
});
assert.equal(calculatorCalls.length, 1, 'production CTA must open one calculator quote');
assert.equal(calculatorCalls[0].recipeId, 'recipe_scrap_advanced', 'calculator bridge must preserve the Scrap Smelter recipe');
assert.equal(calculatorCalls[0].pobKey, 'fort-torrelavega', 'calculator bridge must preserve Torrelavega');
assert.equal(calculatorCalls[0].quantity, 750, 'calculator bridge must quote one Scrap Smelter cycle');
assert.equal(calculatorCalls[0].alternatives[1], 'commodity_mox_fuel', 'calculator bridge must preserve the configured Scrap Smelter fuel');
assert.equal(calculatorCalls[0].alternatives[2], 'commodity_scrap_metal', 'calculator bridge must preserve Scrap Metal instead of silently switching to Iron');

assert.equal(sandbox.window.DTRProduction.POB_KEYS.length, 3, 'the active network must have three POBs');
for (const key of ['deterrence-sanctum','ravenna-invicta']) {
  appState.view=key;
  appState.bases.set(key,base);
  sandbox.window.DTRProduction.render();
  assert(!elements.productionPanel.hidden,key+' must render production panel');
  assert(elements.productionGrid.innerHTML.includes('SCRAP SMELTER'),key+' must render Scrap Smelter');
  assert(!elements.productionGrid.innerHTML.includes('Wildcat Gold'),key+' must not inherit Gold production');
}
assert(!sandbox.window.DTRProduction.POB_KEYS.includes('forja-del-vacio'), 'Forja is retired and cannot be a production node');


const moduleIds = {
  'deterrence-sanctum': ['recipe_fow_advanced','recipe_scrap_advanced','recipe_milsal'],
  'ravenna-invicta': ['recipe_fow_advanced','recipe_scrap_advanced','recipe_milsal','ship_part_exotic'],
  'fort-torrelavega': ['recipe_gold_advanced','recipe_scrap_advanced']
};
for (const [key, ids] of Object.entries(moduleIds)) {
  const actual = Array.from(sandbox.window.DTRProduction.modulesFor(key), module=>module.recipeId);
  assert.deepEqual(actual, ids, key+' must show precisely its installed production modules');
}
// Desktop slot positions are explicit, while DOM order supports single-column mobile.
const desiredLayout = {
  'deterrence-sanctum': [
    ['Food Rations','top-left'], ['Basic Alloy','top-right'],
    ['Prototype Components','bottom-left']
  ],
  'ravenna-invicta': [
    ['Food Rations','top-left'], ['Basic Alloy','top-right'],
    ['Prototype Components','bottom-left'], ['Exotic Systems','bottom-right']
  ],
  'fort-torrelavega': [
    ['Wildcat Gold','top-left'], ['Basic Alloy','top-right']
  ]
};
for (const [key,expected] of Object.entries(desiredLayout)) {
  appState.view=key;
  if(!appState.bases.has(key)) appState.bases.set(key,base);
  sandbox.window.DTRProduction.render();
  const rendered=[...elements.productionGrid.innerHTML.matchAll(
    /<article class="production-card" data-tone="[^"]+" data-layout-slot="([^"]+)"[\s\S]*?<h4>([^<]+)<\/h4>/g
  )].map(([,slot,name])=>[name,slot]);
  assert.deepEqual(rendered,expected,key+' must respect the production grid layout');
  assert.equal(rendered.length,expected.length,key+' may not show empty dummy module cards');
}
const prototypeRecipe=catalog.recipes.find(entry=>entry.id==='recipe_milsal');
const hydroRecipe=catalog.recipes.find(entry=>entry.id==='recipe_fow_advanced');
const exoticRecipe=catalog.recipes.find(entry=>entry.id==='ship_part_exotic');
const production=sandbox.window.DTRProduction;
const prototype=production.createSnapshot(prototypeRecipe,base);
assert.equal(prototype.factor,1,'current salvage reclamation must not apply the removed Corsair discount');
assert.equal(prototype.outputPerCycle,25,'prototype reclaiming yields 25 components');
assert.equal(prototype.rows[0].required,250,'current reclamation must consume 250 Military Salvage per cycle');
assert.equal(prototype.cycles,12,'3000 Military Salvage must support twelve current cycles');
assert.equal(prototype.estimatedOutput,300,'twelve current cycles must produce 300 Prototype Components');
const salvageBoundary=production.createSnapshot(prototypeRecipe,{shop_items:[
  {nickname:'commodity_military_salvage',quantity:750}
]});
assert.equal(salvageBoundary.cycles,3,'750 salvage must support three cycles without a second discount');
assert.equal(salvageBoundary.estimatedOutput,75,'750 salvage must produce 75 Prototype Components');
assert.equal(prototype.byproducts[0].name,'Scrap Metal','reclamation must retain Scrap Metal byproduct');
assert.equal(prototype.byproducts[0].qty,450,'reclamation must show 450 Scrap Metal byproduct');
assert.equal(prototype.catalysts[0].qty,100,'100 scientists must be retained, not consumed');
const hydro=production.createSnapshot(hydroRecipe,base);
assert.equal(hydro.factor,1,'Corsairs must not receive a Hydroponics discount');
assert.equal(hydro.outputPerCycle,750,'advanced Hydroponics yields 750 Food Rations');
assert.deepEqual(Array.from(hydro.rows,row=>[row.option.name,row.required]),
  [['Water',1000],['Fertilizers',100]],'advanced Hydroponics recipe must use Water and Fertilizers');
assert.equal(hydro.cycles,5,'Hydroponics capacity must be limited by actual stock');
assert.equal(hydro.catalysts[0].qty,200,'Hydroponics must show 200 retained crew');
const exotic=production.createSnapshot(exoticRecipe,base);
assert.equal(exotic.factor,0.25,'Corsair Exotic Systems factor must be 0.25');
assert.equal(exotic.outputPerCycle,1,'Exotic Systems output one component per cycle');
assert.deepEqual(Array.from(exotic.rows,row=>row.required),[10,15,15,10,15,25,10],
  'Exotic Systems inputs must apply Corsair discount to each consumed material');
assert.equal(exotic.rows[6].option.id,'commodity_multiplexors','available Multiplexors should be used for Exotic Systems');
assert(exotic.catalysts.some(row=>row.name==='Scientists'&&row.qty===100),'Scientists required but not consumed');
assert(exotic.catalysts.some(row=>row.name==='Crew'&&row.qty===200),'Crew required but not consumed');
for(const key of ['deterrence-sanctum','ravenna-invicta']){
  appState.view=key;
  production.render();
  assert(elements.productionGrid.innerHTML.includes('Prototype Components'),key+' must show Prototype Components production');
  assert(elements.productionGrid.innerHTML.includes('Food Rations'),key+' must show advanced Food Rations production');
  assert(elements.productionGrid.innerHTML.includes('Hydroponics Bay'.toUpperCase()),key+' must show Hydroponics Bay module');
}
appState.view='ravenna-invicta';
production.render();
assert(elements.productionGrid.innerHTML.includes('Exotic Systems'), 'Invicta must show shipyard Exotic Systems production');
assert(elements.productionGrid.innerHTML.includes('CORSAIR −75% MATERIALS'),'Exotic production must show its Corsair IFF bonus');
appState.view='deterrence-sanctum';
production.render();
assert(!elements.productionGrid.innerHTML.includes('Exotic Systems'),'Sanctum must not claim the Invicta Exotic Systems module');
const callsBefore=calculatorCalls.length;
listeners.click({target:{closest(selector){
  return selector==='[data-production-calculate]'
    ?{dataset:{productionCalculate:'recipe_milsal',productionPob:'deterrence-sanctum'}}:null;
}}});
assert.equal(calculatorCalls.length,callsBefore+1,'Salvage module should open calculator');
assert.equal(calculatorCalls.at(-1).pobKey,'deterrence-sanctum','Sanctum module must pass its own POB');
assert.equal(calculatorCalls.at(-1).quantity,25,'Prototype quote must select one 25-unit batch');
listeners.click({target:{closest(selector){
  return selector==='[data-production-calculate]'
    ?{dataset:{productionCalculate:'ship_part_exotic',productionPob:'ravenna-invicta'}}:null;
}}});
assert.equal(calculatorCalls.at(-1).recipeId,'ship_part_exotic','Exotic module quote must use the exact recipe');
assert.equal(calculatorCalls.at(-1).pobKey,'ravenna-invicta','Exotic module quote must use Invicta prices');

console.log('DTR production runtime audit passed (Gold, Scrap Smelter, visible materials and calculator bridge).');
