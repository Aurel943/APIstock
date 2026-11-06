/* Persistance locale (localStorage) : réglages, instruments, transactions, watchlist */
'use strict';

const STORE_KEY = 'apistock:v1';

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
  transactions: [],  // { id, key, type: 'buy'|'sell', date, qty, price, fees }
  watchlist: [],     // [key]
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
    // comptes (PEA, CTO…) : migration depuis l'ancien réglage fiscal unique
    if (!Array.isArray(this.state.accounts) || !this.state.accounts.length) {
      const st = this.state.settings;
      const type = st.taxMode === 'pea' ? 'pea' : st.taxMode === 'cto' ? 'cto' : 'autre';
      this.state.accounts = [{ id: 'main', name: type === 'pea' ? 'PEA' : type === 'cto' ? 'Compte-titres' : 'Compte principal', type,
        taxRate: st.taxMode && st.taxMode !== 'none' ? parseNum(st.taxRate) || 0 : 0 }];
    }
    if (!this.state.accountFilter || (this.state.accountFilter !== 'all' && !this.state.accounts.some(a => a.id === this.state.accountFilter))) this.state.accountFilter = 'all';
    return this.state;
  },

  save() {
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
    this.save();
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
  },
};
