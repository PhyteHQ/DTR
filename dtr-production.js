/* DTR Torrelavega production module · live stock against the advanced Wildcat Gold recipe. */
(() => {
  'use strict';

  const RECIPE_ID = 'recipe_gold_advanced';
  const POB_KEY = 'fort-torrelavega';
  const DTR_AFFILIATION = 'fc_c_grp';
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

  function createSnapshot(recipe, base) {
    if (!recipe) return null;
    const factor = affiliationFactor(recipe);
    const output = effectiveOutput(recipe);
    const rows = (recipe.inputs || []).map((group, index) => {
      const selected = bestCapacityOption(base, group.options || [], factor);
      return selected ? { ...selected, group, index } : null;
    }).filter(Boolean);
    const cycles = rows.length
      ? Math.min(...rows.map(row => row.capacity))
      : 0;
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
      const available = row.stock === null
        ? row.item ? 'STOCK UNKNOWN' : 'NOT LISTED'
        : row.stock < row.required
          ? `SHORT ${fmt(row.required - row.stock)}`
          : `${fmt(row.capacity)} CYCLES`;
      return `<li data-tone="${row.stock === null || row.stock < row.required ? 'danger' : row.capacity < 10 ? 'warn' : 'good'}">
        <div><small>INPUT 0${index + 1}${row.group.options.length > 1 ? ' // AUTO CAPACITY' : ''}</small><strong>${esc(row.option.name)}</strong></div>
        <span><small>REQ / CYCLE</small><b>${fmt(row.required)}</b></span>
        <span><small>ON HAND</small><b>${fmt(row.stock)}</b></span>
        <em>${esc(available)}</em>
      </li>`;
    }).join('');
  }

  function supportLine(label, entries, suffix = '') {
    if (!entries.length) return '';
    return `<span><small>${label}</small><b>${entries.map(entry => `${fmt(entry.qty)} ${esc(entry.name)}`).join(' + ')}${suffix}</b></span>`;
  }

  function render() {
    if (!panel || !grid || !status) return;
    const appState = window.DTRApp?.getState?.();
    const active = appState?.view === POB_KEY;
    panel.hidden = !active;
    if (!active) return;

    const recipe = window.DTR_RECIPE_CATALOG?.recipes?.find(entry => entry.id === RECIPE_ID);
    if (!recipe) {
      status.dataset.tone = 'danger';
      status.textContent = 'RECIPE UNAVAILABLE';
      grid.innerHTML = '<div class="production-empty" data-tone="danger">ADVANCED WILDCAT GOLD RECIPE NOT FOUND.</div>';
      return;
    }

    const base = appState?.bases?.get?.(POB_KEY) || null;
    const snapshot = createSnapshot(recipe, base);
    const statusText = !base
      ? 'NO POB FEED'
      : snapshot.cycles === 0
        ? 'ACTION REQUIRED'
        : snapshot.cycles < 10
          ? 'LOW CAPACITY'
          : 'PRODUCTION READY';
    status.dataset.tone = snapshot.tone;
    status.textContent = statusText;
    const desktopOpen = window.matchMedia?.('(min-width: 761px)')?.matches ? ' open' : '';
    const nextCycle = snapshot.bottleneck
      ? `NEXT +1 CYCLE // ${esc(snapshot.bottleneck.option.name)} +${fmt(snapshot.bottleneck.gap)}`
      : 'NEXT CYCLE // MATERIAL STATUS UNAVAILABLE';
    const efficiency = Math.round((1 - snapshot.factor) * 100);

    grid.innerHTML = `<article class="production-card" data-tone="${snapshot.tone}">
      <header>
        <div><small>MODULE-04 // ADVANCED REFINING</small><h4>${esc(snapshot.output?.name || 'Wildcat Gold')}</h4><p>YIELD PER CYCLE // <strong>${fmt(snapshot.outputPerCycle)}</strong></p></div>
        <div class="production-actions"><span>${efficiency > 0 ? `CORSAIR −${efficiency}% MATERIALS` : 'STANDARD MATERIAL LOAD'}</span><button type="button" data-production-calculate>COST / CALCULATE</button></div>
      </header>
      <div class="production-metrics">
        <div><small>MAX CYCLES</small><strong>${base ? fmt(snapshot.cycles) : '—'}</strong></div>
        <div><small>IN STOCK</small><strong>${fmt(snapshot.outputStock)}</strong><span>${esc(snapshot.output?.name || 'OUTPUT')}</span></div>
        <div><small>EST. YIELD</small><strong>${base ? fmt(snapshot.estimatedOutput) : '—'}</strong></div>
      </div>
      <div class="production-next" data-tone="${snapshot.tone}">${nextCycle}</div>
      <details class="production-materials"${desktopOpen}>
        <summary>SHOW / HIDE MATERIALS <span>${snapshot.rows.length} CONSUMED INPUTS</span></summary>
        <ul>${materialRows(snapshot)}</ul>
      </details>
      <footer>
        ${supportLine('CATALYST // RETAINED', snapshot.catalysts, ' // NOT CONSUMED')}
        ${supportLine('BYPRODUCT / CYCLE', snapshot.byproducts)}
      </footer>
    </article>`;
  }

  function openCalculator() {
    const appState = window.DTRApp?.getState?.();
    const recipe = window.DTR_RECIPE_CATALOG?.recipes?.find(entry => entry.id === RECIPE_ID);
    const snapshot = createSnapshot(recipe, appState?.bases?.get?.(POB_KEY) || null);
    if (!snapshot) return;
    if (window.DTRCalculator?.openRecipe) {
      window.DTRCalculator.openRecipe({
        recipeId: RECIPE_ID,
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
      if (event.target.closest('[data-production-calculate]')) openCalculator();
    });
    render();
  }

  window.DTRProduction = Object.freeze({
    RECIPE_ID,
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
