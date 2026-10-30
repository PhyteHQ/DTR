import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [catalogSource, calculatorSource] = await Promise.all([
  readFile(join(rootPath, 'recipe-catalog.js'), 'utf8'),
  readFile(join(rootPath, 'dtr-calculator.js'), 'utf8')
]);

const catalogContext = { window: {} };
runInNewContext(catalogSource, catalogContext);
const catalog = catalogContext.window.DTR_RECIPE_CATALOG;

const pobs = [
  { key: 'deterrence-sanctum', short: 'SANCTUM', label: 'Deterrence Sanctum' },
  { key: 'ravenna-invicta', short: 'INVICTA', label: 'Ravenna Invicta' },
  { key: 'fort-torrelavega', short: 'TORRELAVEGA', label: 'Fort Torrelavega' }
];

function calculatorRuntime(recipeId, shopItems, quantity = 1, priceOverrides = {}, search = '', selectedPob = 'deterrence-sanctum') {
  const storage = new Map([["dtr:calculator:v1", JSON.stringify({
    recipeId,
    search,
    pobKey: selectedPob,
    quantity,
    alternatives: {},
    priceOverrides
  })]]);
  const listeners = {};
  const shownViews = [];
  const calculatorRoot = {
    innerHTML: '',
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const sandbox = {
    console,
    Date,
    Intl,
    Map,
    Set,
    Blob,
    Response,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    document: {
      readyState: 'complete',
      activeElement: null,
      getElementById(id) { return id === 'calculatorView' ? calculatorRoot : null; }
    },
    window: {
      DTR_RECIPE_CATALOG: catalog,
      DTRApp: {
        POBS: pobs,
        getState() {
          return {
            bases: new Map([[selectedPob, { shop_items: shopItems }]]),
            mode: 'live',
            last: new Date('2026-09-02T12:00:00Z'),
            view: 'calculator'
          };
        },
        show(view) { shownViews.push(view); }
      },
      addEventListener() {}
    }
  };
  runInNewContext(calculatorSource, sandbox);
  return {
    get html() { return calculatorRoot.innerHTML; },
    api: sandbox.window.DTRCalculator,
    listeners,
    storage,
    shownViews
  };
}

function calculatorHtml(recipeId, shopItems, quantity = 1, priceOverrides = {}, search = '', selectedPob = 'deterrence-sanctum') {
  return calculatorRuntime(recipeId, shopItems, quantity, priceOverrides, search, selectedPob).html;
}

function inventoryFor(recipe, price) {
  return recipe.inputs.flatMap(group => group.options).map(option => ({
    nickname: option.id,
    name: option.name,
    quantity: Math.max(1000000, option.qty * 10),
    price
  }));
}

const coreUpgrade = catalog.recipes.find(recipe => recipe.id === 'module_coreupgrade');
assert(coreUpgrade, 'Core Upgrade fixture recipe must exist');
const completePrice = 2;
const expectedCoreCost = coreUpgrade.creditCost
  + coreUpgrade.inputs.reduce((total, group) => total + group.options[0].qty * completePrice, 0);
const completeHtml = calculatorHtml(coreUpgrade.id, inventoryFor(coreUpgrade, completePrice));
assert(completeHtml.includes(`$${expectedCoreCost.toLocaleString('en-GB')}`), 'complete quote must include consumed materials and fixed fee');
assert(completeHtml.includes('QUOTE READY // STOCK AVAILABLE'), 'complete stocked quote must be ready');
assert(completeHtml.includes(`ALL ${coreUpgrade.inputs.length} MATERIALS PRICED`), 'pricing completeness must use plain status copy');
assert(!completeHtml.includes('PRICE COVERAGE'), 'technical price-coverage card must not be shown');
assert(completeHtml.includes('RECIPE FEE'), 'a non-zero recipe fee must remain visible');
assert(!/\bcr\b/i.test(completeHtml), 'calculator currency must use the Discovery dollar notation');

const partialHtml = calculatorHtml(coreUpgrade.id, inventoryFor(coreUpgrade, completePrice).slice(0, 1));
assert(partialHtml.includes('MATERIAL PRICES MISSING'), 'unlisted inputs must keep the quote incomplete');
assert(partialHtml.includes('NOT LISTED'), 'unlisted inputs must be explicit');
assert(partialHtml.includes('data-calculator-price='), 'every consumed material must expose an editable unit price');
assert(partialHtml.includes('NO POB PRICE // ENTER MANUALLY'), 'missing POB prices must invite a manual value');
assert(/TOTAL BUILD COST<\/small><strong>—<\/strong>/.test(partialHtml), 'incomplete total must remain unknown');
assert(!partialHtml.includes('NaN'), 'missing prices must never produce NaN');

const manualUnitPrice = 7;
const manualPrices = Object.fromEntries(
  coreUpgrade.inputs.flatMap(group => group.options).map(option => [option.id, manualUnitPrice])
);
const expectedManualCost = coreUpgrade.creditCost
  + coreUpgrade.inputs.reduce((total, group) => total + group.options[0].qty * manualUnitPrice, 0);
const manualHtml = calculatorHtml(coreUpgrade.id, [], 1, {
  'deterrence-sanctum': manualPrices
});
assert(manualHtml.includes(`$${expectedManualCost.toLocaleString('en-GB')}`), 'manual prices must complete a quote when the POB does not list the materials');
assert(manualHtml.includes('MANUAL PRICE // SAVED FOR THIS POB'), 'manual price source must be visible');
assert(manualHtml.includes('MANUAL // NOT LISTED'), 'manual pricing must not hide that a commodity is absent from the POB');
assert(manualHtml.includes('CLEAR MANUAL PRICE'), 'unlisted commodities must not claim that a live POB price exists');

const editedOption = coreUpgrade.inputs[0].options[0];
const editRuntime = calculatorRuntime(coreUpgrade.id, []);
editRuntime.listeners.change({
  target: {
    dataset: { calculatorPrice: editedOption.id },
    value: '13',
    matches(selector) { return selector === '[data-calculator-price]'; }
  }
});
const savedAfterEdit = JSON.parse(editRuntime.storage.get('dtr:calculator:v1'));
assert.equal(savedAfterEdit.priceOverrides['deterrence-sanctum'][editedOption.id], 13, 'edited prices must persist for the selected POB and commodity');
assert(editRuntime.html.includes('MANUAL PRICE // SAVED FOR THIS POB'), 'editing a price must immediately switch its visible source to manual');
assert(editRuntime.html.includes('CLEAR MANUAL PRICE'), 'a manual-only value must expose an honest clear action');
editRuntime.listeners.click({
  target: {
    closest(selector) {
      return selector === '[data-calculator-price-reset]'
        ? { dataset: { calculatorPriceReset: editedOption.id } }
        : null;
    }
  }
});
const savedAfterReset = JSON.parse(editRuntime.storage.get('dtr:calculator:v1'));
assert(!savedAfterReset.priceOverrides['deterrence-sanctum'], 'resetting a price must remove the POB override');
assert(editRuntime.html.includes('NO POB PRICE // ENTER MANUALLY'), 'resetting an unlisted commodity must restore the blank price state');

const liveUnitPrice = 11;
const liveItem = {
  nickname: editedOption.id,
  name: editedOption.name,
  quantity: Math.max(1000000, editedOption.qty * 10),
  price: liveUnitPrice,
  sell_price: 5
};
const liveRuntime = calculatorRuntime(coreUpgrade.id, [
  liveItem,
  ...inventoryFor(coreUpgrade, completePrice).filter(item => item.nickname !== editedOption.id)
]);
assert(liveRuntime.html.includes(`value="${liveUnitPrice}"`), 'native Darkstat price must prefill the editable unit price');
assert(liveRuntime.html.includes('LIVE POB PRICE // EDIT TO OVERRIDE'), 'native Darkstat price must be identified as the live POB source');
liveRuntime.listeners.change({
  target: {
    dataset: { calculatorPrice: editedOption.id },
    value: '13',
    matches(selector) { return selector === '[data-calculator-price]'; }
  }
});
assert(liveRuntime.html.includes('USE POB PRICE'), 'a manual override backed by a live quote must expose the restore action');
liveRuntime.listeners.click({
  target: {
    closest(selector) {
      return selector === '[data-calculator-price-reset]'
        ? { dataset: { calculatorPriceReset: editedOption.id } }
        : null;
    }
  }
});
assert(liveRuntime.html.includes(`value="${liveUnitPrice}"`), 'restoring a POB price must reveal the live value instead of zero');
assert(liveRuntime.html.includes('LIVE POB PRICE // EDIT TO OVERRIDE'), 'restoring must return the source to live POB data');

const alternativeRecipe = catalog.recipes.find(recipe => recipe.inputs.some(group => group.options.length > 1));
assert(alternativeRecipe, 'alternative-input fixture recipe must exist');
const alternativeGroup = alternativeRecipe.inputs.find(group => group.options.length > 1);
const cheapOption = alternativeGroup.options[1];
const alternativeInventory = alternativeRecipe.inputs.flatMap(group => group.options.map((option, index) => ({
  nickname: option.id,
  name: option.name,
  quantity: Math.max(1000000, option.qty * 10),
  price: group === alternativeGroup ? (index === 1 ? 4 : 9 + index) : 3
})));
const alternativeHtml = calculatorHtml(alternativeRecipe.id, alternativeInventory);
assert(alternativeHtml.includes(`<strong>${cheapOption.name}</strong>`), 'automatic alternative selection must choose the lowest priced valid POB option');
assert(alternativeHtml.includes('CHOOSE MATERIAL // ONE REQUIRED'), 'alternative inputs must use a clear material chooser');
assert(alternativeHtml.includes('AUTOMATICALLY USING THE BEST PRICED AVAILABLE OPTION'), 'automatic alternative behavior must be explained');
assert(alternativeHtml.includes(`POB $4 · STOCK`), 'alternative choices must show comparable POB price and stock data');

const goldAdvanced = catalog.recipes.find(recipe => recipe.id === 'recipe_gold_advanced');
assert(goldAdvanced, 'advanced Wildcat Gold fixture recipe must exist');
const goldPrices = new Map([
  ['commodity_industrial', 50],
  ['commodity_gold_ore', 160],
  ['commodity_mox_fuel', 50],
  ['commodity_gallic_fuel', 65],
  ['commodity_h_fuel', 70]
]);
const goldInventory = goldAdvanced.inputs.flatMap(group => group.options.map(option => ({
  nickname: option.id,
  name: option.name,
  quantity: option.id === 'commodity_gold_ore' ? 0 : 19340,
  price: goldPrices.get(option.id) ?? 99,
  sell_price: 1
})));
const goldHtml = calculatorHtml(goldAdvanced.id, goldInventory);
assert(goldHtml.includes('<strong>MOX</strong>'), 'advanced Wildcat Gold must automatically choose the best-priced stocked fuel');
assert(goldHtml.includes('SELECTED RECIPE MATERIAL'), 'alternative rows must identify the displayed material without exposing a technical label');
assert(goldHtml.includes('AUTO · MOX · POB $50 · STOCK 19,340'), 'MOX chooser must explain the automatic price and stock decision');
assert(goldHtml.includes('ALL 3 MATERIALS PRICED'), 'alternative material groups must count once in pricing completeness');
assert(goldHtml.includes('QUOTE READY // 1 STOCK SHORTAGE'), 'pricing completeness must remain separate from stock shortages');
assert(!goldHtml.includes('RECIPE FEE'), 'advanced Wildcat Gold must not show a zero recipe-fee card');

const productionBridge = calculatorRuntime(coreUpgrade.id, goldInventory);
assert.equal(productionBridge.api.openRecipe({
  recipeId: goldAdvanced.id,
  pobKey: 'fort-torrelavega',
  quantity: 800,
  alternatives: { 2: 'commodity_gallic_fuel' }
}), true, 'production bridge must accept a valid recipe preset');
const bridgedState = JSON.parse(productionBridge.storage.get('dtr:calculator:v1'));
assert.equal(bridgedState.recipeId, goldAdvanced.id, 'production bridge must select the requested recipe');
assert.equal(bridgedState.pobKey, 'fort-torrelavega', 'production bridge must select the requested POB');
assert.equal(bridgedState.quantity, 800, 'production bridge must request one full output cycle');
assert.equal(bridgedState.alternatives[`${goldAdvanced.id}:2`], 'commodity_gallic_fuel', 'production bridge must preserve its fuel selection');
assert.deepEqual(productionBridge.shownViews, ['calculator'], 'production bridge must navigate to the calculator once');

const fuelGroupIndex = goldAdvanced.inputs.findIndex(group => group.options.some(option => option.id === 'commodity_mox_fuel'));
const goldChoiceRuntime = calculatorRuntime(goldAdvanced.id, goldInventory);
const chooseFuel = value => goldChoiceRuntime.listeners.change({
  target: {
    id: '',
    value,
    matches() { return false; },
    closest(selector) {
      return selector === '[data-calculator-alternative]'
        ? { dataset: { calculatorAlternative: String(fuelGroupIndex) }, value }
        : null;
    }
  }
});
chooseFuel('commodity_h_fuel');
assert(goldChoiceRuntime.html.includes('<strong>H-Fuel</strong>'), 'manual material selection must replace the automatic choice');
assert(goldChoiceRuntime.html.includes('MANUAL MATERIAL SELECTION'), 'manual material selection must be identified');
chooseFuel('');
assert(goldChoiceRuntime.html.includes('<strong>MOX</strong>'), 'empty material selection must return to automatic mode');
assert(goldChoiceRuntime.html.includes('AUTOMATICALLY USING THE BEST PRICED AVAILABLE OPTION'), 'automatic mode must be restorable');

const exoticRecipe = catalog.recipes.find(recipe => recipe.id === 'ship_part_exotic');
assert(exoticRecipe, 'Corsair Exotic Systems recipe must exist');
const exoticHtml = calculatorHtml(exoticRecipe.id, inventoryFor(exoticRecipe, completePrice));
assert(exoticHtml.includes('CORSAIR IFF BONUS // 0.25× MATERIALS'), 'the retained Exotic Systems discount must be visible');
assert(exoticHtml.includes('TOTAL BUILD COST</small><strong>$200</strong>'),
  'Exotic Systems must apply its retained Corsair factor and choose the 10-unit dynamic input');

const salvageHtml = calculatorHtml('recipe_milsal', [
  { nickname: 'commodity_military_salvage', quantity: 750, price: 50 }
], 25);
assert(salvageHtml.includes('TOTAL BUILD COST</small><strong>$12,500</strong>'),
  'one 25-unit Prototype batch must consume 250 salvage at the quoted unit price');
assert(!salvageHtml.includes('CORSAIR IFF BONUS'), 'the removed salvage discount must not be applied again');
assert(salvageHtml.includes('CHECKED 2026-10-30'), 'the calculator must expose the recipe snapshot date');

const wildcatHtml = calculatorHtml('recipe_gold_basic', [], 1, {}, 'wildcat gold');
assert(wildcatHtml.includes('4 MATCHES'), 'Wildcat Gold search must expose basic, advanced, bulk and reprocessing recipes');
assert(wildcatHtml.includes('Gold refining, basic → Wildcat Gold × 650'), 'basic Wildcat Gold output must be labelled');
assert(wildcatHtml.includes('Gold refining, advanced → Wildcat Gold × 800'), 'advanced Wildcat Gold output must be labelled');
assert(wildcatHtml.includes('Gold refining, bulk → Wildcat Gold × 4,000'), 'bulk Wildcat Gold output must be labelled');
assert(wildcatHtml.includes('Wildcat Gold reprocessing → Gold × 100'), 'the separate Wildcat-to-Gold conversion must remain distinct');
assert(!wildcatHtml.includes('RECIPE FEE'), 'zero-value recipe fees must stay out of the quote summary');


// Invicta shipyard alone values Exotic Systems at its outgoing BASE SELLS quote.
// The POB may only pay $1 to buy Exotics while selling them for $50,000.
const invictaShipRecipe=catalog.recipes.find(recipe=>recipe.id==='ship_assembly_dsy_venator');
assert(invictaShipRecipe,'Murmillo recipe must exist');
const invictaStock=invictaShipRecipe.inputs.map(group=>{
  const o=group.options[0];
  return {
    nickname:o.id,name:o.name,quantity:1000,
    price:o.id==='commodity_ship_part_exotic'?1:10,
    price_to_sell_to_base:o.id==='commodity_ship_part_exotic'?1:10,
    price_to_buy_from_base:o.id==='commodity_ship_part_exotic'?50000:999,
    dtrBaseSellPrice:o.id==='commodity_ship_part_exotic'?50000:999
  };
});
const invictaHtml=calculatorHtml(invictaShipRecipe.id,invictaStock,1,{},'','ravenna-invicta');
assert(invictaHtml.includes('INVICTA BASE SELLS // EXOTIC SYSTEMS'),'Invicta shipyard Exotic price source must be shown');
assert(invictaHtml.includes('value="50000"'),'Invicta shipyard Exotic price must use the $50,000 selling quote');
assert(invictaHtml.includes('$2,652,300'),'Murmillo calculator must match shipyard mixed-source material valuation');
const invictaOverride=calculatorHtml(invictaShipRecipe.id,invictaStock,1,{
  'ravenna-invicta':{'commodity_ship_part_exotic':45000}
},'','ravenna-invicta');
assert(invictaOverride.includes('value="45000"'),'manual pricing must remain possible');
assert(invictaOverride.includes('MANUAL PRICE // SAVED FOR THIS POB'),'manual source must be shown');
assert(invictaOverride.includes('$2,387,300'),'manual override must adjust the selected shipyard quote');
const invictaUnknown=calculatorHtml(invictaShipRecipe.id,invictaStock.map(item=>
  item.nickname==='commodity_ship_part_exotic'
    ?{...item,price_to_buy_from_base:null,dtrBaseSellPrice:null}
    :item
),1,{},'','ravenna-invicta');
assert(invictaUnknown.includes('1 MATERIAL PRICE MISSING'),'a missing Exotic Systems selling quote must block a complete ship price');
assert(!invictaUnknown.includes('$2,353'),'a $1 incoming buy offer must never be mistaken for the outgoing price');
assert(invictaUnknown.includes('NO POB PRICE // ENTER MANUALLY'),'unreported exotic price should allow manual entry');
const sanctuaryShip=calculatorHtml(invictaShipRecipe.id,invictaStock,1,{},'','deterrence-sanctum');
assert(sanctuaryShip.includes('value="1"'),'normal non-Invicta calculator quotes must retain BASE BUYS for Exotics');
assert(!sanctuaryShip.includes('EXOTIC = BASE SELLS'),'Exotic sale-price exception must remain scoped to Invicta shipyard');

// The 30 October public snapshot adds three hulls, four weapon variants and a cloak.
// Fixed unit prices isolate consumed quantities from live market changes.
const newRecipeCosts = new Map([
  ['ship_assembly_ex_hacker_gunship', 1530],
  ['ship_assembly_cv_cruiser', 3060],
  ['recipe_cruiser_heavy_battlecannon', 1140],
  ['recipe_generic_gb_chaingun', 910],
  ['recipe_gb_heavychaingun_forward', 910],
  ['recipe_gb_heavychaingun_forward_internal', 990],
  ['recipe_cloak_light_blacklight_delta', 9000],
  ['ship_assembly_xenos_corvette', 1922]
]);
const quotedCost = html => html.match(/TOTAL BUILD COST<\/small><strong>([^<]*)<\/strong>/)?.[1];
for (const [id, expected] of newRecipeCosts) {
  const recipe = catalog.recipes.find(entry => entry.id === id);
  assert(recipe, `new recipe ${id} must exist`);
  const stocked = inventoryFor(recipe, 2);
  const html = calculatorHtml(id, stocked);
  assert.equal(quotedCost(html), `$${expected.toLocaleString('en-GB')}`,
    `${id} must price consumed materials while excluding retained catalysts`);
  assert(html.includes(id === 'ship_assembly_xenos_corvette'
    ? 'RESTRICTED RECIPE // CORSAIR IFF NOT AUTHORIZED'
    : 'QUOTE READY // STOCK AVAILABLE'), `${id} must retain its actual Corsair authorization`);
  const missing = calculatorHtml(id, []);
  assert.equal(quotedCost(missing), '—', `${id} missing prices must stay unknown`);
  assert(missing.includes('NO POB PRICE // ENTER MANUALLY'), `${id} must allow manual prices`);
  const searched = calculatorHtml(id, stocked, 1, {}, recipe.name);
  assert(!searched.includes('NO MATCHING RECIPE'), `${id} must be searchable by its name`);
}
const xenoRecipe = catalog.recipes.find(recipe => recipe.id === 'ship_assembly_xenos_corvette');
assert.equal(xenoRecipe.restricted, true, 'the Xeno Corvette must remain restricted');
assert(xenoRecipe.bonuses.some(bonus => bonus.id === 'fc_x_grp'), 'Xeno Corvette authorization must retain Xenos affiliation');
assert(!xenoRecipe.bonuses.some(bonus => bonus.id === 'fc_c_grp'), 'Xeno Corvette must not acquire Corsair authorization');
for (const recipe of catalog.recipes) {
  const html = calculatorHtml(recipe.id, inventoryFor(recipe, 2));
  assert(html.includes('Recipe Cost Calculator'), `${recipe.id} must render`);
  assert(!/\b(?:NaN|Infinity|undefined)\b/.test(html), `${recipe.id} must not display invalid values`);
}
const noMatches = calculatorHtml('recipe_milsal', [], 1, {}, 'no-such-recipe-20261030');
assert(noMatches.includes('CHECKED 2026-10-30'), 'no-match view must retain the source date');

console.log('DTR calculator runtime audit passed (300 recipe displays, eight additions, salvage quantities, live/manual/missing prices, variants and Corsair rules).');
