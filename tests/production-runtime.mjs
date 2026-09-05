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
  { nickname: 'commodity_iron', name: 'Iron', quantity: 100000, price: 25 }
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

console.log('DTR production runtime audit passed (Gold, Scrap Smelter, visible materials and calculator bridge).');
