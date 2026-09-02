/* DTR POB Network · live uplink control deck. */
(() => {
  'use strict';
  if (window.DTRUplink) return;

  const $ = id => document.getElementById(id);

  function state() {
    return window.DTRApp?.getState?.() || {
      mode: 'none',
      last: null,
      loading: false,
      nextRefreshAt: 0
    };
  }

  function formatClock(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return '--:--:--';
    return value.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  function formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'DUE NOW';
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function linkState(snapshot = state()) {
    if (!navigator.onLine) return { tone: 'danger', connection: 'CONNECTION LOST', datalink: 'OFFLINE' };
    if (snapshot.loading) return { tone: 'warn', connection: 'UPLINK IN PROGRESS', datalink: 'SYNCING' };
    if (snapshot.mode === 'cache') return { tone: 'warn', connection: 'CACHED LINK ACTIVE', datalink: 'CACHE' };
    if (snapshot.mode === 'live') return { tone: 'good', connection: 'CONNECTION SECURE', datalink: 'LIVE' };
    return { tone: 'muted', connection: 'LINK STANDBY', datalink: 'STANDBY' };
  }

  function mount() {
    if ($('dtrUplinkConsole')) return;
    const metrics = document.querySelector('#overviewView .network-metrics');
    if (!metrics) return;
    metrics.insertAdjacentHTML('afterend', `<section class="dtr-uplink-console" id="dtrUplinkConsole" data-tone="muted" aria-label="Darkstat uplink controls">
      <header class="dtr-uplink-head">
        <div class="dtr-uplink-state"><i aria-hidden="true"></i><div><small>UPLINK STATUS</small><strong id="dtrUplinkConnection">LINK STANDBY</strong></div></div>
        <span>DARKSTAT CONTROL CHANNEL</span>
      </header>
      <div class="dtr-uplink-grid">
        <div><small>SYSTEM CLOCK</small><strong id="dtrUplinkClock">[--:--:--]</strong></div>
        <div><small>LATEST SYNC</small><strong id="dtrUplinkLatest">--:--:--</strong></div>
        <div><small>SNAPSHOT AGE</small><strong id="dtrUplinkAge">AWAITING</strong></div>
        <div><small>NEXT SYNC</small><strong id="dtrUplinkNext">--:--</strong></div>
        <div><small>DATALINK</small><strong id="dtrUplinkDatalink">STANDBY</strong></div>
      </div>
      <footer class="dtr-uplink-actions">
        <button id="dtrForceUplink" type="button"><i aria-hidden="true"></i><span>FORCE UPLINK</span></button>
        <span id="dtrUplinkMessage" role="status" aria-live="polite">AUTO CYCLE ARMED</span>
      </footer>
    </section>`);
    $('dtrForceUplink')?.addEventListener('click', forceUplink);
  }

  function setMessage(text, tone = 'muted') {
    const node = $('dtrUplinkMessage');
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  }

  async function forceUplink() {
    const button = $('dtrForceUplink');
    if (!navigator.onLine) {
      setMessage('NETWORK OFFLINE // UPLINK BLOCKED', 'danger');
      return;
    }
    const snapshot = state();
    if (snapshot.loading) {
      setMessage('UPLINK ALREADY IN PROGRESS', 'warn');
      return;
    }
    if (button) button.disabled = true;
    setMessage('MANUAL UPLINK REQUESTED', 'warn');
    try {
      await window.DTRApp?.refresh?.();
      const latest = state();
      setMessage(
        latest.mode === 'live' ? 'MANUAL UPLINK VERIFIED' : 'MANUAL UPLINK FAILED // CACHE ACTIVE',
        latest.mode === 'live' ? 'good' : 'danger'
      );
    } catch {
      setMessage('MANUAL UPLINK FAILED', 'danger');
    } finally {
      sync();
    }
  }

  function sync() {
    mount();
    const consoleNode = $('dtrUplinkConsole');
    if (!consoleNode) return;

    const snapshot = state();
    const connection = linkState(snapshot);
    consoleNode.dataset.tone = connection.tone;
    const connectionNode = $('dtrUplinkConnection');
    if (connectionNode) connectionNode.textContent = connection.connection;
    const datalink = $('dtrUplinkDatalink');
    if (datalink) {
      datalink.textContent = connection.datalink;
      datalink.dataset.tone = connection.tone;
    }

    const now = Date.now();
    const clock = $('dtrUplinkClock');
    if (clock) clock.textContent = `[${formatClock(new Date(now))}]`;
    const latest = $('dtrUplinkLatest');
    if (latest) latest.textContent = formatClock(snapshot.last);
    const age = $('dtrUplinkAge');
    if (age) age.textContent = snapshot.last ? window.DTRApp?.ageText?.(snapshot.last) || 'VERIFIED' : 'AWAITING';
    const next = $('dtrUplinkNext');
    if (next) next.textContent = snapshot.nextRefreshAt
      ? formatCountdown(snapshot.nextRefreshAt - now)
      : 'AWAITING';

    const button = $('dtrForceUplink');
    if (button) {
      button.disabled = !navigator.onLine || snapshot.loading;
      button.classList.toggle('busy', snapshot.loading);
      const label = button.querySelector('span');
      if (label) label.textContent = snapshot.loading ? 'UPLINKING…' : 'FORCE UPLINK';
    }
  }

  function tick() {
    const overview = $('overviewView');
    if (document.visibilityState === 'visible' && overview && !overview.hidden) sync();
  }

  function init() {
    mount();
    sync();
    window.setInterval(tick, 1000);
  }

  window.addEventListener('dtr:statechange', sync);
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });

  window.DTRUplink = { sync, forceUplink };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

