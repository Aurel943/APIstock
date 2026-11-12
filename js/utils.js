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

/** Parité d'une division : « 10 », « 1:10 » ou « 1/10 » (1 ancienne → 10 nouvelles), « 10:1 » pour un regroupement */
function parseSplit(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  const m = s.match(/^(\d+(?:[.,]\d+)?)[:/](\d+(?:[.,]\d+)?)$/);
  if (m) { const a = parseNum(m[1]), b = parseNum(m[2]); return a > 0 && b > 0 ? b / a : NaN; }
  return parseNum(s);
}

/** « 1 → 10 » pour une division, « 10 → 1 » pour un regroupement */
function fmtSplit(r) {
  r = parseNum(r);
  if (!(r > 0)) return '—';
  return r >= 1 ? '1 → ' + fmtNum(r, Number.isInteger(r) ? 0 : 2) : fmtNum(1 / r, Number.isInteger(1 / r) ? 0 : 2) + ' → 1';
}

let toastTimer = null;
/** Message temporaire ; `action` ({ label, fn }) ajoute un bouton (ex. « Annuler ») */
function toast(message, kind = 'info', ms = 4000, action = null) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { clearTimeout(toastTimer); t.className = 'toast'; action.fn(); });
    t.append(b);
  }
  t.className = 'toast show ' + kind + (action ? ' has-action' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), ms);
}

/** Suppression annulable : le bandeau propose « Annuler » pendant quelques secondes */
function undoToast(message, restore, ms = 7000) {
  toast(message, 'info', ms, { label: 'Annuler', fn: () => { restore(); toast('Suppression annulée', 'success', 2000); } });
}

/*
 * Nom court et lisible d'un fonds, à partir de son nom officiel :
 * « Amundi PEA S&P 500 UCITS ETF Acc » → « Amundi PEA S&P 500 ».
 * On retire le jargon réglementaire (UCITS, ETF, Acc/Dist, devise de part…) qui n'aide pas à reconnaître le produit.
 */
function friendlyName(name, symbol) {
  let s = String(name || '').trim();
  if (!s || s.toUpperCase() === String(symbol || '').toUpperCase()) return '';
  // « Amundi Index Solutions - Amundi MSCI World … » : garder la partie qui nomme le fonds
  const dash = s.split(/\s+[-–]\s+/);
  if (dash.length > 1 && dash[1].split(' ')[0].toLowerCase() === dash[0].split(' ')[0].toLowerCase()) s = dash.slice(1).join(' - ');
  s = s.replace(/\([^)]*\)/g, ' ')
    .replace(/\b(UCITS|ETFs?|ETP|Trust|SICAV|FCP|Fund|Class|Shares?|Acc|Accumulating|Dist|Distributing|Inc|Capitalisation|Capitalisante|Distribution|Distribuante)\b\.?/gi, ' ')
    .replace(/\b(EUR|USD|GBP|CHF|JPY)\b(?!\s*(Hedged|Hdg|Couvert))/g, ' ')
    .replace(/(\s+\b\d?[A-D]\b)+\s*$/i, ' ')
    .replace(/[\s\-–,·/]+$/g, '').replace(/^[\s\-–,·/]+/, '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  return s.length > 40 ? s.slice(0, 39).trimEnd() + '…' : s;
}
