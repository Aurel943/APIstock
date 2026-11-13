/*
 * Outils institutionnels : ce que les banques et les grands gérants utilisent, appliqué à ton portefeuille.
 *
 * - Stress test inversé : au lieu de « combien je perds si… », la question retournée : quel est le scénario de marché
 *   le plus plausible qui ferait perdre X % ? Plus petit choc (distance de Mahalanobis) sur les facteurs qui produit
 *   cette perte d'après les sensibilités de tes lignes, et sa probabilité (méthode demandée aux banques par les régulateurs).
 * - Black-Litterman : tes convictions (rendement attendu d'une ligne, ou écart entre deux lignes, avec un niveau de
 *   confiance) mélangées à l'équilibre implicite de ta répartition actuelle → rendements révisés et répartition optimale
 *   (moyenne-variance, sans vente à découvert, poids plafonné).
 * - Planificateur probabiliste : 3 000 trajectoires futures tirées par blocs de 12 mois dans l'historique réel (depuis
 *   2000, indices suivis) de ta répartition, avec tes versements mensuels et l'inflation → probabilité d'atteindre un
 *   objectif, éventail des résultats et versement mensuel nécessaire pour 50, 75 ou 90 % de chances.
 *
 * Calculs purs dans l'objet Inst (tests/institut.test.mjs) ; affichage en bas du fichier.
 */
'use strict';

const INST_CONF = { low: { name: 'faible', c: 0.25 }, mid: { name: 'moyenne', c: 0.5 }, high: { name: 'forte', c: 0.8 } };

const Inst = {
  /* ------------------------------------------------------------------ */
  /* Algèbre                                                              */
  /* ------------------------------------------------------------------ */

  /** Inverse d'une petite matrice (Gauss-Jordan avec pivot) ; null si singulière */
  inv(A) {
    const n = A.length;
    const M = A.map((r, i) => r.slice().concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-15) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f) for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(r => r.slice(n));
  },
  mv(A, x) { return A.map(r => r.reduce((s, a, j) => s + a * x[j], 0)); },
  mm(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0))); },
  tr(A) { return A[0].map((_, j) => A.map(r => r[j])); },
  dot(a, b) { return a.reduce((s, x, i) => s + x * b[i], 0); },

  /** Fonction de répartition de la loi normale centrée réduite */
  normCdf(z) {
    // queue extrême (|z| > 5) : développement asymptotique de Mills, précis là où l'approximation d'erf s'effondre
    if (Math.abs(z) > 5) {
      const a = Math.abs(z), tail = Math.exp(-a * a / 2) / (a * Math.sqrt(2 * Math.PI)) * (1 - 1 / (a * a) + 3 / a ** 4 - 15 / a ** 6);
      return z < 0 ? tail : 1 - tail;
    }
    // Abramowitz-Stegun 7.1.26 sur erf
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  },

  /* ------------------------------------------------------------------ */
  /* Stress test inversé                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Scénario le plus plausible produisant une perte relative `loss` (ex. −0,25) sur l'horizon `weeks`.
   * `model` : Quant.factorModel (bêtas hebdomadaires, covariance hebdomadaire des facteurs) ; `values` : { clé: valeur }.
   * Exposition b = Σ (poids × bêtas) ; covariance sur l'horizon Σh = semaines × Σ. Le choc s qui minimise sᵀΣh⁻¹s
   * sous bᵀs = perte vaut s* = perte · Σh b / (bᵀΣh b), à la distance d = |perte| / √(bᵀΣh b) « écarts-types ».
   */
  reverseStress(model, values, loss, weeks = 4) {
    const keys = model.lineKeys.filter(k => values[k] > 0);
    const total = keys.reduce((s, k) => s + values[k], 0);
    if (!(total > 0) || !(loss < 0)) return null;
    const nf = model.factorKeys.length;
    const b = new Array(nf).fill(0);
    for (const k of keys) model.betas[k].beta.forEach((x, i) => { b[i] += values[k] / total * x; });
    const S = model.cov.map(r => r.map(c => c * weeks));
    const Sb = this.mv(S, b), var_ = this.dot(b, Sb);
    if (!(var_ > 0)) return null;
    const shock = Sb.map(x => loss * x / var_);
    const d = Math.abs(loss) / Math.sqrt(var_);
    const p = this.normCdf(-d); // probabilité qu'une période de `weeks` semaines fasse au moins aussi mal (loi normale)
    const lines = keys.map(k => {
      const r = Math.max(-1, model.betas[k].beta.reduce((s, x, i) => s + x * shock[i], 0));
      return { key: k, ret: r, pnl: values[k] * r, r2: model.betas[k].r2 };
    });
    return { shock: Object.fromEntries(model.factorKeys.map((f, i) => [f, shock[i]])), d, p, years: p > 0 ? weeks / 52 / p : Infinity,
      vol: Math.sqrt(var_), lines, pnl: lines.reduce((s, l) => s + l.pnl, 0), total };
  },

  /* ------------------------------------------------------------------ */
  /* Black-Litterman                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Rendements révisés de Black-Litterman.
   * `cov` : covariance annuelle des lignes ; `w` : poids de référence (équilibre) ; `views` : [{ p: [coef par ligne], q: rendement
   * annuel attendu, conf: 0..1 }] (vue absolue : p = 1 sur une ligne ; relative : +1 / −1). Ω = (1−c)/c · τ·pΣpᵀ (Idzorek simplifié).
   * Renvoie { pi (équilibre), mu (révisés), sigma (covariance a posteriori) }.
   */
  blackLitterman({ cov, w, views = [], delta = 2.5, tau = 0.05 }) {
    const n = w.length;
    const pi = this.mv(cov, w).map(x => delta * x);
    const tS = cov.map(r => r.map(c => c * tau));
    if (!views.length) return { pi, mu: pi.slice(), sigma: cov.map((r, i) => r.map((c, j) => c + tS[i][j])) };
    const P = views.map(v => v.p), Q = views.map(v => v.q);
    const omega = views.map((v, i) => {
      const c = Math.min(0.99, Math.max(0.01, v.conf));
      return ((1 - c) / c) * this.dot(P[i], this.mv(tS, P[i]));
    });
    const tSi = this.inv(tS);
    if (!tSi) return null;
    const Pt = this.tr(P);
    const PtOiP = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => views.reduce((s, _v, k) => s + Pt[i][k] * P[k][j] / omega[k], 0)));
    const A = tSi.map((r, i) => r.map((x, j) => x + PtOiP[i][j]));
    const Ai = this.inv(A);
    if (!Ai) return null;
    const rhs = this.mv(tSi, pi).map((x, i) => x + views.reduce((s, _v, k) => s + Pt[i][k] * Q[k] / omega[k], 0));
    const mu = this.mv(Ai, rhs);
    return { pi, mu, sigma: cov.map((r, i) => r.map((c, j) => c + Ai[i][j])) };
  },

  /** Projection sur { 0 ≤ wᵢ ≤ cap, Σw = 1 } (recherche du seuil par dichotomie) */
  project(v, cap = 1) {
    const n = v.length, c = Math.max(cap, 1 / n);
    let lo = Math.min(...v) - c, hi = Math.max(...v);
    const sum = t => v.reduce((s, x) => s + Math.min(c, Math.max(0, x - t)), 0);
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (sum(m) > 1) lo = m; else hi = m; }
    return v.map(x => Math.min(c, Math.max(0, x - (lo + hi) / 2)));
  },

  /** Répartition optimale : max wᵀμ − δ/2·wᵀΣw, sans vente à découvert, poids ≤ cap (gradient projeté) */
  optimize(mu, cov, { delta = 2.5, cap = 1, iters = 3000 } = {}) {
    const n = mu.length;
    let w = this.project(new Array(n).fill(1 / n), cap);
    const L = delta * Math.max(...cov.map((r, i) => r.reduce((s, c, j) => s + Math.abs(c) + (i === j ? 0 : 0), 0))) || 1;
    const step = 1 / L;
    for (let k = 0; k < iters; k++) {
      const g = this.mv(cov, w).map((x, i) => mu[i] - delta * x);
      const nw = this.project(w.map((x, i) => x + step * g[i]), cap);
      const moved = nw.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
      w = nw;
      if (moved < 1e-10) break;
    }
    return w;
  },

  /** Rendement et volatilité annuels d'une répartition */
  stats(w, mu, cov) {
    const v = this.dot(w, this.mv(cov, w));
    return { ret: this.dot(w, mu), vol: Math.sqrt(Math.max(0, v)) };
  },

  /* ------------------------------------------------------------------ */
  /* Planificateur probabiliste                                           */
  /* ------------------------------------------------------------------ */

  /** Générateur pseudo-aléatoire reproductible (mulberry32) */
  rng(seed = 7) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },

  /** Rendements mensuels d'une répartition rééquilibrée chaque mois (`P` : Desk.panel) */
  portfolioMonthly(P, w) {
    const out = [];
    for (let i = 1; i < P.px.length; i++) out.push(w.reduce((s, x, j) => s + x * (P.px[i][j] / P.px[i - 1][j] - 1), 0));
    return out;
  },

  /**
   * Scénarios de rendements mensuels : `paths` trajectoires de `months` mois, construites par blocs consécutifs de `block`
   * mois tirés au hasard dans l'historique (bootstrap par blocs : garde l'enchaînement des krachs et des rebonds).
   */
  scenarios(rets, months, { paths = 3000, block = 12, seed = 7 } = {}) {
    const r = this.rng(seed), n = rets.length, out = [];
    const b = Math.max(1, Math.min(block, n));
    for (let p = 0; p < paths; p++) {
      const path = new Float64Array(months);
      for (let m = 0; m < months;) {
        const s = Math.floor(r() * (n - b + 1));
        for (let k = 0; k < b && m < months; k++, m++) path[m] = rets[s + k];
      }
      out.push(path);
    }
    return out;
  },

  /**
   * Valeurs finales (et, si `track`, valeurs mois par mois) pour un capital de départ et un versement mensuel ;
   * `inflation` (annuelle) ramène tout en euros d'aujourd'hui ; `fees` (annuels) retirés chaque mois.
   */
  simulate(scen, { start, monthly, inflation = 0, fees = 0, track = false }) {
    const months = scen[0] ? scen[0].length : 0;
    const defl = Math.pow(1 + inflation, 1 / 12), fee = Math.pow(1 - fees, 1 / 12);
    const finals = new Float64Array(scen.length), tracks = track ? Array.from({ length: months + 1 }, () => new Float64Array(scen.length)) : null;
    for (let p = 0; p < scen.length; p++) {
      let v = start;
      if (track) tracks[0][p] = v;
      for (let m = 0; m < months; m++) {
        v = (v * (1 + scen[p][m]) * fee + monthly) / defl;
        if (track) tracks[m + 1][p] = v;
      }
      finals[p] = v;
    }
    return { finals, tracks };
  },

  /** Quantile q (0..1) d'un tableau de nombres */
  quantile(arr, q) {
    const s = Array.from(arr).sort((a, b) => a - b);
    if (!s.length) return NaN;
    const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  },

  /** Probabilité d'atteindre `target` */
  prob(finals, target) { let k = 0; for (const v of finals) if (v >= target) k++; return finals.length ? k / finals.length : NaN; },

  /** Versement mensuel minimal pour atteindre `target` avec probabilité `p` (mêmes scénarios : résultat stable) */
  requiredMonthly(scen, { start, target, p, inflation = 0, fees = 0, max = 1e6 }) {
    const ok = m => this.prob(this.simulate(scen, { start, monthly: m, inflation, fees }).finals, target) >= p;
    if (ok(0)) return 0;
    let lo = 0, hi = 100;
    while (!ok(hi)) { lo = hi; hi *= 2; if (hi > max) return Infinity; }
    for (let i = 0; i < 40 && hi - lo > 1; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    return Math.ceil(hi);
  },
};

/* ==================== Affichage ==================== */

Object.assign(App, {
  bindInstitut() {
    if ($('#iStressRun')) $('#iStressRun').addEventListener('click', () => this.runReverseStress());
    if ($('#iBlRun')) $('#iBlRun').addEventListener('click', () => this.runBlackLitterman());
    if ($('#iPlanRun')) $('#iPlanRun').addEventListener('click', () => this.runPlanner());
    this.on('view:shown', v => { if (v === 'simulation') this.renderPlannerForm(); });
  },

  /** Séries en devise de base de tes lignes, prolongées par l'indice suivi (depuis `start`) */
  async instSeries(lines, start, extend = true) {
    const series = {}, sources = [], missing = [];
    for (const l of lines) {
      let own = null, proxy = null;
      try { own = await this.quantSeries(l.key, start); } catch (e) { own = null; }
      const p = extend ? LAB_PROXY[Expo.of(l.key).profile] : null;
      if (p) { try { proxy = await this.quantSeries('Y:' + p[0], start, p[1]); } catch (e) { proxy = null; } }
      const s = own && own.length ? (proxy && proxy.length ? Lab.extend(own, proxy) : own) : proxy;
      if (s && s.length > 30) { series[l.key] = s; if (proxy && own && own.length && proxy[0][0] < own[0][0]) sources.push(`${Store.label(l.key)} avant ${own[0][0].slice(0, 4)} → ${p[2]}`); }
      else missing.push(Store.label(l.key));
    }
    return { series, sources, missing };
  },

  /* ---------- stress test inversé ---------- */

  async runReverseStress() {
    const box = $('#iStressBody'), btn = $('#iStressRun');
    const lines = this.quantLines();
    if (!lines.length) { this.quantEmpty(box, 'Ajoute des positions pour lancer le stress test inversé.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -5 * 365);
      const factors = {}, lineSeries = {};
      for (const f of QUANT_FACTORS) { try { factors[f.id] = await Api.daily('Y:' + f.sym, start); } catch (e) { /* facteur ignoré */ } }
      for (const l of lines) { try { lineSeries[l.key] = await this.quantSeries(l.key, start); } catch (e) { /* ligne ignorée */ } }
      const model = Quant.factorModel(lineSeries, factors);
      if (!model || !model.lineKeys.length) throw new Error('Pas assez d\'historique commun (au moins six mois) entre tes lignes et les facteurs de marché.');
      this.stress = { model, values: Object.fromEntries(lines.map(l => [l.key, l.value])), loss: this.stress ? this.stress.loss : 25, weeks: this.stress ? this.stress.weeks : 4 };
      this.renderReverseStress();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderReverseStress() {
    const S = this.stress, box = $('#iStressBody');
    if (!S || !box) return;
    const cur = this.base();
    const out = el('div');
    const slider = el('input', { type: 'range', min: 5, max: 60, step: 1, value: S.loss, 'aria-label': 'Perte visée en %' });
    const lossLbl = el('b', { class: 'mono down' });
    const horizon = el('div', { class: 'seg small' }, ...[[1, '1 semaine'], [4, '1 mois'], [13, '3 mois'], [52, '1 an']].map(([w, t]) =>
      el('button', { type: 'button', class: w === S.weeks ? 'active' : '', onclick: e => { S.weeks = w; $$('button', horizon).forEach(b => b.classList.toggle('active', b === e.currentTarget)); update(); } }, t)));
    const facName = id => (QUANT_FACTORS.find(f => f.id === id) || { name: id }).name;
    const freq = y => (!isFinite(y) ? 'pratiquement jamais (d\'après la loi normale)' : y < 1 ? `environ ${fmtNum(1 / y, 1)} fois par an` : y < 1000 ? `environ une fois tous les ${fmtNum(y, y < 10 ? 1 : 0)} ans` : 'moins d\'une fois par millénaire (d\'après la loi normale)');
    const update = () => {
      S.loss = +slider.value;
      lossLbl.textContent = '−' + S.loss + ' %';
      const r = Inst.reverseStress(S.model, S.values, -S.loss / 100, S.weeks);
      if (!r) { out.replaceChildren(el('p', { class: 'muted' }, 'Calcul impossible avec ces données.')); return; }
      const hz = { 1: 'une semaine', 4: 'un mois', 13: 'trois mois', 52: 'un an' }[S.weeks];
      out.replaceChildren(
        el('p', { class: 'q-lead' }, 'Le scénario le plus plausible qui ferait perdre ', el('b', { class: 'down' }, `${S.loss} % (${fmtMoney(r.pnl, cur, 0)})`), ` en ${hz} : `,
          ...Object.entries(r.shock).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).flatMap(([f, v], i) => [i ? ', ' : '', el('b', {}, facName(f)), ' ', el('span', { class: 'mono ' + trendClass(v) }, fmtPct(v * 100, 1))]), '.'),
        el('div', { class: 'q-kpis' },
          el('div', { class: 'q-kpi' }, el('span', { class: 'muted small' }, 'Fréquence théorique'), el('b', {}, freq(r.years)), el('small', { class: 'muted' }, `choc à ${fmtNum(r.d, 1)} écarts-types`)),
          el('div', { class: 'q-kpi' }, el('span', { class: 'muted small' }, 'Volatilité sur ' + hz), el('b', { class: 'mono' }, fmtPct(r.vol * 100, 1, false)), el('small', { class: 'muted' }, 'expliquée par les facteurs'))),
        el('table', { class: 'q-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Variation'), el('th', { class: 'num' }, 'En ' + cur), el('th', { class: 'num' }, 'Fiabilité'))),
          el('tbody', {}, ...r.lines.sort((a, b) => a.pnl - b.pnl).map(l => el('tr', {}, el('td', {}, Store.label(l.key)),
            el('td', { class: 'num mono ' + trendClass(l.ret) }, fmtPct(l.ret * 100, 1)), el('td', { class: 'num mono ' + trendClass(l.pnl) }, fmtSignedMoney(l.pnl, cur)),
            el('td', { class: 'num mono' }, fmtNum(l.r2 * 100, 0) + ' %'))))),
        el('p', { class: 'small muted' }, r.d > 4 ? 'Au-delà de 4 écarts-types, la loi normale sous-estime fortement le risque : les krachs réels (1987, 2008, 2020) étaient « impossibles » selon elle. Lis la fréquence comme un minimum.' : 'Les marchés ont des queues épaisses : ce genre de choc arrive en réalité plus souvent que ne le dit la loi normale.'));
    };
    slider.addEventListener('input', update);
    box.replaceChildren(
      el('div', { class: 'i-stress-ctrl' }, el('label', {}, el('span', {}, 'Perte que je ne veux pas subir'), lossLbl, slider), horizon),
      out,
      noteTip(`Sensibilités de chaque ligne aux facteurs (régression sur ${S.model.weeks.length} rendements hebdomadaires) et covariance des facteurs, mise à l'échelle de l'horizon. Parmi tous les chocs de facteurs qui produisent cette perte, on retient celui dont la distance de Mahalanobis (√ sᵀΣ⁻¹s) est la plus petite : le plus probable selon les corrélations historiques. C'est le « reverse stress test » que les régulateurs bancaires (EBA, Bâle) demandent aux banques. Le risque propre à chaque ligne (hors facteurs) n'est pas compté.`, 'Méthode et limites'));
    update();
  },

  /* ---------- Black-Litterman ---------- */

  async runBlackLitterman() {
    const box = $('#iBlBody'), btn = $('#iBlRun');
    const lines = this.quantLines();
    if (lines.length < 2) { this.quantEmpty(box, 'Il faut au moins deux lignes cotées pour optimiser une répartition.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -5 * 365);
      const { series, missing } = await this.instSeries(lines, start, false);
      const al = Quant.weeklyReturns(series);
      if (al.returns.length < 52) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins un an).');
      const cov = Quant.covariance(al.returns).cov.map(r => r.map(c => c * 52));
      const total = al.keys.reduce((s, k) => s + lines.find(l => l.key === k).value, 0);
      const w = al.keys.map(k => lines.find(l => l.key === k).value / total);
      this.bl = { keys: al.keys, cov, w, missing, views: (this.bl && this.bl.views) || {}, rel: (this.bl && this.bl.rel) || null, cap: (this.bl && this.bl.cap) || 60, span: [al.weeks[0], al.weeks[al.weeks.length - 1]] };
      this.renderBlackLitterman();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderBlackLitterman() {
    const B = this.bl, box = $('#iBlBody');
    if (!B || !box) return;
    const pct = (v, d = 1) => (isFinite(v) ? fmtPct(v * 100, d) : '—');
    const pi = Inst.blackLitterman({ cov: B.cov, w: B.w }).pi;
    const out = el('div');
    const viewInputs = B.keys.map((k, i) => {
      const v = B.views[k] || {};
      const q = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: fmtNum(pi[i] * 100, 1), value: v.q !== undefined ? v.q : '', 'aria-label': 'Rendement annuel attendu ' + Store.label(k) });
      const c = el('select', { 'aria-label': 'Confiance' }, ...Object.entries(INST_CONF).map(([id, x]) => el('option', { value: id }, x.name)));
      c.value = v.conf || 'mid';
      const save = () => { B.views[k] = { q: q.value.trim(), conf: c.value }; update(); };
      q.addEventListener('input', save); c.addEventListener('change', save);
      return el('tr', {}, el('td', {}, Store.label(k)), el('td', { class: 'num mono' }, fmtPct(B.w[i] * 100, 0, false)), el('td', { class: 'num mono muted' }, pct(pi[i])),
        el('td', { class: 'num' }, el('span', { class: 'i-view' }, q, '%')), el('td', {}, c));
    });
    // vue relative : A fera mieux que B de x %
    const optKeys = () => B.keys.map(k => el('option', { value: k }, Store.label(k)));
    const ra = el('select', { 'aria-label': 'Ligne A' }, el('option', { value: '' }, '—'), ...optKeys()), rb = el('select', { 'aria-label': 'Ligne B' }, ...optKeys());
    const rq = el('input', { type: 'number', step: '0.5', inputmode: 'decimal', placeholder: '3', 'aria-label': 'Écart annuel en %' });
    const rc = el('select', { 'aria-label': 'Confiance' }, ...Object.entries(INST_CONF).map(([id, x]) => el('option', { value: id }, x.name)));
    if (B.rel) { ra.value = B.rel.a; rb.value = B.rel.b; rq.value = B.rel.q; rc.value = B.rel.conf; } else rc.value = 'mid';
    const saveRel = () => { B.rel = ra.value && rb.value && ra.value !== rb.value && rq.value.trim() !== '' ? { a: ra.value, b: rb.value, q: rq.value, conf: rc.value } : null; update(); };
    [ra, rb, rc].forEach(x => x.addEventListener('change', saveRel)); rq.addEventListener('input', saveRel);
    const cap = el('input', { type: 'number', min: 10, max: 100, step: 5, value: B.cap, 'aria-label': 'Poids maximum par ligne en %' });
    cap.addEventListener('input', () => { B.cap = Math.min(100, Math.max(10, parseNum(cap.value) || 60)); update(); });
    const update = () => {
      const views = [];
      B.keys.forEach((k, i) => {
        const v = B.views[k];
        if (v && v.q !== '' && isFinite(parseNum(v.q))) views.push({ p: B.keys.map((_, j) => (j === i ? 1 : 0)), q: parseNum(v.q) / 100, conf: INST_CONF[v.conf].c });
      });
      if (B.rel) views.push({ p: B.keys.map(k => (k === B.rel.a ? 1 : k === B.rel.b ? -1 : 0)), q: parseNum(B.rel.q) / 100, conf: INST_CONF[B.rel.conf].c });
      const r = Inst.blackLitterman({ cov: B.cov, w: B.w, views });
      if (!r) { out.replaceChildren(el('p', { class: 'muted' }, 'Calcul impossible (matrice singulière).')); return; }
      const opt = Inst.optimize(r.mu, r.sigma, { cap: B.cap / 100 });
      const now = Inst.stats(B.w, r.mu, r.sigma), best = Inst.stats(opt, r.mu, r.sigma);
      const apply = () => {
        for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
        B.keys.forEach((k, i) => { Store.state.targets[k] = Math.round(opt[i] * 1000) / 10; });
        Store.save(); this.renderAll(); this.show('invest');
        toast('Répartition Black-Litterman appliquée comme cible : le plan d\'achat te dit quoi acheter pour t\'en rapprocher.', 'success', 6000);
      };
      out.replaceChildren(
        el('p', { class: 'q-lead' }, views.length ? `${views.length} conviction${views.length > 1 ? 's' : ''} prise${views.length > 1 ? 's' : ''} en compte. ` : 'Sans conviction, le modèle retrouve ta répartition actuelle : c\'est son point d\'équilibre. ',
          'Rendement attendu ', el('b', {}, pct(now.ret)), ' → ', el('b', { class: 'up' }, pct(best.ret)), ' pour une volatilité ', el('b', {}, fmtPct(now.vol * 100, 1, false)), ' → ', el('b', {}, fmtPct(best.vol * 100, 1, false)), '.'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'q-table i-bl-out' },
          el('thead', {}, el('tr', {}, ...['Ligne', 'Rendement révisé', 'Aujourd\'hui', 'Optimal', 'Écart'].map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
          el('tbody', {}, ...B.keys.map((k, i) => el('tr', {}, el('td', {}, Store.label(k)), el('td', { class: 'num mono ' + trendClass(r.mu[i]) }, pct(r.mu[i])),
            el('td', { class: 'num mono' }, fmtPct(B.w[i] * 100, 0, false)), el('td', { class: 'num mono' }, el('b', {}, fmtPct(opt[i] * 100, 0, false))),
            el('td', { class: 'num mono ' + trendClass(opt[i] - B.w[i]) }, (opt[i] - B.w[i] >= 0 ? '+' : '') + fmtNum((opt[i] - B.w[i]) * 100, 0) + ' pts')))))),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small', onclick: apply }, 'Utiliser comme cible')));
    };
    box.replaceChildren(
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table i-views' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Poids'), el('th', { class: 'num' }, el('span', {}, 'Équilibre', infoTip('Rendement que ta répartition actuelle « suppose » implicitement (rendements d\'équilibre de Black-Litterman : δ·Σ·w). C\'est le point de départ, modifié par tes convictions.'))),
          el('th', { class: 'num' }, 'Ma conviction (par an)'), el('th', {}, 'Confiance'))),
        el('tbody', {}, ...viewInputs))),
      el('div', { class: 'i-rel' }, el('span', { class: 'small muted' }, 'Vue relative :'), ra, el('span', { class: 'small' }, 'fera mieux que'), rb, el('span', { class: 'small' }, 'de'), el('span', { class: 'i-view' }, rq, '% par an'), rc,
        el('label', { class: 'small i-cap' }, el('span', {}, 'Poids max'), cap, el('span', {}, '%'))),
      out,
      noteTip(`Covariance de tes lignes sur ${fmtDate(B.span[0])} → ${fmtDate(B.span[1])} (rendements hebdomadaires annualisés). Rendements d'équilibre Π = δΣw (aversion au risque δ = 2,5, τ = 0,05) ; chaque conviction est pondérée par sa confiance (incertitude Ω = (1−c)/c · τ·PΣPᵀ). Rendements révisés μ = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹[(τΣ)⁻¹Π + PᵀΩ⁻¹Q], puis répartition qui maximise rendement − δ/2 · variance, sans vente à découvert et avec un poids maximum. Modèle de Fischer Black et Robert Litterman (Goldman Sachs, 1990). Les rendements révisés ne sont pas des prévisions : ils traduisent tes convictions de façon cohérente.`, 'Méthode'));
    update();
  },

  /* ---------- planificateur probabiliste ---------- */

  renderPlannerForm() {
    const sel = $('#iPlanGoal');
    if (!sel || sel.dataset.ready) return;
    sel.dataset.ready = '1';
    const goals = typeof Goals !== 'undefined' ? Goals.all() : [];
    sel.replaceChildren(...goals.map(g => el('option', { value: g.id }, g.name || 'Objectif principal')), el('option', { value: '' }, 'Objectif libre…'));
    const fill = () => {
      const g = goals.find(x => x.id === sel.value);
      $('#iPlanCustom').classList.toggle('hidden', !!g);
      if (g) { $('#iPlanTarget').value = parseNum(g.target) || ''; if (g.date) $('#iPlanDate').value = g.date; if (parseNum(g.monthly) > 0) $('#iPlanMonthly').value = parseNum(g.monthly); }
    };
    sel.addEventListener('change', fill);
    const plans = (Store.state.plans || []).filter(p => p.active !== false).reduce((s, p) => s + (parseNum(p.amount) || 0), 0);
    if (plans > 0) $('#iPlanMonthly').value = Math.round(plans);
    if (!$('#iPlanDate').value) $('#iPlanDate').value = addMonthsISO(todayISO(), 120);
    fill();
  },

  async runPlanner() {
    const box = $('#iPlanBody'), btn = $('#iPlanRun');
    const target = parseNum($('#iPlanTarget').value), date = $('#iPlanDate').value, monthly = parseNum($('#iPlanMonthly').value) || 0;
    const months = date ? this.monthsBetween(todayISO(), date) : 0;
    if (!(target > 0) || !(months >= 6)) { box.replaceChildren(el('p', { class: 'muted' }, 'Indique un objectif et une date dans au moins six mois.')); return; }
    const lines = this.quantLines();
    btn.disabled = true; btn.textContent = 'Simulation…';
    box.classList.add('dk-loading');
    try {
      let rets, label, sources = [], missing = [];
      if (lines.length) {
        const s = await this.instSeries(lines, '1999-06-01');
        sources = s.sources; missing = s.missing;
        const P = Desk.panel(s.series);
        if (P.months.length < 37) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins trois ans).');
        const total = P.keys.reduce((a, k) => a + lines.find(l => l.key === k).value, 0);
        rets = Inst.portfolioMonthly(P, P.keys.map(k => lines.find(l => l.key === k).value / total));
        label = `ta répartition actuelle, ${P.months[0]} → ${P.months[P.months.length - 1]}`;
      } else {
        const s = await this.quantSeries('Y:' + HIST_BENCH.ysym, '1999-06-01', HIST_BENCH.ccy);
        const P = Desk.panel({ m: s });
        rets = Inst.portfolioMonthly(P, [1]);
        label = `le ${HIST_BENCH.name}, ${P.months[0]} → ${P.months[P.months.length - 1]}`;
      }
      const start = Portfolio.snapshot('all').totals.value + (Portfolio.cashTotal('all').cash || 0);
      const inflation = $('#iPlanReal').checked ? 0.02 : 0;
      const scen = Inst.scenarios(rets, months, { paths: 3000, block: 12, seed: 2026 });
      const sim = Inst.simulate(scen, { start, monthly, inflation, track: true });
      const need = [0.5, 0.75, 0.9].map(p => [p, Inst.requiredMonthly(scen, { start, target, p, inflation })]);
      this.plan = { target, date, months, monthly, start, inflation, prob: Inst.prob(sim.finals, target), sim, need, label, sources, missing, n: rets.length,
        q: [0.1, 0.25, 0.5, 0.75, 0.9].map(q => Inst.quantile(sim.finals, q)) };
      this.renderPlanner();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally { btn.disabled = false; btn.textContent = 'Simuler 3 000 futurs'; box.classList.remove('dk-loading'); }
  },

  renderPlanner() {
    const P = this.plan, box = $('#iPlanBody');
    if (!P || !box) return;
    const cur = this.base(), m = v => fmtMoney(v, cur, 0);
    const pct = Math.round(P.prob * 100);
    const verdict = pct >= 90 ? ['🟢', 'Très probable'] : pct >= 70 ? ['🟢', 'Probable'] : pct >= 45 ? ['🟡', 'Une chance sur deux'] : pct >= 20 ? ['🟠', 'Peu probable'] : ['🔴', 'Très improbable'];
    box.replaceChildren(...[
      el('div', { class: 'i-plan-hero' },
        el('div', { class: 'i-gauge', style: `--p:${pct}` }, el('b', { class: 'mono' }, pct + ' %'), el('span', { class: 'small muted' }, 'de chances')),
        el('div', {}, el('b', { class: 'i-verdict' }, verdict[0] + ' ' + verdict[1]),
          el('p', {}, `d'atteindre ${m(P.target)}${P.inflation ? ' (en euros d\'aujourd\'hui)' : ''} d'ici ${fmtDate(P.date)}, en partant de ${m(P.start)} avec ${m(P.monthly)} par mois.`),
          el('p', { class: 'small muted' }, `Dans la moitié des futurs simulés, tu aurais plus de ${m(P.q[2])} ; dans les 10 % les pires, moins de ${m(P.q[0])} ; dans les 10 % les meilleurs, plus de ${m(P.q[4])}.`))),
      el('div', { class: 'i-need' }, ...P.need.map(([p, v]) => el('div', { class: P.monthly >= v ? 'ok' : '' },
        el('span', { class: 'small muted' }, `Pour ${Math.round(p * 100)} % de chances`),
        el('b', { class: 'mono' }, isFinite(v) ? m(v) + ' / mois' : 'hors de portée'),
        el('small', { class: 'muted' }, !isFinite(v) ? '' : P.monthly >= v ? '✓ déjà le cas' : `+${m(v - P.monthly)} par mois`)))),
      el('div', { class: 'chart-box i-plan-chart' }, el('canvas', { id: 'iPlanChart' })),
      P.missing.length ? el('p', { class: 'small lab-warn' }, 'Sans historique, ignorées : ' + P.missing.join(', ')) : null,
      noteTip(`3 000 futurs de ${P.months} mois, construits en recollant au hasard des blocs de 12 mois consécutifs tirés dans ${P.n} mois d'historique réel de ${P.label} (bootstrap par blocs : les krachs et les rebonds gardent leur enchaînement et leur violence, sans supposer de loi normale).${P.sources.length ? ' Historique prolongé par l\'indice suivi : ' + P.sources.join(' · ') + '.' : ''} Versement à la fin de chaque mois, rééquilibrage mensuel, hors frais et impôts${P.inflation ? ', inflation de 2 % par an déduite' : ''}. Le versement nécessaire est calculé sur les mêmes futurs.`, 'Méthode')].filter(Boolean));
    if (typeof Chart !== 'undefined') {
      Charts.destroy('iPlanChart');
      const o = Charts.baseOptions();
      o.plugins.legend.display = false;
      o.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label} : ${m(c.raw)}` };
      o.scales.y.ticks.callback = v => fmtNum(v / 1000, 0) + ' k';
      o.scales.x.ticks.maxTicksLimit = innerWidth < 640 ? 4 : 8;
      o.elements = { point: { radius: 0, hoverRadius: 3 } };
      const step = Math.max(1, Math.round(P.months / 120));
      const idx = Array.from({ length: P.months + 1 }, (_, i) => i).filter(i => i % step === 0 || i === P.months);
      const q = qq => idx.map(i => Inst.quantile(P.sim.tracks[i], qq));
      const labels = idx.map(i => addMonthsISO(todayISO(), i).slice(0, 7));
      const accent = Charts.css('--accent');
      Charts.instances.iPlanChart = new Chart($('#iPlanChart'), { type: 'line', options: o, data: { labels, datasets: [
        { label: '90 % des cas au-dessous', data: q(0.9), borderColor: 'transparent', backgroundColor: accent + '22', fill: '+2' },
        { label: 'Médiane', data: q(0.5), borderColor: accent, borderWidth: 2.5, fill: false },
        { label: '10 % des cas au-dessous', data: q(0.1), borderColor: 'transparent', fill: false },
        { label: 'Objectif', data: idx.map(() => P.target), borderColor: Charts.css('--down'), borderDash: [6, 4], borderWidth: 1.5, fill: false },
      ] } });
    }
  },
});
