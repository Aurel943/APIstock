/* Utilitaires de formatage et helpers DOM */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const nfCache = {};
/* Mode discret : les montants (2 décimales ou moins) sont masqués ; les cours (3 décimales) restent visibles */
function privacyOn() { return document.documentElement.classList.contains('privacy'); }

function fmtMoney(value, currency = 'EUR', digits = 2, noMask = false) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  if (!noMask && digits < 3 && privacyOn()) return '•••• ' + ({ EUR: '€', USD: '$', GBP: '£', GBp: '£', CHF: 'CHF', JPY: '¥' }[currency] || currency);
  const cur = currency === 'GBp' ? 'GBP' : currency;
  const key = cur + digits;
  try {
    nfCache[key] = nfCache[key] || new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
    return nfCache[key].format(currency === 'GBp' ? value / 100 : value);
  } catch (e) {
    return fmtNum(value, digits) + ' ' + currency;
  }
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function fmtQty(value) {
  if (!isFinite(value)) return '—';
  if (privacyOn()) return '••';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(value);
}

function fmtPct(value, digits = 2, signed = true) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  const s = fmtNum(value, digits) + ' %';
  return signed && value > 0 ? '+' + s : s;
}

function fmtSignedMoney(value, currency) {
  if (!isFinite(value)) return '—';
  if (privacyOn()) return fmtMoney(value, currency);
  const s = fmtMoney(value, currency);
  return value > 0 ? '+' + s : s;
}

function trendClass(v) {
  if (!isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(iso, months) {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso.replace(' ', 'T'));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  return parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
}

let toastTimer = null;
function toast(message, kind = 'info', ms = 4000) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), ms);
}
