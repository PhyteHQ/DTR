/* DTR Torrelavega production modules · live stock against fixed facility recipes. */
(() => {
  'use strict';

  const POB_KEY = 'fort-torrelavega';
  const DTR_AFFILIATION = 'fc_c_grp';
  const MODULES = Object.freeze([
    Object.freeze({
      recipeId: 'recipe_gold_advanced',
      code: 'MODULE-04',
      process: 'ADVANCED GOLD REFINING',
      preferredAlternatives: Object.freeze({ 2: 'commodity_mox_fuel' })
    }),
    Object.freeze({
      recipeId: 'recipe_scrap_advanced',
      code: 'MODULE-05',
      process: 'SCRAP SMELTER',
      preferredAlternatives: Object.freeze({
        1: 'commodity_mox_fuel',
        2: 'commodity_scrap_metal'
      })
    })
  ]);
  const RECIPE_IDS = Object.freeze(MODULES.map(module => module.recipeId));
  const LOCALE = 'en-GB';
  const numberFormat = new Intl.NumberFormat(LOCALE);
  let panel = null;
  let grid = null;
  let status = null;

  const finite = value => {
    if (value === null || value === undefined || value === '') return null;
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  };
  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const fmt = value => Number.isFinite(value) ? numberFormat.format(Math.round(value)) : '—';

  function itemList(base) {
    const list = base?.shop_items ?? base?.shopItems ?? base?.goods ?? [];
    return Array.isArray(list) ? list : [];
  }

  function inventoryAliases(item) {
    return [
      item?.name,
      item?.good_name,
      item?.commodity_name,
      item?.nickname,
      item?.good,
      item?.id,
      item?.item_id,
      item?.good_id
    ].map(norm).filter(Boolean);
  }

  function requirementAliases(requirement) {
    return [
      requirement?.name,
      requirement?.id,
      String(requirement?.id || '').replace(/^commodity_/i, '')
    ].map(norm).filter(Boolean);
  }

  function findInventoryItem(base, requirement) {
    const wanted = new Set(requirementAliases(requirement));
    if (!wanted.size) return null;
    return itemList(base).find(item => inventoryAliases(item).some(alias => wanted.has(alias))) || null;
  }

  function inventoryQuantity(item) {
    if (!item) return null;
    return finite(item?.quantity ?? item?.amount ?? item?.stock);
  }

  function pobSalePrice(item) {
    if (!item) return null;
    const value = finite(
      item?.price
      ?? item?.price_to_buy_from_base
      ?? item?.buy_price
      ?? item?.price_buy
    );
    return value !== null && value > 0 ? value : null;
  }

  function affiliationFactor(recipe) {
    const bonus = (recipe?.bonuses || []).find(entry => entry.id === DTR_AFFILIATION);
    return bonus ? Math.max(0, finite(bonus.factor) ?? 1) : 1;
  }

  function adjustedPerCycle(value, factor) {
    const raw = Math.max(0, finite(value) ?? 0) * Math.max(0, finite(factor) ?? 1);
    return raw <= 0 ? 0 : Math.ceil(raw - 1e-9);
  }

  function effectiveOutput(recipe) {
    const affiliationOutput = (recipe?.affiliationOutputs || [])
      .find(entry => entry.factionId === DTR_AFFILIATION);
    return affiliationOutput?.alternate || recipe?.outputs?.[0] || null;
  }

  function optionSnapshot(base, option, factor) {
    const required = adjustedPerCycle(option?.qty, factor);
    const item = findInventoryItem(base, option);
    const stock = inventoryQuantity(item);
    return {
      option,
      item,
      required,
      stock,
      price: pobSalePrice(item),
      capacity: required > 0 && stock !== null ? Math.max(0, Math.floor(stock / required)) : 0
    };
  }

  function bestCapacityOption(base, options, factor) {
    const ranked = options.map((option, sourceIndex) => ({
      ...optionSnapshot(base, option, factor),
      sourceIndex
    }));
    ranked.sort((left, right) => {
      if (right.capacity !== left.capacity) return right.capacity - left.capacity;
      const rightListed = right.item ? 1 : 0;
      const leftListed = left.item ? 1 : 0;
      if (rightListed !== leftListed) return rightListed - leftListed;
      const rightStock = right.stock ?? -1;
      const leftStock = left.stock ?? -1;
      if (rightStock !== leftStock) return rightStock - leftStock;
      const rightPrice = right.price ?? Infinity;
      const leftPrice = left.price ?? Infinity;
      if (rightPrice !== leftPrice) return leftPrice - rightPrice;
      return left.sourceIndex - right.sourceIndex;
    });
    return ranked[0] || null;
  }

  function selectedOption(base, group, factor, preferredId) {
    const preferred = (group?.options || []).find(option => option.id === preferredId);
    return preferred
      ? optionSnapshot(base, preferred, factor)
      : bestCapacityOption(base, group?.options || [], factor);
  }

  function createSnapshot(recipe, base, preferredAlternatives = {}) {
    if (!recipe) return null;
    const factor = affiliationFactor(recipe);
    const output = effectiveOutput(recipe);
    const rows = (recipe.inputs || []).map((group, index) => {
      const selected = selectedOption(base, group, factor, preferredAlternatives[index]);
      return selected ? { ...selected, group, index } : null;
    }).filter(Boolean);
    const cycles = rows.length ? Math.min(...rows.map(row => row.capacity)) : 0;
    const targetCycles = cycles + 1;
    const nextRows = rows.map(row => ({
      ...row,
      gap: row.stock === null
        ? row.required * targetCycles
        : Math.max(0, row.required * targetCycles - row.stock)
    }));
    const bottleneck = nextRows
      .filter(row => row.gap > 0)
      .sort((left, right) => left.capacity - right.capacity
        || (right.gap / Math.max(1, right.required)) - (left.gap / Math.max(1, left.required))
        || left.option.name.localeCompare(right.option.name, 'en'))[0] || null;
    const outputItem = findInventoryItem(base, output);
    const outputPerCycle = Math.max(0, finite(output?.qty) ?? 0);
    const tone = !base || cycles === 0 ? 'danger' : cycles < 10 ? 'warn' : 'good';

    return {
      recipe,
      base,
      factor,
      output,
      outputPerCycle,
      outputStock: inventoryQuantity(outputItem),
      rows,
      cycles,
      estimatedOutput: cycles * outputPerCycle,
      bottleneck,
      tone,
      catalysts: recipe.catalysts || [],
      byproducts: (recipe.outputs || []).slice(1),
      alternatives: Object.fromEntries(rows
        .filter(row => (row.group?.options || []).length > 1)
        .map(row => [row.index, row.option.id]))
    };
  }

  function materialRows(snapshot) {
    return snapshot.rows.map((row, index) => {
      const tone = row.stock === null || row.stock < row.required
        ? 'danger'
        : row.capacity < 10 ? 'warn' : 'good';
      const availability = row.stock === null
        ? row.item ? 'STOCK UNKNOWN' : 'NOT LISTED'
        : row.stock < row.required
          ? `SHORT ${fmt(row.required - row.stock)}`
          : `${fmt(row.capacity)} CYCLES`;
      return `<li data-tone="${tone}">
        <div><small>INPUT 0${index + 1}</small><strong>${esc(row.option.name)}</strong><em>${esc(availability)}</em></div>
        <span><small>REQ / CYCLE</small><b>${fmt(row.required)}</b></span>
        <span><small>ON HAND</small><b>${fmt(row.stock)}</b></span>
      </li>`;
    }).join('');
  }

  function supportLine(label, entries, suffix = '') {
    if (!entries.length) return '';
    return `<span><small>${label}</small><b>${entries.map(entry => `${fmt(entry.qty)} ${esc(entry.name)}`).join(' + ')}${suffix}</b></span>`;
  }

  function cardStatus(snapshot, base) {
    if (!base) return 'NO POB FEED';
    if (snapshot.cycles === 0) return 'NO CYCLES';
    return snapshot.cycles < 10 ? 'LOW CAPACITY' : 'STABLE';
  }

  function renderCard(module, snapshot, base) {
    const nextCycle = snapshot.bottleneck
      ? `NEXT +1 CYCLE // ${esc(snapshot.bottleneck.option.name)} +${fmt(snapshot.bottleneck.gap)}`
      : 'NEXT CYCLE // MATERIAL STATUS UNAVAILABLE';
    const efficiency = Math.round((1 - snapshot.factor) * 100);
    const efficiencyLabel = efficiency > 0
      ? `CORSAIR −${efficiency}% MATERIALS`
      : 'STANDARD MATERIAL LOAD';

    return `<article class="production-card" data-tone="${snapshot.tone}">
      <header>
        <div><small>${esc(module.code)} // ${esc(module.process)}</small><h4>${esc(snapshot.output?.name || 'PRODUCTION OUTPUT')}</h4></div>
        <span class="production-card-state" data-tone="${snapshot.tone}">${cardStatus(snapshot, base)}</span>
      </header>
      <div class="production-command">
        <p>YIELD / CYCLE <strong>${fmt(snapshot.outputPerCycle)}</strong></p>
        <span>${efficiencyLabel}</span>
        <button type="button" data-production-calculate="${esc(module.recipeId)}">COST / CALCULATE</button>
      </div>
      <div class="production-metrics">
        <div><small>MAX CYCLES</small><strong>${base ? fmt(snapshot.cycles) : '—'}</strong></div>
        <div><small>IN STOCK</small><strong>${fmt(snapshot.outputStock)}</strong></div>
        <div><small>EST. YIELD</small><strong>${base ? fmt(snapshot.estimatedOutput) : '—'}</strong></div>
      </div>
      <div class="production-next" data-tone="${snapshot.tone}">${nextCycle}</div>
      <div class="production-materials">
        <div class="production-materials-head"><strong>MATERIALS</strong><span>REQUIRED // AVAILABLE</span></div>
        <ul>${materialRows(snapshot)}</ul>
      </div>
      <footer>
        ${supportLine('CATALYST // RETAINED', snapshot.catalysts, ' // NOT CONSUMED')}
        ${supportLine('BYPRODUCT / CYCLE', snapshot.byproducts)}
      </footer>
    </article>`;
  }

  function render() {
    if (!panel || !grid || !status) return;
    const appState = window.DTRApp?.getState?.();
    const active = appState?.view === POB_KEY;
    panel.hidden = !active;
    if (!active) return;

    const catalog = window.DTR_RECIPE_CATALOG?.recipes || [];
    const base = appState?.bases?.get?.(POB_KEY) || null;
    const resolved = MODULES.map(module => {
      const recipe = catalog.find(entry => entry.id === module.recipeId);
      return recipe ? { module, snapshot: createSnapshot(recipe, base, module.preferredAlternatives) } : null;
    }).filter(Boolean);

    if (resolved.length !== MODULES.length) {
      status.dataset.tone = 'danger';
      status.textContent = 'RECIPE UNAVAILABLE';
    } else {
      status.dataset.tone = !base
        ? 'danger'
        : resolved.some(entry => entry.snapshot.tone === 'danger')
          ? 'danger'
          : resolved.some(entry => entry.snapshot.tone === 'warn') ? 'warn' : 'good';
      status.textContent = !base ? 'NO POB FEED' : `${resolved.length} MODULES`;
    }

    grid.innerHTML = resolved.length
      ? resolved.map(entry => renderCard(entry.module, entry.snapshot, base)).join('')
      : '<div class="production-empty" data-tone="danger">PRODUCTION RECIPES NOT FOUND.</div>';
  }

  function openCalculator(recipeId) {
    const module = MODULES.find(entry => entry.recipeId === recipeId);
    const recipe = window.DTR_RECIPE_CATALOG?.recipes?.find(entry => entry.id === recipeId);
    const appState = window.DTRApp?.getState?.();
    const snapshot = createSnapshot(
      recipe,
      appState?.bases?.get?.(POB_KEY) || null,
      module?.preferredAlternatives
    );
    if (!module || !snapshot) return;
    if (window.DTRCalculator?.openRecipe) {
      window.DTRCalculator.openRecipe({
        recipeId,
        pobKey: POB_KEY,
        quantity: Math.max(1, snapshot.outputPerCycle),
        alternatives: snapshot.alternatives
      });
    } else {
      window.DTRApp?.show?.('calculator');
    }
  }

  function init() {
    panel = document.getElementById('productionPanel');
    grid = document.getElementById('productionGrid');
    status = document.getElementById('productionState');
    if (!panel || !grid || !status) return;
    panel.addEventListener('click', event => {
      const button = event.target.closest('[data-production-calculate]');
      if (button) openCalculator(button.dataset.productionCalculate);
    });
    render();
  }

  window.DTRProduction = Object.freeze({
    RECIPE_IDS,
    POB_KEY,
    createSnapshot,
    render
  });

  window.addEventListener('dtr:statechange', render);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
