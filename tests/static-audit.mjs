import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(join(root, path), 'utf8');
const [html, manifestRaw, sw, qualityCss, responsiveCss, app, pwa, quality] = await Promise.all([
  read('index.html'),
  read('manifest.webmanifest'),
  read('sw.js'),
  read('dtr-quality.css'),
  read('dtr-responsive.css'),
  read('app.js'),
  read('dtr-pwa.js'),
  read('dtr-quality.js')
]);
const manifest = JSON.parse(manifestRaw);

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

const visibleSources = [html, app, await read('dtr-quality.js'), await read('dtr-uplink.js'), pwa].join('\n');
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
assert.match(qualityCss, /@media \(max-width: 760px\)[\s\S]*?\.dtr-quickbar\s*{[\s\S]*?position:\s*relative/, 'mobile command filter must scroll away with the header');
assert.match(responsiveCss, /@media \(max-width: 680px\)[\s\S]*?\.transmission-rail\s*{[\s\S]*?display:\s*none/, 'decorative transmission rail must collapse on phones');
assert.match(responsiveCss, /\.topbar\s*{[\s\S]*?padding:\s*12px 6px 8px/, 'phone header must use compact spacing');
assert.match(responsiveCss, /orientation:\s*landscape/, 'compact landscape header rules must exist');
assert.match(quality, /version:\s*'0\.6\.1'/, 'visible build version must match v0.6.1');
assert.match(sw, /v0\.6\.1/, 'service-worker cache must match v0.6.1');

for (const cssPath of localRuntimeRefs.filter(path => path.endsWith('.css'))) {
  const css = await read(cssPath);
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  assert.equal(opens, closes, `${cssPath} must have balanced rule braces`);
}

console.log(`DTR static audit passed (${runtimeFiles.length} runtime scripts, ${localRuntimeRefs.length} local assets checked).`);
