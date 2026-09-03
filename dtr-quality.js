/* DTR POB Network · diagnostics, attention mode and mobile navigation. */
(() => {
  'use strict';
  if (window.DTRQuality) return;

  const META = Object.freeze({ version: '0.7.3', build: '2026.09.03-A' });
  const ATTENTION_KEY = 'dtr:attention:v1';
  const runtimeEvents = [];
  const $ = id => document.getElementById(id);
  let attention = false;

  function appState() {
    return window.DTRApp?.getState?.() || {
      bases: new Map(),
      mode: 'none',
      view: 'overview',
      last: null,
      loading: false,
      storageFaults: [],
      recoveries: []
    };
  }

  function setText(node, value) {
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  function loadAttention() {
    try {
      attention = localStorage.getItem(ATTENTION_KEY) === 'true';
    } catch {
      attention = false;
    }
  }

  function saveAttention() {
    try {
      localStorage.setItem(ATTENTION_KEY, attention ? 'true' : 'false');
    } catch {}
  }

  function mountQuickbar() {
    if ($('dtrQuickbar')) return;
    const tabs = $('tabs');
    if (!tabs) return;
    tabs.insertAdjacentHTML('afterend', `<section class="dtr-quickbar" id="dtrQuickbar" aria-label="DTR command controls">
      <div class="dtr-quickbar-inner">
        <button class="dtr-attention-toggle" id="dtrAttentionToggle" type="button" aria-pressed="false" aria-label="Show only issues">
          <span>ATTENTION</span><small>ONLY ISSUES</small><b id="dtrAttentionCount">0</b>
        </button>
        <button class="dtr-calculator-launch" id="dtrCalculatorLaunch" type="button" aria-label="Open recipe cost calculator">
          <span>CALCULATOR</span><small>RECIPE COST</small>
        </button>
        <div class="dtr-quickbar-state"><small>COMMAND FILTER</small><strong id="dtrAttentionSummary">ALL NETWORK DATA</strong></div>
        <span class="dtr-build-chip">v${META.version} // ${META.build}</span>
      </div>
    </section>`);
    $('dtrAttentionToggle')?.addEventListener('click', () => {
      attention = !attention;
      saveAttention();
      applyAttention();
    });
    $('dtrCalculatorLaunch')?.addEventListener('click', () => {
      window.DTRApp?.show?.('calculator');
    });
  }

  function mobilePobs() {
    const configured = window.DTRApp?.POBS || [];
    return [
      { view: 'overview', index: '00', short: 'ALL', label: 'All POB nodes' },
      ...configured.map((pob, index) => ({
        view: pob.key,
        index: `0${index + 1}`,
        short: pob.key === 'fort-torrelavega' ? 'TORRE' : pob.short,
        label: pob.label
      }))
    ];
  }

  function mountMobileNav() {
    if ($('dtrMobileNav')) return;
    document.body.insertAdjacentHTML('beforeend', `<nav class="dtr-mobile-nav" id="dtrMobileNav" aria-label="DTR mobile POB navigation">${mobilePobs().map(pob => `<button type="button" data-mobile-view="${pob.view}" aria-label="${pob.label}"><small>${pob.index}</small><span>${pob.short}</span></button>`).join('')}</nav>`);
    $('dtrMobileNav')?.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-view]');
      if (!button) return;
      window.DTRApp?.show?.(button.dataset.mobileView);
    });
    syncMobileNav();
  }

  function syncMobileNav() {
    const active = appState().view || 'overview';
    document.querySelectorAll('#dtrMobileNav [data-mobile-view]').forEach(button => {
      const selected = button.dataset.mobileView === active;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const calculator = $('dtrCalculatorLaunch');
    if (calculator) {
      const selected = active === 'calculator';
      calculator.classList.toggle('active', selected);
      if (selected) calculator.setAttribute('aria-current', 'page');
      else calculator.removeAttribute('aria-current');
    }
  }

  function globalAlertCount() {
    const match = String($('metricAlerts')?.textContent || '').match(/\d+/);
    return match ? Number(match[0]) || 0 : 0;
  }

  function issueTone(node) {
    const tone = node?.dataset?.tone || '';
    return tone === 'warn' || tone === 'danger';
  }

  function setManagedHidden(node, hidden) {
    if (node) node.classList.toggle('dtr-attention-hidden', Boolean(hidden));
  }

  function applyAttention() {
    document.body.classList.toggle('dtr-attention-mode', attention);
    const toggle = $('dtrAttentionToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', attention ? 'true' : 'false');
      toggle.setAttribute('aria-label', attention ? 'Show all network data' : 'Show only issues');
    }

    const count = globalAlertCount();
    setText($('dtrAttentionCount'), count);
    setText(
      $('dtrAttentionSummary'),
      attention
        ? count
          ? `${count} ACTIVE CONDITION${count === 1 ? '' : 'S'}`
          : 'ALL CLEAR // NO ACTIVE CONDITIONS'
        : 'ALL NETWORK DATA'
    );

    document.querySelectorAll('#overviewGrid .base-card').forEach(card => {
      const footerState = card.querySelector('.base-card-footer b');
      const hasIssue = card.dataset.state === 'missing' || issueTone(footerState);
      setManagedHidden(card, attention && !hasIssue);
    });
    document.querySelectorAll('#networkMatrix .matrix-row:not(.matrix-head)').forEach(row => {
      setManagedHidden(row, attention && ![...row.querySelectorAll('[data-tone]')].some(issueTone));
    });
    document.querySelectorAll('#maintenanceGrid .maintenance-card').forEach(card => {
      setManagedHidden(card, attention && !issueTone(card));
    });
    document.querySelectorAll('#watchGrid .watch-card').forEach(card => {
      setManagedHidden(card, attention && !issueTone(card));
    });
    document.querySelectorAll('#inventoryBody tr').forEach(row => {
      setManagedHidden(row, attention && !issueTone(row.querySelector('.stock-level')));
    });

    syncMobileNav();
  }

  function standalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function diagnostic(key, label, tone, status, detail) {
    return { key, label, tone, status, detail };
  }

  function collectDiagnostics() {
    const state = appState();
    const storageReady = window.DTRApp?.storageCheck?.() ?? false;
    const storageFaults = state.storageFaults?.length || 0;
    const recoveries = state.recoveries?.length || 0;
    const requiredShell = ['tabs', 'overviewView', 'calculatorView', 'detailView', 'overviewGrid', 'networkMatrix', 'systemPanel']
      .every(id => Boolean($(id)));
    const runtimeReady = Boolean(window.DTRApp) && requiredShell && runtimeEvents.length === 0;
    const matches = [...(state.bases?.values?.() || [])].filter(Boolean).length;
    const pwaState = window.DTRPWA?.state || {};
    const registration = pwaState.registration;
    const shellReady = Boolean(
      navigator.serviceWorker?.controller ||
      registration?.active ||
      registration?.waiting ||
      registration?.installing
    );
    const updateReady = Boolean(pwaState.updateWorker);
    const applying = Boolean(pwaState.updating);
    const freshness = state.last
      ? `${window.DTRApp?.ageText?.(state.last) || 'VERIFIED'} // ${state.last.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
      : 'No verified snapshot.';

    const storageTone = !storageReady ? 'danger' : storageFaults || recoveries ? 'warn' : 'good';
    const storageStatus = !storageReady
      ? 'UNAVAILABLE'
      : storageFaults
        ? 'SAVE WARNING'
        : recoveries
          ? 'RECOVERED'
          : 'READY';
    const storageDetail = !storageReady
      ? 'Browser-local saves are unavailable.'
      : storageFaults
        ? `${storageFaults} storage operation${storageFaults === 1 ? '' : 's'} failed this session.`
        : recoveries
          ? `${recoveries} damaged local entr${recoveries === 1 ? 'y was' : 'ies were'} backed up and reset.`
          : 'Watchlist, view state and verified snapshots can be saved locally.';

    const telemetryTone = state.mode === 'live'
      ? 'good'
      : state.mode === 'cache'
        ? (Date.now() - state.last?.getTime() >= (window.DTRApp?.STALE_DANGER_MS || Infinity) ? 'danger' : 'warn')
        : 'danger';
    const telemetryStatus = state.loading
      ? 'SYNCING'
      : state.mode === 'live'
        ? 'LIVE'
        : state.mode === 'cache'
          ? 'CACHE ACTIVE'
          : 'NO DATA';

    return [
      diagnostic('build', 'APP BUILD', 'good', `v${META.version}`, META.build),
      diagnostic(
        'runtime',
        'APP RUNTIME',
        runtimeReady ? 'good' : 'danger',
        runtimeReady ? 'READY' : `${runtimeEvents.length || 1} ISSUE${runtimeEvents.length === 1 ? '' : 'S'}`,
        runtimeReady ? 'Core UI mounted without recorded runtime errors.' : 'A runtime or required-shell failure was detected this session.'
      ),
      diagnostic('storage', 'LOCAL STORAGE', storageTone, storageStatus, storageDetail),
      diagnostic(
        'network',
        'CONNECTION',
        navigator.onLine ? 'good' : 'warn',
        navigator.onLine ? 'ONLINE' : 'OFFLINE',
        navigator.onLine ? 'Network access is available.' : 'Cached DTR data remains available; live telemetry is paused.'
      ),
      diagnostic('telemetry', 'DARKSTAT UPLINK', telemetryTone, telemetryStatus, freshness),
      diagnostic(
        'pobs',
        'POB MATCHES',
        matches === 4 ? 'good' : matches ? 'warn' : 'danger',
        `${matches}/4`,
        matches === 4 ? 'All tracked DTR POBs resolve from the current app state.' : 'One or more tracked POBs are missing from the current app state.'
      ),
      diagnostic(
        'recipes',
        'RECIPE CATALOG',
        window.DTR_RECIPE_CATALOG?.meta?.recipeCount ? 'good' : 'danger',
        window.DTR_RECIPE_CATALOG?.meta?.recipeCount ? `${window.DTR_RECIPE_CATALOG.meta.recipeCount} READY` : 'UNAVAILABLE',
        window.DTR_RECIPE_CATALOG?.meta?.recipeCount
          ? 'Discovery recipe data is available to the POB cost calculator.'
          : 'The calculator recipe data did not load.'
      ),
      diagnostic(
        'pwa',
        'PWA SHELL',
        shellReady ? 'good' : 'warn',
        standalone() ? 'STANDALONE' : shellReady ? 'READY' : 'CHECKING',
        standalone() ? 'DTR is running in its dedicated app window.' : shellReady ? 'Offline startup shell is registered.' : 'Service-worker control is not active yet.'
      ),
      diagnostic(
        'update',
        'APP UPDATE',
        updateReady ? 'warn' : 'good',
        applying ? 'APPLYING' : updateReady ? 'UPDATE READY' : 'CURRENT',
        applying ? 'DTR is switching to the approved build.' : updateReady ? 'A newer DTR shell is waiting for UPDATE NOW.' : 'No unapplied DTR build is currently detected.'
      )
    ];
  }

  function renderDiagnostics() {
    const grid = $('systemGrid');
    const overall = $('systemOverall');
    if (!grid || !overall) return;
    const checks = collectDiagnostics();
    grid.innerHTML = checks.map(check => `<article class="dtr-diagnostic-card" data-tone="${check.tone}" data-check="${check.key}"><small>${check.label}</small><strong>${check.status}</strong><span>${check.detail}</span></article>`).join('');
    const danger = checks.filter(check => check.tone === 'danger').length;
    const warn = checks.filter(check => check.tone === 'warn').length;
    overall.dataset.tone = danger ? 'danger' : warn ? 'warn' : 'good';
    setText(overall.querySelector('strong'), danger ? 'ATTENTION REQUIRED' : warn ? 'CORE SYSTEMS NOMINAL' : 'ALL SYSTEMS NOMINAL');
    setText(
      overall.querySelector('span'),
      danger
        ? `${danger} blocking check${danger === 1 ? '' : 's'} detected.`
        : warn
          ? `${warn} status notice${warn === 1 ? '' : 's'}; no blocking app failure detected.`
          : 'Runtime, storage, telemetry and app shell report ready.'
    );
    mountCopyDiagnostics();
  }

  function diagnosticsReport() {
    const state = appState();
    const checks = collectDiagnostics();
    return [
      'DTR SYSTEM CHECK',
      `GENERATED: ${new Date().toISOString()}`,
      `APP: v${META.version} // BUILD ${META.build}`,
      `WINDOW: ${standalone() ? 'STANDALONE APP' : 'BROWSER'}`,
      '',
      ...checks.map(check => `${check.label}: ${check.status} // ${check.detail}`),
      '',
      `SESSION RUNTIME EVENTS: ${runtimeEvents.length}`,
      `STORAGE RECOVERIES: ${state.recoveries?.length || 0}`,
      'PRIVACY: No commodity quantities, prices or POB credit balances are included.'
    ].join('\n');
  }

  async function copyDiagnostics() {
    const report = diagnosticsReport();
    let copied = false;
    try {
      await navigator.clipboard.writeText(report);
      copied = true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = report;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        copied = document.execCommand('copy');
        area.remove();
      } catch {}
    }
    const button = $('dtrDiagnosticsCopy');
    if (button) {
      const previous = button.textContent;
      button.textContent = copied ? 'COPIED' : 'COPY FAILED';
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1400);
    }
  }

  function mountCopyDiagnostics() {
    const actions = document.querySelector('#systemPanel .system-actions');
    if (!actions || $('dtrDiagnosticsCopy')) return;
    const button = document.createElement('button');
    button.id = 'dtrDiagnosticsCopy';
    button.type = 'button';
    button.textContent = 'COPY DIAGNOSTICS';
    button.addEventListener('click', copyDiagnostics);
    actions.appendChild(button);
  }

  function mountBuildBadge() {
    const footer = document.querySelector('body > footer');
    if (!footer || $('dtrBuildBadge')) return;
    const badge = document.createElement('span');
    badge.id = 'dtrBuildBadge';
    badge.className = 'dtr-footer-build';
    badge.textContent = `DTR v${META.version} // ${META.build}`;
    footer.appendChild(badge);
  }

  function onStateChange() {
    syncMobileNav();
    applyAttention();
    if (!$('systemPanel')?.hidden) renderDiagnostics();
  }

  function init() {
    loadAttention();
    mountQuickbar();
    mountMobileNav();
    mountBuildBadge();
    renderDiagnostics();
    applyAttention();
  }

  window.addEventListener('error', event => {
    runtimeEvents.push({
      type: 'error',
      at: Date.now(),
      message: String(event.message || 'runtime error')
    });
    if (runtimeEvents.length > 20) runtimeEvents.shift();
  });
  window.addEventListener('unhandledrejection', event => {
    runtimeEvents.push({
      type: 'promise',
      at: Date.now(),
      message: String(event.reason?.message || event.reason || 'promise rejection')
    });
    if (runtimeEvents.length > 20) runtimeEvents.shift();
  });
  window.addEventListener('dtr:statechange', onStateChange);
  window.addEventListener('dtr:pwa-state', () => {
    if (!$('systemPanel')?.hidden) renderDiagnostics();
  });
  window.addEventListener('dtr:system-open', renderDiagnostics);
  window.addEventListener('dtr:system-refresh', renderDiagnostics);
  window.addEventListener('online', renderDiagnostics);
  window.addEventListener('offline', renderDiagnostics);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('systemPanel')?.hidden) renderDiagnostics();
  });

  window.DTRQuality = {
    META,
    get attention() {
      return attention;
    },
    setAttention(value) {
      attention = Boolean(value);
      saveAttention();
      applyAttention();
    },
    renderDiagnostics,
    diagnosticsReport
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
