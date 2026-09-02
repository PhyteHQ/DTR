#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const [, , itemsArgument, modulesArgument, outputArgument = 'recipe-catalog.js'] = process.argv;

if (!itemsArgument || !modulesArgument) {
  console.error('Usage: node scripts/build-recipe-catalog.mjs <base_recipe_items.cfg> <base_recipe_modules.cfg> [output.js]');
  process.exit(1);
}

const itemsPath = resolve(itemsArgument);
const modulesPath = resolve(modulesArgument);
const outputPath = resolve(outputArgument);

function splitComment(raw) {
  const index = raw.indexOf(';');
  return index === -1
    ? { value: raw.trim(), comment: '' }
    : { value: raw.slice(0, index).trim(), comment: raw.slice(index + 1).trim() };
}

function parseScalar(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function parseCfg(source, sourceType) {
  const recipes = [];
  let current = null;

  const finish = () => {
    if (current?.nickname) recipes.push(current);
    current = null;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      finish();
      if (line.toLowerCase() === '[recipe]') current = { sourceType };
      continue;
    }

    if (!current || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const { value, comment } = splitComment(line.slice(separator + 1));

    if (['produced_item', 'consumed', 'catalyst', 'affiliation_bonus', 'consumed_dynamic_alt', 'consumed_dynamic', 'produced_affiliation'].includes(key)) {
      (current[key] ||= []).push({ value, comment });
      continue;
    }

    if (['cooking_rate', 'reqlevel', 'loop_production', 'recipe_number', 'module_class', 'credit_cost', 'cargo_storage'].includes(key)) {
      current[key] = parseScalar(value);
      continue;
    }

    if (key === 'restricted') {
      current[key] = /^(?:true|1|yes)$/i.test(value);
      continue;
    }

    current[key] = value;
  }

  finish();
  return recipes;
}

const tokens = value => String(value || '').split(',').map(part => part.trim()).filter(Boolean);
const cleanName = value => String(value || '').replace(/\s+Assembly$/i, '').trim();

function quantity(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalSourceName(path) {
  const name = basename(path);
  const match = name.match(/base_recipe_(?:items|modules)\.cfg$/i);
  return match ? match[0].toLowerCase() : name;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rememberName(names, id, name) {
  const cleaned = cleanName(name);
  if (id && cleaned && cleaned !== id) names.set(id, cleaned);
}

function humanizeId(id) {
  return String(id || '')
    .replace(/^commodity_/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
    .trim() || String(id || 'Unknown Item');
}

function collectNames(rawRecipes) {
  const names = new Map();
  for (const recipe of rawRecipes) {
    for (const entry of recipe.produced_item || []) {
      const [id] = tokens(entry.value);
      rememberName(names, id, entry.comment);
    }
    for (const key of ['consumed', 'catalyst']) {
      for (const entry of recipe[key] || []) {
        const [id] = tokens(entry.value);
        rememberName(names, id, entry.comment);
      }
    }
    for (const entry of recipe.consumed_dynamic_alt || []) {
      const parts = tokens(entry.value).slice(1);
      const labels = tokens(entry.comment);
      parts.forEach((id, index) => rememberName(names, id, labels[index]));
    }
    for (const entry of recipe.consumed_dynamic || []) {
      const parts = tokens(entry.value);
      const labels = tokens(entry.comment);
      for (let index = 0; index < parts.length - 1; index += 2) {
        rememberName(names, parts[index], labels[index / 2]);
      }
    }
  }
  return names;
}

function makeItem(id, amount, explicitName, names) {
  return {
    id,
    name: cleanName(explicitName) || names.get(id) || humanizeId(id),
    qty: quantity(amount)
  };
}

function normalizeRecipe(raw, names) {
  const infoName = cleanName(raw.infotext);
  const producedOutputs = [];

  for (const entry of raw.produced_item || []) {
    const parts = tokens(entry.value);
    if (!parts.length) continue;
    const productName = cleanName(entry.comment) || names.get(parts[0]) || infoName;
    producedOutputs.push(makeItem(parts[0], parts[1] ?? 1, productName, names));
  }

  const affiliationOutputs = [];
  for (const entry of raw.produced_affiliation || []) {
    const parts = tokens(entry.value);
    if (parts.length < 5) continue;
    affiliationOutputs.push({
      base: makeItem(parts[0], parts[1], '', names),
      factionId: parts[2],
      alternate: makeItem(parts[3], parts[4], '', names)
    });
  }

  const outputs = affiliationOutputs.length
    ? [affiliationOutputs[0].base, ...producedOutputs]
    : producedOutputs;
  if (!outputs.length && raw.sourceType === 'module') {
    outputs.push(makeItem(raw.nickname, 1, infoName, names));
  }
  if (!outputs.length) return null;

  const inputs = [];
  for (const entry of raw.consumed || []) {
    const parts = tokens(entry.value);
    if (parts.length < 2) continue;
    inputs.push({
      kind: 'consumed',
      options: [makeItem(parts[0], parts[1], entry.comment, names)]
    });
  }

  for (const entry of raw.consumed_dynamic_alt || []) {
    const parts = tokens(entry.value);
    if (parts.length < 2) continue;
    const labels = tokens(entry.comment);
    inputs.push({
      kind: 'alternative',
      options: parts.slice(1).map((id, index) => makeItem(id, parts[0], labels[index], names))
    });
  }

  for (const entry of raw.consumed_dynamic || []) {
    const parts = tokens(entry.value);
    const labels = tokens(entry.comment);
    const options = [];
    for (let index = 0; index < parts.length - 1; index += 2) {
      options.push(makeItem(parts[index], parts[index + 1], labels[index / 2], names));
    }
    if (options.length) inputs.push({ kind: 'dynamic', options });
  }

  const catalysts = [];
  for (const entry of raw.catalyst || []) {
    const parts = tokens(entry.value);
    if (parts.length < 2) continue;
    catalysts.push(makeItem(parts[0], parts[1], entry.comment, names));
  }

  const bonuses = [];
  for (const entry of raw.affiliation_bonus || []) {
    const parts = tokens(entry.value);
    if (parts.length < 2) continue;
    bonuses.push({
      id: parts[0],
      name: cleanName(entry.comment) || humanizeId(parts[0]),
      factor: quantity(parts[1], 1)
    });
  }

  return {
    id: raw.nickname,
    name: infoName || outputs[0].name || raw.nickname,
    sourceType: raw.sourceType,
    craftType: raw.craft_type || raw.build_type || raw.craft_list || '',
    cookingRate: quantity(raw.cooking_rate, 0),
    restricted: Boolean(raw.restricted),
    loopProduction: raw.loop_production ?? null,
    creditCost: quantity(raw.credit_cost, 0),
    outputs,
    inputs,
    catalysts,
    bonuses,
    affiliationOutputs
  };
}

const [itemsBuffer, modulesBuffer] = await Promise.all([
  readFile(itemsPath),
  readFile(modulesPath)
]);
const rawRecipes = [
  ...parseCfg(itemsBuffer.toString('utf8'), 'item'),
  ...parseCfg(modulesBuffer.toString('utf8'), 'module')
];
const names = collectNames(rawRecipes);
const recipes = rawRecipes.map(recipe => normalizeRecipe(recipe, names)).filter(Boolean)
  .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'));

const catalog = {
  meta: {
    schemaVersion: 2,
    sourceUrl: 'https://discoverygc.com/gameconfigpublic/',
    sourceFiles: [canonicalSourceName(itemsPath), canonicalSourceName(modulesPath)],
    sourceSha256: {
      [canonicalSourceName(itemsPath)]: sha256(itemsBuffer),
      [canonicalSourceName(modulesPath)]: sha256(modulesBuffer)
    },
    recipeCount: recipes.length,
    productCount: new Set(recipes.flatMap(recipe => recipe.outputs.map(output => output.id))).size,
    generatedFor: 'DTR v0.7.1'
  },
  recipes
};

const output = `/* DTR recipe catalog. Generated from Discovery public CFG files; do not hand-edit. */\nwindow.DTR_RECIPE_CATALOG=${JSON.stringify(catalog)};\n`;
await writeFile(outputPath, output, 'utf8');
console.log(`Built ${catalog.meta.recipeCount} recipes and ${catalog.meta.productCount} products -> ${outputPath}`);
