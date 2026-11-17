/*
 * Agenda financier : toutes les échéances au même endroit (versements programmés, dividendes attendus,
 * publications de résultats des actions suivies, grands rendez-vous macroéconomiques des indices,
 * jours de bourse fermée, jalons PEA / assurance-vie, déclaration fiscale, relevés à saisir),
 * exportables vers l'agenda du téléphone (fichier .ics).
 */
'use strict';

const AGENDA_KINDS = {
  plan: { label: 'Versements', icon: '🗓' },
  div: { label: 'Dividendes', icon: '💶' },
  earn: { label: 'Résultats', icon: '📊' },
  eco: { label: 'Indices & macro', icon: '🌍' },
  market: { label: 'Bourse', icon: '🏛' },
  tax: { label: 'Fiscalité', icon: '🧾' },
  todo: { label: 'Relevés', icon: '✏️' },
};

/*
 * Grands rendez-vous macroéconomiques qui font bouger les indices.
 * Sources officielles, consultées le 17/11/2026 : federalreserve.gov (calendrier FOMC révisé le 12/11/2026),
 * ecb.europa.eu, bankofengland.co.uk, boj.or.jp, bls.gov (CPI et Employment Situation), Eurostat (calendrier provisoire
 * des comptes trimestriels, « QNA release calendar » d'octobre 2026, pour le PIB de la zone euro).
 * À compléter chaque année quand ces institutions publient le calendrier suivant (en général à l'automne).
 * `time` : heure locale de l'annonce dans le fuseau `tz` (convertie en heure de Paris à l'affichage).
 */
const MACRO_CALENDAR = [
  { id: 'fed', flag: '🇺🇸', title: 'Fed : décision sur les taux', tz: 'America/New_York', time: '14:00',
    sub: 'Communiqué puis conférence de presse du président de la Fed 30 min plus tard. Fait bouger le S&P 500, le Nasdaq, le Dow Jones et le dollar, et par ricochet toutes les bourses.',
    dates: ['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-11-17'],
    notes: { '2026-12-09': 'Avec les nouvelles prévisions des membres (« dot plot »).' } },
  { id: 'ecb', flag: '🇪🇺', title: 'BCE : décision sur les taux', tz: 'Europe/Berlin', time: '14:15',
    sub: 'Conférence de presse de la présidente de la BCE à 14h45. Fait bouger le CAC 40, le DAX, l\'Euro Stoxx 50 et l\'euro.',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10', '2027-07-22', '2027-09-09', '2027-10-28', '2027-12-16'] },
  { id: 'boe', flag: '🇬🇧', title: 'Banque d\'Angleterre : décision sur les taux', tz: 'Europe/London', time: '12:00',
    sub: 'Fait bouger le FTSE 100 et la livre sterling.',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-17', '2027-07-29', '2027-09-16', '2027-11-04', '2027-12-16'],
    notes: { '2027-02-04': 'Avec le rapport trimestriel de politique monétaire.', '2027-04-29': 'Avec le rapport trimestriel de politique monétaire.',
      '2027-07-29': 'Avec le rapport trimestriel de politique monétaire.', '2027-11-04': 'Avec le rapport trimestriel de politique monétaire.' } },
  { id: 'boj', flag: '🇯🇵', title: 'Banque du Japon : décision sur les taux', tz: 'Asia/Tokyo',
    sub: 'Annonce en général dans la matinée à Tokyo (la nuit en France). Fait bouger le Nikkei 225 et le yen.',
    dates: ['2026-12-18', '2027-01-22', '2027-03-18', '2027-04-28', '2027-06-11', '2027-07-22', '2027-09-22', '2027-10-29', '2027-12-17'] },
  { id: 'gdpez', flag: '🇪🇺', title: 'Zone euro : croissance du PIB du {trimestre} (première estimation)', tz: 'Europe/Luxembourg', time: '11:00',
    sub: 'Première estimation d\'Eurostat, 30 jours après la fin du trimestre. Peut faire bouger le CAC 40, le DAX, l\'Euro Stoxx 50 et l\'euro. Date provisoire, confirmée par Eurostat la semaine précédente.',
    dates: ['2027-01-29', '2027-04-30', '2027-07-30', '2027-10-29'] },
  { id: 'cpi', flag: '🇺🇸', title: 'États-Unis : inflation (CPI) de {mois}', tz: 'America/New_York', time: '08:30',
    sub: 'Chiffre suivi de près par la Fed : une surprise fait bouger Wall Street et les taux, et souvent les bourses européennes l\'après-midi.',
    dates: ['2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'] },
  { id: 'nfp', flag: '🇺🇸', title: 'États-Unis : rapport sur l\'emploi de {mois}', tz: 'America/New_York', time: '08:30',
    sub: 'Créations d\'emplois et taux de chômage : l\'une des publications qui font le plus bouger les marchés.',
    dates: ['2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'] },
];

const Macro = {
  /** Heure de Paris d'une heure locale (« 14h30 ») */
  parisTime(tz, date, hhmm) {
    const t = Markets.wallToUtc(tz, date, hhmm);
    const p = Markets.parts('Europe/Paris', t);
    return `${p.h}h${String(p.mi).padStart(2, '0')}`;
  },

  /** Troisième vendredi de mars, juin, septembre et décembre */
  witchingDays(from, to) {
    const out = [];
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      for (const m of [3, 6, 9, 12]) {
        const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
        const d = 1 + ((5 - first + 7) % 7) + 14;
        out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    return out.filter(d => d >= from && d <= to);
  },

  events(today, end) {
    const out = [];
    for (const c of MACRO_CALENDAR) {
      for (const d of c.dates) {
        if (d < today || d > end) continue;
        const prev = addMonthsISO(d.slice(0, 7) + '-01', -1);
        const month = new Date(prev + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
        const quarter = `T${Math.ceil(+prev.slice(5, 7) / 3)} ${prev.slice(0, 4)}`;
        const at = c.time ? `À ${this.parisTime(c.tz, d, c.time)} (heure de Paris). ` : '';
        out.push({ date: d, kind: 'eco', title: `${c.flag} ${c.title.replace('{mois}', month).replace('{trimestre}', quarter)}`, sub: at + c.sub + (c.notes && c.notes[d] ? ' ' + c.notes[d] : '') });
      }
    }
    const nyse = (HOLIDAYS.nyse && HOLIDAYS.nyse.closed) || [];
    for (const d of this.witchingDays(today, end)) {
      out.push({ date: d, kind: 'eco', title: '🌍 Quatre sorcières : échéance trimestrielle des options et contrats à terme',
        sub: 'Volumes et volatilité en hausse, surtout en fin de séance. Le soir même, les révisions trimestrielles des indices (S&P 500, Nasdaq-100, CAC 40, Euro Stoxx 50…) prennent effet : entrées et sorties de valeurs.'
          + (nyse.includes(d) ? ' Wall Street est fermée ce jour-là : les échéances américaines sont avancées à la veille.' : '') });
    }
    return out;
  },
};

/*
 * Principales lignes des ETF suivis (pour les résultats des sociétés qui pèsent le plus dans tes ETF).
 * Yahoo ne donne pas la composition de beaucoup d'ETF européens (CW8, ESE…) : on lit celle d'un ETF américain
 * qui suit le même indice (profil de l'ETF, voir Expo dans features.js). Mise à jour hebdomadaire.
 */
const ETF_PROXY = { sp500: 'SPY', ndx: 'QQQ', world: 'URTH', allworld: 'ACWI', em: 'EEM', europe: 'VGK', es50: 'FEZ', cac: 'CAC.PA', japan: 'EWJ' };
const HOLD_STORE = 'apistock:holdings';
const Holdings = {
  TTL: 7 * 86400000,
  TOP: 10,           // lignes retenues par ETF
  cache: null,       // symbole de l'ETF de référence -> { ts, list: [{ sym, name, pct }] }

  load() {
    if (!this.cache) {
      try { this.cache = JSON.parse(localStorage.getItem(HOLD_STORE) || '{}') || {}; } catch (e) { this.cache = {}; }
    }
    return this.cache;
  },
  save() { try { localStorage.setItem(HOLD_STORE, JSON.stringify(this.cache || {})); } catch (e) { /* stockage indisponible */ } },

  /** Nom court d'une société : « Alphabet Inc Class A » → « Alphabet », « Amazon.com Inc » → « Amazon » */
  cleanName(n) {
    const s = String(n || '').replace(/\.com\b/gi, '')
      .replace(/\b(Inc|Corp|Corporation|Co|Ltd|Limited|PLC|SA|SE|AG|NV|Holdings?|Group|Ordinary|Registered|Shares|new|Platforms|Class [A-C]|Cl [A-C])\b\.?/gi, ' ')
      .replace(/[\s,.]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    return s || String(n || '');
  },

  /** ETF suivis (portefeuille et watchlist) dont on sait lire les principales lignes : [{ key, proxy }] */
  etfs() {
    const out = [];
    if (typeof Expo === 'undefined') return out;
    for (const key of Store.trackedKeys()) {
      const proxy = ETF_PROXY[Expo.of(key).profile];
      if (proxy) out.push({ key, proxy });
    }
    return out;
  },

  /** Lignes d'une réponse Yahoo topHoldings, classes d'actions regroupées (Alphabet A + C) */
  parse(th) {
    const by = new Map();
    for (const h of (th && th.holdings) || []) {
      const sym = String(h.symbol || ''), pct = h.holdingPercent && h.holdingPercent.raw * 100;
      if (!sym || !SYMBOL_OK.test(sym) || /^\d+$/.test(sym) || !(pct > 0)) continue;
      const name = this.cleanName(h.holdingName || sym), k = name.toLowerCase();
      const e = by.get(k);
      if (e) e.pct += pct; else by.set(k, { sym, name, pct });
    }
    return Array.from(by.values()).sort((a, b) => b.pct - a.pct).slice(0, this.TOP);
  },

  async refresh(force = false) {
    const c = this.load(), now = Date.now();
    const todo = Array.from(new Set(this.etfs().map(e => e.proxy))).filter(p => force || !c[p] || now - c[p].ts > this.TTL);
    if (!todo.length) return false;
    const json = await Api.yahoo({ type: 'summary', symbols: todo.join(','), modules: 'topHoldings' });
    if (!json || typeof json.results !== 'object' || !json.results) throw new ApiError('requête invalide', 0);
    for (const p of todo) {
      const r = json.results[p];
      c[p] = { ts: now, list: r && r.topHoldings ? this.parse(r.topHoldings) : [] };
    }
    this.save();
    return true;
  },

  /** Sociétés détenues à travers les ETF : symbole -> { sym, name, via: [{ key, pct, value }] } (value : part de ta ligne, devise de base) */
  exposure() {
    const c = this.load(), out = new Map();
    let rows = [];
    try { rows = Portfolio.snapshot('all').rows; } catch (e) { rows = []; }
    for (const { key, proxy } of this.etfs()) {
      const r = rows.find(x => x.key === key);
      const value = r ? (isFinite(r.valueBase) ? r.valueBase : r.costBase) : NaN;
      for (const h of (c[proxy] && c[proxy].list) || []) {
        const e = out.get(h.sym) || { sym: h.sym, name: h.name, via: [] };
        e.via.push({ key, pct: h.pct, value: value > 0 ? value * h.pct / 100 : NaN });
        out.set(h.sym, e);
      }
    }
    return out;
  },
};

/* Publications de résultats des actions suivies et des grandes sociétés de tes ETF (relais Yahoo, type=calendar), gardées 12 h */
const EARN_STORE = 'apistock:earnings';
const REACT_STORE = 'apistock:reactions';
const Earnings = {
  TTL: 12 * 3600000,
  RETRY: 10 * 60000,
  RECENT: 14,       // jours de « publiés récemment »
  cache: null,      // symbole Yahoo -> { ts, data }
  reactions: null,  // « symbole|horodatage de publication » -> { pct, label, date }
  status: '',       // '' | 'loading' | 'old-relay' | 'error'
  holdStatus: '',   // '' | 'old-relay' | 'error' (principales lignes des ETF)
  failedAt: 0,

  load() {
    if (!this.cache) {
      try { this.cache = JSON.parse(localStorage.getItem(EARN_STORE) || '{}') || {}; } catch (e) { this.cache = {}; }
    }
    return this.cache;
  },
  loadReactions() {
    if (!this.reactions) {
      try { this.reactions = JSON.parse(localStorage.getItem(REACT_STORE) || '{}') || {}; } catch (e) { this.reactions = {}; }
    }
    return this.reactions;
  },
  save() {
    const keep = new Set(this.targets().map(t => t.sym)), now = Date.now();
    // on garde aussi quelques jours ce qui a été consulté sur une fiche
    for (const [s, v] of Object.entries(this.cache || {})) if (!keep.has(s) && now - v.ts > 7 * 86400000) delete this.cache[s];
    try { localStorage.setItem(EARN_STORE, JSON.stringify(this.cache || {})); } catch (e) { /* stockage indisponible */ }
    try { localStorage.setItem(REACT_STORE, JSON.stringify(this.reactions || {})); } catch (e) { /* stockage indisponible */ }
  },

  /** Symbole Yahoo d'une action (null pour les ETF, fonds, indices, devises…) */
  stockSymbol(key) {
    const i = Store.instrument(key);
    if (!i || i.provider === 'manual') return null;
    if (/etf|etc|etn|fonds|fund|trust|indice|index|crypto|devise|currency|mati|future|obligation|bond|warrant|turbo/i.test(i.type || '')) return null;
    if (typeof Expo !== 'undefined' && ETF_PROXY[Expo.of(key).profile]) return null;
    const sym = yahooSymbolFor(i);
    return sym && SYMBOL_OK.test(sym) && !/^\^|=|-(EUR|USD)$/.test(sym) ? sym : null;
  },

  /** Place de cotation déduite du symbole Yahoo (sans suffixe : Wall Street) */
  instFor(sym, key) {
    const i = key ? Store.instrument(key) : null;
    if (i) return i;
    return { mic: sym.includes('.') ? '' : 'XNAS', currency: sym.includes('.') ? '' : 'USD' };
  },

  /**
   * Sociétés suivies : actions du portefeuille et de la watchlist, puis principales lignes des ETF suivis.
   * [{ sym, key?, name, inst, via: [{ key, pct, value }] }]
   */
  targets() {
    const out = new Map();
    for (const key of Store.trackedKeys()) {
      const sym = this.stockSymbol(key);
      if (sym && !out.has(sym)) out.set(sym, { sym, key, name: Store.label(key), inst: Store.instrument(key), via: [] });
    }
    for (const [sym, e] of Holdings.exposure()) {
      const t = out.get(sym);
      if (t) t.via = e.via;
      else out.set(sym, { sym, name: e.name, inst: this.instFor(sym), via: e.via });
    }
    return Array.from(out.values());
  },

  /** Recharge les dates périmées ; renvoie true si quelque chose a changé (à réafficher) */
  async refresh(force = false) {
    if (this._busy || !Api.hasProxy()) return false;
    if (!force && Date.now() - this.failedAt < this.RETRY) return false;
    this._busy = true;
    let changed = false;
    try {
      // 1. principales lignes des ETF (appel « summary », relais d'après novembre 2026)
      try { changed = (await Holdings.refresh(force)) || changed; this.holdStatus = ''; }
      catch (e) { this.holdStatus = /requête invalide/i.test(e.message || '') ? 'old-relay' : 'error'; changed = true; }
      // 2. dates de résultats
      const c = this.load(), now = Date.now();
      const todo = this.targets().map(t => t.sym).filter(s => force || !c[s] || now - c[s].ts > this.TTL);
      if (todo.length) {
        this.status = 'loading';
        try {
          for (let i = 0; i < todo.length; i += 20) {
            const chunk = todo.slice(i, i + 20);
            const json = await Api.yahoo({ type: 'calendar', symbols: chunk.join(',') });
            if (!json || typeof json.results !== 'object' || !json.results) throw new ApiError('requête invalide', 0);
            for (const s of chunk) c[s] = { ts: now, data: json.results[s] || null };
          }
          this.status = '';
        } catch (e) {
          // relais pas encore mis à jour : il ne connaît pas « type=calendar »
          this.status = /requête invalide/i.test(e.message || '') ? 'old-relay' : 'error';
          this.error = e.message || '';
          this.failedAt = Date.now();
        }
        changed = true;
      }
      // 3. réaction de l'action après les publications récentes
      changed = (await this.refreshReactions()) || changed;
    } finally {
      this._busy = false;
      this.save();
    }
    return changed;
  },

  /** Données d'une action pour sa fiche : rechargées si absentes ou périmées */
  async ensure(sym) {
    const c = this.load();
    if (c[sym] && Date.now() - c[sym].ts < this.TTL) return c[sym].data;
    if (!Api.hasProxy()) return null;
    const json = await Api.yahoo({ type: 'calendar', symbols: sym });
    c[sym] = { ts: Date.now(), data: (json && json.results && json.results[sym]) || null };
    this.save();
    return c[sym].data;
  },

  /** « ≈ 7,6 % de ton ETF X, 5,2 % de Y (≈ 1 234 € de ton portefeuille) » */
  viaText(via) {
    if (!via || !via.length) return '';
    const cur = Store.state.settings.baseCurrency;
    const parts = via.map(v => `${fmtNum(v.pct, 1)} % de ${via.length === 1 ? 'ton ETF ' : ''}${Store.label(v.key)}`);
    const val = via.reduce((s, v) => s + (isFinite(v.value) ? v.value : 0), 0);
    return `Pèse ${parts.join(', ')}` + (val > 0 ? ` (≈ ${fmtMoney(val, cur, 0)} de ton portefeuille)` : '');
  },

  events(today, end) {
    const c = this.load(), out = [];
    for (const t of this.targets()) {
      const d = c[t.sym] && c[t.sym].data;
      if (!d) continue;
      const via = this.viaText(t.via);
      for (const e of this.eventsFor(d, t.name, t.inst, today, end)) {
        if (via) e.sub = via + '. ' + e.sub;
        e.sym = t.sym;
        out.push(e);
      }
    }
    return out;
  },

  /** « T3 2026 », ou « T3 de l'exercice 2027 » si l'exercice de la société est décalé ; court : « T3 ex. 2027 » */
  quarterLabel(fiscal, calendar, short = false) {
    const f = /^(\d)Q(\d{4})$/.exec(fiscal || ''), cq = /^(\d)Q(\d{4})$/.exec(calendar || '');
    if (!f) return '';
    if (f[1] === (cq && cq[1]) && f[2] === (cq && cq[2])) return `T${f[1]} ${f[2]}`;
    return short ? `T${f[1]} ex. ${f[2]}` : `T${f[1]} de l'exercice ${f[2]}`;
  },

  raw: x => (x && isFinite(x.raw) ? x.raw : null),
  localISO(t) { const x = new Date(t); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
  ccyOf(d, inst = {}) { return (d.earnings && d.earnings.financialCurrency) || inst.currency || 'USD'; },

  /** Trimestres publiés (bénéfice réel connu), du plus ancien au plus récent */
  quarters(d) {
    const ec = (d && d.earnings && d.earnings.earningsChart) || {};
    return (ec.quarterly || []).filter(q => this.raw(q.actual) !== null).sort((a, b) => (this.raw(a.reportedDate) || 0) - (this.raw(b.reportedDate) || 0));
  },

  /** « bénéfice par action 2,22 $ contre 2,09 $ attendu (+6,2 %, au-dessus des attentes) » */
  beat(q, ccy) {
    const a = this.raw(q.actual), e = this.raw(q.estimate), money = v => fmtMoney(v, ccy, 2, true);
    if (a === null) return '';
    return `bénéfice par action ${money(a)}` + (e !== null ? ` contre ${money(e)} attendu (${e ? fmtPct(((a - e) / Math.abs(e)) * 100, 1) + ', ' : ''}${a >= e ? 'au-dessus' : 'en dessous'} des attentes)` : '');
  },

  /** Prochaine publication : { t, day, estimate, dates, quarter, periodEnd } ou null */
  next(d) {
    const ce = (d.calendarEvents && d.calendarEvents.earnings) || {};
    const ec = (d.earnings && d.earnings.earningsChart) || {};
    const dates = (ce.earningsDate && ce.earningsDate.length ? ce.earningsDate : ec.earningsDate || []).map(this.raw).filter(Boolean).map(x => x * 1000);
    if (!dates.length) return null;
    const t = dates[0], pend = this.raw(ec.currentPeriodEndDate);
    // trimestre concerné : clos avant la publication, et au plus 4 mois avant
    const ok = pend && pend * 1000 < t && t - pend * 1000 < 130 * 86400000;
    return { t, day: this.localISO(t), dates, estimate: !!(ce.isEarningsDateEstimate || ec.isEarningsDateEstimate),
      fiscal: ok ? ec.currentFiscalQuarter : '', calendar: ok ? ec.currentCalendarQuarter : '', periodEnd: ok ? pend : null,
      eps: this.raw(ce.earningsAverage) !== null ? this.raw(ce.earningsAverage) : this.raw(ec.currentQuarterEstimate),
      epsLow: this.raw(ce.earningsLow), epsHigh: this.raw(ce.earningsHigh), revenue: this.raw(ce.revenueAverage) };
  },

  /** « Après la clôture de Wall Street (vers 22h00, heure de Paris) » ; horaires fiables seulement pour Wall Street */
  timing(t, inst = {}) {
    if (!US_MICS.has(inst.mic)) return '';
    const p = Markets.parts('America/New_York', t), hm = p.h * 60 + p.mi;
    if (!hm) return '';
    const when = hm < 9 * 60 + 30 ? 'Avant l\'ouverture de Wall Street' : hm >= 16 * 60 ? 'Après la clôture de Wall Street' : 'Pendant la séance';
    const pt = Markets.parts('Europe/Paris', t);
    return `${when} (vers ${pt.h}h${String(pt.mi).padStart(2, '0')}, heure de Paris)`;
  },

  /** Événements d'une société à partir de la réponse Yahoo (calendarEvents + earnings) */
  eventsFor(d, name, inst = {}, today = todayISO(), end = addDaysISO(today, 366)) {
    const ccy = this.ccyOf(d, inst);
    const money = v => fmtMoney(v, ccy, 2, true);
    const big = v => {
      try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: ccy, notation: 'compact', maximumFractionDigits: 1 }).format(v); }
      catch (e) { return fmtNum(v / 1e9, 1) + ' Md ' + ccy; }
    };
    const quarters = this.quarters(d);
    const out = [];

    // résultats publiés aujourd'hui
    for (const q of quarters) {
      const t = this.raw(q.reportedDate);
      if (!t) continue;
      const day = this.localISO(t * 1000);
      if (day < today || day > end) continue;
      const ql = this.quarterLabel(q.fiscalQuarter, q.calendarQuarter);
      out.push({ date: day, kind: 'earn', title: `Résultats publiés${ql ? ' ' + ql : ''} · ${name}`, sub: this.beat(q, ccy).replace(/^./, ch => ch.toUpperCase()) + '.' });
    }

    // prochaine publication
    const n = this.next(d);
    if (!n || n.day < today || n.day > end || out.some(e => e.date === n.day)) return out;
    const ql = this.quarterLabel(n.fiscal, n.calendar);
    const parts = [];
    if (n.estimate) parts.push(n.dates[1] && this.localISO(n.dates[1]) !== n.day ? `Date estimée, entre le ${fmtDate(n.day)} et le ${fmtDate(this.localISO(n.dates[1]))}` : 'Date estimée');
    else if (this.timing(n.t, inst)) parts.push(this.timing(n.t, inst));
    if (n.periodEnd) parts.push(`trimestre clos le ${fmtDate(new Date(n.periodEnd * 1000).toISOString().slice(0, 10))}`);
    if (n.eps !== null) parts.push(`bénéfice par action attendu ${money(n.eps)}` + (n.epsLow !== null && n.epsHigh !== null && n.epsLow !== n.epsHigh ? ` (estimations de ${money(n.epsLow)} à ${money(n.epsHigh)})` : ''));
    if (n.revenue !== null) parts.push(`chiffre d'affaires attendu ${big(n.revenue)}`);
    const last = quarters[quarters.length - 1];
    if (last && this.beat(last, ccy)) parts.push(`trimestre précédent : ${this.beat(last, ccy)}`);
    const sub = parts.map((x, i) => (i ? x : x.replace(/^./, ch => ch.toUpperCase()))).join(' · ');
    out.push({ date: n.day, kind: 'earn', title: `Résultats${ql ? ' ' + ql : ''} · ${name}`, sub: sub ? sub + '.' : 'Date annoncée par la société.' });
    return out;
  },

  /* ---------- publiés récemment et réaction de l'action ---------- */

  /** Publications des `days` derniers jours (avant aujourd'hui), la plus récente d'abord */
  recent(today = todayISO(), days = this.RECENT) {
    const c = this.load(), R = this.loadReactions(), from = addDaysISO(today, -days), out = [];
    for (const t of this.targets()) {
      const d = c[t.sym] && c[t.sym].data;
      if (!d) continue;
      const q = this.quarters(d).pop();
      const ts = q && this.raw(q.reportedDate);
      if (!ts) continue;
      const day = this.localISO(ts * 1000);
      if (day < from || day >= today) continue;
      out.push({ sym: t.sym, name: t.name, via: t.via, inst: t.inst, q, ts, day, ccy: this.ccyOf(d, t.inst), reaction: R[t.sym + '|' + ts] || null });
    }
    return out.sort((a, b) => b.ts - a.ts);
  },

  /**
   * Variation de l'action autour d'une publication, d'après les clôtures quotidiennes ([horodatages s], [clôtures], fuseau de la bourse).
   * Wall Street : après la clôture → clôture du jour à celle du lendemain ; avant l'ouverture → veille au jour même.
   * Ailleurs (horaire peu fiable) : de la veille au lendemain, sur deux séances.
   */
  reactionFrom(ts, closes, tz, t, us, now = Date.now()) {
    const days = [];
    (ts || []).forEach((x, i) => { if (closes[i] > 0) days.push({ d: Markets.parts(tz, x * 1000).date, c: closes[i] }); });
    const p = Markets.parts(tz, t * 1000), D = p.date, hm = p.h * 60 + p.mi;
    const lastBefore = d => days.filter(x => x.d < d).pop(), lastUpTo = d => days.filter(x => x.d <= d).pop(), firstAfter = d => days.find(x => x.d > d);
    let before, after, label;
    if (us && hm >= 16 * 60) { before = lastUpTo(D); after = firstAfter(D); label = 'le lendemain'; }
    else if (us && hm && hm < 9 * 60 + 30) { before = lastBefore(D); after = days.find(x => x.d === D); label = 'le jour même'; }
    else { before = lastBefore(D); after = firstAfter(D); label = 'sur deux séances (veille au lendemain)'; }
    if (!before || !after) return null;
    return { pct: (after.c / before.c - 1) * 100, label, date: after.d, final: after.d < Markets.parts(tz, now).date };
  },

  async refreshReactions() {
    const R = this.loadReactions();
    const todo = this.recent().filter(r => !r.reaction || !r.reaction.final);
    let changed = false;
    for (const r of todo.slice(0, 8)) {
      try {
        const json = await Api.yahoo({ type: 'chart', symbol: r.sym, range: '1mo', interval: '1d' });
        const res = json && json.chart && json.chart.result && json.chart.result[0];
        if (!res) continue;
        const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
        const x = this.reactionFrom(res.timestamp, closes, (res.meta && res.meta.exchangeTimezoneName) || 'America/New_York', r.ts, US_MICS.has(r.inst && r.inst.mic));
        if (x) { R[r.sym + '|' + r.ts] = x; changed = true; }
      } catch (e) { /* on réessaiera plus tard */ }
    }
    // ménage : réactions de plus de 60 jours
    for (const k of Object.keys(R)) if (Date.now() / 1000 - +k.split('|')[1] > 60 * 86400) delete R[k];
    return changed;
  },

  /* ---------- dividendes annoncés ---------- */

  /** Détachement et paiement annoncés par une action : { ex, pay } (dates ISO) ou null */
  officialDividend(key) {
    const sym = this.stockSymbol(key), c = this.load();
    const d = sym && c[sym] && c[sym].data;
    const ce = d && d.calendarEvents;
    const ex = ce && this.raw(ce.exDividendDate), pay = ce && this.raw(ce.dividendDate);
    if (!ex) return null;
    const iso = s => new Date(s * 1000).toISOString().slice(0, 10);
    return { ex: iso(ex), pay: pay && pay >= ex ? iso(pay) : null };
  },

  /**
   * Dividendes estimés (divForecast) recalés sur la date de détachement annoncée par la société, si elle tombe à
   * moins de 45 jours de l'estimation : { confirmed: true, pay }.
   */
  confirmDividends(items, today = todayISO()) {
    const byKey = new Map();
    for (const it of items) { if (!byKey.has(it.key)) byKey.set(it.key, []); byKey.get(it.key).push(it); }
    for (const [key, list] of byKey) {
      const o = this.officialDividend(key);
      if (!o || o.ex < today) continue;
      const gap = it => Math.abs(new Date(it.date) - new Date(o.ex)) / 86400000;
      const best = list.filter(it => gap(it) <= 45).sort((a, b) => gap(a) - gap(b))[0];
      if (best) Object.assign(best, { date: o.ex, confirmed: true, pay: o.pay });
    }
    return items.sort((a, b) => (a.date < b.date ? -1 : 1));
  },
};

const Agenda = {
  /** Échéances des `days` prochains jours, triées par date : [{ date, kind, title, sub, amount? }] */
  events(today = todayISO(), days = 366) {
    const end = addDaysISO(today, days);
    const cur = Store.state.settings.baseCurrency;
    const out = [];
    const inRange = d => d >= today && d <= end;

    // versements programmés actifs : chaque mois jusqu'à l'horizon
    for (const p of Store.state.plans || []) {
      if (p.active === false || !p.start) continue;
      let month = (p.start > today ? p.start : today).slice(0, 7);
      for (let g = 0; g < 14; g++, month = addMonthsISO(month + '-01', 1).slice(0, 7)) {
        const d = Portfolio.planDate(p, month);
        if (d < p.start || !inRange(d) || (p.done && p.done[month])) continue;
        out.push({ date: d, kind: 'plan', amount: parseNum(p.amount), title: `Versement programmé · ${Store.label(p.key)}`,
          sub: fmtMoney(parseNum(p.amount), cur, 0) + (Store.state.accounts.length > 1 ? ' · ' + Store.account(p.account).name : '') });
      }
    }

    // dividendes attendus (d'après les détachements des 12 derniers mois), recalés sur la date annoncée par la société
    const divKeys = new Set();
    if (typeof App !== 'undefined' && App.divForecast) {
      for (const d of App.divForecast(today, 'all')) {
        if (!inRange(d.date)) continue;
        if (d.confirmed) divKeys.add(d.key);
        const amount = (isFinite(d.amount) ? '≈ ' + fmtMoney(d.amount, cur) + ' brut' : 'montant inconnu') + ` (${fmtMoney(d.perShare, d.currency, 3)} par part)`;
        out.push({ date: d.date, kind: 'div', amount: d.amount, title: `Dividende ${d.confirmed ? 'confirmé' : 'attendu'} · ${Store.label(d.key)}`,
          sub: d.confirmed
            ? `Détachement annoncé par la société${d.pay ? `, paiement le ${fmtDate(d.pay)}` : ''}. Montant estimé d'après le versement de l'an dernier : ${amount}.`
            : amount });
      }
    }
    // détachements annoncés sans estimation (action de la watchlist, premier dividende…) : à détenir la veille pour le toucher
    for (const key of Store.trackedKeys()) {
      if (divKeys.has(key)) continue;
      const o = Earnings.officialDividend(key);
      if (!o || !inRange(o.ex) || out.some(e => e.kind === 'div' && e.date === o.ex && e.title.endsWith(Store.label(key)))) continue;
      out.push({ date: o.ex, kind: 'div', title: `Détachement du dividende · ${Store.label(key)}`,
        sub: `Date annoncée par la société${o.pay ? `, paiement le ${fmtDate(o.pay)}` : ''}. Pour le toucher, il faut détenir l'action la veille au soir. Montant non communiqué par Yahoo.` });
    }

    // publications de résultats des actions suivies (portefeuille et watchlist)
    out.push(...Earnings.events(today, end));

    // grands rendez-vous des indices : banques centrales, inflation et emploi américains, échéances trimestrielles
    out.push(...Macro.events(today, end));

    // bourses où tu as des lignes : jours fériés et clôtures anticipées
    const held = Portfolio.snapshot('all').rows;
    const exchanges = new Map();
    for (const r of held) { const ex = r.inst && Markets.forMic(r.inst.mic); if (ex && ex.holidays) exchanges.set(ex.id, ex); }
    for (const ex of exchanges.values()) {
      const H = HOLIDAYS[ex.holidays] || {};
      for (const d of H.closed || []) {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if (inRange(d) && wd !== 0 && wd !== 6) out.push({ date: d, kind: 'market', title: `${ex.name} fermée (jour férié)`, sub: '' });
      }
      for (const [d, at] of Object.entries(H.early || {})) {
        if (inRange(d)) out.push({ date: d, kind: 'market', title: `${ex.name} : clôture anticipée à ${at} (heure locale)`, sub: '' });
      }
    }

    // jalons fiscaux : 5 ans du PEA, 8 ans de l'assurance-vie, plafond du PEA
    for (const a of Store.state.accounts) {
      if (!Tax.sortedTxs(a.id).length) continue;
      if (a.type === 'pea') {
        const p = Tax.pea(a);
        if (p.five && inRange(p.five)) out.push({ date: p.five, kind: 'tax', title: `${a.name} : 5 ans`, sub: 'Retraits possibles sans clôture, gains exonérés d\'impôt sur le revenu (prélèvements sociaux seulement).' });
        const cap = Tax.peaCapDate(a, p.deposits, taxConf().peaCap, today);
        if (cap && inRange(cap.date)) out.push({ date: cap.date, kind: 'tax', title: `${a.name} : plafond des versements`, sub: `Atteint vers cette date au rythme de ${fmtMoney(cap.monthly, cur, 0)}/mois.` });
      }
      if (a.type === 'av') {
        const v = Tax.av(a, today);
        if (v.eight && inRange(v.eight)) out.push({ date: v.eight, kind: 'tax', title: `${a.name} : 8 ans`, sub: 'Abattement annuel sur les gains rachetés (4 600 €, 9 200 € en couple).' });
      }
    }

    // déclaration de revenus : plus-values et dividendes du compte-titres de l'année précédente
    const declYear = +today.slice(0, 4) - (today.slice(5) < '06-15' ? 1 : 0);
    const declDate = `${declYear + 1}-04-10`;
    if (inRange(declDate)) {
      let gains = 0, divs = 0, any = false;
      for (const a of Store.state.accounts.filter(x => x.type === 'cto' || x.type === 'autre')) {
        const e = Tax.events(a);
        for (const s of e.sales) if (s.date.startsWith(String(declYear))) { gains += s.gain; any = true; }
        for (const d of e.divs) if (d.date.startsWith(String(declYear))) { divs += d.amount; any = true; }
      }
      if (any) out.push({ date: declDate, kind: 'tax', title: `Déclaration des revenus ${declYear}`,
        sub: `Compte-titres : ${gains >= 0 ? 'plus-value' : 'moins-value'} ${fmtMoney(Math.abs(gains), cur, 0)} (case ${gains >= 0 ? '3VG' : '3VH'}), dividendes ${fmtMoney(divs, cur, 0)} (case 2DC ou 2TR). Ouverture en ligne vers avril ; date limite selon ton département (impots.gouv.fr).` });
    }

    // placements à valeur saisie : prochain relevé trimestriel à reporter
    if (typeof Manual !== 'undefined') {
      for (const r of held) {
        if (!Manual.is(r.key)) continue;
        const last = Manual.last(r.key);
        const next = last ? addMonthsISO(last[0], 3) : null;
        if (next) out.push({ date: next < today ? today : next, kind: 'todo', title: `Valeur à mettre à jour · ${Store.label(r.key)}`,
          sub: `Dernière valeur saisie le ${fmtDate(last[0])} : reporte celle de ton prochain relevé.` });
      }
    }

    return out.filter(e => inRange(e.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind.localeCompare(b.kind)));
  },

  /** Fichier iCalendar (journées entières) : importable dans Agenda iPhone, Google Agenda, Outlook */
  ics(events, stamp = new Date()) {
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const ymd = d => d.replace(/-/g, '');
    const fold = line => { // lignes de 75 octets au plus (RFC 5545)
      const out = [];
      let cur = '';
      for (const ch of line) {
        if (new TextEncoder().encode(cur + ch).length > 73) { out.push(cur); cur = ' '; }
        cur += ch;
      }
      out.push(cur);
      return out.join('\r\n');
    };
    const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//APIstock//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:APIstock'];
    for (const e of events) {
      lines.push('BEGIN:VEVENT',
        `UID:${ymd(e.date)}-${e.kind}-${hash(e.title)}@apistock`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${ymd(e.date)}`,
        `DTEND;VALUE=DATE:${ymd(addDaysISO(e.date, 1))}`,
        fold('SUMMARY:' + esc(e.title)),
        fold('DESCRIPTION:' + esc(e.sub)),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  },
};

Object.assign(App, {
  agendaFilter: '',

  bindAgenda() {
    const btn = $('#agendaExport');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const evs = Agenda.events().filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
      if (!evs.length) { toast('Aucune échéance à exporter'); return; }
      const blob = new Blob([Agenda.ics(evs)], { type: 'text/calendar;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'apistock-agenda.ics' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`${evs.length} échéance(s) exportée(s) : ouvre le fichier pour les ajouter à ton agenda`, 'success', 5000);
    });
  },

  /** Résultats publiés ces 14 derniers jours : bénéfice réel contre attendu et réaction de l'action */
  agendaRecent() {
    const list = Earnings.recent();
    if (!list.length) return null;
    return el('section', { class: 'agenda-month agenda-recent' },
      el('h3', {}, 'Publiés récemment', el('span', { class: 'muted small' }, `${Earnings.RECENT} derniers jours`)),
      el('ul', { class: 'agenda-list' }, ...list.map(r => {
        const d = new Date(r.day + 'T12:00:00Z');
        const ql = Earnings.quarterLabel(r.q.fiscalQuarter, r.q.calendarQuarter);
        const a = Earnings.raw(r.q.actual), e = Earnings.raw(r.q.estimate);
        const x = r.reaction;
        const react = x ? el('b', { class: trendClass(x.pct) }, `${x.pct >= 0 ? '▲' : '▼'} ${fmtPct(x.pct, 1)}`) : null;
        return el('li', { class: 'agenda-item earn past' },
          el('div', { class: 'agenda-date' }, el('b', {}, String(d.getUTCDate())),
            el('span', {}, d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }))),
          el('span', { class: 'agenda-icon', 'aria-hidden': 'true' }, a !== null && e !== null ? (a >= e ? '✅' : '⚠️') : '📊'),
          el('div', { class: 'agenda-text' },
            el('b', {}, `Résultats${ql ? ' ' + ql : ''} · ${r.name}`),
            el('span', { class: 'muted small' }, Earnings.beat(r.q, r.ccy).replace(/^./, ch => ch.toUpperCase()) + '.'),
            el('span', { class: 'small' }, 'Réaction de l\'action : ', react || el('span', { class: 'muted' }, 'en attente de la prochaine séance'),
              x ? el('span', { class: 'muted' }, ` ${x.label}${x.final ? '' : ' (séance en cours)'}`) : null),
            r.via && r.via.length ? el('span', { class: 'muted small' }, Earnings.viaText(r.via) + '.') : null));
      })));
  },

  /* ---------- fiche d'une action : résultats trimestriels ---------- */

  async loadDetailEarnings(key) {
    const box = $('#detailEarnings');
    if (!box) return;
    const sym = key && Earnings.stockSymbol(key);
    if (!sym) { box.replaceChildren(); return; }
    const c = Earnings.load();
    this.renderDetailEarnings(key, c[sym] && c[sym].data);
    try {
      const d = await Earnings.ensure(sym);
      if (this.detailKey === key) this.renderDetailEarnings(key, d);
    } catch (e) { if (this.detailKey === key && !(c[sym] && c[sym].data)) box.replaceChildren(); }
  },

  /** Bénéfice par action des 4 derniers trimestres (publié contre attendu) et prochaine publication */
  renderDetailEarnings(key, d) {
    const box = $('#detailEarnings');
    if (!box) return;
    const quarters = d ? Earnings.quarters(d).slice(-4) : [];
    const n = d ? Earnings.next(d) : null;
    if (!quarters.length && !n) { box.replaceChildren(); return; }
    const inst = Store.instrument(key) || {};
    const ccy = Earnings.ccyOf(d, inst), money = v => fmtMoney(v, ccy, 2, true);
    const today = todayISO();
    const upcoming = n && n.day >= today ? n : null;
    const cols = quarters.map(q => ({ label: Earnings.quarterLabel(q.fiscalQuarter, q.calendarQuarter, true), a: Earnings.raw(q.actual), e: Earnings.raw(q.estimate),
      day: Earnings.raw(q.reportedDate) ? Earnings.localISO(Earnings.raw(q.reportedDate) * 1000) : '', q }));
    if (upcoming && upcoming.eps !== null) cols.push({ label: Earnings.quarterLabel(upcoming.fiscal, upcoming.calendar, true) || 'À venir', a: null, e: upcoming.eps, day: upcoming.day, next: true });
    const max = Math.max(...cols.flatMap(c => [c.a, c.e]).filter(v => v !== null).map(v => Math.max(0, v)), 0) || 1;
    const h = v => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    const surprise = c => (c.a !== null && c.e ? ((c.a - c.e) / Math.abs(c.e)) * 100 : null);
    const timing = upcoming ? (upcoming.estimate ? 'date estimée' : Earnings.timing(upcoming.t, inst).replace(/^./, ch => ch.toLowerCase())) : '';
    box.replaceChildren(el('section', { class: 'earn-panel' },
      el('h3', {}, 'Résultats trimestriels', el('span', { class: 'muted small' }, ' · bénéfice par action')),
      upcoming ? el('p', { class: 'small' }, el('b', {}, `Prochaine publication : ${fmtDate(upcoming.day)}`),
        el('span', { class: 'muted' }, [timing, upcoming.eps !== null ? `attendu ${money(upcoming.eps)}` : ''].filter(Boolean).map(x => ' · ' + x).join(''))) : null,
      el('div', { class: 'earn-chart', role: 'img', 'aria-label': 'Bénéfice par action publié et attendu, trimestre par trimestre' }, ...cols.map(c => {
        const s = surprise(c);
        const tip = c.next ? `${c.label} · publication le ${fmtDate(c.day)} · attendu ${money(c.e)}`
          : `${c.label}${c.day ? ' · publié le ' + fmtDate(c.day) : ''} · publié ${money(c.a)}${c.e !== null ? ' · attendu ' + money(c.e) : ''}${s !== null ? ' · ' + fmtPct(s, 1) : ''}`;
        return el('div', { class: 'earn-col' + (c.next ? ' next' : ''), title: tip, tabindex: '0', 'aria-label': tip },
          el('div', { class: 'earn-plot' },
            c.a !== null ? el('span', { class: 'earn-bar', style: `height:${h(c.a)}` }) : null,
            c.e !== null ? el('span', { class: 'earn-est', style: `bottom:${h(c.e)}` }) : null),
          el('b', { class: 'earn-val' }, money(c.next ? c.e : c.a)),
          el('span', { class: 'earn-q muted' }, c.label),
          s !== null ? el('span', { class: 'earn-surp ' + (s >= 0 ? 'up' : 'down') }, `${s >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(s), 1)} %`)
            : el('span', { class: 'earn-surp muted' }, c.next ? fmtDate(c.day).replace(/ \d{4}$/, '') : '—'));
      })),
      el('div', { class: 'earn-legend small muted' }, el('span', { class: 'lg-bar' }), 'publié', el('span', { class: 'lg-est' }), 'attendu par les analystes',
        el('span', {}, ' · ▲ / ▼ : écart entre publié et attendu'))));
  },

  renderAgenda() {
    const box = $('#agendaList');
    if (!box) return;
    const pending = Earnings.refresh(); // dates de résultats périmées : rechargées en arrière-plan
    pending.then(changed => { if (changed && this.view === 'agenda') this.renderAgenda(); });
    const note = $('#agendaNote');
    if (note) {
      const relay = 'ton relais Yahoo doit être mis à jour (copie à nouveau proxy/cloudflare-worker.js dans ton worker Cloudflare, puis Deploy)';
      const msg = {
        loading: 'Chargement des dates de résultats…',
        'old-relay': `Dates de résultats indisponibles : ${relay}.`,
        error: 'Dates de résultats indisponibles pour l\'instant' + (Earnings.error ? ' (' + Earnings.error + ')' : '') + '.',
      }[Earnings.status] || (Earnings.holdStatus === 'old-relay' && Holdings.etfs().length ? `Résultats des grandes sociétés de tes ETF : ${relay}.` : '');
      note.textContent = msg;
      note.hidden = !msg;
    }
    const all = Agenda.events();
    const counts = {};
    for (const e of all) counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (this.agendaFilter && !counts[this.agendaFilter]) this.agendaFilter = '';
    $('#agendaKinds').replaceChildren(
      el('button', { class: this.agendaFilter ? '' : 'active', onclick: () => { this.agendaFilter = ''; this.renderAgenda(); } }, `Tout (${all.length})`),
      ...Object.entries(AGENDA_KINDS).filter(([k]) => counts[k]).map(([k, v]) =>
        el('button', { class: this.agendaFilter === k ? 'active' : '', onclick: () => { this.agendaFilter = k; this.renderAgenda(); } }, `${v.label} (${counts[k]})`)));
    const evs = all.filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
    const recent = !this.agendaFilter || this.agendaFilter === 'earn' ? this.agendaRecent() : null;
    if (!evs.length && recent) { box.replaceChildren(recent); return; }
    if (!evs.length) {
      box.replaceChildren(el('p', { class: 'empty' }, all.length ? 'Rien dans cette catégorie.' : 'Aucune échéance pour l\'instant. Programme un versement (onglet Investir) ou ajoute des lignes : leurs dividendes et les jours fériés de leur bourse apparaîtront ici.'));
      return;
    }
    const today = todayISO();
    const byMonth = new Map();
    for (const e of evs) { const m = e.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(e); }
    const cur = this.base();
    box.replaceChildren(...(recent ? [recent] : []), ...Array.from(byMonth.entries()).map(([m, list]) => {
      const sum = list.filter(e => e.kind === 'div' && isFinite(e.amount)).reduce((s, e) => s + e.amount, 0);
      const plans = list.filter(e => e.kind === 'plan').reduce((s, e) => s + (e.amount || 0), 0);
      const label = new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return el('section', { class: 'agenda-month' },
        el('h3', {}, label, el('span', { class: 'muted small' }, [plans ? `${fmtMoney(plans, cur, 0)} à investir` : '', sum ? `≈ ${fmtMoney(sum, cur)} de dividendes` : ''].filter(Boolean).join(' · '))),
        el('ul', { class: 'agenda-list' }, ...list.map(e => {
          const d = new Date(e.date + 'T12:00:00Z');
          return el('li', { class: 'agenda-item ' + e.kind + (e.date === today ? ' today' : '') },
            el('div', { class: 'agenda-date' }, el('b', {}, String(d.getUTCDate())),
              el('span', {}, d.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }))),
            el('span', { class: 'agenda-icon', 'aria-hidden': 'true' }, AGENDA_KINDS[e.kind].icon),
            el('div', { class: 'agenda-text' }, el('b', {}, e.title), e.sub ? el('span', { class: 'muted small' }, e.sub) : null));
        })));
    }));
  },
});

App.on('detail:selected', function (key) { this.loadDetailEarnings(key); });
