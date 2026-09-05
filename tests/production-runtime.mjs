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
  { nickname: 'commodity_industrial', name: 'Industrial Materials', quantity: 850, price: 50 },
  { nickname: 'commodity_gold_ore', name: 'Gold Ore', quantity: 900, price: 160 },
  { nickname: 'commodity_mox_fuel', name: 'MOX', quantity: 340, price: 50 },
  { nickname: 'commodity_gallic_fuel', name: 'Promethene', quantity: 1700, price: 65 },
  { nickname: 'commodity_h_fuel', name: 'H-Fuel', quantity: 0, price: 45 },
  { nickname: 'commodity_pirate_gold', name: 'Wildcat Gold', quantity: 500, price: 500 }
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
const recipe = catalog.recipes.find(entry => entry.id === 'recipe_gold_advanced');
const snapshot = sandbox.window.DTRProduction.createSnapshot(recipe, base);

assert.equal(snapshot.factor, 0.85, 'Torrelavega production must apply the Corsair material factor');
assert.equal(snapshot.output.name, 'Wildcat Gold', 'Corsairs must retain the Wildcat Gold recipe output');
assert.equal(snapshot.outputPerCycle, 800, 'advanced refining must retain its 800-unit output');
assert.deepEqual(
  Array.from(snapshot.rows, row => [row.option.name, row.required]),
  [['Industrial Materials', 85], ['Gold Ore', 425], ['Promethene', 170]],
  'production inputs must use Corsair-adjusted quantities and the highest-capacity listed fuel'
);
assert.equal(snapshot.cycles, 2, 'maximum cycles must use the tightest live material capacity');
assert.equal(snapshot.estimatedOutput, 1600, 'estimated output must multiply maximum cycles by recipe yield');
assert.equal(snapshot.bottleneck.option.name, 'Gold Ore', 'next-cycle bottleneck must identify the limiting material');
assert.equal(snapshot.bottleneck.gap, 375, 'next-cycle shortage must target exactly one additional cycle');
assert.equal(snapshot.outputStock, 500, 'current Wildcat Gold stock must come from Torrelavega telemetry');
assert.equal(
  sandbox.window.DTRProduction.createSnapshot(recipe, null).rows[2].option.name,
  'MOX',
  'missing telemetry must fall back to the recipe\'s first configured fuel instead of inventing availability'
);
assert(elements.productionGrid.innerHTML.includes('CORSAIR −15% MATERIALS'), 'rendered module must explain the Corsair reduction');
assert(elements.productionGrid.innerHTML.includes('150 Toxic Waste'), 'rendered module must show the recipe byproduct');
assert(elements.productionGrid.innerHTML.includes('100 Crew // NOT CONSUMED'), 'rendered module must distinguish its retained catalyst');

listeners.click({
  target: {
    closest(selector) { return selector === '[data-production-calculate]' ? {} : null; }
  }
});
assert.equal(calculatorCalls.length, 1, 'production CTA must open one calculator quote');
assert.equal(calculatorCalls[0].recipeId, 'recipe_gold_advanced', 'calculator bridge must preserve the advanced recipe');
assert.equal(calculatorCalls[0].pobKey, 'fort-torrelavega', 'calculator bridge must preserve Torrelavega');
assert.equal(calculatorCalls[0].quantity, 800, 'calculator bridge must quote one production cycle');
assert.equal(calculatorCalls[0].alternatives[2], 'commodity_gallic_fuel', 'calculator bridge must preserve the capacity-selected fuel');

console.log('DTR production runtime audit passed (Corsair factor, capacity, bottleneck and calculator bridge).');
