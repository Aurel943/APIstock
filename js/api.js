/* Client Twelve Data : file d'attente limitée en crédits/minute + caches */
'use strict';

const API_BASE = 'https://api.twelvedata.com';

class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const Api = {
  callLog: [],          // timestamps des appels sur la dernière minute
  queue: Promise.resolve(),
  quotes: {},           // key -> { data, ts }
  fx: {},               // 'USD/EUR' -> { rate, ts }
  intraday: {},         // cache mémoire court pour l'intraday
  listeners: new Set(),

  init() {
    try { this.quotes = JSON.parse(localStorage.getItem('apistock:quotes') || '{}'); } catch (e) { this.quotes = {}; }
    try { this.fx = JSON.parse(localStorage.getItem('apistock:fx') || '{}'); } catch (e) { this.fx = {}; }
  },

  onUsage(fn) { this.listeners.add(fn); },
  emitUsage() {
    const now = Date.now();
    this.callLog = this.callLog.filter(t => now - t < 60000);
    for (const fn of this.listeners) fn(this.callLog.length, this.limit());
  },

  limit() { return Math.max(1, parseInt(Store.state.settings.creditsPerMin, 10) || 8); },

  hasKey() { return !!(Store.state.settings.apiKey || '').trim(); },

  async waitForSlot() {
    for (;;) {
      const now = Date.now();
      this.callLog = this.callLog.filter(t => now - t < 60000);
      if (this.callLog.length < this.limit()) { this.callLog.push(now); this.emitUsage(); return; }
      const wait = 60000 - (now - this.callLog[0]) + 250;
      this.emitUsage();
      await new Promise(r => setTimeout(r, wait));
    }
  },

  /** Appel brut sérialisé et limité */
  request(endpoint, params = {}) {
    const run = async () => {
      if (!this.hasKey()) throw new ApiError('Clé API Twelve Data manquante — ajoute-la dans Réglages.', 401);
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.waitForSlot();
        const url = new URL(API_BASE + '/' + endpoint);
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
        url.searchParams.set('apikey', Store.state.settings.apiKey.trim());
        let res, json;
        try {
          res = await fetch(url.toString());
          json = await res.json();
        } catch (e) {
          throw new ApiError('Erreur réseau : ' + e.message, 0);
        }
        if (json && json.status === 'error') {
          if (json.code === 429 && attempt === 0) {
            // quota minute dépassé : on remplit le compteur et on réessaie à la minute suivante
            const now = Date.now();
            this.callLog = Array(this.limit()).fill(now);
            continue;
          }
          throw new ApiError(json.message || 'Erreur API', json.code);
        }
        return json;
      }
      throw new ApiError('Limite de requêtes atteinte, réessaie dans une minute.', 429);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  },

  instParams(key) {
    const i = Store.instrument(key);
    const p = { symbol: i ? i.symbol : key.split('@')[0] };
    if (i && i.mic) p.mic_code = i.mic;
    return p;
  },

  async search(query) {
    const json = await this.request('symbol_search', { symbol: query, outputsize: 30 });
    return json.data || [];
  },

  /** Cotation temps réel (dernier prix, variation du jour…) */
  async quote(key) {
    const q = await this.request('quote', this.instParams(key));
    const data = {
      price: parseNum(q.close),
      previousClose: parseNum(q.previous_close),
      change: parseNum(q.change),
      percentChange: parseNum(q.percent_change),
      open: parseNum(q.open), high: parseNum(q.high), low: parseNum(q.low),
      volume: parseNum(q.volume),
      isOpen: !!q.is_market_open,
      datetime: q.datetime,
      currency: q.currency,
      name: q.name,
      exchange: q.exchange,
      low52: q.fifty_two_week ? parseNum(q.fifty_two_week.low) : NaN,
      high52: q.fifty_two_week ? parseNum(q.fifty_two_week.high) : NaN,
    };
    this.quotes[key] = { data, ts: Date.now() };
    const inst = Store.instrument(key);
    if (inst && ((q.currency && inst.currency !== q.currency) || (q.name && inst.name === inst.symbol))) {
      Store.upsertInstrument({ symbol: inst.symbol, mic: inst.mic, currency: q.currency || inst.currency, name: q.name || inst.name, exchange: q.exchange });
    }
    this.persistQuotes();
    return data;
  },

  persistQuotes() {
    try { localStorage.setItem('apistock:quotes', JSON.stringify(this.quotes)); } catch (e) { /* ignore */ }
  },

  cachedQuote(key) { return this.quotes[key] ? this.quotes[key].data : null; },
  quoteAge(key) { return this.quotes[key] ? Date.now() - this.quotes[key].ts : Infinity; },

  /** Taux de change de `from` vers la devise de base (cache 1 h) */
  async fxRate(from) {
    const base = Store.state.settings.baseCurrency;
    if (!from || from === base) return 1;
    if (from === 'GBp') return (await this.fxRate('GBP')) / 100;
    if (from === 'GBX') return (await this.fxRate('GBP')) / 100;
    const pair = from + '/' + base;
    const c = this.fx[pair];
    if (c && Date.now() - c.ts < 3600 * 1000) return c.rate;
    try {
      const json = await this.request('exchange_rate', { symbol: pair });
      const rate = parseNum(json.rate);
      if (isFinite(rate) && rate > 0) {
        this.fx[pair] = { rate, ts: Date.now() };
        try { localStorage.setItem('apistock:fx', JSON.stringify(this.fx)); } catch (e) { /* ignore */ }
        return rate;
      }
    } catch (e) {
      if (c) return c.rate;
      throw e;
    }
    return c ? c.rate : NaN;
  },

  /** Taux en cache (synchrone), NaN si inconnu */
  fxCached(from) {
    const base = Store.state.settings.baseCurrency;
    if (!from || from === base) return 1;
    if (from === 'GBp' || from === 'GBX') return this.fxCached('GBP') / 100;
    const c = this.fx[from + '/' + base];
    return c ? c.rate : NaN;
  },

  /**
   * Historique journalier [[date, close], …] trié par date croissante depuis startDate.
   * Mis en cache dans localStorage (6 h) pour économiser les crédits.
   */
  async daily(key, startDate) {
    const cacheKey = 'apistock:daily:' + key;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) { cached = null; }
    const fresh = cached && Date.now() - cached.ts < 6 * 3600 * 1000;
    if (fresh && cached.start <= startDate) return cached.values.filter(v => v[0] >= startDate);

    const start = cached && cached.start < startDate ? cached.start : startDate;
    const json = await this.request('time_series', Object.assign(this.instParams(key), {
      interval: '1day', start_date: start, outputsize: 5000, order: 'asc',
    }));
    const values = (json.values || []).map(v => [v.datetime.slice(0, 10), parseNum(v.close)]).filter(v => isFinite(v[1]));
    values.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const record = { ts: Date.now(), start, values };
    try { localStorage.setItem(cacheKey, JSON.stringify(record)); }
    catch (e) { this.pruneSeriesCache(); try { localStorage.setItem(cacheKey, JSON.stringify(record)); } catch (e2) { /* ignore */ } }
    return values.filter(v => v[0] >= startDate);
  },

  pruneSeriesCache() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('apistock:daily:')) localStorage.removeItem(k);
    }
  },

  /** Série pour les graphiques de détail (intraday ou journalière) */
  async chartSeries(key, range) {
    const cfg = {
      '1J': { interval: '5min', outputsize: 120 },
      '5J': { interval: '30min', outputsize: 90 },
      '1M': { days: 31 }, '6M': { days: 183 }, '1A': { days: 366 }, '5A': { days: 1830 }, 'MAX': { days: 365 * 20 },
    }[range];
    if (cfg.interval) {
      const ck = key + range;
      const c = this.intraday[ck];
      if (c && Date.now() - c.ts < 120000) return c.values;
      const json = await this.request('time_series', Object.assign(this.instParams(key), {
        interval: cfg.interval, outputsize: cfg.outputsize, order: 'asc',
      }));
      const values = (json.values || []).map(v => [v.datetime.slice(5, 16), parseNum(v.close)]);
      this.intraday[ck] = { ts: Date.now(), values };
      return values;
    }
    return this.daily(key, addDaysISO(todayISO(), -cfg.days));
  },
};
