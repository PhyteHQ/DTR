import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(join(root, path), 'utf8');
const [html, manifestRaw, sw, qualityCss, responsiveCss, calculatorCss, app, calculator, catalogSource, pwa, quality] = await Promise.all([
  read('index.html'),
  read('manifest.webmanifest'),
  read('sw.js'),
  read('dtr-quality.css'),
  read('dtr-responsive.css'),
  read('dtr-calculator.css'),
  read('app.js'),
  read('dtr-calculator.js'),
  read('recipe-catalog.js'),
  read('dtr-pwa.js'),
  read('dtr-quality.js')
]);
const manifest = JSON.parse(manifestRaw);
const catalogContext = { window: {} };
runInNewContext(catalogSource, catalogContext);
const catalog = catalogContext.window.DTR_RECIPE_CATALOG;

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'index.html must not contain duplicate IDs');
assert.match(html, /<html\s+lang="en">/i, 'document language must be English');
assert.equal(manifest.lang, 'en-GB', 'manifest language must be en-GB');
assert.equal(manifest.display, 'standalone', 'PWA must use standalone display mode');
assert(!manifest.display_override?.includes('window-controls-overlay'), 'mobile-first PWA must not prefer window controls overlay');

const localRuntimeRefs = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))"/g)]
  .map(match => match[1]);
for (const path of localRuntimeRefs) {
  await read(path);
}

assert(!html.includes('enhancements.js'), 'legacy enhancement runtime must not be loaded');
assert(!html.includes('dtr-pwa-updates.js'), 'legacy PWA update runtime must not be loaded');
assert(sw.includes('./dtr-responsive.css'), 'responsive layer must be cached for offline startup');
assert(!sw.includes('./enhancements.js'), 'legacy enhancement runtime must not be cached');
assert(!sw.includes('./dtr-pwa-updates.js'), 'legacy PWA update runtime must not be cached');
assert.match(html, /aria-labelledby="installTitle"/, 'install dialog must have an accessible name');
assert.match(html, /id="offlineBanner"[^>]+aria-live="polite"/, 'offline status must be announced');

const runtimeFiles = (await readdir(root)).filter(path => path.endsWith('.js'));
const runtime = (await Promise.all(runtimeFiles.map(read))).join('\n');
assert.equal((runtime.match(/serviceWorker\.register\s*\(/g) || []).length, 1, 'service worker must be registered once');
assert.equal((runtime.match(/beforeinstallprompt/g) || []).length, 1, 'install prompt must be handled once');
assert.equal((runtime.match(/new\s+MutationObserver/g) || []).length, 0, 'runtime must not use broad mutation observers');

const installHandler = sw.match(/addEventListener\('install',[\s\S]*?\n}\);/)?.[0] || '';
assert(installHandler, 'service worker install handler must exist');
assert(!installHandler.includes('skipWaiting'), 'service worker install must not bypass update approval');
assert.match(sw, /type==='SKIP_WAITING'[\s\S]*?skipWaiting/, 'approved updates must activate through a message');
assert.match(pwa, /primaryAction === "update"[\s\S]*?SKIP_WAITING/, 'update activation must follow the explicit update action');

assert.match(app, /value === null \|\| value === undefined \|\| value === ''/, 'missing numeric values must remain unknown');
assert.match(app, /quantity === null \|\| !bounds\.valid/, 'stock bars must require a quantity and valid API limits');
assert.match(app, /REQUIRED \$\{fmt\(bounds\.min\)\}/, 'equal stock limits must render as one required value');
assert.match(html, /class="base-hero-telemetry"/, 'POB health and sync must share the compact hero');
assert(!html.includes('id="healthValue"'), 'structural integrity must not be duplicated in a stat card');
assert.match(html, /class="stat-grid compact-stats"[\s\S]*?BASE CREDITS[\s\S]*?FREE STORAGE/, 'compact POB stats must retain credits and storage');
assert.match(html, /data-view="calculator"[\s\S]*?>CALCULATOR</, 'desktop navigation must expose the calculator');
assert.match(html, /id="calculatorView"/, 'calculator workspace must exist');
assert(html.indexOf('recipe-catalog.js') < html.indexOf('dtr-calculator.js'), 'recipe catalog must load before the calculator runtime');

assert.equal(catalog?.meta?.recipeCount, 292, 'Discovery catalog must contain all 292 supplied recipes');
assert.equal(catalog?.recipes?.length, 292, 'catalog metadata and recipe payload must agree');
assert.equal(catalog?.meta?.sourceUrl, 'https://discoverygc.com/gameconfigpublic/', 'catalog must retain its authoritative source URL');
assert(catalog.recipes.some(recipe => recipe.inputs.some(group => group.kind === 'alternative')), 'catalog must retain alternative recipe inputs');
assert(catalog.recipes.some(recipe => recipe.inputs.some(group => group.kind === 'dynamic')), 'catalog must retain dynamic recipe inputs');
assert(catalog.recipes.some(recipe => recipe.bonuses.some(bonus => bonus.id === 'fc_c_grp')), 'catalog must retain Corsair IFF bonuses');
assert.equal(catalog.recipes.find(recipe => recipe.id === 'module_coreupgrade')?.creditCost, 2500000, 'fixed recipe fees must be preserved');
assert.equal(catalog.recipes.find(recipe => recipe.id === 'recipe_gold_basic')?.outputs?.[0]?.id, 'commodity_pirate_gold', 'affiliation output must remain the primary recipe product');
assert.equal(catalog.recipes.find(recipe => recipe.id === 'recipe_gold_basic')?.outputs?.[0]?.name, 'Wildcat Gold', 'recipe titles must not overwrite actual product names');
assert.equal(catalog.recipes.find(recipe => recipe.id === 'recipe_gold_advanced')?.outputs?.[0]?.qty, 800, 'advanced Gold refining output must be preserved');
assert.equal(catalog.recipes.find(recipe => recipe.id === 'recipe_gold_bulk')?.outputs?.[0]?.qty, 4000, 'bulk Gold refining output must be preserved');
assert.match(calculator, /item\?\.price[\s\S]*?\?\? item\?\.price_to_buy_from_base/, 'calculator must prefer Darkstat native POB base-sells prices');
assert.match(app, /item\?\.sell_price \?\? item\?\.price_to_sell_to_base/, 'inventory must use Darkstat native base-buys prices');
assert.match(app, /item\?\.price \?\? item\?\.price_to_buy_from_base/, 'inventory must use Darkstat native base-sells prices');
assert.match(calculator, /return value !== null && value > 0 \? value : null/, 'non-sale and missing prices must remain unknown');
assert.match(calculator, /lineCost: snapshot\.price === null \? null : snapshot\.price \* required/, 'missing prices must not be multiplied as zero');
assert.match(calculator, /const complete = missingPrices === 0/, 'quote completeness must depend on full price coverage');
assert.match(calculator, /priceOverrides\?\.\[pobKey\]\?\.\[priceKey\(option\)\]/, 'manual prices must be scoped by POB and commodity');
assert.match(calculator, /data-calculator-price=/, 'consumed material prices must be editable');
assert.match(calculator, /data-calculator-price-reset=/, 'manual prices must be resettable to the POB feed');
assert.match(calculator, /CLEAR MANUAL PRICE/, 'manual-only values must have an honest clear action');
assert.match(calculator, /CHOOSE MATERIAL \/\/ ONE REQUIRED/, 'alternative inputs must use a clear material chooser');
assert.match(calculator, /AUTOMATICALLY USING THE BEST PRICED AVAILABLE OPTION/, 'alternative inputs must explain automatic selection');
assert(!calculator.includes('PRICE COVERAGE'), 'technical price coverage card must be removed');
assert.match(calculator, /result\.fixedFee > 0 \? `<article><small>RECIPE FEE/, 'recipe-fee card must only render for non-zero fees');
assert.match(calculator, /ALL \$\{total\} MATERIAL/, 'price completeness must be written as plain status text');
assert.match(calculator, /`\$\$\{fmt\(value\)\}`/, 'calculator currency must use Discovery dollar notation');
assert.match(calculator, /adjustedPerCycle\(option\?\.qty, factor\) \* cycles/, 'Corsair IFF material factors must be applied per cycle');
assert.match(calculator, /EXCLUDED FROM CONSUMED MATERIAL COST/, 'catalyst costing semantics must be explicit');

const visibleSources = [html, app, calculator, quality, await read('dtr-uplink.js'), pwa].join('\n');
const nonEnglishUi = [
  /lang="de"/i,
  /de-DE/,
  /Inventar durchsuchen/i,
  /WARE SUCHEN/i,
  /Keine passende Ware/i,
  /Darkstat konnte/i,
  />MENGE</i,
  />BASE KAUFT</i,
  />BASE VERKAUFT</i
];
for (const pattern of nonEnglishUi) {
  assert(!pattern.test(visibleSources), `non-English UI copy detected: ${pattern}`);
}

assert.match(qualityCss, /min-height:\s*64px/, 'mobile navigation needs large touch targets');
assert(!/font-size:\s*6\.3px/.test(qualityCss), 'mobile navigation text must not use the legacy 6.3px size');
assert.match(quality, /class="dtr-quickbar-inner"/, 'desktop quickbar content must use a centred inner rail');
assert.match(qualityCss, /\.dtr-quickbar-inner\s*{[\s\S]*?width:\s*min\(1180px, calc\(100% - 32px\)\)/, 'desktop quickbar content must align with the dashboard shell');
assert.match(qualityCss, /@media \(max-width: 760px\)[\s\S]*?\.dtr-quickbar\s*{[\s\S]*?position:\s*relative/, 'mobile command filter must scroll away with the header');
assert.match(responsiveCss, /@media \(max-width: 680px\)[\s\S]*?\.transmission-rail\s*{[\s\S]*?display:\s*none/, 'decorative transmission rail must collapse on phones');
assert.match(responsiveCss, /\.topbar\s*{[\s\S]*?padding:\s*12px 6px 8px/, 'phone header must use compact spacing');
assert.match(responsiveCss, /orientation:\s*landscape/, 'compact landscape header rules must exist');
assert.match(responsiveCss, /@media \(min-width: 981px\)[\s\S]*?\.base-card-stats strong\s*{[\s\S]*?font-size:\s*1rem/, 'desktop POB values must remain readable');
assert.match(calculatorCss, /\.calculator-field input,[\s\S]*?min-height:\s*50px/, 'calculator fields must remain touch friendly');
assert.match(calculatorCss, /\.calculator-price-editor input\s*{[\s\S]*?min-height:\s*46px/, 'editable material prices must remain touch friendly on desktop');
assert.match(calculatorCss, /@media \(max-width: 760px\)[\s\S]*?\.calculator-price-editor > button\s*{[\s\S]*?min-height:\s*44px/, 'manual-price reset must remain touch friendly on phones');
assert.match(calculatorCss, /@media \(max-width: 760px\)[\s\S]*?\.calculator-table tr\s*{[\s\S]*?display:\s*grid/, 'calculator materials must become mobile cards');
assert.match(calculatorCss, /\.calculator-quote-grid\[data-cards="3"\]\s*{[\s\S]*?repeat\(3/, 'desktop quote cards must adapt when a real recipe fee exists');
assert.match(quality, /id="dtrCalculatorLaunch"/, 'mobile header controls must expose the calculator');
assert.match(quality, /version:\s*'0\.7\.2'/, 'visible build version must match v0.7.2');
assert.match(sw, /v0\.7\.2/, 'service-worker cache must match v0.7.2');
assert(sw.includes('./recipe-catalog.js'), 'recipe catalog must be available offline');
assert(sw.includes('./dtr-calculator.js'), 'calculator runtime must be available offline');

for (const cssPath of localRuntimeRefs.filter(path => path.endsWith('.css'))) {
  const css = await read(cssPath);
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  assert.equal(opens, closes, `${cssPath} must have balanced rule braces`);
}

console.log(`DTR static audit passed (${runtimeFiles.length} runtime scripts, ${localRuntimeRefs.length} local assets checked).`);
