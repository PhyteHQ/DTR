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
  { key: 'forja-del-vacio', short: 'FORJA', label: 'Forja del Vacio' },
  { key: 'fort-torrelavega', short: 'TORRELAVEGA', label: 'Fort Torrelavega' }
];

function calculatorHtml(recipeId, shopItems, quantity = 1) {
  const storage = new Map([["dtr:calculator:v1", JSON.stringify({
    recipeId,
    search: '',
    pobKey: 'deterrence-sanctum',
    quantity,
    alternatives: {}
  })]]);
  const calculatorRoot = {
    innerHTML: '',
    addEventListener() {}
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
      getElementById(id) { return id === 'calculatorView' ? calculatorRoot : null; }
    },
    window: {
      DTR_RECIPE_CATALOG: catalog,
      DTRApp: {
        POBS: pobs,
        getState() {
          return {
            bases: new Map([['deterrence-sanctum', { shop_items: shopItems }]]),
            mode: 'live',
            last: new Date('2026-09-02T12:00:00Z'),
            view: 'calculator'
          };
        },
        show() {}
      },
      addEventListener() {}
    }
  };
  runInNewContext(calculatorSource, sandbox);
  return calculatorRoot.innerHTML;
}

function inventoryFor(recipe, price) {
  return recipe.inputs.flatMap(group => group.options).map(option => ({
    nickname: option.id,
    name: option.name,
    quantity: Math.max(1000000, option.qty * 10),
    price_to_buy_from_base: price
  }));
}

const coreUpgrade = catalog.recipes.find(recipe => recipe.id === 'module_coreupgrade');
assert(coreUpgrade, 'Core Upgrade fixture recipe must exist');
const completePrice = 2;
const expectedCoreCost = coreUpgrade.creditCost
  + coreUpgrade.inputs.reduce((total, group) => total + group.options[0].qty * completePrice, 0);
const completeHtml = calculatorHtml(coreUpgrade.id, inventoryFor(coreUpgrade, completePrice));
assert(completeHtml.includes(`${expectedCoreCost.toLocaleString('en-GB')} cr`), 'complete quote must include consumed materials and fixed fee');
assert(completeHtml.includes('QUOTE READY // STOCK AVAILABLE'), 'complete stocked quote must be ready');

const partialHtml = calculatorHtml(coreUpgrade.id, inventoryFor(coreUpgrade, completePrice).slice(0, 1));
assert(partialHtml.includes('MATERIAL PRICES MISSING'), 'unlisted inputs must keep the quote incomplete');
assert(partialHtml.includes('NOT LISTED'), 'unlisted inputs must be explicit');
assert(/TOTAL BUILD COST<\/small><strong>—<\/strong>/.test(partialHtml), 'incomplete total must remain unknown');
assert(!partialHtml.includes('NaN'), 'missing prices must never produce NaN');

const alternativeRecipe = catalog.recipes.find(recipe => recipe.inputs.some(group => group.options.length > 1));
assert(alternativeRecipe, 'alternative-input fixture recipe must exist');
const alternativeGroup = alternativeRecipe.inputs.find(group => group.options.length > 1);
const cheapOption = alternativeGroup.options[1];
const alternativeInventory = alternativeRecipe.inputs.flatMap(group => group.options.map((option, index) => ({
  nickname: option.id,
  name: option.name,
  quantity: Math.max(1000000, option.qty * 10),
  price_to_buy_from_base: group === alternativeGroup ? (index === 1 ? 4 : 9 + index) : 3
})));
const alternativeHtml = calculatorHtml(alternativeRecipe.id, alternativeInventory);
assert(alternativeHtml.includes(`<strong>${cheapOption.name}</strong>`), 'automatic alternative selection must choose the lowest priced valid POB option');
assert(alternativeHtml.includes('AUTO LOWEST PRICE'), 'automatic alternative behavior must be visible');

const corsairRecipe = catalog.recipes.find(recipe => {
  const bonus = recipe.bonuses.find(entry => entry.id === 'fc_c_grp' && entry.factor < 1);
  return bonus && recipe.inputs.every(group => group.options.length === 1);
});
assert(corsairRecipe, 'Corsair IFF fixture recipe must exist');
const corsairFactor = corsairRecipe.bonuses.find(entry => entry.id === 'fc_c_grp').factor;
const expectedCorsairCost = corsairRecipe.creditCost + corsairRecipe.inputs.reduce(
  (total, group) => total + Math.ceil(group.options[0].qty * corsairFactor - 1e-9) * completePrice,
  0
);
const corsairHtml = calculatorHtml(corsairRecipe.id, inventoryFor(corsairRecipe, completePrice));
assert(corsairHtml.includes(`CORSAIR IFF BONUS // ${corsairFactor.toFixed(2)}× MATERIALS`), 'Corsair IFF factor must be visible');
assert(corsairHtml.includes(`${expectedCorsairCost.toLocaleString('en-GB')} cr`), 'Corsair IFF factor must alter material cost');

console.log('DTR calculator runtime audit passed (complete, missing, alternative-price and Corsair-IFF scenarios).');
