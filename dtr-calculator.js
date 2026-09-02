/* DTR Recipe Cost Calculator · Discovery recipes + live POB sale prices. */
(() => {
  'use strict';

  const CATALOG = window.DTR_RECIPE_CATALOG;
  const STORAGE_KEY = 'dtr:calculator:v1';
  const DEFAULT_POB = 'deterrence-sanctum';
  const DTR_AFFILIATION = 'fc_c_grp';
  const LOCALE = 'en-GB';
  const numberFormat = new Intl.NumberFormat(LOCALE);
  let root = null;
  let searchTimer = null;

  const norm = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const finite = value => {
    if (value === null || value === undefined || value === '') return null;
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const fmt = value => Number.isFinite(value) ? numberFormat.format(Math.round(value)) : '—';
  const money = value => Number.isFinite(value) ? `${fmt(value)} cr` : '—';

  function readState() {
    const fallback = {
      recipeId: CATALOG?.recipes?.[0]?.id || '',
      search: '',
      pobKey: DEFAULT_POB,
      quantity: 1,
      alternatives: {}
    };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return fallback;
      return {
        ...fallback,
        ...parsed,
        search: typeof parsed.search === 'string' ? parsed.search : '',
        quantity: Math.max(1, Math.floor(finite(parsed.quantity) ?? 1)),
        alternatives: parsed.alternatives && typeof parsed.alternatives === 'object'
          ? { ...parsed.alternatives }
          : {}
      };
    } catch {
      return fallback;
    }
  }

  let state = readState();

  function saveState(patch = {}) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function appState() {
    return window.DTRApp?.getState?.() || {
      bases: new Map(),
      mode: 'none',
      last: null,
      view: 'overview'
    };
  }

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
    const value = finite(item?.price_to_buy_from_base ?? item?.buy_price ?? item?.price_buy);
    return value !== null && value > 0 ? value : null;
  }

  function recipeSearchText(recipe) {
    return norm([
      recipe?.name,
      recipe?.id,
      recipe?.craftType,
      recipe?.sourceType,
      ...(recipe?.outputs || []).flatMap(output => [output.name, output.id])
    ].filter(Boolean).join(' '));
  }

  function matchingRecipes(search = state.search) {
    const terms = norm(search).split(' ').filter(Boolean);
    return [...(CATALOG?.recipes || [])]
      .filter(recipe => {
        const haystack = recipeSearchText(recipe);
        return terms.every(term => haystack.includes(term));
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'));
  }

  function recipeNameCounts() {
    const counts = new Map();
    for (const recipe of CATALOG?.recipes || []) {
      const key = norm(recipe.name);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  const duplicateNames = recipeNameCounts();

  function recipeLabel(recipe) {
    const duplicate = (duplicateNames.get(norm(recipe.name)) || 0) > 1;
    if (!duplicate) return recipe.name;
    return `${recipe.name} · ${recipe.craftType || recipe.id}`;
  }

  function selectedRecipe(matches = matchingRecipes()) {
    const selected = (CATALOG?.recipes || []).find(recipe => recipe.id === state.recipeId);
    if (selected && (!state.search || matches.some(recipe => recipe.id === selected.id))) return selected;
    return matches[0] || (!state.search ? CATALOG?.recipes?.[0] : null) || null;
  }

  function selectedPobDefinition() {
    const pobs = window.DTRApp?.POBS || [];
    return pobs.find(pob => pob.key === state.pobKey) || pobs[0] || {
      key: DEFAULT_POB,
      short: 'SANCTUM',
      label: 'Deterrence Sanctum'
    };
  }

  function selectedBase() {
    return appState().bases?.get?.(selectedPobDefinition().key) || null;
  }

  function optionSnapshot(base, option) {
    const item = findInventoryItem(base, option);
    return {
      option,
      item,
      price: pobSalePrice(item),
      stock: inventoryQuantity(item)
    };
  }

  function automaticOption(base, options) {
    const ranked = options.map(option => optionSnapshot(base, option));
    ranked.sort((left, right) => {
      const rank = snapshot => snapshot.price !== null
        ? snapshot.stock > 0
          ? 3
          : snapshot.stock === null
            ? 2
            : 1
        : snapshot.item
          ? 0
          : -1;
      const availabilityRank = rank(right) - rank(left);
      if (availabilityRank) return availabilityRank;
      if (left.price !== null && right.price !== null && left.price !== right.price) return left.price - right.price;
      return left.option.name.localeCompare(right.option.name, 'en');
    });
    return ranked[0]?.option || options[0] || null;
  }

  function chosenOption(recipe, group, index, base) {
    const key = `${recipe.id}:${index}`;
    const explicitId = state.alternatives?.[key];
    return group.options.find(option => option.id === explicitId)
      || automaticOption(base, group.options);
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

  function cyclesFor(recipe) {
    const output = effectiveOutput(recipe);
    const outputPerCycle = Math.max(1, finite(output?.qty) ?? 1);
    return {
      output,
      outputPerCycle,
      cycles: Math.max(1, Math.ceil(state.quantity / outputPerCycle))
    };
  }

  function availability(row) {
    if (!row.base) return { tone: 'danger', label: 'NO POB FEED' };
    if (!row.item) return { tone: 'danger', label: 'NOT LISTED' };
    if (row.price === null) return { tone: 'warn', label: 'NO SALE PRICE' };
    if (row.stock === null) return { tone: 'muted', label: 'STOCK UNKNOWN' };
    if (row.stock <= 0) return { tone: 'danger', label: 'OUT OF STOCK' };
    if (row.stock < row.required) return { tone: 'warn', label: `SHORT ${fmt(row.required - row.stock)}` };
    return { tone: 'good', label: 'AVAILABLE' };
  }

  function requirementRows(recipe, base, cycles, factor) {
    return (recipe.inputs || []).map((group, index) => {
      const option = chosenOption(recipe, group, index, base);
      const item = findInventoryItem(base, option);
      const price = pobSalePrice(item);
      const stock = inventoryQuantity(item);
      const required = adjustedPerCycle(option?.qty, factor) * cycles;
      const row = {
        recipe,
        group,
        index,
        option,
        item,
        price,
        stock,
        required,
        lineCost: price === null ? null : price * required,
        base
      };
      return { ...row, availability: availability(row) };
    });
  }

  function catalystRows(recipe, base) {
    return (recipe.catalysts || []).map(option => {
      const item = findInventoryItem(base, option);
      const price = pobSalePrice(item);
      const stock = inventoryQuantity(item);
      const row = {
        option,
        item,
        price,
        stock,
        required: Math.max(0, finite(option.qty) ?? 0),
        base
      };
      return { ...row, availability: availability(row) };
    });
  }

  function calculation(recipe, base) {
    const cycle = cyclesFor(recipe);
    const factor = affiliationFactor(recipe);
    const rows = requirementRows(recipe, base, cycle.cycles, factor);
    const fixedFee = Math.max(0, finite(recipe.creditCost) ?? 0) * cycle.cycles;
    const knownMaterialCost = rows.reduce((total, row) => total + (row.lineCost ?? 0), 0);
    const missingPrices = rows.filter(row => row.price === null).length;
    const complete = missingPrices === 0;
    const knownCost = knownMaterialCost + fixedFee;
    const totalCost = complete ? knownCost : null;
    const actualOutput = cycle.outputPerCycle * cycle.cycles;
    const unitCost = complete && actualOutput > 0 ? totalCost / actualOutput : null;
    const shortRows = rows.filter(row => row.stock !== null && row.stock < row.required).length;
    const unavailableRows = rows.filter(row => !row.item).length;
    return {
      ...cycle,
      factor,
      authorized: !recipe.restricted || (recipe.bonuses || []).some(entry => entry.id === DTR_AFFILIATION),
      rows,
      catalysts: catalystRows(recipe, base),
      fixedFee,
      knownMaterialCost,
      knownCost,
      totalCost,
      unitCost,
      actualOutput,
      missingPrices,
      complete,
      shortRows,
      unavailableRows
    };
  }

  function pobOptions() {
    const current = appState();
    return (window.DTRApp?.POBS || []).map(pob => {
      const online = Boolean(current.bases?.get?.(pob.key));
      return `<option value="${esc(pob.key)}"${pob.key === state.pobKey ? ' selected' : ''}>${esc(pob.label)} · ${online ? 'LIVE' : 'NO FEED'}</option>`;
    }).join('');
  }

  function recipeOptions(matches, selectedId) {
    if (!matches.length) return '<option value="">NO MATCHING RECIPES</option>';
    return matches.map(recipe => `<option value="${esc(recipe.id)}"${recipe.id === selectedId ? ' selected' : ''}>${esc(recipeLabel(recipe))}</option>`).join('');
  }

  function alternativeMarkup(row) {
    if ((row.group?.options || []).length <= 1) return '';
    const key = `${row.recipe.id}:${row.index}`;
    const explicit = Boolean(state.alternatives?.[key]);
    const options = row.group.options.map(option => {
      const snapshot = optionSnapshot(row.base, option);
      const suffix = snapshot.price !== null
        ? `${money(snapshot.price)} / UNIT`
        : snapshot.item
          ? 'NO SALE PRICE'
          : 'NOT LISTED';
      return `<option value="${esc(option.id)}"${option.id === row.option.id ? ' selected' : ''}>${esc(option.name)} · ${suffix}</option>`;
    }).join('');
    return `<label class="calculator-alternative"><span>${row.group.kind === 'dynamic' ? 'DYNAMIC INPUT' : 'ALTERNATIVE INPUT'} // ${explicit ? 'SELECTED' : 'AUTO LOWEST PRICE'}</span><select data-calculator-alternative="${row.index}">${options}</select></label>`;
  }

  function materialRowsMarkup(rows) {
    if (!rows.length) return '<div class="calculator-empty" data-tone="good">THIS RECIPE HAS NO CONSUMED MATERIAL INPUTS</div>';
    return `<div class="calculator-table-wrap"><table class="calculator-table"><thead><tr><th>MATERIAL</th><th>REQUIRED</th><th>POB STOCK</th><th>POB SELLS / UNIT</th><th>LINE COST</th><th>STATUS</th></tr></thead><tbody>${rows.map(row => `<tr data-calculator-tone="${row.availability.tone}">
      <td data-label="MATERIAL"><strong>${esc(row.option.name)}</strong><small>${esc(row.option.id)}</small>${alternativeMarkup(row)}</td>
      <td data-label="REQUIRED">${fmt(row.required)}</td>
      <td data-label="POB STOCK">${fmt(row.stock)}</td>
      <td data-label="POB SELLS / UNIT" class="calculator-price">${money(row.price)}</td>
      <td data-label="LINE COST">${money(row.lineCost)}</td>
      <td data-label="STATUS"><span class="calculator-status" data-tone="${row.availability.tone}">${esc(row.availability.label)}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function catalystMarkup(rows) {
    if (!rows.length) return '';
    const unavailable = rows.filter(row => !row.item || row.price === null).length;
    return `<details class="calculator-catalysts">
      <summary><span>CATALYST REQUIREMENTS</span><b data-tone="${unavailable ? 'warn' : 'good'}">${unavailable ? `${unavailable} UNPRICED` : 'POB DATA READY'}</b></summary>
      <p>REQUIRED ON SITE // RETAINED AFTER PRODUCTION // EXCLUDED FROM CONSUMED MATERIAL COST</p>
      <div class="calculator-catalyst-grid">${rows.map(row => `<article data-calculator-tone="${row.availability.tone}"><div><strong>${esc(row.option.name)}</strong><small>${esc(row.option.id)}</small></div><dl><div><dt>REQUIRED</dt><dd>${fmt(row.required)}</dd></div><div><dt>POB STOCK</dt><dd>${fmt(row.stock)}</dd></div><div><dt>POB SELLS</dt><dd>${money(row.price)}</dd></div></dl><span class="calculator-status" data-tone="${row.availability.tone}">${esc(row.availability.label)}</span></article>`).join('')}</div>
    </details>`;
  }

  function notesMarkup(recipe, result) {
    const extraOutputs = (recipe.outputs || []).slice(1);
    const notes = [];
    if (recipe.restricted) notes.push(result.authorized ? 'RESTRICTED // CORSAIR IFF AUTHORIZED' : 'RESTRICTED // CORSAIR IFF NOT AUTHORIZED');
    if (result.factor !== 1) notes.push(`CORSAIR IFF BONUS // ${result.factor.toFixed(2)}× MATERIALS`);
    if (recipe.affiliationOutputs?.length) notes.push('OUTPUT VARIES BY AFFILIATION');
    if (extraOutputs.length) notes.push(`ADDITIONAL OUTPUT: ${extraOutputs.map(output => `${output.name} × ${fmt(output.qty)}`).join(' · ')}`);
    return notes.length ? `<div class="calculator-recipe-notes">${notes.map(note => `<span>${esc(note)}</span>`).join('')}</div>` : '';
  }

  function calculatorStatus(result, base) {
    if (!base) return { tone: 'danger', label: 'SELECTED POB FEED UNAVAILABLE' };
    if (!result.authorized) return { tone: 'danger', label: 'RESTRICTED RECIPE // CORSAIR IFF NOT AUTHORIZED' };
    if (!result.complete) return { tone: 'warn', label: `${result.missingPrices} MATERIAL PRICE${result.missingPrices === 1 ? '' : 'S'} MISSING` };
    if (result.shortRows) return { tone: 'warn', label: `QUOTE READY // ${result.shortRows} STOCK SHORTAGE${result.shortRows === 1 ? '' : 'S'}` };
    return { tone: 'good', label: 'QUOTE READY // STOCK AVAILABLE' };
  }

  function renderNoMatch(matches) {
    const pobs = pobOptions();
    root.innerHTML = `<header class="calculator-heading" data-recipe-count="${fmt(CATALOG?.meta?.recipeCount)}"><div><p class="section-kicker">DTR PROCUREMENT // DISCOVERY RECIPES</p><h2>Recipe Cost Calculator</h2><p>LIVE POB PURCHASE PRICES // MISSING VALUES STAY UNKNOWN</p></div><button type="button" data-calculator-action="overview">BACK TO NETWORK</button></header>
      <section class="calculator-controls"><div class="calculator-section-head"><div><span>01</span><strong>RECIPE + POB</strong></div><small>${fmt(CATALOG?.meta?.recipeCount)} MASTER RECIPES</small></div><div class="calculator-form-grid">
        <label class="calculator-field calculator-wide"><span>SEARCH RECIPE</span><input id="calculatorRecipeSearch" type="search" value="${esc(state.search)}" placeholder="REACTOR, JUMP DRIVE, HULL…" autocomplete="off"><small>TYPE A PRODUCT NAME OR RECIPE ID</small></label>
        <label class="calculator-field calculator-wide"><span>SELECTED RECIPE</span><select id="calculatorRecipeSelect">${recipeOptions(matches, '')}</select><small>0 MATCHES</small></label>
        <label class="calculator-field"><span>PRICE SOURCE POB</span><select id="calculatorPobSelect">${pobs}</select><small>USES THE POB SELLS PRICE</small></label>
      </div><div class="calculator-empty" data-tone="warn">NO MATCHING RECIPE<small>TRY A DIFFERENT PRODUCT OR RECIPE NAME</small></div></section>`;
  }

  function render({ focusSearch = false } = {}) {
    if (!root || !CATALOG?.recipes?.length) return;
    const matches = matchingRecipes();
    const recipe = selectedRecipe(matches);
    if (!recipe) {
      renderNoMatch(matches);
      if (focusSearch) focusRecipeSearch();
      return;
    }
    if (state.recipeId !== recipe.id) saveState({ recipeId: recipe.id, alternatives: {} });

    const pob = selectedPobDefinition();
    if (state.pobKey !== pob.key) saveState({ pobKey: pob.key, alternatives: {} });
    const base = selectedBase();
    const result = calculation(recipe, base);
    const status = calculatorStatus(result, base);
    const telemetry = appState();
    const sync = telemetry.last instanceof Date && Number.isFinite(telemetry.last.getTime())
      ? telemetry.last.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : 'NO VERIFIED SNAPSHOT';
    const output = result.output || { name: recipe.name, id: recipe.id };
    const knownLabel = result.complete ? 'ALL CONSUMED MATERIALS PRICED' : `${money(result.knownCost)} KNOWN SUBTOTAL`;

    root.innerHTML = `<header class="calculator-heading" data-recipe-count="${fmt(CATALOG.meta.recipeCount)}"><div><p class="section-kicker">DTR PROCUREMENT // DISCOVERY RECIPES</p><h2>Recipe Cost Calculator</h2><p>LIVE POB PURCHASE PRICES // MISSING VALUES STAY UNKNOWN</p></div><button type="button" data-calculator-action="overview">BACK TO NETWORK</button></header>
      <section class="calculator-controls">
        <div class="calculator-section-head"><div><span>01</span><strong>RECIPE + POB</strong></div><small>${fmt(CATALOG.meta.recipeCount)} MASTER RECIPES</small></div>
        <div class="calculator-form-grid">
          <label class="calculator-field calculator-wide"><span>SEARCH RECIPE</span><input id="calculatorRecipeSearch" type="search" value="${esc(state.search)}" placeholder="REACTOR, JUMP DRIVE, HULL…" autocomplete="off"><small>TYPE A PRODUCT NAME OR RECIPE ID // FIRST MATCH SELECTS AUTOMATICALLY</small></label>
          <label class="calculator-field calculator-wide"><span>SELECTED RECIPE</span><select id="calculatorRecipeSelect">${recipeOptions(matches.length ? matches : [recipe], recipe.id)}</select><small>${matches.length} MATCH${matches.length === 1 ? '' : 'ES'} // ${esc(recipe.craftType || recipe.sourceType || 'GENERAL')}${recipe.restricted ? ' // RESTRICTED' : ''}</small></label>
          <label class="calculator-field"><span>PRICE SOURCE POB</span><select id="calculatorPobSelect">${pobOptions()}</select><small>USES ${esc(pob.short)} BASE-SELL PRICES // SYNC ${esc(sync)}</small></label>
          <label class="calculator-field"><span>OUTPUT QUANTITY</span><div class="calculator-quantity"><button type="button" data-calculator-quantity="-1" aria-label="Decrease output quantity">−</button><input id="calculatorQuantity" type="number" inputmode="numeric" min="1" step="1" value="${state.quantity}"><button type="button" data-calculator-quantity="1" aria-label="Increase output quantity">+</button></div><small>DESIRED NUMBER OF PRODUCED ITEMS</small></label>
        </div>
        <div class="calculator-recipe-meta"><div><small>OUTPUT</small><strong>${esc(output.name)}</strong></div><div><small>OUTPUT / CYCLE</small><strong>${fmt(result.outputPerCycle)}</strong></div><div><small>CYCLES</small><strong>${fmt(result.cycles)}</strong></div><div><small>ACTUAL OUTPUT</small><strong>${fmt(result.actualOutput)}</strong></div></div>
        ${notesMarkup(recipe, result)}
      </section>
      <section class="calculator-quote" data-calculator-tone="${status.tone}">
        <div class="calculator-section-head"><div><span>02</span><strong>POB COST QUOTE</strong></div><small>${esc(pob.label)} // ${telemetry.mode === 'live' ? 'LIVE' : telemetry.mode === 'cache' ? 'CACHED' : 'NO FEED'}</small></div>
        <div class="calculator-quote-grid">
          <article><small>TOTAL BUILD COST</small><strong>${money(result.totalCost)}</strong><span>${esc(knownLabel)}</span></article>
          <article><small>COST / PRODUCED ITEM</small><strong>${money(result.unitCost)}</strong><span>${fmt(result.actualOutput)} ACTUAL OUTPUT</span></article>
          <article><small>PRICE COVERAGE</small><strong>${result.rows.length - result.missingPrices} / ${result.rows.length}</strong><span>CONSUMED MATERIALS</span></article>
          <article><small>FIXED RECIPE FEE</small><strong>${money(result.fixedFee)}</strong><span>${result.fixedFee ? `${money(recipe.creditCost)} × ${fmt(result.cycles)} CYCLES` : 'NO FIXED FEE'}</span></article>
        </div>
        <div class="calculator-quote-state" data-tone="${status.tone}"><i></i><strong>${esc(status.label)}</strong></div>
      </section>
      <section class="calculator-materials">
        <div class="calculator-section-head"><div><span>03</span><strong>CONSUMED MATERIALS</strong></div><small>AUTO-PRICED FROM ${esc(pob.short)}</small></div>
        ${materialRowsMarkup(result.rows)}
        <div class="calculator-legend"><span><i data-tone="good"></i>AVAILABLE</span><span><i data-tone="warn"></i>PRICE / STOCK NOTICE</span><span><i data-tone="danger"></i>MISSING / OUT OF STOCK</span></div>
      </section>
      ${catalystMarkup(result.catalysts)}
      <div class="calculator-source"><span>RECIPE SOURCE // <a href="${esc(CATALOG.meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">DISCOVERY PUBLIC GAME CONFIG</a></span><span>POB PRICES // DARKSTAT LIVE TELEMETRY</span></div>`;

    if (focusSearch) focusRecipeSearch();
  }

  function focusRecipeSearch() {
    const search = document.getElementById('calculatorRecipeSearch');
    if (!search) return;
    search.focus();
    try {
      search.setSelectionRange(search.value.length, search.value.length);
    } catch {}
  }

  function updateSearch(value) {
    saveState({ search: value });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const matches = matchingRecipes(value);
      const patch = {};
      if (matches.length && !matches.some(recipe => recipe.id === state.recipeId)) {
        patch.recipeId = matches[0].id;
        patch.alternatives = {};
      }
      saveState(patch);
      render({ focusSearch: true });
    }, 130);
  }

  function handleInput(event) {
    if (event.target?.id === 'calculatorRecipeSearch') updateSearch(event.target.value);
  }

  function handleChange(event) {
    if (event.target?.id === 'calculatorRecipeSelect') {
      saveState({ recipeId: event.target.value, alternatives: {} });
      render();
      return;
    }
    if (event.target?.id === 'calculatorPobSelect') {
      saveState({ pobKey: event.target.value, alternatives: {} });
      render();
      return;
    }
    if (event.target?.id === 'calculatorQuantity') {
      saveState({ quantity: Math.max(1, Math.floor(finite(event.target.value) ?? 1)) });
      render();
      return;
    }
    const alternative = event.target?.closest?.('[data-calculator-alternative]');
    if (alternative) {
      const recipe = selectedRecipe(matchingRecipes());
      if (!recipe) return;
      const key = `${recipe.id}:${alternative.dataset.calculatorAlternative}`;
      saveState({ alternatives: { ...state.alternatives, [key]: alternative.value } });
      render();
    }
  }

  function handleClick(event) {
    const action = event.target.closest('[data-calculator-action]');
    if (action?.dataset.calculatorAction === 'overview') {
      window.DTRApp?.show?.('overview');
      return;
    }
    const quantityButton = event.target.closest('[data-calculator-quantity]');
    if (quantityButton) {
      const delta = finite(quantityButton.dataset.calculatorQuantity) ?? 0;
      saveState({ quantity: Math.max(1, Math.floor(state.quantity + delta)) });
      render();
    }
  }

  function init() {
    root = document.getElementById('calculatorView');
    if (!root) return;
    if (!CATALOG?.recipes?.length) {
      root.innerHTML = '<div class="calculator-empty" data-tone="danger">RECIPE CATALOG UNAVAILABLE</div>';
      return;
    }
    const validPobs = new Set((window.DTRApp?.POBS || []).map(pob => pob.key));
    if (!validPobs.has(state.pobKey)) state.pobKey = DEFAULT_POB;
    if (!CATALOG.recipes.some(recipe => recipe.id === state.recipeId)) state.recipeId = CATALOG.recipes[0].id;
    saveState();
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('click', handleClick);
    render();
  }

  window.addEventListener('dtr:statechange', () => {
    if (appState().view === 'calculator') render();
  });

  window.DTRCalculator = Object.freeze({
    render,
    matchingRecipes,
    findInventoryItem,
    pobSalePrice,
    getState() {
      return { ...state, alternatives: { ...state.alternatives } };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
