/* Persistance locale (localStorage) : réglages, instruments, transactions, watchlist */
'use strict';

const STORE_KEY = 'apistock:v1';

/*
 * Fiscalité : tous les taux utilisés par le site, au même endroit.
 * Valeurs par défaut pour les revenus 2026, modifiables dans Réglages → Fiscalité (Store.state.settings.tax).
 * Sources : loi n° 2025-1403 du 30 décembre 2025 de financement de la sécurité sociale pour 2026 (art. 12 : CSG sur les
 * revenus du capital portée de 9,2 % à 10,6 %), impots.gouv.fr (PFU de 31,4 % = 12,8 % + 18,6 % ; PEA de plus de 5 ans :
 * 18,6 % de prélèvements sociaux), rapport du Sénat sur le PLFSS 2026 (contrats d'assurance-vie rachetables maintenus à 17,2 %).
 */
const TAX_DEFAULTS = {
  year: 2026,
  source: 'LFSS 2026 (loi n° 2025-1403 du 30 déc. 2025, art. 12), impots.gouv.fr',
  ir: 12.8,          // impôt sur le revenu au prélèvement forfaitaire unique (PFU)
  social: 18.6,      // prélèvements sociaux sur les revenus du capital (compte-titres, PEA, PER)
  socialAv: 17.2,    // prélèvements sociaux de l'assurance-vie (contrats rachetables : hors hausse 2026)
  avIr8: 7.5,        // impôt sur le revenu d'une assurance-vie de plus de 8 ans, au-delà de l'abattement
  peaCap: 150000,    // plafond des versements sur un PEA
};
const TAX_FIELDS = ['ir', 'social', 'socialAv', 'avIr8', 'peaCap'];

/** Taux en vigueur (valeurs par défaut, remplacées par celles saisies dans Réglages) ; pfu = ir + social */
function taxConf() {
  const c = Object.assign({}, TAX_DEFAULTS);
  const o = (typeof Store !== 'undefined' && Store.state && Store.state.settings && Store.state.settings.tax) || {};
  for (const k of TAX_FIELDS) if (isFinite(parseNum(o[k])) && parseNum(o[k]) >= 0) c[k] = parseNum(o[k]);
  c.custom = TAX_FIELDS.some(k => c[k] !== TAX_DEFAULTS[k]);
  c.pfu = Math.round((c.ir + c.social) * 100) / 100;
  return c;
}

/** Taux d'imposition des gains par défaut d'un type de compte */
function taxRateFor(type, c = taxConf()) {
  return { pea: c.social, cto: c.pfu, per: c.pfu, av: Math.round((c.avIr8 + c.socialAv) * 100) / 100 }[type] || 0;
}
/** Taux appliqués avant la LFSS 2026 (comptes créés avec une ancienne version) */
const LEGACY_ACCOUNT_RATES = { pea: 17.2, cto: 30, per: 30, av: 24.7, autre: 0 };

const DEFAULT_STATE = {
  settings: {
    apiKey: '',
    yahooProxy: '',
    baseCurrency: 'EUR',
    refreshSec: 60,
    creditsPerMin: 8,
    taxMode: 'none',   // none | pea | cto | custom
    taxRate: 0,
  },
  targets: {},       // key -> % cible
  alerts: [],        // { id, key, kind: 'above'|'below'|'dayUp'|'dayDown', value, active, triggeredAt }
  instruments: {},   // key -> { symbol, mic, exchange, name, currency, type }
  transactions: [],  // { id, key, type: 'buy'|'sell'|'div'|'split', date, qty (parité pour 'split'), price, fees, note }
  cashMoves: [],     // { id, account, type: 'deposit'|'withdraw', date, amount (devise de base), note }
  plans: [],         // versements programmés { id, key, account, amount, day, start, fractional, active, done: { 'AAAA-MM': idOpération | 'skip' } }
  watchlist: [],     // [key]
  deleted: {},       // id -> horodatage de suppression (synchronisation : un élément supprimé ne réapparaît pas)
  restored: {},      // id -> horodatage d'annulation d'une suppression (l'emporte sur une suppression plus ancienne)
  sim: null,         // derniers paramètres de simulation
  projection: null,
};

const Store = {
  state: null,

  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    this.state = Object.assign(structuredClone(DEFAULT_STATE), saved || {});
    this.state.settings = Object.assign({}, DEFAULT_STATE.settings, (saved && saved.settings) || {});
    this.state.targets = this.state.targets || {};
    this.state.alerts = this.state.alerts || [];
    if (!Array.isArray(this.state.cashMoves)) this.state.cashMoves = [];
    if (!Array.isArray(this.state.plans)) this.state.plans = [];
    for (const k of ['deleted', 'restored']) if (!this.state[k] || typeof this.state[k] !== 'object' || Array.isArray(this.state[k])) this.state[k] = {};
    this.purgeTombstones();
    // comptes (PEA, CTO…) : migration depuis l'ancien réglage fiscal unique
    if (!Array.isArray(this.state.accounts) || !this.state.accounts.length) {
      const st = this.state.settings;
      const type = st.taxMode === 'pea' ? 'pea' : st.taxMode === 'cto' ? 'cto' : 'autre';
      this.state.accounts = [{ id: 'main', name: type === 'pea' ? 'PEA' : type === 'cto' ? 'Compte-titres' : 'Compte principal', type,
        taxRate: st.taxMode && st.taxMode !== 'none' ? parseNum(st.taxRate) || 0 : 0 }];
    }
    this.syncAccountRates();
    if (typeof Portfolio !== 'undefined') Portfolio.invalidate();
    if (!this.state.accountFilter || (this.state.accountFilter !== 'all' && !this.state.accounts.some(a => a.id === this.state.accountFilter))) this.state.accountFilter = 'all';
    return this.state;
  },

  /**
   * Met à jour le taux des comptes restés sur le taux par défaut de leur type quand les taux changent
   * (nouvelle loi, ou modification dans Réglages) ; un taux personnalisé n'est jamais touché.
   */
  syncAccountRates() {
    const st = this.state.settings;
    const prev = st.taxApplied || LEGACY_ACCOUNT_RATES;
    const now = {};
    for (const t of Object.keys(LEGACY_ACCOUNT_RATES)) now[t] = taxRateFor(t);
    let changed = false;
    for (const a of this.state.accounts) {
      if (prev[a.type] !== undefined && Math.abs(parseNum(a.taxRate) - prev[a.type]) < 1e-9 && a.taxRate !== now[a.type]) { a.taxRate = now[a.type]; changed = true; }
    }
    if (JSON.stringify(prev) !== JSON.stringify(now)) { st.taxApplied = now; changed = true; }
    return changed;
  },

  save() {
    if (typeof Portfolio !== 'undefined') Portfolio.invalidate(); // données modifiées : instantanés à recalculer
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); }
    catch (e) { toast('Impossible de sauvegarder localement : ' + e.message, 'error'); }
  },

  key(symbol, mic) { return symbol.toUpperCase() + '@' + (mic || '').toUpperCase(); },

  upsertInstrument(info) {
    const key = this.key(info.symbol, info.mic);
    const prev = this.state.instruments[key] || {};
    this.state.instruments[key] = Object.assign({}, prev, {
      symbol: info.symbol.toUpperCase(),
      mic: (info.mic || '').toUpperCase(),
      exchange: info.exchange || prev.exchange || '',
      name: info.name || prev.name || info.symbol,
      currency: info.currency || prev.currency || this.state.settings.baseCurrency,
      type: info.type || prev.type || '',
      provider: info.provider || prev.provider || 'twelve',
      ysymbol: info.ysymbol || prev.ysymbol || '',
      short: info.short || prev.short || '',
      isin: info.isin || prev.isin || '',
    });
    this.save();
    return key;
  },

  instrument(key) { return this.state.instruments[key]; },

  defaultAccount() { return this.state.accounts[0].id; },
  account(id) { return this.state.accounts.find(a => a.id === id) || this.state.accounts[0]; },

  label(key) {
    const i = this.instrument(key);
    if (!i) return key;
    if (i.short) return i.short;
    return i.symbol + (i.mic ? ' · ' + i.mic : '');
  },

  addTransaction(tx) {
    tx.id = tx.id || uid();
    this.state.transactions.push(tx);
    this.save();
  },

  updateTransaction(id, patch) {
    const t = this.state.transactions.find(x => x.id === id);
    if (t) Object.assign(t, patch);
    this.save();
  },

  removeTransaction(id) {
    this.state.transactions = this.state.transactions.filter(t => t.id !== id);
    this.markDeleted(id);
    this.save();
  },

  /* ---- Suppressions mémorisées pour la synchronisation (opérations, espèces, versements, alertes, comptes…) ---- */
  TOMBSTONE_DAYS: 180,
  markDeleted(id) {
    if (!id) return;
    this.state.deleted[id] = Date.now();
    delete this.state.restored[id];
  },
  /** « Annuler » : l'entrée est retirée, et l'annulation est datée pour l'emporter sur la suppression déjà envoyée */
  unmarkDeleted(id) {
    if (!id) return;
    delete this.state.deleted[id];
    this.state.restored[id] = Date.now();
  },
  purgeTombstones(now = Date.now()) {
    const limit = now - this.TOMBSTONE_DAYS * 864e5;
    for (const k of ['deleted', 'restored']) for (const [id, ts] of Object.entries(this.state[k] || {})) if (!(ts > limit)) delete this.state[k][id];
  },

  toggleWatch(key, on) {
    const has = this.state.watchlist.includes(key);
    if (on === undefined) on = !has;
    if (on && !has) this.state.watchlist.push(key);
    if (!on && has) this.state.watchlist = this.state.watchlist.filter(k => k !== key);
    this.save();
  },

  /** Tous les instruments utilisés (portefeuille + watchlist) */
  trackedKeys() {
    const set = new Set(this.state.watchlist);
    for (const t of this.state.transactions) set.add(t.key);
    for (const k of Object.keys(this.state.targets || {})) set.add(k);
    for (const a of this.state.alerts || []) if (a.active) set.add(a.key);
    for (const p of this.state.plans || []) if (p.active !== false) set.add(p.key);
    return Array.from(set).filter(k => this.state.instruments[k]);
  },

  exportJSON() {
    const data = structuredClone(this.state);
    data.settings.apiKey = ''; // on n'exporte pas la clé
    return JSON.stringify({ app: 'apistock', version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
  },

  importJSON(text) {
    const parsed = JSON.parse(text);
    const data = parsed.data || parsed;
    if (!data.instruments || !Array.isArray(data.transactions)) throw new Error('Fichier non reconnu');
    const apiKey = this.state.settings.apiKey;
    this.state = Object.assign(structuredClone(DEFAULT_STATE), data);
    this.state.settings = Object.assign({}, DEFAULT_STATE.settings, data.settings || {}, { apiKey });
    this.save();
    this.load(); // mêmes migrations qu'au démarrage
  },
};
