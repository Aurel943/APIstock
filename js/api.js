/* Client Twelve Data : file d'attente limitée en crédits/minute + caches */
'use strict';

const API_BASE = 'https://api.twelvedata.com';

/* Correspondances places de cotation : code Yahoo <-> MIC <-> suffixe Yahoo */
const YAHOO_EX_TO_MIC = {
  PAR: 'XPAR', AMS: 'XAMS', BRU: 'XBRU', LIS: 'XLIS', MIL: 'XMIL', GER: 'XETR', FRA: 'XFRA', STU: 'XSTU',
  MUN: 'XMUN', DUS: 'XDUS', HAM: 'XHAM', BER: 'XBER', LSE: 'XLON', EBS: 'XSWX', MCE: 'XMAD', STO: 'XSTO',
  CPH: 'XCSE', HEL: 'XHEL', OSL: 'XOSL', VIE: 'XWBO', IRL: 'XDUB', TOR: 'XTSE',
  NYQ: 'XNYS', NMS: 'XNAS', NGM: 'XNAS', NCM: 'XNAS', PCX: 'ARCX', ASE: 'XASE', BTS: 'BATS',
};
const MIC_TO_YAHOO_SUFFIX = {
  XPAR: '.PA', XAMS: '.AS', XBRU: '.BR', XLIS: '.LS', XMIL: '.MI', XETR: '.DE', XFRA: '.F', XSTU: '.SG',
  XMUN: '.MU', XDUS: '.DU', XHAM: '.HM', XBER: '.BE', XLON: '.L', XSWX: '.SW', XMAD: '.MC', XSTO: '.ST',
  XCSE: '.CO', XHEL: '.HE', XOSL: '.OL', XWBO: '.VI', XDUB: '.IR', XTSE: '.TO',
  XNYS: '', XNAS: '', XNGS: '', XNCM: '', XNMS: '', ARCX: '', XASE: '', BATS: '',
};
const US_MICS = new Set(['XNYS', 'XNAS', 'XNGS', 'XNCM', 'XNMS', 'ARCX', 'XASE', 'BATS']);
const EXCHANGE_CCY = { XPAR: 'EUR', XAMS: 'EUR', XBRU: 'EUR', XLIS: 'EUR', XMIL: 'EUR', XETR: 'EUR', XFRA: 'EUR', XSTU: 'EUR', XMUN: 'EUR', XDUS: 'EUR', XHAM: 'EUR', XBER: 'EUR', XMAD: 'EUR', XHEL: 'EUR', XWBO: 'EUR', XDUB: 'EUR', XSWX: 'CHF', XSTO: 'SEK', XCSE: 'DKK', XOSL: 'NOK', XTSE: 'CAD' };

/* Raccourcis : matières premières, devises, crypto, indices (via Yahoo) */
const QUICK_ASSETS = [
  { y: 'BZ=F', short: 'Brent', name: 'Pétrole Brent (contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['petrole', 'brent', 'baril', 'oil'] },
  { y: 'CL=F', short: 'WTI', name: 'Pétrole WTI (contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['petrole', 'wti', 'baril', 'oil'] },
  { y: 'GC=F', short: 'Or', name: 'Or (once, contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['or', 'gold'] },
  { y: 'SI=F', short: 'Argent', name: 'Argent (once, contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['argent', 'silver'] },
  { y: 'NG=F', short: 'Gaz naturel', name: 'Gaz naturel (contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['gaz', 'gas'] },
  { y: 'HG=F', short: 'Cuivre', name: 'Cuivre (contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['cuivre', 'copper'] },
  { y: 'ZW=F', short: 'Blé', name: 'Blé (contrat à terme)', ccy: 'USD', type: 'Matière première', words: ['ble', 'wheat'] },
  { y: 'BTC-EUR', short: 'Bitcoin', name: 'Bitcoin en euros', ccy: 'EUR', type: 'Crypto', words: ['bitcoin', 'btc', 'crypto'] },
  { y: 'ETH-EUR', short: 'Ethereum', name: 'Ethereum en euros', ccy: 'EUR', type: 'Crypto', words: ['ethereum', 'eth', 'crypto'] },
  { y: 'EURUSD=X', short: 'EUR/USD', name: 'Euro / Dollar US', ccy: 'USD', type: 'Devise', words: ['eurusd', 'euro', 'dollar', 'devise'] },
  { y: '^FCHI', short: 'CAC 40', name: 'Indice CAC 40', ccy: 'EUR', type: 'Indice', words: ['cac', 'cac40'] },
  { y: '^GSPC', short: 'S&P 500', name: 'Indice S&P 500', ccy: 'USD', type: 'Indice', words: ['sp500', 'snp', 's&p'] },
  { y: '^IXIC', short: 'Nasdaq', name: 'Indice Nasdaq Composite', ccy: 'USD', type: 'Indice', words: ['nasdaq'] },
  { y: '^GDAXI', short: 'DAX', name: 'Indice DAX', ccy: 'EUR', type: 'Indice', words: ['dax'] },
  { y: '^STOXX50E', short: 'Euro Stoxx 50', name: 'Indice Euro Stoxx 50', ccy: 'EUR', type: 'Indice', words: ['stoxx', 'eurostoxx'] },
];
const YAHOO_TYPE_FR = { FUTURE: 'Matière première', INDEX: 'Indice', CURRENCY: 'Devise', CRYPTOCURRENCY: 'Crypto', EQUITY: 'Action', ETF: 'ETF', MUTUALFUND: 'Fonds' };
/* traductions pour la recherche Yahoo (qui attend de l'anglais) */
const SEARCH_FR = { petrole: 'crude oil', or: 'gold', argent: 'silver', gaz: 'natural gas', cuivre: 'copper', ble: 'wheat', mais: 'corn', cafe: 'coffee', sucre: 'sugar', platine: 'platinum' };

function yahooSymbolFor(inst) {
  if (inst.ysymbol) return inst.ysymbol;
  const suf = MIC_TO_YAHOO_SUFFIX[inst.mic];
  return suf === undefined ? null : inst.symbol + suf;
}

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
  autoProxy: '',       // relais détecté automatiquement (site hébergé avec /api/yahoo)
  proxyUrl() { return (Store.state.settings.yahooProxy || '').trim() || this.autoProxy; },
  hasProxy() { return !!this.proxyUrl(); },
  ready() { return this.hasKey() || this.hasProxy(); },
  provider(key) {
    const i = Store.instrument(key);
    if (i && i.provider !== 'yahoo' && !this.hasKey() && this.hasProxy()) this.switchToYahoo(key);
    return i && i.provider === 'yahoo' ? 'yahoo' : 'twelve';
  },

  /** Détecte un relais Yahoo servi par le même site (ex. déploiement Vercel avec api/yahoo.js) */
  async detectProxy() {
    if (location.protocol === 'file:') return;
    try {
      const res = await fetch('api/yahoo?type=ping');
      const j = await res.json();
      if (j && j.ok) this.autoProxy = new URL('api/yahoo', location.href).toString();
    } catch (e) { /* pas de relais local */ }
  },

  /** Appel au relais Yahoo Finance (pas de crédits consommés) */
  async yahoo(params, proxyOverride) {
    const base = proxyOverride || this.proxyUrl();
    if (!base) throw new ApiError('Relais Yahoo non configuré — voir Réglages.', 0);
    const url = new URL(base, location.href);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    let json;
    try {
      const res = await fetch(url.toString());
      json = await res.json();
    } catch (e) {
      throw new ApiError('Relais Yahoo injoignable : ' + e.message, 0);
    }
    if (json && json.error) throw new ApiError('Yahoo : ' + (json.error.description || json.error.message || json.error), 0);
    if (json && json.chart && json.chart.error) throw new ApiError('Yahoo : ' + (json.chart.error.description || 'symbole introuvable'), 404);
    return json;
  },

  async yahooChart(key, params) {
    const inst = Store.instrument(key);
    const ysym = yahooSymbolFor(inst);
    if (!ysym) throw new ApiError('Symbole Yahoo inconnu pour ' + Store.label(key), 404);
    const json = await this.yahoo(Object.assign({ type: 'chart', symbol: ysym }, params));
    const r = json.chart && json.chart.result && json.chart.result[0];
    if (!r) throw new ApiError('Yahoo : aucune donnée pour ' + ysym, 404);
    return r;
  },

  /** Bascule un instrument Twelve Data vers Yahoo (ex. symbole non couvert par le forfait gratuit) */
  switchToYahoo(key) {
    const inst = Store.instrument(key);
    if (!inst || !this.hasProxy()) return false;
    const ysym = yahooSymbolFor(inst);
    if (!ysym) return false;
    inst.provider = 'yahoo';
    inst.ysymbol = ysym;
    Store.save();
    return true;
  },

  isPlanError(e) { return /plan|upgrad|grow|venture|pro\b|not available|subscription/i.test(e.message || ''); },

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

  /** Recherche combinée Yahoo + Twelve Data, résultats normalisés */
  async search(query) {
    const out = [];
    const errors = [];
    const norm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9&]/g, '');
    if (this.hasProxy()) {
      // raccourcis correspondant aux mots tapés (« pétrole », « or », « cac »…)
      for (const a of QUICK_ASSETS) {
        if (a.words.some(w => norm === w || (norm.length >= 3 && w.startsWith(norm))) || norm === a.y.toLowerCase().replace(/[^a-z0-9&]/g, '')) {
          out.push({ source: 'yahoo', provider: 'yahoo', ysymbol: a.y, symbol: a.y, mic: '', exchange: a.type, name: a.name, short: a.short, currency: a.ccy, type: a.type, country: '' });
        }
      }
      try {
        const json = await this.yahoo({ type: 'search', q: SEARCH_FR[norm] || query });
        for (const q of json.quotes || []) {
          if (!q.symbol || !q.quoteType || q.quoteType === 'OPTION') continue;
          if (out.some(o => o.ysymbol === q.symbol)) continue;
          // contrats à terme, indices, devises, crypto : pas de place de cotation au sens MIC
          const special = ['FUTURE', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY'].includes(q.quoteType);
          if (special) {
            out.push({ source: 'yahoo', provider: 'yahoo', ysymbol: q.symbol, symbol: q.symbol, mic: '', exchange: q.exchDisp || q.exchange,
              name: q.longname || q.shortname || q.symbol, currency: '', type: YAHOO_TYPE_FR[q.quoteType] || q.quoteType, country: '' });
            continue;
          }
          const mic = YAHOO_EX_TO_MIC[q.exchange] || q.exchange;
          const base = q.symbol.includes('.') && MIC_TO_YAHOO_SUFFIX[mic] ? q.symbol.slice(0, q.symbol.lastIndexOf('.')) : q.symbol;
          out.push({
            source: 'yahoo', provider: 'yahoo', ysymbol: q.symbol, symbol: base, mic,
            exchange: q.exchDisp || q.exchange, name: q.longname || q.shortname || q.symbol,
            currency: EXCHANGE_CCY[mic] || (US_MICS.has(mic) ? 'USD' : ''), type: YAHOO_TYPE_FR[q.quoteType] || q.typeDisp || q.quoteType, country: '',
          });
        }
      } catch (e) { errors.push(e); }
    }
    if (this.hasKey()) {
      try {
        const json = await this.request('symbol_search', { symbol: query, outputsize: 30 });
        for (const d of json.data || []) {
          const k = Store.key(d.symbol, d.mic_code);
          // si Yahoo propose déjà cet instrument hors USA, on garde Yahoo (gratuit)
          if (out.some(o => Store.key(o.symbol, o.mic) === k)) {
            if (US_MICS.has(d.mic_code)) {
              const i = out.findIndex(o => Store.key(o.symbol, o.mic) === k);
              out.splice(i, 1);
            } else continue;
          }
          out.push({
            source: 'twelve', provider: 'twelve', symbol: d.symbol, mic: d.mic_code, exchange: d.exchange,
            name: d.instrument_name, currency: d.currency, type: d.instrument_type, country: d.country,
          });
        }
      } catch (e) { errors.push(e); }
    }
    if (!out.length && errors.length) throw errors[0];
    return out;
  },

  /** Cotation temps réel (dernier prix, variation du jour…) */
  async quote(key) {
    if (this.provider(key) === 'yahoo') return this.yahooQuote(key);
    let q;
    try {
      q = await this.request('quote', this.instParams(key));
    } catch (e) {
      if (e.code !== 401 && e.code !== 429 && this.isPlanError(e) && this.switchToYahoo(key)) return this.yahooQuote(key);
      throw e;
    }
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

  /** Cotation brute d'un symbole Yahoo (indices, devises, matières premières) — mise en cache 30 s */
  async yahooSymbol(ysym) {
    const ck = 'Y:' + ysym;
    const c = this.quotes[ck];
    if (c && Date.now() - c.ts < 30000) return c.data;
    const json = await this.yahoo({ type: 'chart', symbol: ysym, range: '1d', interval: '5m' });
    const r = json.chart && json.chart.result && json.chart.result[0];
    if (!r) throw new ApiError('Yahoo : aucune donnée pour ' + ysym, 404);
    const data = this.parseYahoo(r);
    this.quotes[ck] = { data, ts: Date.now() };
    return data;
  },

  parseYahoo(r) {
    const m = r.meta;
    const quote = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const closes = (quote.close || []).filter(v => v !== null && isFinite(v));
    const opens = (quote.open || []).filter(v => v !== null);
    const price = m.regularMarketPrice;
    const prev = m.previousClose ?? m.chartPreviousClose;
    const now = Date.now() / 1000;
    const reg = m.currentTradingPeriod && m.currentTradingPeriod.regular;
    const ts = m.regularMarketTime ? new Date(m.regularMarketTime * 1000) : null;
    return {
      price, previousClose: prev, change: price - prev, percentChange: prev ? (price / prev - 1) * 100 : NaN,
      open: opens.length ? opens[0] : NaN, high: m.regularMarketDayHigh, low: m.regularMarketDayLow, volume: m.regularMarketVolume,
      isOpen: !!(reg && now >= reg.start && now < reg.end),
      datetime: ts ? ts.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '',
      time: ts ? +ts : 0,
      currency: m.currency, name: m.longName || m.shortName, exchange: m.fullExchangeName,
      low52: m.fiftyTwoWeekLow, high52: m.fiftyTwoWeekHigh,
      spark: closes,
    };
  },

  async yahooQuote(key) {
    const r = await this.yahooChart(key, { range: '1d', interval: '5m' });
    const m = r.meta;
    const data = this.parseYahoo(r);
    this.quotes[key] = { data, ts: Date.now() };
    const inst = Store.instrument(key);
    if (inst && ((m.currency && inst.currency !== m.currency) || !inst.name || inst.name === inst.symbol)) {
      Store.upsertInstrument({ symbol: inst.symbol, mic: inst.mic, currency: m.currency || inst.currency, name: inst.name && inst.name !== inst.symbol ? inst.name : data.name, exchange: inst.exchange || data.exchange });
    }
    this.persistQuotes();
    return data;
  },

  persistQuotes() {
    const slim = {};
    for (const [k, v] of Object.entries(this.quotes)) if (!k.startsWith('Y:')) slim[k] = { ts: v.ts, data: Object.assign({}, v.data, { spark: undefined }) };
    try { localStorage.setItem('apistock:quotes', JSON.stringify(slim)); } catch (e) { /* ignore */ }
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
      let rate;
      if (this.hasProxy()) {
        const json = await this.yahoo({ type: 'chart', symbol: from + base + '=X', range: '1d', interval: '1d' });
        rate = json.chart.result[0].meta.regularMarketPrice;
      } else {
        const json = await this.request('exchange_rate', { symbol: pair });
        rate = parseNum(json.rate);
      }
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
    let values;
    // clé « Y:<symbole> » : symbole Yahoo brut (indice, devise, matière première)
    const rawY = key.startsWith('Y:') ? key.slice(2) : null;
    if (rawY || this.provider(key) === 'yahoo') {
      const params = { interval: '1d', period1: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000), period2: Math.floor(Date.now() / 1000) + 86400 };
      let r;
      if (rawY) {
        const json = await this.yahoo(Object.assign({ type: 'chart', symbol: rawY }, params));
        r = json.chart && json.chart.result && json.chart.result[0];
        if (!r) throw new ApiError('Yahoo : aucune donnée pour ' + rawY, 404);
      } else {
        r = await this.yahooChart(key, params);
      }
      const closes = (r.indicators.quote[0] || {}).close || [];
      const off = (r.meta.gmtoffset || 0) * 1000;
      values = (r.timestamp || []).map((t, i) => [new Date(t * 1000 + off).toISOString().slice(0, 10), closes[i]])
        .filter(v => v[1] !== null && isFinite(v[1]));
      // dédoublonnage (Yahoo renvoie parfois deux points pour le jour en cours)
      const seen = new Map();
      for (const v of values) seen.set(v[0], v);
      values = Array.from(seen.values());
    } else {
      let json;
      try {
        json = await this.request('time_series', Object.assign(this.instParams(key), {
          interval: '1day', start_date: start, outputsize: 5000, order: 'asc',
        }));
      } catch (e) {
        if (e.code !== 401 && e.code !== 429 && this.isPlanError(e) && this.switchToYahoo(key)) return this.daily(key, startDate);
        throw e;
      }
      values = (json.values || []).map(v => [v.datetime.slice(0, 10), parseNum(v.close)]).filter(v => isFinite(v[1]));
    }
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
      let values;
      if (this.provider(key) === 'yahoo') {
        const r = await this.yahooChart(key, range === '1J' ? { range: '1d', interval: '5m' } : { range: '5d', interval: '30m' });
        const closes = (r.indicators.quote[0] || {}).close || [];
        values = (r.timestamp || []).map((t, i) => {
          const d = new Date(t * 1000);
          const lbl = (range === '5J' ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' : '') +
            d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          return [lbl, closes[i]];
        }).filter(v => v[1] !== null && isFinite(v[1]));
      } else {
        let json;
        try {
          json = await this.request('time_series', Object.assign(this.instParams(key), {
            interval: cfg.interval, outputsize: cfg.outputsize, order: 'asc',
          }));
        } catch (e) {
          if (e.code !== 401 && e.code !== 429 && this.isPlanError(e) && this.switchToYahoo(key)) return this.chartSeries(key, range);
          throw e;
        }
        values = (json.values || []).map(v => [v.datetime.slice(5, 16), parseNum(v.close)]);
      }
      this.intraday[ck] = { ts: Date.now(), values };
      return values;
    }
    return this.daily(key, addDaysISO(todayISO(), -cfg.days));
  },
};
