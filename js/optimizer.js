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

  /**
   * Plafonne chaque poids à `cap` (0-1) en redistribuant l'excédent aux autres lignes, au prorata de leur poids
   * (à parts égales si elles sont toutes à 0). Suppose cap × nombre de lignes ≥ 1 (sinon impossible : renvoie w).
   */
  capWeights(w, cap) {
    if (!(cap < 1) || cap * w.length < 1 - 1e-9) return w.slice();
    const x = w.slice();
    for (let it = 0; it < 50; it++) {
      let excess = 0;
      const free = [];
      x.forEach((v, i) => { if (v > cap + 1e-12) { excess += v - cap; x[i] = cap; } else if (v < cap - 1e-12) free.push(i); });
      if (excess <= 1e-12 || !free.length) break;
      const base = free.reduce((s, i) => s + x[i], 0);
      free.forEach(i => { x[i] += base > 0 ? excess * x[i] / base : excess / free.length; });
    }
    return x;
  },

  /** Montants à vendre (négatifs) ou acheter (positifs) par ligne pour passer des valeurs actuelles à la répartition `w` */
  trades(values, w) {
    const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
    return values.map((v, i) => w[i] * total - (v > 0 ? v : 0));
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
   * plus les répartitions extrêmes ; renvoie aussi la moins risquée, celle au meilleur ratio de Sharpe et celle au
   * rendement maximal (le rendement d'un mélange étant la moyenne pondérée des lignes, c'est 100 % sur la meilleure ligne).
   */
  frontier(st, { n = 4000, rf = 0, seed = 42, current, cap = 1 } = {}) {
    const k = st.mean.length, rand = this.rng(seed);
    const points = [];
    // poids maximum par ligne : chaque répartition tirée est ramenée sous le plafond
    const push = w0 => { const w = cap < 1 ? this.capWeights(w0, cap) : w0; const m = this.measure(w, st, rf); points.push(Object.assign(m, { w })); };
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
    const maxRet = points.reduce((a, b) => (b.ret > a.ret ? b : a));
    return { points, minVol, maxSharpe, maxRet, current: current ? Object.assign(this.measure(current, st, rf), { w: current }) : null };
  },
};

const OPT_STORE = 'apistock:optOpts';

Object.assign(App, {
  /** Réglages de l'optimiseur : période (années), poids maximum par ligne (0-1), seulement les ETF éligibles au PEA */
  optOpts() {
    if (!this._optOpts) {
      let o = null;
      try { o = JSON.parse(localStorage.getItem(OPT_STORE) || 'null'); } catch (e) { o = null; }
      this._optOpts = Object.assign({ years: 3, cap: 1, pea: false }, o || {});
    }
    return this._optOpts;
  },

  renderOptOpts() {
    const box = $('#optOpts');
    if (!box) return;
    const o = this.optOpts();
    const set = (k, v) => { o[k] = v; try { localStorage.setItem(OPT_STORE, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ } this.renderOptOpts(); if (this.optResult) this.runOptimizer(); };
    box.replaceChildren(
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Période' }, ...[3, 5, 10].map(y =>
        el('button', { type: 'button', class: o.years === y ? 'active' : '', onclick: () => set('years', y) }, `${y} ans`))),
      el('label', { class: 'small' }, 'Poids max par ligne ',
        el('select', { onchange: e => set('cap', parseFloat(e.target.value)) },
          ...[[1, 'sans limite'], [0.6, '60 %'], [0.5, '50 %'], [0.4, '40 %'], [0.3, '30 %']].map(([v, l]) => el('option', { value: v, selected: o.cap === v || null }, l)))),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: o.pea || null, onchange: e => set('pea', e.target.checked) }), 'Seulement les ETF éligibles au PEA'));
  },

  /**
   * Coût estimé pour passer de la répartition actuelle à `w` : ventes et achats, frais de courtage (barème du compte),
   * impôt sur les plus-values réalisées. Ventes réparties entre les comptes au prorata de ce que chacun détient ;
   * arbitrage sans impôt dans un PEA, une assurance-vie ou un PER (l'argent y reste) ; impôt au taux du compte ailleurs.
   */
  optTransition(keys, values, w) {
    const deltas = Optimizer.trades(values, w);
    let sells = 0, buys = 0, fees = 0, tax = 0;
    const wrapper = acc => ['pea', 'av', 'per'].includes(acc && acc.type);
    keys.forEach((k, i) => {
      const d = deltas[i];
      if (Math.abs(d) < 1) return;
      const inst = Store.instrument(k), q = Api.cachedQuote(k);
      const fx = Api.fxCached(inst ? inst.currency : Store.state.settings.baseCurrency);
      if (!q || !(q.price > 0) || !(fx > 0)) return;
      const held = Store.state.accounts.map(a => { const p = Portfolio.positions(a.id).find(x => x.key === k); return { a, qty: p ? p.qty : 0 }; }).filter(x => x.qty > 0);
      if (d < 0) {
        sells += -d;
        const totalQty = held.reduce((s, x) => s + x.qty, 0);
        for (const h of held) {
          const sim = Portfolio.simulateSale(k, h.a.id, (-d / (q.price * fx)) * (h.qty / totalQty));
          if (!sim) continue;
          fees += sim.fees;
          if (!wrapper(h.a)) tax += sim.tax;
        }
      } else {
        buys += d;
        const acc = held.length ? held.sort((x, y) => y.qty - x.qty)[0].a : Store.state.accounts[0];
        fees += (Portfolio.brokerFee(acc, d / fx, fx) || 0) * fx;
      }
    });
    return { sells, buys, fees, tax };
  },

  /** Charge l'historique des lignes détenues (hors valeurs saisies) sur la période choisie et calcule le nuage */
  async runOptimizer() {
    const box = $('#optBody');
    const btn = $('#optRun');
    const o = this.optOpts();
    this.renderOptOpts();
    const { rows } = Portfolio.snapshot();
    let lines = rows.filter(r => !Manual.is(r.key) && isFinite(r.valueBase) && r.valueBase > 0);
    if (o.pea) lines = lines.filter(r => PEA_ELIGIBLE.has(Expo.dbSymbol(Store.instrument(r.key))));
    if (lines.length < 2) {
      box.replaceChildren(el('p', { class: 'muted' }, o.pea ? 'Il faut au moins deux lignes éligibles au PEA pour comparer des répartitions (décoche « Seulement les ETF éligibles au PEA »).' : 'Il faut au moins deux lignes cotées pour comparer des répartitions.'));
      return;
    }
    if (o.cap * lines.length < 1) {
      box.replaceChildren(el('p', { class: 'muted' }, `Avec ${lines.length} lignes, le poids maximum doit être d'au moins ${fmtNum(Math.ceil(100 / lines.length), 0)} % pour que la somme fasse 100 %.`));
      return;
    }
    btn.disabled = true; btn.textContent = 'Calcul…';
    try {
      const start = addDaysISO(todayISO(), -Math.round(o.years * 365.25));
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
      const values = al.keys.map(k => lines.find(r => r.key === k).valueBase);
      const current = values.map(v => v / total);
      const rf = (parseNum(Store.state.settings.riskFree) || 0) / 100;
      this.optResult = { al, st, values, opts: Object.assign({}, o), fr: Optimizer.frontier(st, { rf, current, cap: o.cap }), span: [al.dates[0], al.dates[al.dates.length - 1]] };
      this.renderOptimizer();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally {
      btn.disabled = false; btn.textContent = 'Recalculer';
    }
  },

  renderOptimizer(quiet = false) {
    const res = this.optResult;
    const box = $('#optBody');
    if (!res || !box) return;
    const { al, fr, span } = res;
    const pick = res.pick || null; // point choisi d'un clic sur le graphique
    const pct = v => fmtPct(v * 100, 1, false);
    /** Répartition d'un point, du poids le plus fort au plus faible (lignes à moins de 0,5 % omises) */
    const weights = w => al.keys.map((k, i) => [Store.label(k), w[i]]).filter(([, x]) => x >= 0.005).sort((a, b) => b[1] - a[1]);
    const apply = (p, name) => () => {
      if (!confirm(`Remplacer ton allocation cible par la répartition « ${name} » ?`)) return;
      for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
      al.keys.forEach((k, i) => { Store.state.targets[k] = Math.round(p.w[i] * 1000) / 10; });
      Store.save(); this.renderAll(); this.show('invest');
      toast(`Cible « ${name} » appliquée : le plan d'achat te dit quoi acheter pour t'en rapprocher.`, 'success', 6000);
    };
    const col = (p, name, cls, action) => el('div', { class: 'opt-col ' + cls },
      el('b', {}, name, cls === 'pick' ? el('button', { type: 'button', class: 'link small opt-unpick', onclick: () => { res.pick = null; this.renderOptimizer(true); } }, 'retirer') : null),
      el('div', { class: 'opt-num' }, el('span', {}, 'Rendement'), el('b', { class: trendClass(p.ret) }, fmtPct(p.ret * 100, 1))),
      el('div', { class: 'opt-num' }, el('span', {}, 'Volatilité'), el('b', {}, pct(p.vol))),
      el('div', { class: 'opt-num' }, el('span', {}, 'Sharpe'), el('b', {}, fmtNum(p.sharpe, 2))),
      el('ul', { class: 'opt-weights' }, ...al.keys.map((k, i) => el('li', {}, el('span', {}, Store.label(k)), el('b', { class: 'mono' }, fmtNum(p.w[i] * 100, 0) + ' %')))),
      cls !== 'current' && res.values ? (() => {
        const t = this.optTransition(al.keys, res.values, p.w);
        const cur = this.base();
        if (t.sells + t.buys < 1) return el('p', { class: 'small muted opt-move' }, 'Déjà ta répartition.');
        return el('p', { class: 'small opt-move' }, el('span', { class: 'muted' }, 'Pour y passer : '),
          `vendre ${fmtMoney(t.sells, cur, 0)}, acheter ${fmtMoney(t.buys, cur, 0)}`,
          el('br'), el('span', { class: 'muted' }, `frais ≈ ${fmtMoney(t.fees, cur, 0)} · impôt ≈ ${fmtMoney(t.tax, cur, 0)}`));
      })() : null,
      action ? el('button', { type: 'button', class: 'btn small', onclick: action }, 'Utiliser comme cible') : null);
    box.replaceChildren(
      el('div', { class: 'chart-box opt-chart' }, el('canvas', { id: 'optChart' })),
      el('div', { class: 'opt-cols' },
        fr.current ? col(fr.current, 'Ta répartition', 'current') : null,
        col(fr.minVol, 'La moins risquée', 'minvol', apply(fr.minVol, 'La moins risquée')),
        col(fr.maxSharpe, 'Meilleur rendement / risque', 'maxsharpe', apply(fr.maxSharpe, 'Meilleur rendement / risque')),
        col(fr.maxRet, 'Rendement maximal', 'maxret', apply(fr.maxRet, 'Rendement maximal')),
        pick ? col(pick, 'Point choisi', 'pick', apply(pick, 'Point choisi')) : null),
      el('p', { class: 'small muted opt-hint' }, pick
        ? 'Clique sur un autre point du nuage pour comparer une autre répartition.'
        : 'Survole un point pour voir sa répartition, clique dessus pour l\'ajouter à la comparaison ci-dessus.'),
      (() => {
        // historique commun plus court que la période demandée : l'ETF le plus récent limite la période
        const yrs = (new Date(span[1]) - new Date(span[0])) / (365.25 * 86400000);
        return res.opts && yrs < res.opts.years - 0.5 ? el('p', { class: 'small warn-text' }, `Historique commun limité à ${fmtNum(yrs, 1)} an(s) au lieu de ${res.opts.years} : une de tes lignes est plus récente.`) : '';
      })(),
      noteTip(`Calculé sur les cours de clôture du ${fmtDate(span[0])} au ${fmtDate(span[1])} (${fr.points.length} répartitions simulées, positions positives uniquement${res.opts && res.opts.cap < 1 ? `, ${fmtNum(res.opts.cap * 100, 0)} % au plus par ligne` : ''}${res.opts && res.opts.pea ? ', lignes éligibles au PEA seulement' : ''}, taux sans risque des Réglages). « Pour y passer » : ventes et achats au cours actuel, frais selon le barème de chaque compte, impôt sur les plus-values réalisées hors PEA, assurance-vie et PER (un arbitrage à l'intérieur n'est pas imposé). Une période passée favorable à un indice ne se reproduit pas forcément : à lire comme un éclairage sur le couple risque / rendement, pas comme une prévision.`, 'Méthode et limites'));
    const pt = p => ({ x: p.vol * 100, y: p.ret * 100, w: p.w, p });
    Charts.scatter('optChart', [
      { label: 'Répartitions simulées', data: fr.points.map(pt), backgroundColor: Charts.css('--muted') + '30', pointRadius: 2, pointHoverRadius: 5, pointHoverBackgroundColor: Charts.css('--text') },
      ...(fr.current ? [{ label: 'Ta répartition', data: [pt(fr.current)], backgroundColor: Charts.css('--accent'), pointRadius: 8, pointStyle: 'circle' }] : []),
      { label: 'La moins risquée', data: [pt(fr.minVol)], backgroundColor: '#6366f1', pointRadius: 8, pointStyle: 'rectRot' },
      { label: 'Meilleur rendement / risque', data: [pt(fr.maxSharpe)], backgroundColor: '#f59e0b', borderColor: '#b45309', borderWidth: 1.5, pointRadius: 9, pointStyle: 'triangle' },
      { label: 'Rendement maximal', data: [pt(fr.maxRet)], backgroundColor: '#db2777', borderColor: '#9d174d', borderWidth: 1.5, pointRadius: 10, pointStyle: 'star' },
      ...(pick ? [{ label: 'Point choisi', data: [pt(pick)], backgroundColor: 'transparent', borderColor: Charts.css('--text'), borderWidth: 2.5, pointRadius: 9, pointStyle: 'circle' }] : []),
    ], {
      // info-bulle : répartition du point survolé
      extra: raw => (raw.w ? weights(raw.w).map(([n, x]) => `   ${n} : ${fmtNum(x * 100, 0)} %`) : []),
      // clic : le point le plus proche rejoint la comparaison sous le graphique
      onPick: raw => { if (raw && raw.p) { res.pick = raw.p; this.renderOptimizer(true); } },
    }, quiet);
  },
});
