/*
 * Exposition aux styles (Analyse › Risque) : vers quoi penche vraiment ton portefeuille — sociétés bon marché
 * (value) ou chères (croissance), petites ou grandes capitalisations, momentum, qualité, faible volatilité.
 * Chaque ligne est régressée (rendements hebdomadaires sur 3 ans) sur le marché mondial et sur l'écart entre un
 * ETF « style » MSCI World et le MSCI World lui-même (même société de gestion, même devise : l'effet de change
 * s'annule). Une exposition de +0,3 au style value : la ligne gagne 0,3 % de plus que le marché quand les sociétés
 * value font 1 % de mieux que lui. L'exposition du portefeuille est la moyenne pondérée de celles de ses lignes.
 * Calculs purs (objet Styles) testés dans tests/styles.test.mjs ; affichage en bas du fichier.
 */
'use strict';

/* Marché : MSCI World en devise de base (rendement des lignes) et en dollars (référence des écarts de style) */
const STYLE_MARKET = { sym: 'IWDA.AS', ccy: 'EUR', usd: 'IWDA.L' };
/* Styles : ETF iShares MSCI World « factor », cotés à Londres en dollars, capitalisants */
const STYLE_FACTORS = [
  { id: 'value', sym: 'IWVL.L', name: 'Value / croissance', pos: 'sociétés bon marché (value)', neg: 'sociétés de croissance, chères (tech)',
    tip: 'MSCI World Value Factor : sociétés peu chères au regard de leurs bénéfices, de leurs ventes et de leurs dividendes. Négatif : penche vers la croissance.' },
  { id: 'size', sym: 'WSML.L', name: 'Petites capitalisations', pos: 'petites sociétés', neg: 'géants de la cote',
    tip: 'MSCI World Small Cap. Négatif : plus concentré sur les très grandes sociétés que le marché.' },
  { id: 'momentum', sym: 'IWMO.L', name: 'Momentum', pos: 'gagnants récents (momentum)', neg: 'valeurs délaissées',
    tip: 'MSCI World Momentum : les actions qui ont le plus monté sur 6 à 12 mois.' },
  { id: 'quality', sym: 'IWQU.L', name: 'Qualité', pos: 'sociétés rentables et peu endettées', neg: 'sociétés moins rentables',
    tip: 'MSCI World Sector Neutral Quality : rentabilité élevée, bénéfices stables, peu de dette.' },
  { id: 'lowvol', sym: 'MVOL.L', name: 'Faible volatilité', pos: 'valeurs défensives', neg: 'valeurs plus nerveuses que le marché',
    tip: 'MSCI World Minimum Volatility : le portefeuille d\'actions mondiales le moins agité possible.' },
];

const Styles = {
  /**
   * Expositions de chaque ligne. `lines` : { clé: [[date, cours en devise de base]] } ;
   * `market` : MSCI World en devise de base, `marketUsd` : MSCI World en dollars, `factors` : { id: [[date, cours en dollars]] }.
   * → { weeks, factorIds, betas: { clé: { market, value…, alpha, r2 } } } ; null si moins de 52 semaines communes.
   */
  fit({ lines, market, marketUsd, factors }) {
    const ids = STYLE_FACTORS.map(f => f.id).filter(id => factors[id] && factors[id].length);
    const all = { M: market, U: marketUsd };
    for (const id of ids) all['F:' + id] = factors[id];
    for (const [k, s] of Object.entries(lines)) all['L:' + k] = s;
    const w = Quant.weeklyReturns(all);
    if (w.returns.length < 52) return null;
    const ix = name => w.keys.indexOf(name);
    const iM = ix('M'), iU = ix('U');
    if (iM < 0 || iU < 0) return null;
    const X = w.returns.map(r => [r[iM], ...ids.map(id => r[ix('F:' + id)] - r[iU])]);
    const betas = {};
    for (const k of Object.keys(lines)) {
      const i = ix('L:' + k);
      if (i < 0) continue;
      const fit = Quant.ols(w.returns.map(r => r[i]), X);
      if (!fit) continue;
      const b = { market: fit.beta[0], alpha: fit.alpha * 52, r2: fit.r2 };
      ids.forEach((id, j) => { b[id] = fit.beta[j + 1]; });
      betas[k] = b;
    }
    return { weeks: w.weeks, factorIds: ids, betas };
  },

  /** Exposition du portefeuille : moyenne des expositions des lignes pondérée par leur valeur ({ clé: valeur }) */
  portfolio(betas, values) {
    const keys = Object.keys(betas).filter(k => values[k] > 0);
    const total = keys.reduce((s, k) => s + values[k], 0);
    if (!(total > 0)) return null;
    const out = {};
    for (const k of keys) for (const [f, b] of Object.entries(betas[k])) if (isFinite(b)) out[f] = (out[f] || 0) + b * values[k] / total;
    return out;
  },

  /** Intensité d'une exposition : neutre (< 0,1), légère (< 0,3) ou marquée */
  level(b) { const a = Math.abs(b); return !isFinite(b) || a < 0.1 ? 'neutre' : a < 0.3 ? 'légère' : 'marquée'; },

  /** Phrase de synthèse : les deux penchants les plus nets (ou « proche du marché ») */
  sentence(p) {
    const tilts = STYLE_FACTORS.filter(f => isFinite(p[f.id]) && Math.abs(p[f.id]) >= 0.1)
      .sort((a, b) => Math.abs(p[b.id]) - Math.abs(p[a.id])).slice(0, 2)
      .map(f => `${p[f.id] > 0 ? f.pos : f.neg} (${this.level(p[f.id])})`);
    return tilts.length ? 'Ton portefeuille penche vers les ' + tilts.join(' et les ') + '.' : 'Ton portefeuille ressemble au marché mondial : aucun penchant de style net.';
  },
};

Object.assign(App, {
  async runStyles() {
    const box = $('#styleBody'), btn = $('#styleRun');
    if (!box) return;
    const lines = this.quantLines();
    if (!lines.length) { this.quantEmpty(box, 'Ajoute des positions pour mesurer leurs penchants de style.'); return; }
    if (!Api.hasProxy()) { this.quantEmpty(box, 'Le relais Yahoo est nécessaire pour charger les indices de style (Réglages).'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -3 * 365 - 7);
      const market = await this.quantSeries('Y:' + STYLE_MARKET.sym, start, STYLE_MARKET.ccy);
      const marketUsd = await Api.daily('Y:' + STYLE_MARKET.usd, start);
      const factors = {};
      for (const f of STYLE_FACTORS) { try { factors[f.id] = await Api.daily('Y:' + f.sym, start); } catch (e) { /* style indisponible : ignoré */ } }
      const series = {};
      for (const l of lines) { try { series[l.key] = await this.quantSeries(l.key, start); } catch (e) { /* ligne sans historique */ } }
      const fit = Styles.fit({ lines: series, market, marketUsd, factors });
      if (!fit || !Object.keys(fit.betas).length) throw new Error('Pas assez d\'historique commun (au moins un an) entre tes lignes et les indices de style.');
      const values = Object.fromEntries(lines.map(l => [l.key, l.value]));
      this._styleResult = { fit, values, port: Styles.portfolio(fit.betas, values) };
      this.renderStyles();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderStyles() {
    const S = this._styleResult, box = $('#styleBody');
    if (!S || !box || !S.port) return;
    const P = S.port, facs = STYLE_FACTORS.filter(f => S.fit.factorIds.includes(f.id));
    const n = x => (isFinite(x) ? (x >= 0 ? '+' : '−') + fmtNum(Math.abs(x), 2) : '—');
    const max = Math.max(0.5, ...facs.map(f => Math.abs(P[f.id] || 0)));
    const keys = Object.keys(S.fit.betas).sort((a, b) => (S.values[b] || 0) - (S.values[a] || 0));
    box.replaceChildren(
      el('p', { class: 'etfcmp-verdict style-verdict' }, Styles.sentence(P),
        isFinite(P.market) ? ` Sensibilité au marché mondial : ${fmtNum(P.market, 2)} (${P.market > 1.1 ? 'tu amplifies ses mouvements' : P.market < 0.9 ? 'tu amortis ses mouvements' : 'tu suis le marché'}).` : ''),
      el('ul', { class: 'attr-bars style-bars' }, ...facs.map(f => {
        const v = P[f.id] || 0;
        return el('li', {},
          el('span', { class: 'attr-name' }, f.name, infoTip(f.tip)),
          el('span', { class: 'attr-track', title: v >= 0 ? f.pos : f.neg },
            el('span', { class: 'attr-fill ' + (v >= 0 ? 'up' : 'down'), style: `width:${Math.min(50, Math.abs(v) / max * 50)}%;${v >= 0 ? 'left:50%' : 'right:50%'}` })),
          el('b', { class: 'mono' }, n(v)), el('small', { class: 'muted style-lvl' }, Styles.level(v) === 'neutre' ? 'neutre' : (v > 0 ? f.pos : f.neg)));
      })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table style-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Marché'), ...facs.map(f => el('th', { class: 'num' }, f.name.split(' /')[0])),
          el('th', { class: 'num' }, el('span', {}, 'Fiabilité', infoTip('Part des variations de la ligne expliquée par le marché et les styles (R²).'))))),
        el('tbody', {}, ...keys.map(k => { const b = S.fit.betas[k]; return el('tr', {},
          el('td', {}, Store.label(k)),
          el('td', { class: 'num mono' }, fmtNum(b.market, 2)),
          ...facs.map(f => el('td', { class: 'num mono ' + (Math.abs(b[f.id]) >= 0.3 ? 'style-strong' : Math.abs(b[f.id]) < 0.1 ? 'muted' : '') }, n(b[f.id]))),
          el('td', { class: 'num mono' }, fmtNum(b.r2 * 100, 0) + ' %')); })))),
      noteTip(`Régression des rendements hebdomadaires de chaque ligne (${S.fit.weeks.length} semaines depuis le ${fmtDate(S.fit.weeks[0])}) sur le MSCI World en ${this.base()} et sur l'écart de rendement de cinq ETF iShares MSCI World « factor » (${STYLE_FACTORS.map(f => f.sym).join(', ')}) face au MSCI World (${STYLE_MARKET.usd}), tous en dollars.`
        + ' Lecture : 0 = comme le marché ; ±0,1 à 0,3 : penchant léger ; au-delà : marqué. Les styles sont liés entre eux (momentum et qualité, par exemple) : les chiffres se lisent ensemble, comme des tendances plutôt qu\'au centième près.', 'Méthode'));
  },
});

App.on('view:shown', function (page) {
  if (page !== 'analysis/risque' || this._styleBound || !$('#styleRun')) return;
  this._styleBound = true;
  $('#styleRun').addEventListener('click', () => this.runStyles());
});
