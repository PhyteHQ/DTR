import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(join(root, path), 'utf8');
const [html, manifestRaw, sw, qualityCss, responsiveCss, calculatorCss, productionCss, app, calculator, production, catalogSource, pwa, quality] = await Promise.all([
  read('index.html'),
  read('manifest.webmanifest'),
  read('sw.js'),
  read('dtr-quality.css'),
  read('dtr-responsive.css'),
  read('dtr-calculator.css'),
  read('dtr-production.css'),
  read('app.js'),
  read('dtr-calculator.js'),
  read('dtr-production.js'),
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
assert(!html.includes('TOTAL FREE STORAGE'), 'network overview must not repeat aggregate free storage');
assert(!app.includes('metricStorage'), 'removed aggregate storage metric must not leave dead runtime references');
assert(
  html.indexOf('id="overviewGrid"') < html.indexOf('class="network-metrics"'),
  'POB status must appear before secondary network metrics'
);
assert.equal(manifest.lang, 'en-GB', 'manifest language must be en-GB');
assert.equal(manifest.display, 'standalone', 'PWA must use standalone display mode');
assert(!manifest.display_override?.includes('window-controls-overlay'), 'mobile-first PWA must not prefer window controls overlay');

const localRuntimeRefs = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))"/g)]
  .map(match => match[1]);
for (const path of localRuntimeRefs) {
  await read(path);
}

assert(html.includes('id="helpButton"') && html.includes('href="./help/guide.html"'), 'site header must link to the DTR help guide');
assert(sw.includes('./help/guide.html') && sw.includes('./help/img/'), 'PWA must cache the full help guide and screenshots');
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
assert.match(html, /data-view="trade-routes"/, 'desktop must expose its own Trade Routes workspace');
assert.match(html, /id="pobTabs"/, 'the POB sub-navigation must exist');
assert.match(html, /id="tradeRoutesView" class="view dtr-routes-view" hidden/, 'Trade Routes must be a native DTR view');
assert(sw.includes('./dtr-trade-routes.mjs') && sw.includes('./dtr-route-policy.mjs'), 'trade route controls and faction predictor must work offline');
const routePolicy=await read('dtr-route-policy.mjs');
assert.match(routePolicy, /'li01_01_base','ew16_01_base'/, 'Manhattan and landing-site no-dock rules must both exist');
assert.match(routePolicy, /dsy_license_fc_c_grp/, 'actual Corsair ID nickname must be used by docking policy');
assert.match(routePolicy, /REP_MODE/, 'ID rephack adjustment mode must be evaluated');
assert.match(routePolicy, /NO CORSAIR ID REPHACK/, 'missing ID data must fail closed');
const tradeRuntime=await read('dtr-trade-routes.mjs');
assert.match(tradeRuntime, /include_rephacks:true/, 'Darkstat request must include ID rephacks');
assert.match(tradeRuntime, /filter_nicknames:\[CORSAIR_ID_NICKNAME\]/,
  'the actual Corsair ID must be selected, not the NPC faction relationship table');
assert.match(routePolicy, /!includeUnverified&&a\.state==='unverified'/, 'Corsair docking must exclude unknown places unless expressly opted into');
assert.match(await read('dtr-trade-panel.html'), /id="dtrRoutesUnverified"/, 'Advanced Search must offer explicit risky docking opt-in');
assert.match(await read('dtr-trade-routes.mjs'), /access\?\.blocked\.includes\(origin\.id\)/, 'starting station must obey the strict Corsair dock filter');
assert(sw.includes('./trade-core/data/navigation.json.gz'), 'navigation graph must be cached for installed DTR');
assert(sw.includes('./dtr-ship-profiles.mjs')&&sw.includes('./dtr-ship-controller.mjs')&&sw.includes('./dtr-ships.css'),'ship selector modules and styles must be available offline');
assert(html.includes('./dtr-ships.css'),'ship profile styling must load in the DTR workspace');
const shipsView=await read('dtr-trade-panel.html');
assert.match(shipsView,/id="dtrRoutesShipDialog"/,'ship search must have its own dialog');
assert.match(shipsView,/id="dtrRoutesCustomForm"/,'manual ship profiles must remain available');
assert.match(shipsView,/id="dtrRoutesFavorites"/,'quick-favorite ships must be available');
assert.match(shipsView,/form="dtrRoutesForm"[^>]*id="dtrRoutesCargo"|id="dtrRoutesCargo"[^>]*form="dtrRoutesForm"/,'available cargo outside advanced filters must participate in route form validation');
assert(app.includes("'trade-routes'"), 'Trade Routes must be a first-class app route');
assert(quality.includes("short: 'ROUTES'"), 'mobile section navigation must include Trade Routes');
assert(!html.includes('data-view="forja-del-vacio"'), 'retired Forja must remain removed');
assert.match(html, /id="calculatorView"/, 'calculator workspace must exist');
assert.match(html, /data-view="forum"/, 'desktop navigation must expose the forum');
assert.match(html, /id="forumView" class="view dtr-forum-view" hidden/, 'forum composer workspace must exist');
assert(!app.includes('forja-del-vacio'), 'retired Forja must not remain tracked in app');
assert(!production.includes('forja-del-vacio'), 'retired Forja must not have a production module');
assert(!html.includes('data-view="forja-del-vacio"'), 'retired Forja must not be navigable');
assert.equal((html.match(/data-view="(?:deterrence-sanctum|ravenna-invicta|fort-torrelavega)"/g)||[]).length, 3, 'there must be three active base tabs');
assert(app.includes("'forum', ...POBS.map"), 'forum must be a first-class route');
assert(sw.includes('./dtr-forum.js') && sw.includes('./dtr-forum.css'), 'forum must be cached for offline use');
assert((await read('dtr-forum.js')).includes('function buildBbcode('), 'forum must generate BBCode');
assert((await read('dtr-forum.css')).includes('.dtr-forum-render'), 'forum must have styled preview');
assert(html.indexOf('recipe-catalog.js') < html.indexOf('dtr-calculator.js'), 'recipe catalog must load before the calculator runtime');
assert(html.indexOf('dtr-calculator.js') < html.indexOf('dtr-production.js'), 'calculator bridge must load before the production runtime');
assert.match(html, /id="productionPanel"[^>]+hidden/, 'Torrelavega production panel must be opt-in by POB view');
assert.match(html, /POB PRIORITY STOCK[\s\S]*?Pinned Cargo/, 'POB detail must expose its dedicated pinned-stock area');
assert(!html.includes('>WATCHED<'), 'visible inventory controls must use the clearer pinned terminology');
assert(!html.includes('ATTENTION REQUIRED'), 'individual POB pages must not repeat the network-wide attention panel');
assert(!app.includes('renderPriority'), 'removed per-POB attention panel must not leave dead runtime rendering');

assert.equal(catalog?.meta?.recipeCount, 300, 'Discovery catalog must contain all 300 checked recipes');
assert.equal(catalog?.recipes?.length, catalog.meta.recipeCount, 'catalog metadata and recipe payload must agree');
assert.equal(new Set(catalog.recipes.map(recipe => recipe.id)).size, catalog.recipes.length, 'recipe IDs must remain unique');
assert.equal(catalog.meta.sourceCheckedOn, '2026-10-30', 'catalog must identify the checked source snapshot');
assert.deepEqual(JSON.parse(JSON.stringify(catalog.meta.sourceSha256)), {
  'base_recipe_items.cfg': 'd9b013cfc260f6a479c79ce9b6746ba8e2d72e0e029ac98065880843de081003',
  'base_recipe_modules.cfg': '83b8b46b0efb66028f3514b6e5ee0dfcb8b90e8be30beca9cc5d0f7e305ab021'
}, 'recipe inputs must match the checked public CFG snapshot');
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
assert.match(calculator, /function openRecipe\(/, 'calculator must expose a production-module bridge');
assert.match(calculator, /selectedAlternatives\[`\$\{recipe\.id\}:\$\{index\}`\]/, 'production bridge must preserve selected alternative materials');

assert.match(app, /pins:\s*'dtr:pob-pins:v2'/, 'POB pins must use the scoped v2 storage schema');
assert.match(app, /POBS\.map\(pob => \[pob\.key, legacy\.map/, 'legacy global pins must migrate without data loss');
assert.match(app, /pinsFor\(definition\.key\)/, 'reserve alerts must use only the current POB pin set');
assert.match(app, /renderPins\(base, key\)/, 'detail cards must render the selected POB pin set');
assert.match(production, /recipeId: 'recipe_gold_advanced'/, 'Torrelavega must use the advanced Wildcat Gold recipe');
assert.match(production, /recipeId: 'recipe_scrap_advanced'/, 'Torrelavega must expose its advanced Scrap Smelter recipe');
assert.match(production, /2: 'commodity_mox_fuel'/, 'Gold production must keep the RHW facility MOX selection');
assert.match(production, /2: 'commodity_scrap_metal'/, 'Scrap Smelter must keep the RHW facility Scrap Metal selection');
assert.match(production, /DTR_AFFILIATION = 'fc_c_grp'/, 'production material logic must use the DTR Corsair affiliation');
assert.match(production, /adjustedPerCycle\(option\?\.qty, factor\)/, 'production material quantities must apply the Corsair factor');
assert.match(production, /bestCapacityOption/, 'alternative production inputs must select for available cycle capacity');
assert.match(production, /DTRCalculator\.openRecipe/, 'production cost action must open a preselected calculator quote');
assert.match(production, /class="production-materials"/, 'production cards must show their material list immediately');
assert(!production.includes('<details'), 'production material lists must not be collapsed behind disclosure controls');
assert.match(production, /data-layout-slot="\$\{esc\(module\.layoutSlot\)\}"/, 'production modules must identify their intended desktop slots');
assert.match(productionCss, /data-layout-slot="top-left"\]\s*\{\s*grid-column:\s*1;\s*grid-row:\s*1;/, 'Food Rations must occupy top left');
assert.match(productionCss, /data-layout-slot="top-right"\]\s*\{\s*grid-column:\s*2;\s*grid-row:\s*1;/, 'Basic Alloy must occupy top right');
assert.match(productionCss, /data-layout-slot="bottom-left"\]\s*\{\s*grid-column:\s*1;\s*grid-row:\s*2;/, 'Prototype Components must occupy bottom left');
assert.match(productionCss, /data-layout-slot="bottom-right"\]\s*\{\s*grid-column:\s*2;\s*grid-row:\s*2;/, 'Exotic Systems must occupy bottom right');
assert.match(productionCss, /@media \(max-width: 980px\)\s*\{\s*#productionGrid\s*\{\s*grid-template-columns:\s*1fr;/, 'production slots must collapse to one column on tablets and phones');
assert.match(production, /recipeId: 'recipe_milsal'/, 'Sanctum and Invicta must include Prototype Components');
assert.match(production, /recipeId: 'recipe_fow_advanced'/, 'Sanctum and Invicta must include advanced Hydroponics');
assert.match(production, /recipeId: 'ship_part_exotic'/, 'Invicta must include Exotic Systems production');
assert.match(html, /id="shipyardPanel"[^>]+hidden/, 'Invicta shipyard must be a separately controlled POB detail panel');
assert(html.indexOf('dtr-calculator.js') < html.indexOf('dtr-shipyard.js'), 'shipyard needs the calculator before its own runtime');
assert(sw.includes('./dtr-shipyard.js') && sw.includes('./dtr-shipyard.css'), 'shipyard must be available offline');
const yardSource = await read('dtr-shipyard.js');
const yardCss = await read('dtr-shipyard.css');
for (const hullRecipe of ['ship_assembly_dsy_venator', 'ship_assembly_dsy_legate', 'ship_assembly_co_battlecruiser_heavy', 'ship_assembly_medium_miner']) {
  assert(yardSource.includes(hullRecipe), hullRecipe + ' must be available in the Invicta shipyard');
}
assert.match(yardSource, /DTRCalculator\?\.openRecipe/, 'shipyard must open DTR calculator with explicit POB and recipe');
assert.match(yardSource, /EXOTIC_COMPONENT='commodity_ship_part_exotic'/, 'shipyard must identify the Exotic Systems valuation exception');
assert.match(yardSource, /EXTERNAL BUY PRICE \/\/ IN-HOUSE SELL VALUE/, 'shipyard must disclose its two valuation sources');
assert.match(yardSource, /EST\. COMPONENT VALUE/, 'shipyard valuation must not masquerade as raw production cost');
assert.match(yardSource, /IN-HOUSE PRODUCTION/, 'shipyard must identify Exotic Systems as in-house production');
assert.match(yardSource, /EXTERNAL SUPPLY/, 'shipyard must identify delivered components as external supply');
assert.match(yardSource, /POB BUY PRICE/, 'external inputs must show the incoming quotation');
assert.match(yardSource, /POB SELL VALUE/, 'in-house Exotics must show the outgoing valuation');
assert.match(yardSource, /UNIT VALUE/, 'shipyard should display its individual component valuations');
assert.match(calculator, /INVICTA_SHIPYARD_RECIPES/, 'calculator must implement the same Invicta-only ship pricing exception');
assert.match(calculator, /INVICTA BASE SELLS \/\/ EXOTIC SYSTEMS/, 'calculator must label its Exotic Systems price direction');
const procurement = await read('dtr-procurement-prices.js');
assert.match(procurement, /dtrBaseSellPrice/, 'purchase-price adapter must preserve original sales quotes');
assert.match(procurement, /pobSalePrice/, 'sale quote must have its own getter rather than rereading normalized item.price');
assert(yardCss.includes('@media(max-width:760px)'), 'shipyard must collapse component table into phone-friendly cards');

const visibleSources = [html, app, calculator, production, quality, await read('dtr-uplink.js'), pwa].join('\n');
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
assert.match(productionCss, /@media \(max-width: 760px\)[\s\S]*?\.production-command button\s*\{[\s\S]*?min-height:\s*44px/, 'production calculator action must remain touch friendly on phones');
assert.match(productionCss, /\.production-materials li\s*\{[\s\S]*?grid-template-columns:/, 'production inputs must keep a structured desktop layout');
assert.match(quality, /id="dtrCalculatorLaunch"/, 'mobile header controls must expose the calculator');
assert.match(quality, /version:\s*'1\.0\.13'/, 'visible build version must match v1.0.13');
assert.match(sw, /v1\.0\.13/, 'service-worker cache must match v1.0.13');
assert(html.includes('id="dtrAvatarCanvas"') && html.includes('id="dtrAvatarDownload"'), 'Forum portrait framing must be reachable');
assert(html.includes('id="dtrForumToolAvatar"') && html.includes('id="dtrForumToolComposer"'),
  'Forum must expose the portrait tool alongside the composer near the top');
assert(html.indexOf('id="dtrForumToolAvatar"')<html.indexOf('id="dtrForumWrite"'),
  'Avatar choice must appear before the BBCode composer');
assert(html.includes('id="dtrAvatarFit"')&&html.includes('id="dtrAvatarFill"'),
  'portrait editor must offer FIT and FILL sizing');
assert(html.includes('./dtr-avatar.js') && html.includes('./dtr-avatar.css'), 'Avatar editor assets loaded');
assert(sw.includes('./assets/dtr-forum-frame.png') && sw.includes('./dtr-avatar.js'), 'PWA must cache the frame and editor');
assert(sw.includes('./assets/dtr-forum-window-mask.png'),
  'PWA must cache the actual RGBA portrait cutout mask');
assert((await read('dtr-avatar.js')).includes("globalCompositeOperation='destination-in'"),
  'avatar export must clip to the decorative border rather than a rectangular canvas');
assert(sw.includes('./recipe-catalog.js'), 'recipe catalog must be available offline');
assert(sw.includes('./dtr-calculator.js'), 'calculator runtime must be available offline');
assert(sw.includes('./dtr-production.js'), 'production runtime must be available offline');
assert(sw.includes('./dtr-production.css'), 'production styling must be available offline');

for (const cssPath of localRuntimeRefs.filter(path => path.endsWith('.css'))) {
  const css = await read(cssPath);
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  assert.equal(opens, closes, `${cssPath} must have balanced rule braces`);
}

console.log(`DTR static audit passed (${runtimeFiles.length} runtime scripts, ${localRuntimeRefs.length} local assets checked).`);
