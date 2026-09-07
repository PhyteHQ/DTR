/* DTR procurement price direction adapter.
   Cost tools must use the price the POB pays for incoming goods (BASE BUYS),
   never the price a player pays when buying goods from the POB (BASE SELLS). */
(() => {
  'use strict';
  if (window.DTRProcurementPrices || !window.DTRApp) return;

  const originalApp = window.DTRApp;
  const finite = value => {
    if (value === null || value === undefined || value === '') return null;
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  };

  function pobPurchasePrice(item) {
    if (!item) return null;
    const value = finite(
      item?.price_to_sell_to_base
      ?? item?.sell_price
      ?? item?.price_sell
    );
    return value !== null && value > 0 ? value : null;
  }

  function adaptItem(item) {
    if (!item || typeof item !== 'object') return item;
    const purchasePrice = pobPurchasePrice(item);
    /* dtr-calculator.js / dtr-production.js historically read item.price first.
       Set it explicitly on the tool-facing clone. Zero intentionally blocks
       fallback to BASE SELLS when the POB has no valid purchase price. */
    return { ...item, price: purchasePrice ?? 0 };
  }

  function adaptBase(base) {
    if (!base || typeof base !== 'object') return base;
    const source = base.shop_items ?? base.shopItems ?? base.goods;
    if (!Array.isArray(source)) return base;
    const adapted = source.map(adaptItem);
    const copy = { ...base };
    if (Array.isArray(base.shop_items)) copy.shop_items = adapted;
    if (Array.isArray(base.shopItems)) copy.shopItems = adapted;
    if (Array.isArray(base.goods)) copy.goods = adapted;
    return copy;
  }

  function adaptMap(source) {
    if (!(source instanceof Map)) return source;
    return new Map([...source].map(([key, base]) => [key, adaptBase(base)]));
  }

  function getState() {
    const state = originalApp.getState();
    return {
      ...state,
      bases: adaptMap(state.bases),
      previousBases: adaptMap(state.previousBases)
    };
  }

  window.DTRApp = Object.freeze({ ...originalApp, getState });
  window.DTRProcurementPrices = Object.freeze({ pobPurchasePrice, adaptBase });
  document.documentElement.dataset.dtrProcurementPrice = 'base-buys';

  function fixCalculatorLabels() {
    document.querySelectorAll('.calculator-status').forEach(node => {
      if (node.textContent.trim() === 'NO SALE PRICE') node.textContent = 'NO BUY PRICE';
    });
  }

  new MutationObserver(fixCalculatorLabels).observe(document.body, { childList: true, subtree: true });
  fixCalculatorLabels();
})();
