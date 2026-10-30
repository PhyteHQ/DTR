// Audit-only probe for the public recipe snapshot checked on 30 October 2026.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidateArgument = process.argv[2];
if (!candidateArgument) throw new Error('Usage: node tests/dtr-recipe-candidate.mjs <candidate-catalog.js>');
const [catalogSource, calculatorSource] = await Promise.all([
  readFile(resolve(candidateArgument), 'utf8'),
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


const expected = new Map([
  ['ship_assembly_ex_hacker_gunship',1530],
  ['ship_assembly_cv_cruiser',3060],
  ['recipe_cruiser_heavy_battlecannon',1140],
  ['recipe_generic_gb_chaingun',910],
  ['recipe_gb_heavychaingun_forward',910],
  ['recipe_gb_heavychaingun_forward_internal',990],
  ['recipe_cloak_light_blacklight_delta',9000],
  ['ship_assembly_xenos_corvette',1922]
]);
const results=[];
for (const [id,amount] of expected) {
  const recipe=catalog.recipes.find(r=>r.id===id);
  assert(recipe,`${id} must exist`);
  const stocked=inventoryFor(recipe,2);
  const html=calculatorHtml(id,stocked);
  const actual=html.match(/TOTAL BUILD COST<\/small><strong>([^<]*)<\/strong>/)?.[1];
  assert.equal(actual,'$'+amount.toLocaleString('en-GB'),`${id}: all consumed materials and no retained catalysts`);
  assert(html.includes(recipe.restricted?'RESTRICTED RECIPE // CORSAIR IFF NOT AUTHORIZED':'QUOTE READY // STOCK AVAILABLE'),`${id}: correct Corsair restriction`);
  const missing=calculatorHtml(id,[]);
  assert(missing.includes('NO POB PRICE // ENTER MANUALLY'),'unlisted inputs must remain unknown');
  assert.equal(missing.match(/TOTAL BUILD COST<\/small><strong>([^<]*)<\/strong>/)?.[1],'—','missing quotes must not become zero');
  const byName=calculatorHtml(id,stocked,1,{},recipe.name);
  assert(!byName.includes('NO MATCHING RECIPE'),`${id} must be searchable`);
  results.push({id,costAtUnitPrice2:actual,restriction:recipe.restricted?'CORSAIR NOT AUTHORIZED':'unrestricted'});
}
let rendered=0;
for (const recipe of catalog.recipes) {
  const html=calculatorHtml(recipe.id,inventoryFor(recipe,2));
  assert(html.includes('Recipe Cost Calculator'),`${recipe.id}: calculator rendered`);
  assert(!/\b(?:NaN|Infinity|undefined)\b/.test(html),`${recipe.id}: no invalid rendered values`);
  rendered++;
}
const salvage=catalog.recipes.find(r=>r.id==='recipe_milsal');
const salvageHtml=calculatorHtml(salvage.id,[{nickname:'commodity_military_salvage',quantity:750,price:50}],25);
assert.equal(salvageHtml.match(/TOTAL BUILD COST<\/small><strong>([^<]*)<\/strong>/)?.[1],'$12,500');
assert(!salvageHtml.includes('CORSAIR IFF BONUS'),'removed Corsair bonus must not be applied again');
const productionSource=await readFile(join(rootPath,'dtr-production.js'),'utf8');
const context={window:{addEventListener(){}},document:{readyState:'loading',addEventListener(){}},Intl,Map,Set};
runInNewContext(productionSource,context);
const stock={shop_items:[{nickname:'commodity_military_salvage',quantity:750}]};
const before={window:{}};
runInNewContext(await readFile(join(rootPath,'recipe-catalog.js'),'utf8'),before);
const old=context.window.DTRProduction.createSnapshot(before.window.DTR_RECIPE_CATALOG.recipes.find(r=>r.id==='recipe_milsal'),stock);
const fresh=context.window.DTRProduction.createSnapshot(salvage,stock);
assert.equal(old.rows[0].required,255);
assert.equal(fresh.rows[0].required,250);
assert.equal(old.estimatedOutput,50);
assert.equal(fresh.estimatedOutput,75);
console.log('DTR_RECIPE_CANDIDATE '+JSON.stringify({rendered,newRecipeChecks:results,militarySalvage:{stock:750,before:{required:old.rows[0].required,cycles:old.cycles,output:old.estimatedOutput},current:{required:fresh.rows[0].required,cycles:fresh.cycles,output:fresh.estimatedOutput}}}));
