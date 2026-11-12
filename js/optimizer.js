/*
 * Optimiseur de répartition (théorie moderne du portefeuille, Markowitz) : à partir des cours de clôture réels
 * de tes lignes, rendement et volatilité annualisés de milliers de répartitions tirées au hasard, puis les deux
 * portefeuilles remarquables (moins risqué, meilleur rendement par unité de risque). Le passé ne prédit pas l'avenir :
 * c'est un éclairage, pas une recommandation.
 */
'use strict';

const Optimizer = {
  /** Générateur pseudo-aléatoire reproductible (mulberry32) */
  rng(seed = 42) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },

  /**
   * Rendements journaliers alignés sur les dates communes à toutes les séries.
   * `series` : { clé: [[date, cours]] } → { keys, dates, returns: [[r_clé1, r_clé2…] par jour] }
   */
  align(series) {
    const keys = Object.keys(series).filter(k => (series[k] || []).length > 1);
    const maps = keys.map(k => new Map(series[k]));
    const dates = series[keys[0]] ? series[keys[0]].map(v => v[0]).filter(d => maps.every(m => m.has(d))) : [];
    const returns = [];
    for (let i = 1; i < dates.length; i++) {
      const row = maps.map(m => m.get(dates[i]) / m.get(dates[i - 1]) - 1);
      if (row.every(isFinite)) returns.push(row);
    }
    return { keys, dates, returns };
  },

  /** Moyennes et covariances annualisées (252 séances) */
  stats(returns) {
    const n = returns.length, k = returns[0] ? returns[0].length : 0;
    const mean = new Array(k).fill(0);
    for (const r of returns) for (let i = 0; i < k; i++) mean[i] += r[i] / n;
    const cov = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of returns) for (let i = 0; i < k; i++) for (let j = i; j < k; j++) cov[i][j] += (r[i] - mean[i]) * (r[j] - mean[j]) / (n - 1);
    for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
    return { mean: mean.map(m => m * 252), cov: cov.map(row => row.map(c => c * 252)) };
  },

  /** Rendement, volatilité et ratio de Sharpe annualisés d'une répartition `w` (somme 1) */
  measure(w, { mean, cov }, rf = 0) {
    let ret = 0, v = 0;
    for (let i = 0; i < w.length; i++) { ret += w[i] * mean[i]; for (let j = 0; j < w.length; j++) v += w[i] * w[j] * cov[i][j]; }
    const vol = Math.sqrt(Math.max(0, v));
    return { ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : NaN };
  },

  /**
   * Nuage de `n` répartitions aléatoires (positions positives, somme 100 %, lignes à 0 % comprises),
   * plus les répartitions extrêmes ; renvoie aussi la moins risquée et celle au meilleur ratio de Sharpe.
   */
  frontier(st, { n = 4000, rf = 0, seed = 42, current } = {}) {
    const k = st.mean.length, rand = this.rng(seed);
    const points = [];
    const push = w => { const m = this.measure(w, st, rf); points.push(Object.assign(m, { w })); };
    for (let i = 0; i < k; i++) push(Array.from({ length: k }, (_, j) => (j === i ? 1 : 0)));
    for (let s = 0; s < n; s++) {
      // tirage de Dirichlet (exposants variés pour explorer aussi les répartitions concentrées)
      const alpha = s % 3 === 0 ? 0.3 : 1;
      const g = Array.from({ length: k }, () => Math.pow(-Math.log(1 - rand()), 1 / alpha));
      const sum = g.reduce((a, b) => a + b, 0);
      push(g.map(x => x / sum));
    }
    const minVol = points.reduce((a, b) => (b.vol < a.vol ? b : a));
    const maxSharpe = points.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
    return { points, minVol, maxSharpe, current: current ? Object.assign(this.measure(current, st, rf), { w: current }) : null };
  },
};

Object.assign(App, {
  /** Charge ~3 ans d'historique des lignes détenues (hors valeurs saisies) et calcule le nuage */
  async runOptimizer() {
    const box = $('#optBody');
    const btn = $('#optRun');
    const { rows } = Portfolio.snapshot();
    const lines = rows.filter(r => !Manual.is(r.key) && isFinite(r.valueBase) && r.valueBase > 0);
    if (lines.length < 2) { box.replaceChildren(el('p', { class: 'muted' }, 'Il faut au moins deux lignes cotées pour comparer des répartitions.')); return; }
    btn.disabled = true; btn.textContent = 'Calcul…';
    try {
      const start = addDaysISO(todayISO(), -3 * 365);
      const series = {};
      for (const r of lines) {
        const s = await Api.daily(r.key, start);
        const fx = Api.fxCached(r.currency);
        series[r.key] = s.map(([d, v]) => [d, v * (isFinite(fx) && fx > 0 ? fx : 1)]); // en devise de base
      }
      const al = Optimizer.align(series);
      if (al.returns.length < 120) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins six mois).');
      const st = Optimizer.stats(al.returns);
      const total = lines.reduce((s, r) => s + r.valueBase, 0);
      const current = al.keys.map(k => lines.find(r => r.key === k).valueBase / total);
      const rf = (parseNum(Store.state.settings.riskFree) || 0) / 100;
      this.optResult = { al, st, fr: Optimizer.frontier(st, { rf, current }), span: [al.dates[0], al.dates[al.dates.length - 1]] };
      this.renderOptimizer();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally {
      btn.disabled = false; btn.textContent = 'Recalculer';
    }
  },

  renderOptimizer() {
    const res = this.optResult;
    const box = $('#optBody');
    if (!res || !box) return;
    const { al, fr, span } = res;
    const pct = v => fmtPct(v * 100, 1, false);
    const apply = (p, name) => () => {
      if (!confirm(`Remplacer ton allocation cible par la répartition « ${name} » ?`)) return;
      for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
      al.keys.forEach((k, i) => { Store.state.targets[k] = Math.round(p.w[i] * 1000) / 10; });
      Store.save(); this.renderAll(); this.show('invest');
      toast(`Cible « ${name} » appliquée : le plan d'achat te dit quoi acheter pour t'en rapprocher.`, 'success', 6000);
    };
    const col = (p, name, cls, action) => el('div', { class: 'opt-col ' + cls },
      el('b', {}, name),
      el('div', { class: 'opt-num' }, el('span', {}, 'Rendement'), el('b', { class: trendClass(p.ret) }, fmtPct(p.ret * 100, 1))),
      el('div', { class: 'opt-num' }, el('span', {}, 'Volatilité'), el('b', {}, pct(p.vol))),
      el('div', { class: 'opt-num' }, el('span', {}, 'Sharpe'), el('b', {}, fmtNum(p.sharpe, 2))),
      el('ul', { class: 'opt-weights' }, ...al.keys.map((k, i) => el('li', {}, el('span', {}, Store.label(k)), el('b', { class: 'mono' }, fmtNum(p.w[i] * 100, 0) + ' %')))),
      action ? el('button', { type: 'button', class: 'btn small', onclick: action }, 'Utiliser comme cible') : null);
    box.replaceChildren(
      el('div', { class: 'chart-box opt-chart' }, el('canvas', { id: 'optChart' })),
      el('div', { class: 'opt-cols' },
        fr.current ? col(fr.current, 'Ta répartition', 'current') : null,
        col(fr.minVol, 'La moins risquée', 'minvol', apply(fr.minVol, 'La moins risquée')),
        col(fr.maxSharpe, 'Meilleur rendement / risque', 'maxsharpe', apply(fr.maxSharpe, 'Meilleur rendement / risque'))),
      noteTip(`Calculé sur les cours de clôture du ${fmtDate(span[0])} au ${fmtDate(span[1])} (${fr.points.length} répartitions simulées, positions positives uniquement, taux sans risque des Réglages). Une période passée favorable à un indice ne se reproduit pas forcément : à lire comme un éclairage sur le couple risque / rendement, pas comme une prévision.`, 'Méthode et limites'));
    Charts.scatter('optChart', [
      { label: 'Répartitions simulées', data: fr.points.map(p => ({ x: p.vol * 100, y: p.ret * 100 })), backgroundColor: Charts.css('--muted') + '30', pointRadius: 2, pointHoverRadius: 2 },
      ...(fr.current ? [{ label: 'Ta répartition', data: [{ x: fr.current.vol * 100, y: fr.current.ret * 100 }], backgroundColor: Charts.css('--accent'), pointRadius: 8, pointStyle: 'circle' }] : []),
      { label: 'La moins risquée', data: [{ x: fr.minVol.vol * 100, y: fr.minVol.ret * 100 }], backgroundColor: '#6366f1', pointRadius: 8, pointStyle: 'rectRot' },
      { label: 'Meilleur rendement / risque', data: [{ x: fr.maxSharpe.vol * 100, y: fr.maxSharpe.ret * 100 }], backgroundColor: '#f59e0b', borderColor: '#b45309', borderWidth: 1.5, pointRadius: 9, pointStyle: 'triangle' },
    ]);
  },
});
