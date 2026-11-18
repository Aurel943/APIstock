/*
 * Performance réelle (Analyse › Performance) : ce que ton portefeuille a gagné en pouvoir d'achat, une fois
 * l'inflation déduite. Indice des prix à la consommation de l'INSEE (ensemble des ménages, France, mensuel),
 * inscrit ici : base 2015 de janvier 1999 à décembre 2025, prolongé avec la base 2025 (séries 001759970 et 011814630,
 * chaînées en décembre 2025). À compléter chaque mois dans CPI_FR.values (dernier mois publié : CPI_FR.end).
 * Calculs purs (objet Inflation) testés dans tests/inflation.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const CPI_FR = {
  start: '1999-01',
  end: '2026-10',
  source: 'INSEE, indice des prix à la consommation, ensemble des ménages, France (séries 001759970 et 011814630)',
  values: [
    77.97, 78.21, 78.47, 78.69, 78.7, 78.69, 78.48, 78.61, 78.74, 78.79, 78.82, 79.17, 79.17, 79.27, 79.64, 79.64, 79.8, 80, 79.87, 80.02,
    80.43, 80.33, 80.51, 80.47, 80.13, 80.35, 80.71, 81.1, 81.6, 81.65, 81.48, 81.48, 81.63, 81.68, 81.46, 81.56, 81.94, 82.04, 82.4, 82.71,
    82.81, 82.8, 82.8, 82.99, 83.14, 83.27, 83.27, 83.41, 83.57, 84.15, 84.49, 84.37, 84.27, 84.43, 84.34, 84.54, 84.86, 85.04, 85.14, 85.23,
    85.23, 85.59, 85.93, 86.15, 86.47, 86.5, 86.36, 86.55, 86.63, 86.85, 86.9, 87, 86.52, 87.05, 87.6, 87.77, 87.83, 87.93, 87.8, 88.14, 88.48,
    88.46, 88.28, 88.39, 88.3, 88.64, 88.89, 89.27, 89.65, 89.65, 89.5, 89.8, 89.6, 89.4, 89.5, 89.71, 89.4, 89.57, 89.95, 90.39, 90.61, 90.72,
    90.49, 90.86, 90.96, 91.19, 91.69, 92.03, 91.92, 92.12, 92.81, 93.12, 93.62, 93.96, 93.76, 93.73, 93.67, 93.62, 93.18, 92.95, 92.57, 92.92,
    93.09, 93.24, 93.38, 93.5, 93.08, 93.56, 93.33, 93.42, 93.55, 93.8, 93.59, 94.11, 94.57, 94.81, 94.92, 94.91, 94.64, 94.86, 94.79, 94.91,
    95.02, 95.45, 95.22, 95.67, 96.45, 96.78, 96.83, 96.91, 96.48, 96.98, 96.91, 97.14, 97.41, 97.8, 97.46, 97.86, 98.67, 98.8, 98.75, 98.78,
    98.35, 99, 98.76, 98.94, 98.79, 99.1, 98.6, 98.88, 99.63, 99.48, 99.54, 99.7, 99.4, 99.86, 99.63, 99.5, 99.46, 99.8, 99.24, 99.79, 100.24,
    100.2, 100.22, 100.18, 99.86, 100.3, 99.92, 99.95, 99.78, 99.86, 98.86, 99.52, 100.17, 100.28, 100.52, 100.44, 100.03, 100.35, 99.95,
    100.01, 99.82, 100.04, 99.08, 99.33, 100.02, 100.09, 100.5, 100.63, 100.25, 100.58, 100.34, 100.37, 100.35, 100.65, 100.41, 100.53, 101.17,
    101.26, 101.31, 101.32, 100.97, 101.49, 101.33, 101.43, 101.53, 101.85, 101.75, 101.72, 102.75, 102.92, 103.36, 103.37, 103.28, 103.78,
    103.56, 103.67, 103.45, 103.47, 103.01, 103.06, 103.89, 104.22, 104.33, 104.58, 104.38, 104.86, 104.5, 104.46, 104.52, 104.98, 104.54,
    104.53, 104.59, 104.56, 104.71, 104.79, 105.19, 105.09, 104.55, 104.51, 104.73, 104.96, 105.12, 105.12, 105.75, 105.86, 106.2, 106.34,
    106.4, 107.05, 106.81, 107.25, 107.64, 107.85, 108.12, 108.94, 110.49, 110.97, 111.72, 112.55, 112.87, 113.38, 112.74, 113.9, 114.26,
    114.16, 114.6, 115.78, 116.79, 117.5, 117.44, 117.65, 117.71, 118.89, 118.26, 118.43, 118.23, 118.39, 118.19, 119.21, 119.47, 120.07,
    120.11, 120.2, 120.42, 121.06, 119.56, 119.89, 119.72, 119.95, 120.14, 120.16, 120.38, 121.06, 120.9, 121.36, 121.62, 122.13, 120.95,
    121.02, 120.8, 120.9, 120.5, 121.25, 122.42, 123.68, 123.84, 123.51, 124.2, 125.01, 124.67, 125.15
  ],
};

const Inflation = {
  /** Rang d'un mois « AAAA-MM » dans CPI_FR.values */
  monthIndex(ym) {
    const [y, m] = ym.split('-').map(Number), [y0, m0] = CPI_FR.start.split('-').map(Number);
    return (y - y0) * 12 + (m - m0);
  },

  /** Hausse des prix sur les 12 derniers mois connus (fraction) : sert à prolonger l'indice au-delà du dernier mois publié */
  lastYearRate() {
    const v = CPI_FR.values, n = v.length;
    return n > 12 ? v[n - 1] / v[n - 13] - 1 : 0;
  },

  /**
   * Niveau des prix à une date : l'indice d'un mois vaut au 15 du mois, interpolé linéairement entre deux mois ;
   * avant 1999, premier mois connu ; après le dernier mois publié, prolongé au rythme des 12 derniers mois.
   */
  level(iso) {
    const v = CPI_FR.values, n = v.length;
    const day = +iso.slice(8, 10) || 15;
    const pos = this.monthIndex(iso.slice(0, 7)) + (day - 15) / 30.4;
    if (pos <= 0) return v[0];
    if (pos >= n - 1) return v[n - 1] * Math.pow(1 + this.lastYearRate(), (pos - (n - 1)) / 12);
    const i = Math.floor(pos), f = pos - i;
    return v[i] + (v[i + 1] - v[i]) * f;
  },

  /** Hausse des prix entre deux dates (fraction) */
  between(from, to) { return this.level(to) / this.level(from) - 1; },

  /** L'indice est-il prolongé à cette date (après le dernier mois publié) ? */
  estimated(iso) { return iso.slice(0, 7) > CPI_FR.end; },

  /** Série [[date, valeur]] exprimée en monnaie constante de sa dernière date (pouvoir d'achat) */
  realSeries(series) {
    if (!series.length) return [];
    const ref = this.level(series[series.length - 1][0]);
    return series.map(([d, v]) => [d, v * ref / this.level(d)]);
  },

  /** Rendement réel (fraction) à partir d'un rendement nominal et de l'inflation sur la même période (fractions) */
  real(nominal, infl) { return (1 + nominal) / (1 + infl) - 1; },

  /**
   * Flux convertis en monnaie de la date `to` : chaque montant × (prix à `to` ÷ prix à sa date).
   * flows : [{ date: 'AAAA-MM-JJ', amount }] (apports négatifs, retraits et dividendes positifs).
   */
  deflate(flows, to) {
    const ref = this.level(to);
    return flows.map(f => ({ date: f.date, amount: f.amount * ref / this.level(f.date) }));
  },

  /**
   * Gain en euros courants et en pouvoir d'achat d'aujourd'hui.
   * `flows` : apports et retraits passés, `value` : valeur actuelle, `today` : date de cette valeur.
   * → { invested, investedReal, gain, gainReal, eaten } (eaten : part du gain absorbée par la hausse des prix)
   */
  gains(flows, value, today) {
    const invested = -flows.reduce((s, f) => s + f.amount, 0);
    const investedReal = -this.deflate(flows, today).reduce((s, f) => s + f.amount, 0);
    return { invested, investedReal, gain: value - invested, gainReal: value - investedReal, eaten: investedReal - invested };
  },

  /**
   * Performance année par année d'une série pondérée dans le temps [[date, indice]] : nominale, inflation et réelle
   * sur la même période (de la dernière valeur de l'année précédente, ou du premier point, à la dernière de l'année).
   */
  yearly(series) {
    const out = [];
    if (series.length < 2) return out;
    const years = Array.from(new Set(series.map(p => p[0].slice(0, 4)))).sort();
    for (const y of years) {
      const before = series.filter(p => p[0] < y + '-01-01').pop();
      const inYear = series.filter(p => p[0].startsWith(y));
      const a = before || inYear[0], b = inYear[inYear.length - 1];
      if (!a || !b || a[0] >= b[0] || !(a[1] > 0)) continue;
      const nominal = b[1] / a[1] - 1, infl = this.between(a[0], b[0]);
      out.push({ year: y, from: a[0], to: b[0], nominal, infl, real: this.real(nominal, infl),
        partial: !before || b[0].slice(5) < '12-20', estimated: this.estimated(b[0]) });
    }
    return out;
  },

  /** Rendement annualisé (fraction) d'une hausse totale sur `days` jours ; NaN sous 6 mois */
  annualize(total, days) { return days >= 182 ? Math.pow(1 + total, 365.25 / days) - 1 : NaN; },

  /**
   * Synthèse : performance pondérée dans le temps nominale et réelle (totale et annualisée), rendement de
   * l'investisseur (XIRR) nominal et réel, gains en euros courants et constants.
   * `twr` : [[date, indice]], `flows` : flux passés (ou null), `value` : valeur actuelle.
   */
  summary({ twr, flows, value, today = todayISO() }) {
    const first = twr[0], last = twr[twr.length - 1];
    const days = (Date.parse(last[0]) - Date.parse(first[0])) / 864e5;
    const nominal = last[1] / first[1] - 1, infl = this.between(first[0], last[0]);
    const real = this.real(nominal, infl);
    const out = { from: first[0], to: last[0], days, nominal, infl, real,
      nominalAnn: this.annualize(nominal, days), inflAnn: this.annualize(infl, days), realAnn: this.annualize(real, days),
      xirr: NaN, realXirr: NaN, gains: null };
    if (flows && flows.length && value > 0) {
      const tail = [{ date: today, amount: value }];
      out.xirr = Portfolio.xirr(flows.concat(tail)) / 100;
      out.realXirr = Portfolio.xirr(this.deflate(flows, today).concat(tail)) / 100;
      out.gains = this.gains(flows, value, today);
    }
    return out;
  },
};

/** « octobre 2026 » à partir de « 2026-10 » */
function fmtMonthFr(ym) {
  return new Date(ym + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

Object.assign(App, {
  /** Flux de l'investisseur (devise de base, au taux de change de chaque date) : achats négatifs, ventes et dividendes positifs ; null si un taux manque */
  investorFlows() {
    const flows = [];
    for (const t of Portfolio.txs()) {
      if (t.type === 'split') continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt(inst ? inst.currency : this.base(), t.date);
      if (!isFinite(fx)) return null;
      const gross = parseNum(t.qty) * parseNum(t.price), fees = parseNum(t.fees) || 0;
      flows.push({ date: t.date, amount: (t.type === 'sell' || t.type === 'div' ? gross - fees : -(gross + fees)) * fx });
    }
    return flows;
  },

  renderInflation() {
    const box = $('#inflBody');
    if (!box) return;
    if (!Portfolio.txs().some(t => t.type === 'buy')) {
      box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des opérations pour mesurer ce que ton portefeuille a gagné en pouvoir d\'achat.'));
      return;
    }
    const pts = this.historyPoints;
    if (!pts || pts.length < 2) {
      box.replaceChildren(el('p', { class: 'muted' }, 'Ton gain une fois la hausse des prix déduite : ce que ton argent permet vraiment d\'acheter en plus.'),
        el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', id: 'inflRun', onclick: async () => { await this.loadHistory(); this.renderInflation(); } }, 'Calculer')));
      return;
    }
    const twr = Portfolio.twr(pts);
    const value = Portfolio.snapshot().totals.value;
    const S = Inflation.summary({ twr, flows: this.investorFlows(), value: isFinite(value) ? value : NaN });
    const cur = this.base(), pct = (x, d = 1) => (isFinite(x) ? fmtPct(x * 100, d) : '—');
    const g = S.gains, ann = isFinite(S.realAnn);
    const yearly = Inflation.yearly(twr);
    let sentence = null;
    if (g && isFinite(g.gainReal)) {
      sentence = g.gainReal >= 0
        ? [`Tu as gagné ${fmtMoney(g.gain, cur, 0)} en euros courants, soit `, el('b', {}, `${fmtMoney(g.gainReal, cur, 0)} de pouvoir d'achat`),
          ` : la hausse des prix depuis tes versements en a absorbé ${fmtMoney(g.eaten, cur, 0)}.`]
        : [`En euros courants, ton résultat est de ${fmtSignedMoney(g.gain, cur)} ; avec la hausse des prix depuis tes versements (${fmtMoney(g.eaten, cur, 0)}), `,
          el('b', {}, `tu as perdu ${fmtMoney(-g.gainReal, cur, 0)} de pouvoir d'achat`), '.'];
    }
    box.replaceChildren(
      sentence ? el('p', { class: 'etfcmp-verdict infl-verdict ' + (g.gainReal >= 0 ? 'up' : 'down') }, ...sentence) : null,
      el('div', { class: 'kpis' },
        this.kpi(ann ? 'Performance réelle annualisée' : 'Performance réelle', pct(ann ? S.realAnn : S.real), 'pondérée dans le temps, inflation déduite', trendClass(ann ? S.realAnn : S.real),
          'Performance de tes placements (sans l\'effet de tes versements), diminuée de la hausse des prix sur la même période : (1 + performance) ÷ (1 + inflation) − 1.'),
        this.kpi(ann ? 'Performance nominale annualisée' : 'Performance nominale', pct(ann ? S.nominalAnn : S.nominal), 'avant inflation', trendClass(ann ? S.nominalAnn : S.nominal)),
        this.kpi(ann ? 'Inflation par an' : 'Inflation sur la période', pct(ann ? S.inflAnn : S.infl), 'depuis le ' + fmtDate(S.from)),
        isFinite(S.realXirr) ? this.kpi('Ton rendement réel (XIRR)', pct(S.realXirr), 'nominal : ' + pct(S.xirr), trendClass(S.realXirr),
          'Rendement annualisé de ton argent, chaque versement compté à sa date, après avoir ramené tous les montants en euros d\'aujourd\'hui.') : null),
      yearly.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'q-table infl-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Année'), el('th', { class: 'num' }, 'Performance'), el('th', { class: 'num' }, 'Inflation'), el('th', { class: 'num' }, 'Réelle'))),
        el('tbody', {}, ...yearly.slice().reverse().map(y => el('tr', {},
          el('td', {}, y.year, y.partial ? el('small', { class: 'muted' }, ` (${fmtDate(y.from)} → ${fmtDate(y.to)})`) : null),
          el('td', { class: 'num mono ' + trendClass(y.nominal) }, pct(y.nominal)),
          el('td', { class: 'num mono' }, pct(y.infl) + (y.estimated ? ' *' : '')),
          el('td', { class: 'num mono ' + trendClass(y.real) }, el('b', {}, pct(y.real)))))))) : null,
      noteTip(`Indice des prix à la consommation de l'INSEE (ensemble des ménages, France), mensuel, publié jusqu'en ${fmtMonthFr(CPI_FR.end)} ;`
        + ` au-delà (*), prolongé au rythme des 12 derniers mois (${fmtPct(Inflation.lastYearRate() * 100, 1)} par an).`
        + ' Performance pondérée dans le temps de tes lignes depuis ta première opération (espèces non investies exclues).'
        + ' Pouvoir d\'achat : chaque versement est ramené en euros d\'aujourd\'hui avant d\'être comparé à la valeur actuelle.'
        + ' Indice français : un ordre de grandeur si ta devise de référence n\'est pas l\'euro.', 'Source et méthode'));
  },
});

App.on('view:shown', function (page) { if (page === 'analysis/performance') this.renderInflation(); });
