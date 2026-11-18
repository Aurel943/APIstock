/*
 * Attribution de performance (Analyse › Performance) : pourquoi ton portefeuille a fait mieux ou moins bien que le
 * MSCI World, décomposé à la manière de Brinson-Fachler, mois par mois :
 * - répartition géographique : avoir plus ou moins que l'indice dans une zone (États-Unis, Europe, Japon, émergents,
 *   or, crypto) qui a fait mieux ou moins bien que l'indice, en regardant à l'intérieur de tes ETF ;
 * - choix des lignes : tout le reste (indice différent dans la même zone, frais, écart de suivi, actions en direct…).
 * Les effets mensuels sont reliés sur la période par la méthode de Cariño (leur somme donne exactement l'écart total).
 * En complément : la part de l'écart due à une exposition aux devises différente de celle de l'indice.
 * Calculs purs (objet Attribution) testés dans tests/attribution.test.mjs ; affichage en bas du fichier.
 */
'use strict';

/* Indice de référence (ETF capitalisant coté en euros, dividendes réinvestis) */
const ATTR_BENCH = { sym: 'IWDA.AS', ccy: 'EUR', name: 'MSCI World', profile: 'world' };
/* Zones et ETF capitalisants qui les représentent (dividendes réinvestis) ; « other » suit l'indice de référence */
const ATTR_ZONES = [
  { id: 'us', name: 'États-Unis', sym: 'CSPX.L', ccy: 'USD', countries: ['US'] },
  { id: 'europe', name: 'Europe', sym: 'IMAE.AS', ccy: 'EUR', countries: ['FR', 'DE', 'NL', 'GB', 'CH', 'IT', 'ES', 'BE', 'FI', 'SE', 'DK'] },
  { id: 'japan', name: 'Japon', sym: 'IJPA.L', ccy: 'USD', countries: ['JP'] },
  { id: 'em', name: 'Pays émergents', sym: 'EIMI.L', ccy: 'USD', countries: ['CN', 'TW', 'IN', 'KR', 'BR', 'SA', 'ZA', 'MX'] },
  { id: 'gold', name: 'Or', sym: 'IGLN.L', ccy: 'USD', countries: ['Or (matière première)'] },
  { id: 'crypto', name: 'Crypto-monnaies', sym: 'BTC-EUR', ccy: 'EUR', countries: ['Crypto-monnaies'] },
  { id: 'other', name: 'Autres pays', sym: null, countries: [] },
];
/* Devises suivies pour l'effet de change (valeur d'une unité en devise de base) */
const ATTR_CCYS = ['USD', 'JPY', 'GBP', 'CHF'];
const ATTR_PERIODS = { '1A': ['1 an', 12], '3A': ['3 ans', 36], '5A': ['5 ans', 60], max: ['Depuis le début', 240] };

const Attribution = {
  /** Zone d'un code pays (ou d'un libellé spécial : or, crypto) */
  zoneOf(country) {
    const z = ATTR_ZONES.find(x => x.countries.includes(country));
    return z ? z.id : 'other';
  },

  /** Répartition { pays: % } → { zone: fraction } (somme 1) */
  zoneWeights(countries) {
    const out = {};
    const total = Object.values(countries || {}).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    if (!(total > 0)) return { other: 1 };
    for (const [c, v] of Object.entries(countries)) if (v > 0) { const z = this.zoneOf(c); out[z] = (out[z] || 0) + v / total; }
    return out;
  },

  /** Poids par zone d'un portefeuille { clé: valeur } d'après la répartition par pays de chaque ligne `split[clé]` */
  portfolioZones(values, split) {
    const total = Object.values(values).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    const out = {};
    if (!(total > 0)) return out;
    for (const [k, v] of Object.entries(values)) {
      if (!(v > 0)) continue;
      for (const [z, w] of Object.entries(split[k] || { other: 1 })) out[z] = (out[z] || 0) + (v / total) * w;
    }
    return out;
  },

  /**
   * Effets d'un mois (Brinson-Fachler, sélection et interaction réunies) :
   * répartition = Σ (wP,z − wB,z) × (Rz − RB) ; choix des lignes = écart − répartition.
   * `rz` : { zone: rendement } (une zone absente suit l'indice) → { active, alloc, sel, byZone }
   */
  month({ rp, rb, wp, wb, rz }) {
    const byZone = {};
    let alloc = 0;
    for (const z of new Set([...Object.keys(wp), ...Object.keys(wb)])) {
      const r = rz[z] !== undefined && isFinite(rz[z]) ? rz[z] : rb;
      const e = ((wp[z] || 0) - (wb[z] || 0)) * (r - rb);
      byZone[z] = e; alloc += e;
    }
    return { active: rp - rb, alloc, sel: rp - rb - alloc, byZone };
  },

  /** Coefficient de Cariño ln(1+a) − ln(1+b) ÷ (a − b) (limite 1 / (1+a) quand a = b) */
  carino(a, b) { return Math.abs(a - b) < 1e-12 ? 1 / (1 + a) : (Math.log(1 + a) - Math.log(1 + b)) / (a - b); },

  /**
   * Relie des effets mensuels sur la période (Cariño) : la somme des effets reliés est exactement Rp − Rb.
   * `months` : [{ rp, rb, effects: { nom: valeur } }] → { rp, rb, active, effects: { nom: total } }
   */
  link(months) {
    const Rp = months.reduce((p, m) => p * (1 + m.rp), 1) - 1, Rb = months.reduce((p, m) => p * (1 + m.rb), 1) - 1;
    const K = this.carino(Rp, Rb);
    const effects = {};
    for (const m of months) {
      const k = this.carino(m.rp, m.rb) / K;
      for (const [n, v] of Object.entries(m.effects)) effects[n] = (effects[n] || 0) + v * k;
    }
    return { rp: Rp, rb: Rb, active: Rp - Rb, effects };
  },

  /** Dates de fin de mois entre deux dates (incluses), la dernière remplacée par `to` */
  monthEnds(from, to) {
    const out = [from];
    let [y, m] = from.split('-').map(Number);
    for (;;) {
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      if (end >= to) break;
      if (end > from) out.push(end);
      m++; if (m > 12) { m = 1; y++; }
    }
    if (to > out[out.length - 1]) out.push(to);
    return out;
  },

  /**
   * Analyse complète. `dates` : bornes des mois ; `twr` et `bench` : [[date, indice]] ;
   * `lineValues` : { clé: [valeur à chaque date] } ; `split` : { clé: { zone: fraction } } ;
   * `zones` : { zone: [[date, cours]] } ; `wb` : poids de l'indice par zone ;
   * `ccy` (facultatif) : { lineCcy: { clé: { devise: fraction } }, benchCcy: { devise: fraction }, fx: { devise: [[date, taux]] } }.
   */
  analyze({ dates, twr, bench, lineValues, split, zones, wb, ccy }) {
    const at = (s, d) => Quant.at(s, d);
    const months = [], detail = [];
    const sumW = {}, sumWb = {}, zoneRet = {};
    for (let i = 1; i < dates.length; i++) {
      const a = dates[i - 1], b = dates[i];
      const p0 = at(twr, a), p1 = at(twr, b), b0 = at(bench, a), b1 = at(bench, b);
      if (!(p0 > 0 && p1 > 0 && b0 > 0 && b1 > 0)) continue;
      const vals = {};
      for (const [k, arr] of Object.entries(lineValues)) vals[k] = arr[i - 1];
      const wp = this.portfolioZones(vals, split);
      if (!Object.keys(wp).length) continue;
      const rz = {};
      for (const [z, s] of Object.entries(zones)) { const x0 = at(s, a), x1 = at(s, b); if (x0 > 0 && x1 > 0) rz[z] = x1 / x0 - 1; }
      const rp = p1 / p0 - 1, rb = b1 / b0 - 1;
      const m = this.month({ rp, rb, wp, wb, rz });
      const effects = { alloc: m.alloc, sel: m.sel };
      for (const [z, e] of Object.entries(m.byZone)) effects['z:' + z] = e;
      if (ccy) {
        // exposition aux devises du portefeuille (d'après ses lignes) moins celle de l'indice, × variation de chaque devise
        const total = Object.values(vals).reduce((s, v) => s + (v > 0 ? v : 0), 0);
        let fxEff = 0;
        for (const c of ATTR_CCYS) {
          const s = ccy.fx[c];
          if (!s) continue;
          const f0 = at(s, a), f1 = at(s, b);
          if (!(f0 > 0 && f1 > 0)) continue;
          let w = 0;
          for (const [k, v] of Object.entries(vals)) if (v > 0) w += (v / total) * ((ccy.lineCcy[k] || {})[c] || 0);
          fxEff += (w - (ccy.benchCcy[c] || 0)) * (f1 / f0 - 1);
        }
        effects.fx = fxEff;
      }
      months.push({ rp, rb, effects });
      detail.push({ from: a, to: b, rp, rb, wp });
      for (const z of new Set([...Object.keys(wp), ...Object.keys(wb)])) {
        sumW[z] = (sumW[z] || 0) + (wp[z] || 0); sumWb[z] = (sumWb[z] || 0) + (wb[z] || 0);
        zoneRet[z] = (zoneRet[z] === undefined ? 1 : zoneRet[z]) * (1 + (rz[z] !== undefined ? rz[z] : rb));
      }
    }
    if (!months.length) return null;
    const L = this.link(months);
    const n = months.length;
    const zonesOut = Object.keys(sumW).map(z => ({ id: z, wp: sumW[z] / n, wb: sumWb[z] / n, ret: zoneRet[z] - 1, effect: L.effects['z:' + z] || 0 }))
      .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
    return { from: detail[0].from, to: detail[detail.length - 1].to, months: n, rp: L.rp, rb: L.rb, active: L.active,
      alloc: L.effects.alloc, sel: L.effects.sel, fx: L.effects.fx, zones: zonesOut };
  },
};

Object.assign(App, {
  bindAttribution() {
    const seg = $('#attrPeriods');
    if (!seg || seg.childElementCount) return;
    this._attrPeriod = this._attrPeriod || '3A';
    for (const [id, [label]] of Object.entries(ATTR_PERIODS)) {
      seg.append(el('button', { type: 'button', class: id === this._attrPeriod ? 'active' : '', 'data-period': id, onclick: () => {
        this._attrPeriod = id;
        $$('#attrPeriods button').forEach(b => b.classList.toggle('active', b.dataset.period === id));
        if (this._attrResult) this.runAttribution();
      } }, label));
    }
    $('#attrRun').addEventListener('click', () => this.runAttribution());
  },

  /** Valeur de chaque ligne (devise de base) à chaque date, d'après les parts détenues ce jour-là */
  lineValuesAt(dates, series, fx) {
    const events = Portfolio.historyEvents(Portfolio.txs()).filter(e => e.type === 'buy' || e.type === 'sell').sort((a, b) => (a.date < b.date ? -1 : 1));
    const out = {};
    for (const k of Object.keys(series)) {
      const evs = events.filter(e => e.key === k);
      out[k] = dates.map(d => {
        let q = 0;
        for (const e of evs) { if (e.date > d) break; q += e.type === 'sell' ? -e.qty : e.qty; }
        const px = Quant.at(series[k], d);
        return q > 1e-9 && px > 0 ? q * px * (typeof fx[k] === 'function' ? fx[k](d) || 1 : 1) : 0;
      });
    }
    return out;
  },

  async runAttribution() {
    const box = $('#attrBody'), btn = $('#attrRun');
    if (!box) return;
    const txs = Portfolio.txs();
    if (!txs.some(t => t.type === 'buy')) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des opérations pour comparer ton portefeuille au MSCI World.')); return; }
    if (!Api.hasProxy()) { box.replaceChildren(el('p', { class: 'muted' }, 'Le relais Yahoo est nécessaire pour charger l\'indice et les zones (Réglages).')); return; }
    btn.disabled = true; btn.textContent = 'Calcul…';
    try {
      if (!this.historyPoints) await this.loadHistory({ quiet: true });
      if (!this.historyPoints || this.historyPoints.length < 2) throw new Error('Historique du portefeuille indisponible pour l\'instant.');
      const twr = Portfolio.twr(this.historyPoints);
      const first = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
      const months = ATTR_PERIODS[this._attrPeriod || '3A'][1];
      const wanted = addMonthsISO(todayISO(), -months);
      const start = first > wanted ? first : wanted;
      const keys = Array.from(new Set(txs.filter(t => t.type === 'buy').map(t => t.key)));
      const series = {}, fx = {};
      for (const k of keys) {
        try { series[k] = await Api.daily(k, first); fx[k] = await Api.fxSeries((Store.instrument(k) || {}).currency || this.base(), first); }
        catch (e) { /* ligne sans historique : ignorée */ }
      }
      const bench = await this.quantSeries('Y:' + ATTR_BENCH.sym, addDaysISO(start, -10), ATTR_BENCH.ccy);
      const zones = {}, missing = [];
      for (const z of ATTR_ZONES) {
        if (!z.sym) continue;
        try { zones[z.id] = await this.quantSeries('Y:' + z.sym, addDaysISO(start, -10), z.ccy); }
        catch (e) { missing.push(z.id); }
      }
      const fxS = {};
      for (const c of ATTR_CCYS) {
        if (c === this.base()) continue;
        try { const f = await Api.fxSeries(c, start); fxS[c] = Attribution.monthEnds(start, todayISO()).map(d => [d, f(d)]).filter(p => p[1] > 0); }
        catch (e) { /* devise indisponible */ }
      }
      const dates = Attribution.monthEnds(start, (twr[twr.length - 1] || [todayISO()])[0]);
      const split = {}, lineCcy = {};
      for (const k of Object.keys(series)) {
        const sp = Manual.is(k) ? { country: { other: 100 }, ccy: {} } : Expo.split(k);
        split[k] = Attribution.zoneWeights(sp.country);
        const tot = Object.values(sp.ccy || {}).reduce((s, v) => s + v, 0) || 1;
        lineCcy[k] = Object.fromEntries(Object.entries(sp.ccy || {}).map(([c, v]) => [c, v / tot]));
      }
      const W = EXPO_PROFILES[ATTR_BENCH.profile];
      const wb = Attribution.zoneWeights(W.country);
      const btot = Object.values(W.ccy).reduce((s, v) => s + v, 0);
      const benchCcy = Object.fromEntries(Object.entries(W.ccy).map(([c, v]) => [c, v / btot]));
      const res = Attribution.analyze({ dates, twr, bench, lineValues: this.lineValuesAt(dates, series, fx), split, zones, wb,
        ccy: { lineCcy, benchCcy, fx: fxS } });
      if (!res) throw new Error('Pas assez d\'historique commun entre ton portefeuille et l\'indice (au moins un mois).');
      this._attrResult = Object.assign(res, { missing });
      this.renderAttribution();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message || String(e)));
    } finally { btn.disabled = false; btn.textContent = 'Recalculer'; }
  },

  renderAttribution() {
    const R = this._attrResult, box = $('#attrBody');
    if (!R || !box) return;
    const pts = x => (isFinite(x) ? (x >= 0 ? '+' : '−') + fmtNum(Math.abs(x * 100), 1) + ' pt' + (Math.abs(x * 100) >= 2 ? 's' : '') : '—');
    const pct = x => (isFinite(x) ? fmtPct(x * 100, 1) : '—');
    const zname = id => (ATTR_ZONES.find(z => z.id === id) || { name: id }).name;
    const better = R.active >= 0;
    const top = R.zones.filter(z => Math.abs(z.effect) >= 0.001)[0];
    const max = Math.max(0.0001, Math.abs(R.alloc), Math.abs(R.sel), Math.abs(R.active));
    const bar = (label, v, tip) => el('li', {},
      el('span', { class: 'attr-name' }, label, tip ? infoTip(tip) : null),
      el('span', { class: 'attr-track' }, el('span', { class: 'attr-fill ' + (v >= 0 ? 'up' : 'down'), style: `width:${Math.min(50, Math.abs(v) / max * 50)}%;${v >= 0 ? 'left:50%' : 'right:50%'}` })),
      el('b', { class: 'mono ' + trendClass(v) }, pts(v)));
    box.replaceChildren(
      el('p', { class: 'etfcmp-verdict attr-verdict ' + (better ? 'up' : 'down') },
        `Du ${fmtDate(R.from)} au ${fmtDate(R.to)}, ton portefeuille a fait `, el('b', {}, pct(R.rp)), ` contre ${pct(R.rb)} pour le ${ATTR_BENCH.name} : `,
        el('b', {}, pts(R.active)), better ? ' d\'avance.' : ' de retard.',
        top ? ` La zone qui a le plus pesé : ${zname(top.id)} (${pts(top.effect)}).` : ''),
      el('ul', { class: 'attr-bars' },
        bar('Répartition géographique', R.alloc, 'Avoir plus (ou moins) que l\'indice dans une zone qui a fait mieux (ou moins bien) que lui. En regardant à l\'intérieur de tes ETF : un ETF MSCI World compte pour 72 % aux États-Unis.'),
        bar('Choix des lignes', R.sel, 'Tout le reste : un indice différent dans la même zone (Nasdaq-100 plutôt que S&P 500, CAC 40 plutôt qu\'Europe), les frais et l\'écart de suivi de tes ETF, tes actions en direct, le prix obtenu à l\'achat ou à la vente face au cours de clôture du jour, les dividendes non saisis.'),
        bar('Écart total', R.active)),
      isFinite(R.fx) && Math.abs(R.fx) >= 0.0005 ? el('p', { class: 'small' }, `Dont devises : environ ${pts(R.fx)}. Ton exposition au dollar, au yen, à la livre et au franc suisse diffère de celle de l'indice, et ces devises ont bougé face à l'euro (effet déjà compris dans les deux lignes ci-dessus).`) : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table attr-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Zone'), el('th', { class: 'num' }, 'Ta part'), el('th', { class: 'num' }, 'Indice'), el('th', { class: 'num' }, 'Perf. de la zone'), el('th', { class: 'num' }, 'Effet'))),
        el('tbody', {}, ...R.zones.filter(z => z.wp > 0.0005 || z.wb > 0.0005).map(z => el('tr', {},
          el('td', {}, zname(z.id)),
          el('td', { class: 'num mono' }, fmtNum(z.wp * 100, 1) + ' %'),
          el('td', { class: 'num mono muted' }, fmtNum(z.wb * 100, 1) + ' %'),
          el('td', { class: 'num mono ' + trendClass(z.ret) }, z.id === 'other' ? 'comme l\'indice' : pct(z.ret)),
          el('td', { class: 'num mono ' + trendClass(z.effect) }, pts(z.effect))))))),
      (() => { // zones détenues sans données : comptées comme l'indice
        const held = R.missing.filter(id => R.zones.some(z => z.id === id && z.wp > 0.0005)).map(zname);
        return held.length ? el('p', { class: 'small muted' }, `Zone(s) sans données pour l'instant, comptée(s) comme l'indice : ${held.join(', ')}.`) : null;
      })(),
      noteTip(`Méthode de Brinson-Fachler, mois par mois (${R.months} mois), effets reliés par la méthode de Cariño : leur somme donne exactement l'écart total.`
        + ` Ta part par zone : moyenne sur la période, en regardant à l'intérieur de tes ETF (profils d'indice de l'onglet Exposition). Zones représentées par des ETF capitalisants en euros au taux du jour :`
        + ` États-Unis (S&P 500), Europe (MSCI Europe), Japon, émergents (MSCI EM IMI), or, Bitcoin ; « Autres pays » (Canada, Australie…) suit l'indice. Indice de référence : ${ATTR_BENCH.name} (ETF ${ATTR_BENCH.sym}, dividendes réinvestis).`
        + ' Performance de ton portefeuille pondérée dans le temps (hors espèces). Les ETF couverts contre le risque de change ne sont pas repérés.', 'Méthode'));
  },
});

App.on('view:shown', function (page) { if (page === 'analysis/performance') this.bindAttribution(); });
