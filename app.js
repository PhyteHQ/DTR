(() => {
  'use strict';

  const API = 'https://darkstat.dd84ai.com/api/pobs';
  const LOCALE = 'en-GB';
  const HEALTH_MAX = 24000000;
  const REFRESH_MS = 5 * 60 * 1000;
  const TIMEOUT_MS = 18000;
  const STALE_WARN_MS = 15 * 60 * 1000;
  const STALE_DANGER_MS = 60 * 60 * 1000;

  const KEYS = Object.freeze({
    live: 'dtr:pobs:live:v2',
    previous: 'dtr:pobs:previous:v2',
    watch: 'dtr:watchlist:v1',
    view: 'dtr:view:v1',
    recoveries: 'dtr:storage-recoveries:v1'
  });

  const POBS = Object.freeze([
    { key: 'deterrence-sanctum', short: 'SANCTUM', label: 'Deterrence Sanctum', aliases: ['deterrence sanctum'] },
    { key: 'ravenna-invicta', short: 'INVICTA', label: 'Ravenna Invicta', aliases: ['ravenna invicta', 'invicta'] },
    { key: 'forja-del-vacio', short: 'FORJA', label: 'Forja del Vacio', aliases: ['forja del vacio', 'forja del vacío'] },
    { key: 'fort-torrelavega', short: 'TORRELAVEGA', label: 'Fort Torrelavega', aliases: ['fort torrelavega', 'torrelavega'] }
  ]);

  const MAINT = Object.freeze([
    { key: 'basic alloy', label: 'Basic Alloy', code: 'ALLOY', critical: 2500, warn: 15000 },
    { key: 'food rations', label: 'Food Rations', code: 'FOOD', critical: 2500, warn: 15000 },
    { key: 'consumer goods', label: 'Consumer Goods', code: 'GOODS', critical: 2500, warn: 15000 }
  ]);

  const VALID_VIEWS = new Set(['overview', 'calculator', ...POBS.map(pob => pob.key)]);
  const numberFormat = new Intl.NumberFormat(LOCALE);
  const $ = id => document.getElementById(id);
  const E = {
    uplink: $('uplink'),
    status: $('statusText'),
    refresh: $('refreshButton'),
    tabs: $('tabs'),
    overview: $('overviewView'),
    calculator: $('calculatorView'),
    detail: $('detailView'),
    grid: $('overviewGrid'),
    overviewSync: $('overviewSync'),
    networkState: $('networkState'),
    metricNodes: $('metricNodes'),
    metricNodesSub: $('metricNodesSub'),
    metricCredits: $('metricCredits'),
    metricCreditsDelta: $('metricCreditsDelta'),
    metricStorage: $('metricStorage'),
    metricStorageDelta: $('metricStorageDelta'),
    metricAlerts: $('metricAlerts'),
    metricAlertsSub: $('metricAlertsSub'),
    matrix: $('networkMatrix'),
    kicker: $('detailKicker'),
    name: $('detailName'),
    location: $('detailLocation'),
    badge: $('detailHealthBadge'),
    detailDelta: $('detailDelta'),
    meter: $('healthMeter'),
    credits: $('creditsValue'),
    creditsDelta: $('creditsDelta'),
    storage: $('storageValue'),
    storageDelta: $('storageDelta'),
    sync: $('syncValue'),
    syncMode: $('syncMode'),
    maintenance: $('maintenanceGrid'),
    facilityState: $('facilityState'),
    priority: $('priorityList'),
    priorityCount: $('priorityCount'),
    watchGrid: $('watchGrid'),
    watchCount: $('watchCount'),
    search: $('inventorySearch'),
    filters: $('inventoryFilters'),
    body: $('inventoryBody'),
    empty: $('inventoryEmpty'),
    error: $('errorView'),
    errorText: $('errorText'),
    footer: $('footerState'),
    freshness: $('headerFreshness'),
    clock: $('headerClock'),
    offline: $('offlineBanner'),
    systemButton: $('systemButton'),
    systemPanel: $('systemPanel'),
    systemClose: $('systemClose'),
    systemRefresh: $('systemRefresh')
  };

  let data = [];
  let previousData = [];
  let bases = new Map();
  let previousBases = new Map();
  let view = readView();
  let last = null;
  let mode = 'none';
  let inventoryFilter = 'all';
  let refreshTimer = null;
  let nextRefreshAt = 0;
  let loadInFlight = null;
  let lastError = '';
  let systemReturnFocus = null;
  const storageFaults = [];

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
  const cash = value => Number.isFinite(value) ? `${fmt(value)} cr` : '—';

  function rememberStorageFault(action, key, error) {
    storageFaults.push({
      action,
      key,
      at: Date.now(),
      message: String(error?.message || error || 'Storage unavailable')
    });
    if (storageFaults.length > 12) storageFaults.shift();
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      rememberStorageFault('read', key, error);
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      rememberStorageFault('write', key, error);
      return false;
    }
  }

  function recoveryIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEYS.recoveries) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function recoverMalformedJson(key, raw) {
    const at = Date.now();
    const backupKey = `dtr:recovery:${at}:${key.replace(/[^a-z0-9]+/gi, '-')}`;
    try {
      localStorage.setItem(backupKey, JSON.stringify({
        schemaVersion: 1,
        originalKey: key,
        recoveredAt: new Date(at).toISOString(),
        raw
      }));
      localStorage.removeItem(key);
      const index = recoveryIndex();
      index.push({ key, backupKey, at });
      localStorage.setItem(KEYS.recoveries, JSON.stringify(index.slice(-12)));
    } catch (error) {
      rememberStorageFault('recover', key, error);
    }
  }

  function loadJson(key) {
    const raw = storageGet(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      recoverMalformedJson(key, raw);
      return null;
    }
  }

  function saveJson(key, value) {
    return storageSet(key, JSON.stringify(value));
  }

  function readView() {
    let saved = 'overview';
    try {
      saved = localStorage.getItem(KEYS.view) || 'overview';
    } catch {
      return 'overview';
    }
    if (VALID_VIEWS.has(saved)) return saved;
    try {
      localStorage.setItem(KEYS.view, 'overview');
    } catch {}
    return 'overview';
  }

  function formatClock(value, seconds = true) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return '--:--';
    return value.toLocaleTimeString(LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      hour12: false
    });
  }

  function ageMs(value = last) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return Infinity;
    return Math.max(0, Date.now() - value.getTime());
  }

  function ageText(value = last) {
    const age = ageMs(value);
    if (!Number.isFinite(age)) return 'NO VERIFIED SNAPSHOT';
    if (age < 60 * 1000) return 'JUST NOW';
    const minutes = Math.floor(age / (60 * 1000));
    if (minutes < 60) return `${minutes} MIN AGO`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} H AGO`;
    const days = Math.floor(hours / 24);
    return `${days} D AGO`;
  }

  function freshnessTone() {
    const age = ageMs();
    if (!Number.isFinite(age)) return 'muted';
    if (age >= STALE_DANGER_MS) return 'danger';
    if (age >= STALE_WARN_MS || mode === 'cache') return 'warn';
    return 'good';
  }

  function syncText() {
    if (!last) return 'NO DATA';
    const source = mode === 'cache' ? 'CACHE' : 'LIVE';
    return `${source} // ${formatClock(last, false)} // ${ageText(last)}`;
  }

  function emitState(reason) {
    window.dispatchEvent(new CustomEvent('dtr:statechange', {
      detail: {
        reason,
        mode,
        view,
        last: last?.toISOString?.() || null,
        loading: Boolean(loadInFlight),
        storageFaults: storageFaults.length
      }
    }));
  }

  function status(state, text) {
    E.uplink.dataset.state = state;
    E.status.textContent = text;
    E.footer.textContent = text;
    E.freshness.textContent = last ? syncText() : text;
    E.freshness.dataset.tone = last ? freshnessTone() : 'muted';
  }

  function findBase(definition, source = data) {
    const aliases = definition.aliases.map(norm);
    return source.find(base => {
      const haystack = norm([
        base?.name,
        base?.nickname,
        base?.base_name,
        base?.display_name
      ].filter(Boolean).join(' '));
      return aliases.some(alias => haystack === alias || haystack.includes(alias));
    }) || null;
  }

  function rebuild() {
    bases = new Map(POBS.map(pob => [pob.key, findBase(pob, data)]));
    previousBases = new Map(POBS.map(pob => [pob.key, findBase(pob, previousData)]));
  }

  function hpRaw(base) {
    return finite(base?.health ?? base?.base_health ?? base?.hitpoints);
  }

  function hp(base) {
    const raw = hpRaw(base);
    if (raw === null) return null;
    return Math.max(0, Math.min(100, raw <= 100 ? raw : raw / HEALTH_MAX * 100));
  }

  function hpText(base) {
    const value = hp(base);
    return value === null ? '—' : `${value >= 99.95 ? value.toFixed(0) : value.toFixed(1)}%`;
  }

  function hpTone(base) {
    const value = hp(base);
    return value === null ? 'muted' : value < 35 ? 'danger' : value < 75 ? 'warn' : 'good';
  }

  function creditsRaw(base) {
    return finite(base?.money ?? base?.credits ?? base?.base_money);
  }

  function storageRaw(base) {
    return finite(base?.cargospace ?? base?.cargo_space ?? base?.cargo_space_left ?? base?.storage_free);
  }

  function loc(base) {
    if (!base) return 'POB NOT FOUND IN CURRENT FEED';
    const position = base?.pos ?? base?.base_pos ?? base?.position;
    let renderedPosition = '';
    if (typeof position === 'string') {
      renderedPosition = position;
    } else if (position && typeof position === 'object') {
      const values = [
        finite(position.x ?? position.X),
        finite(position.y ?? position.Y),
        finite(position.z ?? position.Z)
      ].filter(value => value !== null);
      if (values.length) renderedPosition = values.map(Math.round).join(' / ');
    }
    return [
      base?.region_name ?? base?.region,
      base?.system_name ?? base?.system,
      base?.sector_coord ?? base?.sector,
      renderedPosition
    ].map(value => String(value ?? '').trim()).filter(Boolean).join(' // ') || 'LOCATION DATA UNAVAILABLE';
  }

  function items(base) {
    const list = base?.shop_items ?? base?.shopItems ?? base?.goods ?? [];
    return Array.isArray(list) ? list : [];
  }

  function itemName(item) {
    return String(
      item?.name ??
      item?.good_name ??
      item?.commodity_name ??
      item?.nickname ??
      item?.good ??
      'UNKNOWN ITEM'
    );
  }

  function itemKey(item) {
    return norm(itemName(item));
  }

  function qty(item) {
    if (!item) return null;
    return finite(item?.quantity ?? item?.amount ?? item?.stock);
  }

  function buy(item) {
    return finite(item?.price_to_sell_to_base ?? item?.sell_price ?? item?.price_sell);
  }

  function sell(item) {
    return finite(item?.price_to_buy_from_base ?? item?.buy_price ?? item?.price_buy);
  }

  function price(value) {
    return value === null ? '—' : `${fmt(value)} cr`;
  }

  function itemByName(base, name) {
    const key = norm(name);
    return items(base).find(item => itemKey(item) === key) || null;
  }

  function boundary(item) {
    const min = finite(item?.min_stock ?? item?.min);
    const max = finite(
      item?.max_stock ??
      item?.max ??
      item?.maxStock ??
      item?.max_quantity ??
      item?.maxQuantity
    );
    return {
      min,
      max,
      valid: min !== null && max !== null && max > 0 && min >= 0 && min <= max
    };
  }

  function stockState(item, fallback = null) {
    const quantity = qty(item);
    if (quantity === null) return 'muted';
    const bounds = boundary(item);
    if (bounds.valid) {
      if (quantity < bounds.min) return 'danger';
      if (bounds.min > 0 && quantity < bounds.min * 1.25) return 'warn';
      return 'good';
    }
    if (fallback) {
      if (quantity < fallback.critical) return 'danger';
      if (quantity < fallback.warn) return 'warn';
      return 'good';
    }
    return 'muted';
  }

  function stockMarkup(item, compact = false) {
    const quantity = qty(item);
    const bounds = boundary(item);
    if (quantity === null || !bounds.valid) {
      return '<span class="stock-unavailable" aria-label="Stock limits unavailable">—</span>';
    }
    const tone = stockState(item);
    const fill = Math.max(0, Math.min(100, quantity / bounds.max * 100));
    const marker = Math.max(0, Math.min(100, bounds.min / bounds.max * 100));
    const fixedRequirement = bounds.min === bounds.max;
    const label = fixedRequirement
      ? `Quantity ${fmt(quantity)}, required stock ${fmt(bounds.min)}`
      : `Quantity ${fmt(quantity)}, minimum ${fmt(bounds.min)}, maximum ${fmt(bounds.max)}`;
    const limits = fixedRequirement
      ? `<div class="stock-range is-fixed"><span>REQUIRED ${fmt(bounds.min)}</span></div>`
      : `<div class="stock-range"><span>MIN ${fmt(bounds.min)}</span><span>MAX ${fmt(bounds.max)}</span></div>`;
    return `<div class="stock-level${compact ? ' compact' : ''}" data-tone="${tone}" role="img" aria-label="${esc(label)}">${limits}<div class="stock-track"><i style="width:${fill}%"></i><mark style="left:${marker}%"></mark></div></div>`;
  }

  function delta(current, previous) {
    return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
  }

  function deltaMarkup(value, unit = '', inverse = false) {
    if (value === null || Math.abs(value) < 0.0001) return '<span data-tone="muted">NO CHANGE</span>';
    const positive = value > 0;
    const good = inverse ? !positive : positive;
    const sign = positive ? '+' : '−';
    const absolute = Math.abs(value);
    const rendered = unit === '%' ? absolute.toFixed(1) : fmt(absolute);
    return `<span data-tone="${good ? 'good' : 'danger'}">${sign}${rendered}${unit}</span>`;
  }

  function setDelta(element, value, unit = '', inverse = false) {
    element.innerHTML = deltaMarkup(value, unit, inverse);
  }

  function maintenanceState(item, definition) {
    return stockState(item, definition);
  }

  function maintenanceStatus(item, definition) {
    const quantity = qty(item);
    if (quantity === null) return 'NO TELEMETRY';
    const state = maintenanceState(item, definition);
    if (state === 'danger') return 'CRITICAL RESERVE';
    if (state === 'warn') return 'LOW RESERVE';
    return 'OPERATIONAL';
  }

  function baseMaintenance(base) {
    return MAINT.map(definition => {
      const item = itemByName(base, definition.label);
      return { definition, item, state: maintenanceState(item, definition) };
    });
  }

  function severity(state) {
    return state === 'danger' ? 3 : state === 'warn' ? 2 : state === 'muted' ? 1 : 0;
  }

  function worst(states) {
    return states.reduce((current, candidate) => severity(candidate) > severity(current) ? candidate : current, 'good');
  }

  function watchlist() {
    const raw = loadJson(KEYS.watch);
    return Array.isArray(raw) ? raw.filter(entry => entry && entry.key && entry.label) : [];
  }

  function setWatchlist(list) {
    return saveJson(KEYS.watch, list);
  }

  function toggleWatch(name) {
    const key = norm(name);
    const list = watchlist();
    const index = list.findIndex(entry => entry.key === key);
    if (index >= 0) list.splice(index, 1);
    else list.push({ key, label: String(name) });
    setWatchlist(list);
    render();
    emitState('watchlist');
  }

  function baseAlerts(definition, base) {
    const alerts = [];
    if (!base) {
      alerts.push({
        tone: 'danger',
        title: 'NODE OFFLINE',
        detail: `${definition.label} was not found in the current telemetry.`
      });
      return alerts;
    }

    const health = hp(base);
    if (health === null) {
      alerts.push({
        tone: 'warn',
        title: 'HEALTH NOT REPORTED',
        detail: 'Structural integrity is unavailable in the current telemetry.'
      });
    } else if (health < 75) {
      alerts.push({
        tone: health < 35 ? 'danger' : 'warn',
        title: 'STRUCTURAL INTEGRITY',
        detail: `Facility health is ${hpText(base)}.`
      });
    }

    baseMaintenance(base).forEach(({ definition: supply, item, state }) => {
      const quantity = qty(item);
      if (quantity === null) {
        alerts.push({
          tone: 'warn',
          title: `${supply.label.toUpperCase()} NOT REPORTED`,
          detail: 'The current feed does not contain a verified quantity.'
        });
      } else if (state !== 'good') {
        alerts.push({
          tone: state,
          title: `${supply.label.toUpperCase()} ${state === 'danger' ? 'CRITICAL' : 'LOW'}`,
          detail: `${fmt(quantity)} units remain in the maintenance reserve.`
        });
      }
    });

    const maintenanceKeys = new Set(MAINT.map(item => item.key));
    watchlist().forEach(watched => {
      if (maintenanceKeys.has(watched.key)) return;
      const item = itemByName(base, watched.label);
      if (!item || !boundary(item).valid) return;
      const state = stockState(item);
      if (state === 'danger' || state === 'warn') {
        alerts.push({
          tone: state,
          title: `${watched.label.toUpperCase()} WATCH ALERT`,
          detail: `${fmt(qty(item))} units remain against the configured stock limits.`
        });
      }
    });

    return alerts;
  }

  function totalMetric(getter, map = bases) {
    let total = 0;
    let count = 0;
    POBS.forEach(pob => {
      const base = map.get(pob.key);
      const value = base ? getter(base) : null;
      if (Number.isFinite(value)) {
        total += value;
        count += 1;
      }
    });
    return count ? total : null;
  }

  function totalAlerts() {
    return POBS.reduce((sum, pob) => sum + baseAlerts(pob, bases.get(pob.key)).length, 0);
  }

  function renderNetworkMetrics() {
    if (!last && mode === 'none') {
      E.metricNodes.textContent = '—';
      E.metricNodesSub.textContent = 'NO VERIFIED FEED';
      E.metricCredits.textContent = '—';
      E.metricCreditsDelta.innerHTML = '<span data-tone="muted">NO BASELINE</span>';
      E.metricStorage.textContent = '—';
      E.metricStorageDelta.innerHTML = '<span data-tone="muted">NO BASELINE</span>';
      E.metricAlerts.textContent = '—';
      E.metricAlertsSub.textContent = 'AWAITING TELEMETRY';
      E.networkState.dataset.tone = 'muted';
      E.networkState.querySelector('strong').textContent = 'AWAITING DATA';
      E.networkState.querySelector('small').textContent = 'NETWORK STATE';
      return;
    }

    const found = POBS.filter(pob => bases.get(pob.key)).length;
    const alerts = totalAlerts();
    const credits = totalMetric(creditsRaw);
    const previousCredits = totalMetric(creditsRaw, previousBases);
    const storage = totalMetric(storageRaw);
    const previousStorage = totalMetric(storageRaw, previousBases);

    E.metricNodes.textContent = `${found}/4`;
    E.metricNodesSub.textContent = mode === 'cache'
      ? `CACHED SNAPSHOT // ${ageText()}`
      : found === 4
        ? 'ALL NODES VERIFIED'
        : `${4 - found} NODE${4 - found === 1 ? '' : 'S'} MISSING`;
    E.metricCredits.textContent = credits === null ? '—' : cash(credits);
    E.metricCreditsDelta.innerHTML = deltaMarkup(delta(credits, previousCredits));
    E.metricStorage.textContent = storage === null ? '—' : fmt(storage);
    E.metricStorageDelta.innerHTML = deltaMarkup(delta(storage, previousStorage));
    E.metricAlerts.textContent = String(alerts);
    E.metricAlertsSub.textContent = alerts ? 'ATTENTION REQUIRED' : 'NO ACTIVE ALERTS';

    const tone = found < 4 ? 'danger' : alerts ? 'warn' : 'good';
    E.networkState.dataset.tone = tone;
    E.networkState.querySelector('strong').textContent = found < 4
      ? 'NETWORK DEGRADED'
      : alerts
        ? 'NODES ONLINE // ALERTS ACTIVE'
        : 'ALL NODES NOMINAL';
    E.networkState.querySelector('small').textContent = mode === 'cache'
      ? `CACHED STATE // ${ageText()}`
      : 'NETWORK STATE';
  }

  function miniMaintenance(base) {
    if (!base) {
      return '<div class="maintenance-mini"><span data-tone="muted">NO TELEMETRY</span></div>';
    }
    return `<div class="maintenance-mini">${baseMaintenance(base).map(({ definition, item, state }) => `<span data-tone="${state}" title="${esc(definition.label)}">${definition.code}<b>${fmt(qty(item))}</b></span>`).join('')}</div>`;
  }

  function renderOverview() {
    E.overviewSync.textContent = syncText();
    E.overviewSync.dataset.tone = freshnessTone();
    renderNetworkMetrics();
    E.grid.innerHTML = POBS.map((pob, index) => {
      const base = bases.get(pob.key);
      const alerts = baseAlerts(pob, base);
      if (!base) {
        const awaiting = !last && mode === 'none';
        return `<article class="base-card" data-base-key="${pob.key}" data-state="${awaiting ? 'awaiting' : 'missing'}" tabindex="0" role="button" aria-label="Open ${esc(pob.label)}"><span class="node-id">NODE 0${index + 1}</span><div class="base-card-head"><div><h3>${esc(pob.label)}</h3><p class="where">${awaiting ? 'Awaiting verified telemetry' : 'POB not found in the current feed'}</p></div><span class="health-pill" data-tone="${awaiting ? 'muted' : 'danger'}">${awaiting ? 'WAITING' : 'OFFLINE'}</span></div>${miniMaintenance(null)}<div class="base-card-footer"><span>NO VERIFIED TELEMETRY</span><b data-tone="${awaiting ? 'muted' : 'danger'}">${awaiting ? 'PENDING' : `${alerts.length} ALERT`}</b></div></article>`;
      }
      return `<article class="base-card" data-base-key="${pob.key}" tabindex="0" role="button" aria-label="Open ${esc(pob.label)}"><span class="node-id">NODE 0${index + 1}</span><div class="base-card-head"><div><h3>${esc(pob.label)}</h3><p class="where">${esc(loc(base))}</p></div><span class="health-pill" data-tone="${hpTone(base)}">${hpText(base)}</span></div><div class="base-card-stats"><div><small>CREDITS</small><strong>${cash(creditsRaw(base))}</strong></div><div><small>FREE STORAGE</small><strong>${fmt(storageRaw(base))}</strong></div></div>${miniMaintenance(base)}<div class="base-card-footer"><span>FACILITY CONDITIONS</span><b data-tone="${alerts.length ? 'warn' : 'good'}">${alerts.length ? `${alerts.length} ALERT${alerts.length === 1 ? '' : 'S'}` : 'NOMINAL'}</b></div></article>`;
    }).join('');
    renderMatrix();
  }

  function matrixRows() {
    const rows = MAINT.map(item => ({
      key: item.key,
      label: item.label,
      maintenance: item
    }));
    watchlist().forEach(watched => {
      if (!rows.some(row => row.key === watched.key)) {
        rows.push({ key: watched.key, label: watched.label, maintenance: null });
      }
    });
    return rows;
  }

  function renderMatrix() {
    const rows = matrixRows();
    E.matrix.innerHTML = `<div class="matrix-table" role="table" aria-label="Cross-POB reserve matrix"><div class="matrix-row matrix-head" role="row"><span role="columnheader">COMMODITY</span>${POBS.map(pob => `<span role="columnheader">${esc(pob.short)}</span>`).join('')}</div>${rows.map(row => `<div class="matrix-row" role="row"><strong role="rowheader">${esc(row.label)}${row.maintenance ? '<small>MAINT</small>' : '<small>WATCH</small>'}</strong>${POBS.map(pob => {
      const base = bases.get(pob.key);
      const item = base ? itemByName(base, row.label) : null;
      const state = row.maintenance ? maintenanceState(item, row.maintenance) : stockState(item);
      const detail = !base
        ? 'NO FEED'
        : !item
          ? 'UNLISTED'
          : row.maintenance
            ? maintenanceStatus(item, row.maintenance)
            : boundary(item).valid
              ? 'STOCK'
              : 'NO LIMITS';
      return `<button role="cell" type="button" data-matrix-base="${pob.key}" data-matrix-item="${esc(row.label)}" data-tone="${state}" aria-label="Open ${esc(row.label)} at ${esc(pob.label)}"><b>${fmt(qty(item))}</b><small>${detail}</small></button>`;
    }).join('')}</div>`).join('')}</div>`;
  }

  function renderMaintenance(base) {
    const rows = baseMaintenance(base);
    const state = worst(rows.map(row => row.state));
    E.facilityState.dataset.tone = state;
    E.facilityState.textContent = state === 'danger'
      ? 'ACTION REQUIRED'
      : state === 'warn'
        ? 'RESERVE WATCH'
        : state === 'muted'
          ? 'DATA INCOMPLETE'
          : 'FACILITY NOMINAL';
    E.maintenance.innerHTML = rows.map(({ definition, item, state: itemState }) => {
      const quantity = qty(item);
      return `<article class="maintenance-card" data-tone="${itemState}"><div class="maintenance-title"><div><small>${definition.code} // DAILY FACILITY SUPPLY</small><strong>${esc(definition.label)}</strong></div><span>${maintenanceStatus(item, definition)}</span></div><div class="maintenance-value"><b>${fmt(quantity)}</b><em>${quantity === null ? 'not reported' : 'units'}</em></div>${stockMarkup(item, true)}</article>`;
    }).join('');
  }

  function renderPriority(definition, base) {
    const list = baseAlerts(definition, base);
    E.priorityCount.textContent = `${list.length} ALERT${list.length === 1 ? '' : 'S'}`;
    E.priorityCount.dataset.tone = list.some(item => item.tone === 'danger')
      ? 'danger'
      : list.length
        ? 'warn'
        : 'good';
    E.priority.innerHTML = list.length
      ? list.map((alert, index) => `<article data-tone="${alert.tone}"><span>0${index + 1}</span><div><strong>${esc(alert.title)}</strong><p>${esc(alert.detail)}</p></div></article>`).join('')
      : '<div class="priority-empty"><i></i><div><strong>NO ACTIVE ALERTS</strong><span>Facility health and monitored reserves are nominal.</span></div></div>';
  }

  function renderWatch(base) {
    const list = watchlist();
    E.watchCount.textContent = `${list.length} WATCHED`;
    if (!list.length) {
      E.watchGrid.innerHTML = '<div class="watch-empty">WATCHLIST EMPTY <small>Star cargo in the manifest to pin it here.</small></div>';
      return;
    }
    E.watchGrid.innerHTML = list.map(watched => {
      const item = base ? itemByName(base, watched.label) : null;
      const quantity = qty(item);
      return `<article class="watch-card" data-tone="${stockState(item)}"><button class="watch-remove" type="button" data-unwatch="${esc(watched.label)}" aria-label="Remove ${esc(watched.label)} from watchlist">×</button><small>WATCHED CARGO</small><strong>${esc(watched.label)}</strong><b>${fmt(quantity)}</b><span class="watch-meta">${quantity === null ? 'NOT REPORTED' : 'UNITS'}</span>${stockMarkup(item, true)}</article>`;
    }).join('');
  }

  function renderItems(base) {
    if (!base) {
      E.body.innerHTML = '';
      E.empty.textContent = 'INVENTORY UNAVAILABLE // NO VERIFIED POB TELEMETRY';
      E.empty.hidden = false;
      return;
    }
    const query = norm(E.search.value);
    const watched = new Set(watchlist().map(entry => entry.key));
    let list = items(base);
    list = list.filter(item => {
      const key = itemKey(item);
      if (query && !key.includes(query)) return false;
      if (inventoryFilter === 'watch') return watched.has(key);
      if (inventoryFilter === 'buy') return (buy(item) ?? 0) > 0;
      if (inventoryFilter === 'sell') return (sell(item) ?? 0) > 0;
      return true;
    }).sort((left, right) => itemName(left).localeCompare(itemName(right), 'en'));

    E.body.innerHTML = list.map(item => {
      const name = itemName(item);
      const watchedItem = watched.has(itemKey(item));
      return `<tr><td data-label="WATCH"><button class="watch-toggle${watchedItem ? ' active' : ''}" type="button" data-watch="${esc(name)}" aria-label="${watchedItem ? 'Remove' : 'Add'} ${esc(name)} ${watchedItem ? 'from' : 'to'} watchlist">★</button></td><td class="item-name" data-label="ITEM">${esc(name)}</td><td data-label="QUANTITY">${fmt(qty(item))}</td><td class="muted" data-label="BASE BUYS">${esc(price(buy(item)))}</td><td class="muted" data-label="BASE SELLS">${esc(price(sell(item)))}</td><td class="stock-cell" data-label="STOCK LEVEL">${stockMarkup(item)}</td></tr>`;
    }).join('');
    E.empty.textContent = 'NO MATCHING COMMODITY FOUND';
    E.empty.hidden = list.length > 0;
  }

  function renderDetail(key) {
    const definition = POBS.find(pob => pob.key === key);
    if (!definition) {
      view = 'overview';
      saveJson(KEYS.view, view);
      render();
      return;
    }
    const base = bases.get(key);
    const previousBase = previousBases.get(key);
    E.kicker.textContent = `POB NODE // ${mode === 'cache' ? 'CACHED' : 'LIVE'}`;
    E.name.textContent = definition.label;
    E.location.textContent = loc(base);
    E.sync.textContent = last ? formatClock(last) : '—';
    E.syncMode.textContent = mode === 'cache'
      ? `CACHE // ${ageText()}`
      : 'LIVE DARKSTAT SNAPSHOT';

    if (!base) {
      E.badge.dataset.tone = 'danger';
      E.badge.textContent = 'OFFLINE';
      E.meter.style.width = '0';
      E.meter.dataset.tone = 'danger';
      E.credits.textContent = '—';
      E.storage.textContent = '—';
      [E.creditsDelta, E.storageDelta].forEach(element => {
        element.textContent = 'NO DATA';
      });
      E.detailDelta.textContent = 'NODE NOT FOUND IN CURRENT FEED';
      renderMaintenance(null);
      renderPriority(definition, null);
      renderWatch(null);
      renderItems(null);
      return;
    }

    const health = hp(base);
    const healthState = hpTone(base);
    const creditChange = delta(creditsRaw(base), creditsRaw(previousBase));
    const storageChange = delta(storageRaw(base), storageRaw(previousBase));
    E.badge.dataset.tone = healthState;
    E.badge.textContent = hpText(base);
    E.meter.style.width = `${health ?? 0}%`;
    E.meter.dataset.tone = healthState;
    E.credits.textContent = cash(creditsRaw(base));
    E.storage.textContent = fmt(storageRaw(base));
    setDelta(E.creditsDelta, creditChange);
    setDelta(E.storageDelta, storageChange);
    E.detailDelta.textContent = previousBase ? 'PREVIOUS SNAPSHOT AVAILABLE' : 'NO PREVIOUS SNAPSHOT FOR COMPARISON';
    renderMaintenance(base);
    renderPriority(definition, base);
    renderWatch(base);
    renderItems(base);
  }

  function render() {
    renderOverview();
    const calculator = view === 'calculator';
    const detail = view !== 'overview' && !calculator;
    E.overview.hidden = view !== 'overview';
    E.calculator.hidden = !calculator;
    E.detail.hidden = !detail;
    E.tabs.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (detail) renderDetail(view);
    if (calculator) window.DTRCalculator?.render?.();
  }

  function show(next, itemSearch = '') {
    view = VALID_VIEWS.has(next) ? next : 'overview';
    saveJson(KEYS.view, view);
    E.search.value = itemSearch;
    inventoryFilter = 'all';
    E.filters.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', button.dataset.filter === 'all');
    });
    render();
    emitState('view');
    window.scrollTo({
      top: 0,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  function hydrateLatest({ renderNow = true } = {}) {
    const live = loadJson(KEYS.live);
    const previous = loadJson(KEYS.previous);
    if (!Array.isArray(live?.data)) return false;
    const savedAt = Date.parse(live.savedAt || '');
    data = live.data;
    previousData = Array.isArray(previous?.data) ? previous.data : [];
    last = new Date(Number.isFinite(savedAt) ? savedAt : Date.now());
    mode = 'cache';
    rebuild();
    status('cache', ageMs() >= STALE_DANGER_MS ? 'STALE CACHE' : 'CACHED DATA');
    if (renderNow) render();
    return true;
  }

  function persistLive(nextData) {
    const current = loadJson(KEYS.live);
    let previousSaved = true;
    if (Array.isArray(current?.data)) previousSaved = saveJson(KEYS.previous, current);
    const liveSaved = saveJson(KEYS.live, {
      savedAt: new Date().toISOString(),
      data: nextData
    });
    const fallbackPrevious = loadJson(KEYS.previous);
    previousData = Array.isArray(current?.data)
      ? current.data
      : Array.isArray(fallbackPrevious?.data)
        ? fallbackPrevious.data
        : [];
    return previousSaved && liveSaved;
  }

  async function requestTelemetry() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(API, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function load() {
    if (loadInFlight) return loadInFlight;
    if (refreshTimer) clearTimeout(refreshTimer);
    E.refresh.disabled = true;
    E.error.hidden = true;
    status('loading', 'SYNCING');

    loadInFlight = (async () => {
      try {
        const response = await requestTelemetry();
        if (!response.ok) throw new Error(`Darkstat HTTP ${response.status}`);
        const next = await response.json();
        if (!Array.isArray(next)) throw new Error('Invalid POB response');

        const stored = persistLive(next);
        data = next;
        last = new Date();
        mode = 'live';
        lastError = '';
        rebuild();
        const found = POBS.filter(pob => bases.get(pob.key)).length;
        status('live', `${found}/4 NODES LIVE`);
        render();
        if (!stored) {
          E.error.hidden = false;
          E.errorText.textContent = 'Live telemetry loaded, but this device could not save the offline snapshot.';
        }
      } catch (error) {
        lastError = error?.name === 'AbortError'
          ? 'Darkstat timed out after 18 seconds.'
          : String(error?.message || 'Darkstat unavailable.');

        if (data.length && last) {
          mode = 'cache';
          status('cache', ageMs() >= STALE_DANGER_MS ? 'STALE CACHE' : 'CACHE ACTIVE');
          E.error.hidden = false;
          E.errorText.textContent = `Live uplink failed. The last verified snapshot remains active // ${ageText()}.`;
          render();
        } else if (hydrateLatest({ renderNow: false })) {
          E.error.hidden = false;
          E.errorText.textContent = `Live uplink failed. The last verified snapshot remains active // ${ageText()}.`;
          render();
        } else {
          mode = 'none';
          status('error', 'UPLINK FAILED');
          E.error.hidden = false;
          E.errorText.textContent = lastError;
          render();
        }
      }
    })();

    emitState('loading');
    try {
      await loadInFlight;
    } finally {
      loadInFlight = null;
      E.refresh.disabled = false;
      nextRefreshAt = Date.now() + REFRESH_MS;
      refreshTimer = setTimeout(load, REFRESH_MS);
      emitState('loaded');
    }
  }

  function storageCheck() {
    const key = `dtr:probe:${Date.now()}`;
    try {
      localStorage.setItem(key, 'ok');
      const ready = localStorage.getItem(key) === 'ok';
      localStorage.removeItem(key);
      return ready;
    } catch {
      return false;
    }
  }

  function updateClock() {
    E.clock.textContent = formatClock(new Date());
  }

  function updateStickyOffset() {
    requestAnimationFrame(() => {
      const offset = E.offline.hidden ? 0 : E.offline.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--sticky-offset', `${Math.round(offset)}px`);
    });
  }

  function connectionState() {
    E.offline.hidden = navigator.onLine;
    updateStickyOffset();
    if (!navigator.onLine && mode === 'live') {
      mode = 'cache';
      status('cache', 'OFFLINE // CACHE');
      render();
    }
    emitState('connection');
  }

  function focusable(panel) {
    return [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getClientRects().length);
  }

  function trapSystemFocus(event) {
    if (event.key !== 'Tab' || E.systemPanel.hidden) return;
    const controls = focusable(E.systemPanel);
    if (!controls.length) return;
    const first = controls[0];
    const final = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      final.focus();
    } else if (!event.shiftKey && document.activeElement === final) {
      event.preventDefault();
      first.focus();
    }
  }

  function openSystem() {
    systemReturnFocus = document.activeElement;
    E.systemPanel.hidden = false;
    document.body.classList.add('modal-open');
    window.dispatchEvent(new CustomEvent('dtr:system-open'));
    E.systemClose.focus();
  }

  function closeSystem() {
    E.systemPanel.hidden = true;
    document.body.classList.remove('modal-open');
    (systemReturnFocus instanceof HTMLElement ? systemReturnFocus : E.systemButton).focus();
  }

  E.tabs.addEventListener('click', event => {
    const button = event.target.closest('.tab');
    if (button) show(button.dataset.view);
  });
  E.grid.addEventListener('click', event => {
    const card = event.target.closest('[data-base-key]');
    if (card) show(card.dataset.baseKey);
  });
  E.grid.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const card = event.target.closest('[data-base-key]');
    if (card) {
      event.preventDefault();
      show(card.dataset.baseKey);
    }
  });
  E.matrix.addEventListener('click', event => {
    const button = event.target.closest('[data-matrix-base]');
    if (button) show(button.dataset.matrixBase, button.dataset.matrixItem);
  });
  E.search.addEventListener('input', () => {
    if (view !== 'overview') renderItems(bases.get(view));
  });
  E.filters.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    inventoryFilter = button.dataset.filter;
    E.filters.querySelectorAll('button').forEach(candidate => {
      candidate.classList.toggle('active', candidate === button);
    });
    renderItems(bases.get(view));
  });
  E.body.addEventListener('click', event => {
    const button = event.target.closest('[data-watch]');
    if (button) toggleWatch(button.dataset.watch);
  });
  E.watchGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-unwatch]');
    if (button) toggleWatch(button.dataset.unwatch);
  });
  E.refresh.addEventListener('click', load);
  E.systemButton.addEventListener('click', openSystem);
  E.systemClose.addEventListener('click', closeSystem);
  E.systemRefresh.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dtr:system-refresh'));
  });
  E.systemPanel.addEventListener('click', event => {
    if (event.target === E.systemPanel) closeSystem();
  });
  E.systemPanel.addEventListener('keydown', trapSystemFocus);

  window.addEventListener('online', () => {
    connectionState();
    load();
  });
  window.addEventListener('offline', connectionState);
  window.addEventListener('resize', updateStickyOffset);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !E.systemPanel.hidden) closeSystem();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && nextRefreshAt && Date.now() >= nextRefreshAt) load();
  });

  window.DTRApp = Object.freeze({
    API,
    LOCALE,
    POBS,
    MAINT,
    KEYS,
    REFRESH_MS,
    STALE_WARN_MS,
    STALE_DANGER_MS,
    refresh: load,
    show,
    storageCheck,
    ageText,
    getState() {
      return {
        data,
        previousData,
        bases: new Map(bases),
        previousBases: new Map(previousBases),
        view,
        last,
        mode,
        loading: Boolean(loadInFlight),
        nextRefreshAt,
        lastError,
        storageFaults: storageFaults.slice(),
        recoveries: recoveryIndex()
      };
    }
  });

  setInterval(updateClock, 1000);
  updateClock();
  connectionState();
  hydrateLatest({ renderNow: false });
  render();
  emitState('boot');
  load();
})();
