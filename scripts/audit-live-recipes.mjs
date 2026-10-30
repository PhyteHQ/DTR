#!/usr/bin/env node

// Read-only comparison: generated files go to the supplied audit directory.
// This script never replaces the dashboard catalog or publishes a deployment.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || 'recipe-audit');
const origins = [
  'https://discoverygc.com/gameconfigpublic/',
  // This is the same public configuration mirror used by fl-darkstat.
  'https://disco-api.dd84ai.com/gameconfigpublic/'
];
const files = ['base_recipe_items.cfg', 'base_recipe_modules.cfg'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });

async function fetchSource(name) {
  const attempts = await Promise.all(origins.map(async origin => {
    const url = origin + name;
    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) return { url, error: `HTTP ${response.status}` };
      const bytes = Buffer.from(await response.arrayBuffer());
      const source = bytes.toString('utf8');
      if (!/^\s*\[recipe\]\s*$/im.test(source) || /<(?:html|!doctype)/i.test(source)) {
        return { url, error: 'Response is not a recipe CFG file' };
      }
      return { url, bytes, sha256: hash(bytes) };
    } catch (error) {
      return { url, error: String(error.message || error) };
    }
  }));
  const selected = attempts.find(attempt => attempt.bytes);
  const metadata = attempts.map(({ bytes, ...entry }) => entry);
  console.log('DTR_RECIPE_SOURCE ' + JSON.stringify({ name, attempts: metadata }));
  if (!selected) throw new Error(`No valid public source available for ${name}`);
  await writeFile(join(output, name), selected.bytes);
  return { name, url: selected.url, sha256: selected.sha256, attempts: metadata };
}

const sources = await Promise.all(files.map(fetchSource));
const candidatePath = join(output, 'recipe-catalog.current.js');
const build = spawnSync(process.execPath, [
  join(root, 'scripts/build-recipe-catalog.mjs'),
  ...files.map(name => join(output, name)), candidatePath
], { encoding: 'utf8' });
if (build.status !== 0) throw new Error(build.stderr || build.stdout || 'Catalog generation failed');
console.log(build.stdout.trim());

async function readCatalog(path) {
  const context = { window: {} };
  runInNewContext(await readFile(path, 'utf8'), context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.window.DTR_RECIPE_CATALOG));
}
const [previous, current] = await Promise.all([
  readCatalog(join(root, 'recipe-catalog.js')), readCatalog(candidatePath)
]);
const before = new Map(previous.recipes.map(recipe => [recipe.id, recipe]));
const after = new Map(current.recipes.map(recipe => [recipe.id, recipe]));
const added = current.recipes.filter(recipe => !before.has(recipe.id));
const removed = previous.recipes.filter(recipe => !after.has(recipe.id));
const changed = current.recipes.filter(recipe => before.has(recipe.id)).flatMap(recipe => {
  const old = before.get(recipe.id);
  const fields = [...new Set([...Object.keys(old), ...Object.keys(recipe)])]
    .filter(key => JSON.stringify(old[key]) !== JSON.stringify(recipe[key]));
  return fields.length ? [{ id: recipe.id, name: recipe.name, fields, previous: old, current: recipe }] : [];
});
const categories = recipes => recipes.reduce((counts, recipe) => {
  const category = recipe.sourceType === 'module' ? 'module'
    : /^ship_assembly_/.test(recipe.id) ? 'ship assembly'
    : /Codes|Osmium|Weapon|Shield|Thruster|Cloak|JumpDrive/.test(recipe.craftType) ? 'equipment'
    : 'production';
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});
const important = [
  'ship_assembly_dsy_venator', 'ship_assembly_dsy_legate',
  'ship_assembly_co_battlecruiser_heavy', 'ship_assembly_medium_miner',
  'recipe_gold_advanced', 'recipe_scrap_advanced', 'recipe_fow_advanced',
  'recipe_milsal', 'ship_part_exotic'
];
const allIds = current.recipes.map(recipe => recipe.id);
const malformed = current.recipes.filter(recipe =>
  !recipe.id || !recipe.outputs.length ||
  recipe.outputs.some(item => !item.id || !Number.isFinite(item.qty) || item.qty <= 0) ||
  recipe.inputs.some(group => !group.options.length || group.options.some(item =>
    !item.id || !Number.isFinite(item.qty) || item.qty <= 0))
).map(recipe => recipe.id);
const duplicates = [...new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index))];
const affiliationRows = (await readFile(join(output, files[0]), 'utf8')).split(/\r?\n/)
  .filter(line => /^\s*produced_affiliation\s*=/i.test(line));
const extendedAffiliationRows = affiliationRows.filter(line =>
  line.split(';')[0].slice(line.indexOf('=') + 1).split(',').length > 5);
const summary = {
  checkedAt: new Date().toISOString(), sources,
  previous: { ...previous.meta, categories: categories(previous.recipes) },
  current: { ...current.meta, categories: categories(current.recipes) },
  addedCount: added.length, removedCount: removed.length, changedCount: changed.length,
  malformed, duplicates, extendedAffiliationRows,
  dashboardRecipes: important.map(id => ({ id, present: after.has(id),
    changedFields: changed.find(recipe => recipe.id === id)?.fields || [] }))
};
await writeFile(join(output, 'audit.json'), JSON.stringify({ ...summary, added, removed, changed }, null, 2));
console.log('DTR_RECIPE_AUDIT ' + JSON.stringify(summary));
for (const recipe of added) console.log('DTR_RECIPE_ADDED ' + JSON.stringify(recipe));
for (const recipe of removed) console.log('DTR_RECIPE_REMOVED ' + JSON.stringify(recipe));
for (const { id, name, fields } of changed) console.log('DTR_RECIPE_CHANGED ' + JSON.stringify({ id, name, fields }));
if (malformed.length || duplicates.length) process.exitCode = 1;
