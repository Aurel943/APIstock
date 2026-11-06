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
  },
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
    });
    this.save();
    return key;
  },

  instrument(key) { return this.state.instruments[key]; },

  label(key) {
    const i = this.instrument(key);
    if (!i) return key;
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
