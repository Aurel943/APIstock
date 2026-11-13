/*
 * Labo quant : les outils des salles de marché, appliqués à ton portefeuille, calculés dans ton navigateur.
 *
 * - Crash-test historique : ton portefeuille actuel rejoué dans les grandes crises (bulle internet, subprimes,
 *   zone euro, Covid, inflation 2022) grâce aux indices que suivent tes ETF → perte, durée de la baisse, retour au plus haut.
 * - Scénarios conditionnels : régression de chaque ligne sur des facteurs de marché (actions mondiales, tech, Europe,
 *   dollar, or) ; tu imposes un choc sur un ou plusieurs facteurs, les autres suivent selon leurs corrélations
 *   historiques (espérance conditionnelle gaussienne), et l'impact se lit ligne par ligne.
 * - Anatomie du risque : contribution de chaque ligne au risque total (décomposition d'Euler), ratio de
 *   diversification, nombre effectif de paris indépendants (analyse en composantes principales), perte probable à
 *   un mois (VaR et Expected Shortfall historiques, VaR de Cornish-Fisher), répartition à risque égal (risk parity).
 * - Météo des marchés : modèle de Markov caché à deux régimes (calme / agité) estimé par l'algorithme de Baum-Welch
 *   sur les rendements hebdomadaires du MSCI World → probabilité d'être aujourd'hui en régime agité.
 * - Audit comportemental : tes dates d'achat et de vente face à des dates neutres (achat le 1er du mois),
 *   achats après les hausses (peur de rater), ventes dans les baisses, écart entre ton rendement d'investisseur
 *   (pondéré par l'argent) et celui de tes placements (pondéré par le temps).
 *
 * Les fonctions de calcul (objet Quant) sont pures et testées (tests/quant.test.mjs) ; l'affichage est en bas du fichier.
 * Un éclairage statistique sur le passé, pas une prévision ni un conseil.
 */
'use strict';

/* Grandes crises : du plus haut d'avant crise au point bas de l'indice de référence */
const QUANT_CRISES = [
  { id: 'dotcom', name: 'Bulle internet', start: '2000-03-24', end: '2002-10-09', story: 'Les valeurs technologiques s\'effondrent après des années d\'euphorie.' },
  { id: 'gfc', name: 'Crise des subprimes', start: '2007-10-09', end: '2009-03-09', story: 'Faillite de Lehman Brothers, crise bancaire mondiale.' },
  { id: 'euro', name: 'Crise de la zone euro', start: '2011-05-02', end: '2011-10-04', story: 'Dettes grecque, italienne et espagnole, doutes sur l\'euro.' },
  { id: 'covid', name: 'Krach du Covid', start: '2020-02-19', end: '2020-03-23', story: 'Confinements mondiaux : la baisse la plus rapide de l\'histoire.' },
  { id: 'infl', name: 'Inflation et hausse des taux', start: '2022-01-03', end: '2022-10-12', story: 'Retour de l\'inflation, les banques centrales relèvent leurs taux.' },
];

/* Facteurs de marché (symboles Yahoo) : rendements dans leur devise, sauf le dollar exprimé en euros */
const QUANT_FACTORS = [
  { id: 'world', sym: 'IWDA.AS', name: 'Actions mondiales', hint: 'MSCI World, en euros' },
  { id: 'tech', sym: '^NDX', name: 'Tech américaine', hint: 'Nasdaq-100' },
  { id: 'europe', sym: '^STOXX', name: 'Actions européennes', hint: 'Stoxx Europe 600' },
  { id: 'usd', sym: 'USDEUR=X', name: 'Dollar', hint: 'valeur d\'un dollar en euros' },
  { id: 'gold', sym: 'GC=F', name: 'Or', hint: 'once d\'or, en dollars' },
];

/* Scénarios prêts à l'emploi (chocs en % sur les facteurs imposés ; les autres suivent leurs corrélations) */
const QUANT_PRESETS = [
  { name: 'Krach de la tech', shocks: { tech: -30 } },
  { name: 'Récession mondiale', shocks: { world: -25 } },
  { name: 'Le dollar chute', shocks: { usd: -15 } },
  { name: 'Crise européenne', shocks: { europe: -20, usd: 8 } },
  { name: 'Fuite vers l\'or', shocks: { world: -15, gold: 20 } },
];

/* Indice du marché pour la météo (MSCI World coté en euros, depuis 2009) */
const QUANT_REGIME = { sym: 'IWDA.AS', name: 'MSCI World', since: '2010-01-01' };

const Quant = {
  /* ---------- algèbre linéaire (petites matrices) ---------- */

  /** Résout A·x = b (élimination de Gauss avec pivot partiel) ; null si la matrice est singulière */
  solve(A, b) {
    const n = A.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  },

  /** Valeurs et vecteurs propres d'une matrice symétrique (méthode de Jacobi) ; vecteurs en colonnes, valeurs décroissantes */
  eigen(S) {
    const n = S.length;
    const A = S.map(r => r.slice());
    const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    const order = A.map((r, i) => i).sort((a, b) => A[b][b] - A[a][a]);
    return { values: order.map(i => A[i][i]), vectors: order.map(i => V.map(r => r[i])) };
  },

  /** Covariance (non annualisée) des colonnes d'un tableau de lignes [[x1, x2…], …] */
  covariance(rows) {
    const n = rows.length, k = rows[0] ? rows[0].length : 0;
    const mean = new Array(k).fill(0);
    for (const r of rows) for (let i = 0; i < k; i++) mean[i] += r[i] / n;
    const cov = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) for (let i = 0; i < k; i++) for (let j = i; j < k; j++) cov[i][j] += (r[i] - mean[i]) * (r[j] - mean[j]) / Math.max(1, n - 1);
    for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
    return { mean, cov };
  },

  /** Moyenne, écart-type, asymétrie et kurtosis en excès */
  moments(x) {
    const n = x.length;
    const mean = x.reduce((a, b) => a + b, 0) / n;
    let m2 = 0, m3 = 0, m4 = 0;
    for (const v of x) { const d = v - mean; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    m2 /= n; m3 /= n; m4 /= n;
    const sd = Math.sqrt(m2);
    return { n, mean, sd: Math.sqrt(m2 * n / Math.max(1, n - 1)), skew: sd > 0 ? m3 / sd ** 3 : 0, kurt: sd > 0 ? m4 / sd ** 4 - 3 : 0 };
  },

  /* ---------- séries ---------- */

  /** Numéro de semaine (lundi → dimanche) d'une date ISO */
  week(d) { return Math.floor((Date.parse(d + 'T00:00:00Z') / 864e5 + 3) / 7); },

  /**
   * Rendements hebdomadaires alignés (dernier cours de chaque semaine, semaines communes à toutes les séries).
   * Les places européennes et américaines ne ferment pas à la même heure : l'hebdomadaire évite ce décalage.
   * `series` : { clé: [[date, cours]] } → { keys, weeks: [date de fin], returns: [[r1, r2…]] }
   */
  weeklyReturns(series) {
    const keys = Object.keys(series).filter(k => (series[k] || []).length > 1);
    const last = keys.map(k => { const m = new Map(); for (const [d, v] of series[k]) if (v > 0) m.set(this.week(d), [d, v]); return m; });
    if (!keys.length) return { keys, weeks: [], returns: [] };
    const weeks = Array.from(last[0].keys()).filter(w => last.every(m => m.has(w))).sort((a, b) => a - b);
    const returns = [], ends = [];
    for (let i = 1; i < weeks.length; i++) {
      const row = last.map(m => m.get(weeks[i])[1] / m.get(weeks[i - 1])[1] - 1);
      if (row.every(isFinite)) { returns.push(row); ends.push(last[0].get(weeks[i])[0]); }
    }
    return { keys, weeks: ends, returns };
  },

  /** Cours à une date (dernier connu à cette date ou avant), série triée */
  at(s, d) {
    let lo = 0, hi = s.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid][0] <= d) { best = s[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  },

  /* ---------- crash-test ---------- */

  /** La série couvre-t-elle la crise (un cours dans les 10 jours avant le début, et jusqu'à la fin) ? */
  covers(s, crisis) {
    return !!(s && s.length && s[0][0] <= crisis.start && s[s.length - 1][0] >= crisis.end
      && this.at(s, crisis.start) !== null && s.some(p => p[0] <= crisis.start && p[0] >= addDaysISO(crisis.start, -10)));
  },

  /**
   * Portefeuille à poids constants au début de la crise (achat puis conservation), rejoué jour par jour.
   * `series` : { clé: [[date, cours]] } (une série par ligne, déjà en devise de base) ; `weights` : { clé: poids }.
   * → { mdd (≤ 0), peakDate, troughDate, recoveryDate | null, recoveryDays, path: [[date, valeur base 1]] }
   */
  crash(series, weights, crisis) {
    const keys = Object.keys(weights).filter(k => weights[k] > 0 && series[k]);
    if (!keys.length) return null;
    const wsum = keys.reduce((s, k) => s + weights[k], 0);
    const p0 = Object.fromEntries(keys.map(k => [k, this.at(series[k], crisis.start)]));
    if (keys.some(k => !(p0[k] > 0))) return null;
    const dates = Array.from(new Set(keys.flatMap(k => series[k].map(p => p[0]).filter(d => d >= crisis.start)))).sort();
    const path = dates.map(d => [d, keys.reduce((s, k) => s + weights[k] / wsum * (this.at(series[k], d) / p0[k]), 0)]);
    let peak = 1, peakDate = crisis.start, mdd = 0, troughDate = crisis.start, mddPeak = 1, mddPeakDate = crisis.start;
    for (const [d, v] of path) {
      if (d > crisis.end) break;
      if (v > peak) { peak = v; peakDate = d; }
      if (v / peak - 1 < mdd) { mdd = v / peak - 1; troughDate = d; mddPeak = peak; mddPeakDate = peakDate; }
    }
    let recoveryDate = null;
    for (const [d, v] of path) if (d > troughDate && v >= mddPeak) { recoveryDate = d; break; }
    const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    return {
      mdd, peakDate: mddPeakDate, troughDate, recoveryDate,
      fallDays: days(mddPeakDate, troughDate),
      recoveryDays: recoveryDate ? days(troughDate, recoveryDate) : null,
      path: path.filter(p => !recoveryDate || p[0] <= addDaysISO(recoveryDate, 60)),
    };
  },

  /* ---------- modèle à facteurs et scénarios ---------- */

  /**
   * Régression linéaire y = a + X·b (moindres carrés, légère régularisation ridge sur les pentes pour
   * stabiliser des facteurs corrélés entre eux). → { alpha, beta: [...], r2 }
   */
  ols(y, X, ridge = 1e-3) {
    const n = y.length, k = X[0] ? X[0].length : 0;
    const Z = X.map(r => [1].concat(r));
    const A = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    const b = new Array(k + 1).fill(0);
    for (let t = 0; t < n; t++) for (let i = 0; i <= k; i++) {
      b[i] += Z[t][i] * y[t];
      for (let j = 0; j <= k; j++) A[i][j] += Z[t][i] * Z[t][j];
    }
    let tr = 0;
    for (let i = 1; i <= k; i++) tr += A[i][i];
    for (let i = 1; i <= k; i++) A[i][i] += ridge * (tr / Math.max(1, k));
    const coef = this.solve(A, b);
    if (!coef) return null;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let ssr = 0, sst = 0;
    for (let t = 0; t < n; t++) {
      const fit = Z[t].reduce((s, z, i) => s + z * coef[i], 0);
      ssr += (y[t] - fit) ** 2; sst += (y[t] - my) ** 2;
    }
    return { alpha: coef[0], beta: coef.slice(1), r2: sst > 0 ? Math.max(0, 1 - ssr / sst) : 0 };
  },

  /**
   * Scénario conditionnel : les facteurs imposés prennent la valeur donnée, les autres prennent leur espérance
   * conditionnelle sachant les premiers (loi normale multivariée de covariance `cov`) : E[u | s] = Σus Σss⁻¹ s.
   * `fixed` : { indice: choc } → vecteur complet des chocs.
   */
  conditional(cov, fixed) {
    const s = Object.keys(fixed).map(Number);
    const full = cov.map((_, i) => (i in fixed ? fixed[i] : 0));
    if (!s.length) return full;
    const Sss = s.map(i => s.map(j => cov[i][j]));
    const z = this.solve(Sss, s.map(i => fixed[i]));
    if (!z) return full;
    for (let u = 0; u < cov.length; u++) if (!(u in fixed)) full[u] = s.reduce((acc, i, k) => acc + cov[u][i] * z[k], 0);
    return full;
  },

  /**
   * Modèle à facteurs : bêtas de chaque ligne sur les facteurs, covariance des facteurs.
   * `lines` et `factors` : { clé: [[date, cours]] } → { lineKeys, factorKeys, betas: { clé: { beta, r2 } }, cov, weeks }
   */
  factorModel(lines, factors) {
    const all = Object.assign({}, factors);
    for (const [k, s] of Object.entries(lines)) all['L:' + k] = s;
    const al = this.weeklyReturns(all);
    const fIdx = al.keys.map((k, i) => [k, i]).filter(([k]) => !k.startsWith('L:'));
    const lIdx = al.keys.map((k, i) => [k, i]).filter(([k]) => k.startsWith('L:'));
    if (al.returns.length < 26 || !fIdx.length) return null;
    const X = al.returns.map(r => fIdx.map(([, i]) => r[i]));
    const betas = {};
    for (const [k, i] of lIdx) {
      const fit = this.ols(al.returns.map(r => r[i]), X);
      if (fit) betas[k.slice(2)] = fit;
    }
    return { factorKeys: fIdx.map(([k]) => k), lineKeys: Object.keys(betas), betas, cov: this.covariance(X).cov, weeks: al.weeks };
  },

  /** Impact d'un scénario (chocs en fraction, par facteur) sur chaque ligne et sur le portefeuille (`weights` en valeur) */
  scenario(model, shocks, values) {
    const fixed = {};
    model.factorKeys.forEach((k, i) => { if (shocks[k] !== undefined && shocks[k] !== null && isFinite(shocks[k])) fixed[i] = shocks[k]; });
    const moves = this.conditional(model.cov, fixed);
    const lines = model.lineKeys.map(k => {
      const r = Math.max(-1, model.betas[k].beta.reduce((s, b, i) => s + b * moves[i], 0));
      return { key: k, ret: r, value: values[k] || 0, pnl: (values[k] || 0) * r, r2: model.betas[k].r2 };
    });
    const total = lines.reduce((s, l) => s + l.value, 0);
    const pnl = lines.reduce((s, l) => s + l.pnl, 0);
    return { moves: Object.fromEntries(model.factorKeys.map((k, i) => [k, moves[i]])), imposed: Object.keys(fixed).map(i => model.factorKeys[i]), lines, pnl, ret: total > 0 ? pnl / total : 0 };
  },

  /* ---------- anatomie du risque ---------- */

  /**
   * Décomposition du risque d'une répartition `w` (somme 1) de covariance `cov` :
   * contributions d'Euler (somme = 100 %), ratio de diversification, nombre effectif de paris (entropie des
   * contributions des composantes principales, Meucci 2009).
   */
  riskDecomp(w, cov) {
    const k = w.length;
    const Sw = cov.map(row => row.reduce((s, c, j) => s + c * w[j], 0));
    const var_ = w.reduce((s, x, i) => s + x * Sw[i], 0);
    const vol = Math.sqrt(Math.max(0, var_));
    const share = w.map((x, i) => (var_ > 0 ? x * Sw[i] / var_ : 0));
    const vols = cov.map((r, i) => Math.sqrt(Math.max(0, r[i])));
    const divRatio = vol > 0 ? w.reduce((s, x, i) => s + x * vols[i], 0) / vol : 1;
    const { values, vectors } = this.eigen(cov);
    const p = values.map((lambda, j) => { const e = vectors[j].reduce((s, v, i) => s + v * w[i], 0); return var_ > 0 ? Math.max(0, lambda) * e * e / var_ : 0; });
    const ps = p.reduce((a, b) => a + b, 0) || 1;
    const enb = Math.exp(-p.reduce((s, x) => (x > 0 ? s + (x / ps) * Math.log(x / ps) : s), 0));
    const firstPc = values[0] > 0 ? values[0] / values.reduce((a, b) => a + Math.max(0, b), 0) : NaN;
    return { vol, share, vols, divRatio, enb: Math.min(k, enb), firstPc };
  },

  /** Répartition à contributions au risque égales (risk parity), par descente cyclique de coordonnées */
  riskParity(cov, budget) {
    const n = cov.length;
    const b = budget || new Array(n).fill(1 / n);
    const x = cov.map((r, i) => 1 / Math.sqrt(Math.max(1e-12, r[i])));
    for (let it = 0; it < 500; it++) {
      let delta = 0;
      for (let i = 0; i < n; i++) {
        const sig = Math.sqrt(Math.max(1e-18, x.reduce((s, xi, a) => s + xi * cov[a].reduce((t, c, j) => t + c * x[j], 0), 0)));
        const c = cov[i].reduce((s, v, j) => (j === i ? s : s + v * x[j]), 0);
        const nx = (-c + Math.sqrt(c * c + 4 * cov[i][i] * b[i] * sig)) / (2 * cov[i][i]);
        delta = Math.max(delta, Math.abs(nx - x[i]));
        x[i] = nx;
      }
      if (delta < 1e-10) break;
    }
    const s = x.reduce((a, v) => a + v, 0);
    return x.map(v => v / s);
  },

  /**
   * Perte probable sur un horizon (VaR, Expected Shortfall) à partir de rendements hebdomadaires du portefeuille :
   * historique (rendements composés glissants de `h` semaines) et Cornish-Fisher (loi corrigée de l'asymétrie
   * et des queues épaisses). Valeurs négatives = pertes.
   */
  tailRisk(weekly, { h = 4, level = 0.95 } = {}) {
    const roll = [];
    for (let i = 0; i + h <= weekly.length; i++) {
      let g = 1;
      for (let j = i; j < i + h; j++) g *= 1 + weekly[j];
      roll.push(g - 1);
    }
    if (roll.length < 20) return null;
    const sorted = roll.slice().sort((a, b) => a - b);
    const q = Math.max(0, Math.floor((1 - level) * sorted.length));
    const hVar = sorted[q];
    const tail = sorted.slice(0, q + 1);
    const es = tail.reduce((a, b) => a + b, 0) / tail.length;
    const m = this.moments(weekly);
    const z = -this.normInv(level);
    const S = m.skew, K = m.kurt;
    const zcf = z + (z * z - 1) * S / 6 + (z ** 3 - 3 * z) * K / 24 - (2 * z ** 3 - 5 * z) * S * S / 36;
    const cf = m.mean * h + zcf * m.sd * Math.sqrt(h);
    const gauss = m.mean * h + z * m.sd * Math.sqrt(h);
    return { hVar, es, cf, gauss, skew: S, kurt: K, worst: sorted[0], samples: roll.length };
  },

  /** Quantile de la loi normale centrée réduite (approximation d'Acklam) */
  normInv(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) return -this.normInv(1 - p);
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  },

  /* ---------- régimes de marché ---------- */

  /**
   * Modèle de Markov caché gaussien à deux états, estimé par Baum-Welch (espérance-maximisation) avec mise à
   * l'échelle. L'état 1 est toujours le plus volatil (« agité »).
   * → { mu: [m0, m1], sigma: [s0, s1], P (transitions), gamma: [proba agité à chaque date], now (filtrée), next, logLik }
   */
  hmm(x, { iters = 200, tol = 1e-8 } = {}) {
    const T = x.length;
    if (T < 30) return null;
    const m = this.moments(x);
    let mu = [m.mean + 0.2 * m.sd, m.mean - 0.5 * m.sd], sg = [0.7 * m.sd, 1.6 * m.sd];
    let P = [[0.97, 0.03], [0.08, 0.92]], pi = [0.7, 0.3];
    const pdf = (v, k) => Math.exp(-0.5 * ((v - mu[k]) / sg[k]) ** 2) / (sg[k] * Math.sqrt(2 * Math.PI));
    let ll = -Infinity, alpha, beta, c, gamma;
    for (let it = 0; it < iters; it++) {
      alpha = []; c = [];
      let a = [pi[0] * pdf(x[0], 0), pi[1] * pdf(x[0], 1)];
      let s = a[0] + a[1] || 1e-300; a = [a[0] / s, a[1] / s]; alpha.push(a); c.push(s);
      for (let t = 1; t < T; t++) {
        const p = alpha[t - 1];
        a = [0, 1].map(j => (p[0] * P[0][j] + p[1] * P[1][j]) * pdf(x[t], j));
        s = a[0] + a[1] || 1e-300; a = [a[0] / s, a[1] / s]; alpha.push(a); c.push(s);
      }
      beta = new Array(T); beta[T - 1] = [1, 1];
      for (let t = T - 2; t >= 0; t--) {
        const e = [pdf(x[t + 1], 0) * beta[t + 1][0], pdf(x[t + 1], 1) * beta[t + 1][1]];
        beta[t] = [0, 1].map(i => (P[i][0] * e[0] + P[i][1] * e[1]) / c[t + 1]);
      }
      gamma = alpha.map((al, t) => { const g = [al[0] * beta[t][0], al[1] * beta[t][1]]; const z = g[0] + g[1] || 1; return [g[0] / z, g[1] / z]; });
      const xi = [[0, 0], [0, 0]];
      for (let t = 0; t < T - 1; t++) {
        const e = [pdf(x[t + 1], 0) * beta[t + 1][0], pdf(x[t + 1], 1) * beta[t + 1][1]];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) xi[i][j] += alpha[t][i] * P[i][j] * e[j] / c[t + 1];
      }
      pi = gamma[0].slice();
      P = xi.map(r => { const z = r[0] + r[1] || 1; return [r[0] / z, r[1] / z]; });
      for (let k = 0; k < 2; k++) {
        const w = gamma.reduce((s, g) => s + g[k], 0) || 1e-12;
        mu[k] = gamma.reduce((s, g, t) => s + g[k] * x[t], 0) / w;
        sg[k] = Math.max(1e-5, Math.sqrt(gamma.reduce((s, g, t) => s + g[k] * (x[t] - mu[k]) ** 2, 0) / w));
      }
      const nll = c.reduce((s, v) => s + Math.log(v), 0);
      if (Math.abs(nll - ll) < tol) { ll = nll; break; }
      ll = nll;
    }
    let calm = 0, rough = 1;
    if (sg[0] > sg[1]) { calm = 1; rough = 0; }
    const last = alpha[T - 1];
    const now = last[rough];
    const next = last[0] * P[0][rough] + last[1] * P[1][rough];
    return {
      mu: [mu[calm], mu[rough]], sigma: [sg[calm], sg[rough]],
      P: [[P[calm][calm], P[calm][rough]], [P[rough][calm], P[rough][rough]]],
      gamma: gamma.map(g => g[rough]), now, next, logLik: ll,
      share: gamma.reduce((s, g) => s + g[rough], 0) / T,
    };
  },

  /* ---------- audit comportemental ---------- */

  /**
   * Audit des opérations face aux cours réels. `txs` : [{ key, type, date, qty, price }] (prix en devise du titre),
   * `series` : { clé: [[date, cours]] } en devise du titre, `fx` : { clé: taux actuel vers la base }.
   * → { buys: [...], sells: [...], timing (€ gagnés ou perdus face à un achat le 1er de chaque mois),
   *     best/worst (le meilleur et le pire jour de chaque mois), chase (rang moyen de la hausse du mois précédant
   *     chaque achat, 0,5 = neutre), panic: ventes faites à plus de 10 % sous le plus haut d'un an }
   */
  behavior(txs, series, fx) {
    const buys = [], sells = [];
    const pct = (arr, v) => arr.filter(x => x < v).length / Math.max(1, arr.length);
    const trailing = {};
    for (const [k, s] of Object.entries(series)) {
      const r = [];
      for (let i = 21; i < s.length; i++) r.push(s[i][1] / s[i - 21][1] - 1);
      trailing[k] = r;
    }
    for (const t of txs) {
      const s = series[t.key];
      if (!s || s.length < 30 || !(t.qty > 0) || !(t.price > 0)) continue;
      const now = s[s.length - 1][1] * (fx[t.key] || 1);
      const i = s.findIndex(p => p[0] >= t.date);
      if (i < 0) continue;
      // prix saisi très éloigné du cours du jour : division non saisie ou autre unité (pence…), opération écartée
      const ref = this.at(s, t.date);
      if (!(ref > 0) || Math.abs(t.price / ref - 1) > 0.4) continue;
      if (t.type === 'buy') {
        const month = s.filter(p => p[0].slice(0, 7) === t.date.slice(0, 7));
        if (!month.length) continue;
        const amount = t.qty * t.price;
        const sharesAt = p => amount / p;
        const firstDay = month[0][1];
        const lo = Math.min(...month.map(p => p[1])), hi = Math.max(...month.map(p => p[1]));
        const before = i >= 21 ? s[i][1] / s[i - 21][1] - 1 : null;
        buys.push({
          key: t.key, date: t.date, amount,
          timing: (t.qty - sharesAt(firstDay)) * now,
          best: (sharesAt(lo) - sharesAt(firstDay)) * now,
          worst: (sharesAt(hi) - sharesAt(firstDay)) * now,
          before, rank: before === null ? null : pct(trailing[t.key], before),
        });
      } else if (t.type === 'sell') {
        const yearAgo = addDaysISO(t.date, -365);
        const high = Math.max(...s.filter(p => p[0] >= yearAgo && p[0] <= t.date).map(p => p[1]));
        const dd = isFinite(high) && high > 0 ? s[i][1] / high - 1 : 0;
        sells.push({ key: t.key, date: t.date, dd, panic: dd <= -0.1, regret: t.qty * (now - t.price * (fx[t.key] || 1)), qty: t.qty });
      }
    }
    const ranked = buys.filter(b => b.rank !== null);
    return {
      buys, sells,
      timing: buys.reduce((s, b) => s + b.timing, 0),
      best: buys.reduce((s, b) => s + b.best, 0),
      worst: buys.reduce((s, b) => s + b.worst, 0),
      chase: ranked.length ? ranked.reduce((s, b) => s + b.rank, 0) / ranked.length : NaN,
      panic: sells.filter(x => x.panic),
    };
  },
};

/* ==================== Affichage : onglet « Labo quant » ==================== */

Object.assign(App, {
  /** Lignes cotées détenues (hors valeurs saisies à la main), avec leur valeur en devise de base */
  quantLines() {
    return Portfolio.snapshot().rows.filter(r => !Manual.is(r.key) && isFinite(r.valueBase) && r.valueBase > 0)
      .map(r => ({ key: r.key, value: r.valueBase, currency: (Store.instrument(r.key) || {}).currency || this.base() }));
  },

  /** Série journalière en devise de base (au taux de change de chaque jour) ; `key` d'instrument ou « Y:symbole » */
  async quantSeries(key, start, ccy) {
    const s = await Api.daily(key, start);
    const cur = ccy || ((Store.instrument(key) || {}).currency) || this.base();
    if (cur === this.base()) return s;
    const fx = await Api.fxSeries(cur, start);
    return s.map(([d, v]) => [d, v * (fx(d) || 1)]);
  },

  quantBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.textContent = busy ? 'Calcul…' : label;
  },

  quantEmpty(box, msg) { box.replaceChildren(el('p', { class: 'muted' }, msg)); },

  bindQuant() {
    if (!$('#view-quant')) return;
    $('#qCrashRun').addEventListener('click', () => this.runCrash());
    $('#qScenRun').addEventListener('click', () => this.runScenario());
    $('#qRiskRun').addEventListener('click', () => this.runRiskAnatomy());
    $('#qRegimeRun').addEventListener('click', () => this.runRegime());
    $('#qBehavRun').addEventListener('click', () => this.runBehavior());
    $('#qAllRun').addEventListener('click', () => this.runAllQuant());
  },

  /**
   * « Tout analyser » : les cinq analyses l'une après l'autre, avec la progression affichée sous le bouton.
   * Une analyse trop longue (requête sans réponse, file d'attente des crédits Twelve Data) est laissée de côté
   * au bout de `limit` ms pour que les suivantes se lancent quand même.
   */
  async runAllQuant(limit = 90000) {
    if (this._qAllBusy) return;
    this._qAllBusy = true;
    const b = $('#qAllRun'), box = $('#qAllProgress');
    const steps = [['runRegime', 'Météo', '#qRegimeCard'], ['runRiskAnatomy', 'Risque', '#qRiskCard'], ['runScenario', 'Scénarios', '#qScenCard'],
      ['runCrash', 'Crash-test', '#qCrashCard'], ['runBehavior', 'Audit', '#qBehavCard']];
    const state = steps.map(() => 'wait');
    const icon = { wait: '○', run: '…', ok: '✓', slow: '⏱', err: '⚠' };
    const draw = () => box.replaceChildren(...steps.map(([, name, card], i) => el('button', { type: 'button', class: 'q-step ' + state[i], onclick: () => $(card).scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      el('span', { 'aria-hidden': 'true' }, icon[state[i]]), name)));
    box.classList.remove('hidden');
    b.disabled = true;
    let slow = 0;
    try {
      for (let i = 0; i < steps.length; i++) {
        state[i] = 'run';
        b.textContent = `Analyse ${i + 1}/${steps.length}…`;
        draw();
        let timer = null;
        const res = await Promise.race([
          Promise.resolve().then(() => this[steps[i][0]]()).then(() => 'ok', () => 'err'),
          new Promise(ok => { timer = setTimeout(() => ok('slow'), limit); }),
        ]);
        clearTimeout(timer);
        state[i] = res;
        if (res === 'slow') slow++;
        draw();
      }
    } finally {
      b.disabled = false;
      b.textContent = 'Tout réanalyser';
      this._qAllBusy = false;
    }
    toast(slow ? `Analyses lancées : ${slow} encore en cours (réponse lente des données), elles s'afficheront dans leur carte.` : 'Les 5 analyses sont prêtes : résultats dans les cartes ci-dessous.', slow ? 'info' : 'success', 5000);
    const first = $('#qRegimeCard');
    if (first && first.getBoundingClientRect().top > innerHeight * 0.6) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ---------- crash-test ---------- */

  async runCrash() {
    const box = $('#qCrashBody'), btn = $('#qCrashRun');
    const lines = this.quantLines();
    if (!lines.length) { this.quantEmpty(box, 'Ajoute des positions pour lancer le crash-test.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = '1999-06-01';
      const load = async (k, ccy) => { try { return await this.quantSeries(k, start, ccy); } catch (e) { return null; } };
      const fallback = await load('Y:^GSPC', 'USD');
      const own = {}, proxy = {};
      for (const l of lines) {
        own[l.key] = await load(l.key);
        const p = LAB_PROXY[Expo.of(l.key).profile];
        proxy[l.key] = p ? { s: await load('Y:' + p[0], p[1]), name: p[2] } : null;
      }
      const equity = k => !['gold', 'crypto'].includes(Expo.of(k).profile);
      const results = QUANT_CRISES.map(c => {
        const series = {}, weights = {}, sources = [], missing = [];
        for (const l of lines) {
          let s = null, src = null;
          if (Quant.covers(own[l.key], c)) { s = own[l.key]; src = 'own'; }
          else if (proxy[l.key] && Quant.covers(proxy[l.key].s, c)) { s = proxy[l.key].s; src = proxy[l.key].name; }
          else if (equity(l.key) && Quant.covers(fallback, c)) { s = fallback; src = 'S&P 500 (approximation)'; }
          if (s) { series[l.key] = s; weights[l.key] = l.value; if (src !== 'own') sources.push(`${Store.label(l.key)} → ${src}`); }
          else missing.push(Store.label(l.key));
        }
        const covered = Object.values(weights).reduce((a, b) => a + b, 0);
        const r = covered > 0 ? Quant.crash(series, weights, c) : null;
        return { c, r, covered, sources, missing };
      });
      this.crashResult = { results, total: lines.reduce((s, l) => s + l.value, 0) };
      this.renderCrash();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Relancer'); }
  },

  /** Petite courbe SVG de la crise (valeur base 1), sans dépendance */
  sparkSvg(path, troughDate) {
    if (!path || path.length < 2) return null;
    const step = Math.max(1, Math.floor(path.length / 120));
    const pts = path.filter((_, i) => i % step === 0 || i === path.length - 1);
    const vals = pts.map(p => p[1]);
    const lo = Math.min(...vals), hi = Math.max(...vals, 1);
    const W = 220, H = 56;
    const x = i => (i / (pts.length - 1)) * W, y = v => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
    const ti = pts.findIndex(p => p[0] >= troughDate);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'q-spark'); svg.setAttribute('aria-hidden', 'true');
    const base = document.createElementNS(ns, 'line');
    Object.entries({ x1: 0, x2: W, y1: y(1), y2: y(1), class: 'q-spark-base' }).forEach(([k, v]) => base.setAttribute(k, v));
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d); line.setAttribute('class', 'q-spark-line');
    svg.append(base, line);
    if (ti >= 0) {
      const dot = document.createElementNS(ns, 'circle');
      Object.entries({ cx: x(ti), cy: y(pts[ti][1]), r: 3.5, class: 'q-spark-dot' }).forEach(([k, v]) => dot.setAttribute(k, v));
      svg.append(dot);
    }
    return svg;
  },

  renderCrash() {
    const res = this.crashResult, box = $('#qCrashBody');
    if (!res || !box) return;
    const cur = this.base();
    const months = days => (days < 45 ? `${days} jours` : `${Math.round(days / 30.44)} mois`);
    const ok = res.results.filter(x => x.r);
    if (!ok.length) { this.quantEmpty(box, 'Aucune crise couverte : les historiques de tes lignes et des indices qu\'elles suivent sont indisponibles pour ces périodes.'); return; }
    const worst = ok.reduce((a, b) => (b.r.mdd < a.r.mdd ? b : a));
    box.replaceChildren(
      el('p', { class: 'q-lead' }, 'Dans la pire crise testée (', el('b', {}, worst.c.name), '), ton portefeuille d\'aujourd\'hui aurait perdu ',
        el('b', { class: 'down' }, fmtMoney(worst.r.mdd * worst.covered, cur, 0)), ` (${fmtPct(worst.r.mdd * 100, 0)}). La vraie question : l'aurais-tu supporté sans vendre ?`),
      el('div', { class: 'q-crises' }, ...res.results.map(({ c, r, covered, sources, missing }) => el('div', { class: 'q-crisis' + (r ? '' : ' off') + (r && c === worst.c ? ' worst' : '') },
        el('div', { class: 'q-crisis-head' }, el('b', {}, c.name), el('span', { class: 'muted small' }, `${c.start.slice(0, 4)}${c.end.slice(0, 4) !== c.start.slice(0, 4) ? '–' + c.end.slice(0, 4) : ''}`)),
        r ? el('div', { class: 'q-crisis-num' }, el('span', { class: 'down mono' }, fmtPct(r.mdd * 100, 0)), el('span', { class: 'mono' }, fmtMoney(r.mdd * covered, cur, 0))) : el('p', { class: 'muted small' }, 'Pas d\'historique pour cette période.'),
        r ? this.sparkSvg(r.path, r.troughDate) : null,
        el('p', { class: 'small muted' }, c.story),
        r ? el('p', { class: 'small' }, `Chute pendant ${months(r.fallDays)}, ` + (r.recoveryDate ? `retour au plus haut ${months(r.recoveryDays)} après le point bas (${fmtDate(r.recoveryDate)}).` : 'pas encore revenu au plus haut d\'avant crise (hors dividendes).')) : null,
        sources.length ? el('p', { class: 'small muted' }, 'Rejoué avec : ' + sources.join(' · ')) : null,
        missing.length ? el('p', { class: 'small lab-warn' }, 'Sans : ' + missing.join(', ') + ' (pas d\'historique)') : null))),
      noteTip('Ton portefeuille actuel (mêmes poids, achat puis conservation) rejoué jour par jour du plus haut d\'avant crise au point bas. Quand une ligne est trop récente, on suit l\'indice qu\'elle réplique (sinon le S&P 500 pour les actions), converti en euros au taux de chaque jour. Indices de prix, hors dividendes : le retour au plus haut est un peu plus lent que dans la réalité. Les crises futures ne ressembleront pas forcément aux passées.', 'Méthode et limites'));
  },

  /* ---------- scénarios conditionnels ---------- */

  async runScenario() {
    const box = $('#qScenBody'), btn = $('#qScenRun');
    const lines = this.quantLines();
    if (!lines.length) { this.quantEmpty(box, 'Ajoute des positions pour simuler un scénario.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -5 * 365);
      const factors = {}, lineSeries = {};
      for (const f of QUANT_FACTORS) {
        // facteurs dans leur propre devise (le dollar, lui, est déjà exprimé en euros)
        try { factors[f.id] = await Api.daily('Y:' + f.sym, start); } catch (e) { /* facteur indisponible : ignoré */ }
      }
      for (const l of lines) lineSeries[l.key] = await this.quantSeries(l.key, start);
      const model = Quant.factorModel(lineSeries, factors);
      if (!model || !model.lineKeys.length) throw new Error('Pas assez d\'historique commun (au moins six mois) entre tes lignes et les facteurs de marché.');
      this.scenModel = { model, values: Object.fromEntries(lines.map(l => [l.key, l.value])), shocks: this.scenShocks || {} };
      this.renderScenario();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderScenario() {
    const S = this.scenModel, box = $('#qScenBody');
    if (!S || !box) return;
    const cur = this.base();
    const facs = QUANT_FACTORS.filter(f => S.model.factorKeys.includes(f.id));
    const inputs = {};
    const out = el('div', { class: 'q-scen-out' });
    const update = () => {
      const shocks = {};
      for (const f of facs) { const v = inputs[f.id].value.trim(); if (v !== '' && isFinite(parseNum(v))) shocks[f.id] = parseNum(v) / 100; }
      this.scenShocks = Object.fromEntries(Object.entries(shocks).map(([k, v]) => [k, v * 100]));
      if (!Object.keys(shocks).length) { out.replaceChildren(el('p', { class: 'muted' }, 'Choisis un scénario ci-dessus ou saisis un choc sur au moins un facteur.')); for (const f of facs) inputs[f.id].placeholder = 'libre'; return; }
      const sc = Quant.scenario(S.model, shocks, S.values);
      for (const f of facs) inputs[f.id].placeholder = sc.imposed.includes(f.id) ? '' : 'suit : ' + fmtNum(sc.moves[f.id] * 100, 1);
      out.replaceChildren(
        el('div', { class: 'q-big ' + trendClass(sc.pnl) }, el('span', { class: 'mono' }, fmtSignedMoney(sc.pnl, cur)), el('small', {}, fmtPct(sc.ret * 100, 1) + ' sur ton portefeuille')),
        el('p', { class: 'small muted' }, 'Ce que feraient les facteurs non imposés, d\'après leurs corrélations : ' + facs.filter(f => !sc.imposed.includes(f.id)).map(f => `${f.name} ${fmtPct(sc.moves[f.id] * 100, 1)}`).join(' · ') + '.'),
        el('table', { class: 'q-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Impact'), el('th', { class: 'num' }, 'En ' + cur), el('th', { class: 'num' }, el('span', {}, 'Fiabilité', infoTip('Part des variations de la ligne expliquée par les facteurs (R²) : plus elle est haute, plus l\'estimation est solide.'))))),
          el('tbody', {}, ...sc.lines.sort((a, b) => a.pnl - b.pnl).map(l => el('tr', {},
            el('td', {}, Store.label(l.key)),
            el('td', { class: 'num mono ' + trendClass(l.ret) }, fmtPct(l.ret * 100, 1)),
            el('td', { class: 'num mono ' + trendClass(l.pnl) }, fmtSignedMoney(l.pnl, cur)),
            el('td', { class: 'num mono' }, fmtNum(l.r2 * 100, 0) + ' %'))))));
    };
    box.replaceChildren(
      el('div', { class: 'q-presets' }, ...QUANT_PRESETS.map(p => el('button', { type: 'button', class: 'btn small', onclick: () => {
        for (const f of facs) inputs[f.id].value = p.shocks[f.id] !== undefined ? p.shocks[f.id] : '';
        update();
      } }, p.name)), el('button', { type: 'button', class: 'btn small', onclick: () => { for (const f of facs) inputs[f.id].value = ''; update(); } }, 'Effacer')),
      el('div', { class: 'q-factors' }, ...facs.map(f => {
        inputs[f.id] = el('input', { type: 'number', step: '1', inputmode: 'decimal', 'aria-label': 'Choc ' + f.name + ' en %', oninput: update });
        if (S.shocks[f.id] !== undefined) inputs[f.id].value = S.shocks[f.id];
        return el('label', {}, el('span', {}, f.name, el('small', { class: 'muted' }, f.hint)), el('span', { class: 'q-pct' }, inputs[f.id], '%'));
      })),
      out,
      noteTip(`Chaque ligne est régressée sur les facteurs (rendements hebdomadaires, ${S.model.weeks.length} semaines depuis le ${fmtDate(S.model.weeks[0])}). Les facteurs que tu laisses libres prennent leur valeur la plus probable sachant ceux que tu imposes (espérance conditionnelle d'une loi normale multivariée), comme dans les outils de stress-test des banques. Approximation linéaire : pour des chocs extrêmes, la réalité peut être pire (les corrélations montent en crise).`, 'Méthode et limites'));
    update();
  },

  /* ---------- anatomie du risque ---------- */

  async runRiskAnatomy() {
    const box = $('#qRiskBody'), btn = $('#qRiskRun');
    const lines = this.quantLines();
    if (!lines.length) { this.quantEmpty(box, 'Ajoute des positions pour analyser ton risque.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -5 * 365);
      const series = {};
      for (const l of lines) series[l.key] = await this.quantSeries(l.key, start);
      const al = Quant.weeklyReturns(series);
      if (al.returns.length < 52) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins un an).');
      const total = al.keys.reduce((s, k) => s + lines.find(l => l.key === k).value, 0);
      const w = al.keys.map(k => lines.find(l => l.key === k).value / total);
      const cov = Quant.covariance(al.returns).cov.map(r => r.map(c => c * 52));
      const port = al.returns.map(r => r.reduce((s, x, i) => s + x * w[i], 0));
      this.riskResult = { keys: al.keys, w, cov, dec: Quant.riskDecomp(w, cov), tail: Quant.tailRisk(port, { h: 4, level: 0.95 }), parity: al.keys.length > 1 ? Quant.riskParity(cov) : null, total, span: [al.weeks[0], al.weeks[al.weeks.length - 1]] };
      this.renderRiskAnatomy();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderRiskAnatomy() {
    const R = this.riskResult, box = $('#qRiskBody');
    if (!R || !box) return;
    const cur = this.base(), d = R.dec, t = R.tail, n = R.keys.length;
    const top = R.keys.map((k, i) => ({ k, w: R.w[i], s: d.share[i] })).sort((a, b) => b.s - a.s)[0];
    const kpi = (label, value, sub, tip) => el('div', { class: 'q-kpi' }, el('span', {}, label, tip ? infoTip(tip) : null), el('b', { class: 'mono' }, value), sub ? el('small', { class: 'muted' }, sub) : null);
    const apply = () => {
      if (!confirm('Remplacer ton allocation cible par la répartition à risque égal ?')) return;
      for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
      R.keys.forEach((k, i) => { Store.state.targets[k] = Math.round(R.parity[i] * 1000) / 10; });
      Store.save(); this.renderAll(); this.show('invest');
      toast('Cible à risque égal appliquée : le plan d\'achat te dit quoi acheter pour t\'en rapprocher.', 'success', 6000);
    };
    box.replaceChildren(
      el('p', { class: 'q-lead' }, n > 1
        ? [el('b', {}, Store.label(top.k)), ` pèse ${fmtNum(top.w * 100, 0)} % de ton portefeuille mais porte `, el('b', {}, fmtNum(top.s * 100, 0) + ' %'), ' de ton risque. ',
          d.enb < 1.5 ? `Tes ${n} lignes se comportent en réalité comme un seul placement.` : `Tes ${n} lignes équivalent à ${fmtNum(d.enb, 1)} paris vraiment indépendants.`]
        : 'Une seule ligne : tout ton risque repose sur elle.'),
      el('div', { class: 'q-kpis' },
        kpi('Volatilité annuelle', fmtPct(d.vol * 100, 1, false), 'amplitude typique sur un an'),
        kpi('Paris indépendants', fmtNum(d.enb, 1) + ' / ' + n, 'nombre effectif de paris', 'Analyse en composantes principales : combien de sources de risque vraiment distinctes ton portefeuille contient (1 = tout bouge ensemble, ' + n + ' = lignes totalement indépendantes). Méthode de Meucci (2009).'),
        kpi('Ratio de diversification', fmtNum(d.divRatio, 2), 'gain de la diversification', 'Somme des volatilités des lignes (pondérées) divisée par la volatilité du portefeuille. 1 = aucun bénéfice ; plus c\'est haut, plus tes lignes se compensent.'),
        t ? kpi('Perte à 1 mois (VaR 95 %)', fmtMoney(t.hVar * R.total, cur, 0), '1 mois sur 20, tu perds plus que ça', 'Historique : 5 % des périodes de 4 semaines observées ont fait pire.') : null,
        t ? kpi('Perte moyenne au-delà', fmtMoney(t.es * R.total, cur, 0), 'Expected Shortfall', 'Moyenne des pertes dans les 5 % de pires mois : ce que coûte un « mauvais mois » quand il arrive. C\'est la mesure de risque exigée des banques par Bâle III.') : null,
        t ? kpi('VaR corrigée des queues', fmtMoney(t.cf * R.total, cur, 0), `asymétrie ${fmtNum(t.skew, 2)} · queues ${fmtNum(t.kurt, 1)}`, 'VaR de Cornish-Fisher : la loi normale corrigée de l\'asymétrie et de l\'épaisseur des queues observées. Si elle est bien pire que la VaR normale (' + fmtMoney(t.gauss * R.total, cur, 0) + '), les krachs sont plus fréquents que ne le dit la volatilité.') : null),
      n > 1 ? el('div', { class: 'chart-box q-risk-chart' }, el('canvas', { id: 'qRiskChart' })) : null,
      R.parity ? el('div', { class: 'q-parity' },
        el('div', { class: 'q-parity-head' }, el('b', {}, 'Répartition à risque égal (risk parity)'), infoTip('La répartition où chaque ligne apporte exactement la même part du risque total : les lignes calmes pèsent plus, les volatiles moins. Approche popularisée par les grands fonds institutionnels.')),
        el('ul', { class: 'opt-weights' }, ...R.keys.map((k, i) => el('li', {}, el('span', {}, Store.label(k)), el('b', { class: 'mono' }, `${fmtNum(R.w[i] * 100, 0)} % → ${fmtNum(R.parity[i] * 100, 0)} %`)))),
        el('button', { type: 'button', class: 'btn small', onclick: apply }, 'Utiliser comme cible')) : null,
      noteTip(`Rendements hebdomadaires en ${cur} du ${fmtDate(R.span[0])} au ${fmtDate(R.span[1])}, poids actuels. Contribution au risque : décomposition d'Euler (wᵢ·(Σw)ᵢ / σ²), dont la somme fait 100 %. Le passé ne garantit pas les corrélations futures, qui ont tendance à monter pendant les crises.`, 'Méthode et limites'));
    if (n > 1 && typeof Chart !== 'undefined') {
      Charts.destroy('qRiskChart');
      const o = Charts.baseOptions();
      o.indexAxis = 'y';
      o.interaction = { mode: 'index', axis: 'y', intersect: false };
      o.scales.x.grid = { color: Charts.css('--chart-grid') };
      o.scales.x.ticks.callback = v => v + ' %';
      o.scales.y.grid = { display: false };
      o.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label} : ${fmtNum(c.raw, 1)} %` };
      Charts.instances.qRiskChart = new Chart(document.getElementById('qRiskChart'), {
        type: 'bar',
        data: {
          labels: R.keys.map(k => Store.label(k)),
          datasets: [
            { label: 'Poids dans le portefeuille', data: R.w.map(x => x * 100), backgroundColor: Charts.css('--muted') + '70', borderRadius: 4 },
            { label: 'Part du risque', data: d.share.map(x => x * 100), backgroundColor: '#ef4444cc', borderRadius: 4 },
          ],
        },
        options: o,
      });
    }
  },

  /* ---------- météo des marchés ---------- */

  async runRegime() {
    const box = $('#qRegimeBody'), btn = $('#qRegimeRun');
    this.quantBusy(btn, true);
    try {
      const s = await Api.daily('Y:' + QUANT_REGIME.sym, QUANT_REGIME.since);
      const al = Quant.weeklyReturns({ m: s });
      const x = al.returns.map(r => Math.log(1 + r[0]));
      const h = Quant.hmm(x);
      if (!h) throw new Error('Historique du marché indisponible.');
      const weekly = new Map();
      for (const [d, v] of s) weekly.set(Quant.week(d), v);
      this.regimeResult = { h, dates: al.weeks, price: al.weeks.map(d => weekly.get(Quant.week(d))) };
      this.renderRegime();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Actualiser'); }
  },

  renderRegime() {
    const R = this.regimeResult, box = $('#qRegimeBody');
    if (!R || !box) return;
    const h = R.h;
    const rough = h.now >= 0.5;
    const ann = (mu, sg) => [(Math.exp(mu * 52) - 1) * 100, sg * Math.sqrt(52) * 100];
    const [cm, cv] = ann(h.mu[0], h.sigma[0]), [rm, rv] = ann(h.mu[1], h.sigma[1]);
    const dur = p => 1 / Math.max(1e-6, 1 - p);
    // depuis quand le régime actuel dure-t-il ?
    let since = R.dates.length - 1;
    while (since > 0 && (R.h.gamma[since - 1] >= 0.5) === rough) since--;
    box.replaceChildren(
      el('div', { class: 'q-weather ' + (rough ? 'rough' : 'calm') },
        el('div', { class: 'q-weather-icon', 'aria-hidden': 'true' }, rough ? '⛈' : '☀'),
        el('div', {},
          el('b', {}, rough ? 'Marché agité' : 'Marché calme'),
          el('p', {}, `Probabilité d'être en régime agité : `, el('b', { class: 'mono' }, fmtNum(h.now * 100, 0) + ' %'), ` · la semaine prochaine : ${fmtNum(h.next * 100, 0)} %`),
          el('p', { class: 'small muted' }, `Régime en cours depuis le ${fmtDate(R.dates[since])}. Un régime ${rough ? 'agité' : 'calme'} dure en moyenne ${fmtNum(dur(rough ? h.P[1][1] : h.P[0][0]), 0)} semaines.`))),
      el('div', { class: 'chart-box q-regime-chart' }, el('canvas', { id: 'qRegimeChart' })),
      el('table', { class: 'q-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Régime'), el('th', { class: 'num' }, 'Rendement annuel'), el('th', { class: 'num' }, 'Volatilité'), el('th', { class: 'num' }, 'Durée moyenne'), el('th', { class: 'num' }, 'Part du temps'))),
        el('tbody', {},
          el('tr', {}, el('td', {}, '☀ Calme'), el('td', { class: 'num mono ' + trendClass(cm) }, fmtPct(cm, 1)), el('td', { class: 'num mono' }, fmtPct(cv, 1, false)), el('td', { class: 'num mono' }, fmtNum(dur(h.P[0][0]), 0) + ' sem.'), el('td', { class: 'num mono' }, fmtPct((1 - h.share) * 100, 0, false))),
          el('tr', {}, el('td', {}, '⛈ Agité'), el('td', { class: 'num mono ' + trendClass(rm) }, fmtPct(rm, 1)), el('td', { class: 'num mono' }, fmtPct(rv, 1, false)), el('td', { class: 'num mono' }, fmtNum(dur(h.P[1][1]), 0) + ' sem.'), el('td', { class: 'num mono' }, fmtPct(h.share * 100, 0, false))))),
      el('p', { class: 'small' }, rough
        ? 'En régime agité, les baisses sont plus fréquentes et plus violentes, mais les plus forts rebonds arrivent aussi dans ces périodes : historiquement, vendre maintenant a souvent fait rater la reprise. C\'est le moment de vérifier que ton allocation te laisse dormir, pas de tout changer.'
        : 'En régime calme, la volatilité est faible et les marchés montent en moyenne. Ces périodes finissent toujours par s\'interrompre sans prévenir : c\'est le bon moment pour fixer tes règles (rééquilibrage, versements) à froid.'),
      noteTip(`Modèle de Markov caché à deux états (gaussiens), estimé par l'algorithme de Baum-Welch sur ${R.dates.length} rendements hebdomadaires du ${QUANT_REGIME.name} en euros depuis ${R.dates[0].slice(0, 4)}. Le modèle découvre seul les deux régimes, sans seuil fixé à la main ; la probabilité « aujourd'hui » n'utilise que les données passées (filtrage). Un outil de lecture, pas un signal d'achat ou de vente.`, 'Méthode et limites'));
    if (typeof Chart === 'undefined') return;
    Charts.destroy('qRegimeChart');
    const o = Charts.baseOptions();
    o.elements = { point: { radius: 0, hoverRadius: 3 } };
    o.scales.y1 = { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: Charts.css('--muted'), callback: v => v + ' %', maxTicksLimit: 3 }, border: { display: false } };
    o.plugins.tooltip.callbacks = { label: c => (c.datasetIndex === 1 ? ` Proba. agité : ${fmtNum(c.raw, 0)} %` : ` ${QUANT_REGIME.name} : ${fmtNum(c.raw, 2)}`) };
    Charts.instances.qRegimeChart = new Chart(document.getElementById('qRegimeChart'), {
      type: 'line',
      data: {
        labels: R.dates.map(d => fmtDate(d)),
        datasets: [
          { label: QUANT_REGIME.name, data: R.price, borderColor: Charts.css('--text'), borderWidth: 1.5, tension: 0.1, fill: false, yAxisID: 'y' },
          { label: 'Probabilité de régime agité', data: R.h.gamma.map(p => p * 100), borderWidth: 0, backgroundColor: '#ef444440', fill: 'origin', stepped: true, yAxisID: 'y1' },
        ],
      },
      options: o,
    });
  },

  /* ---------- audit comportemental ---------- */

  async runBehavior() {
    const box = $('#qBehavBody'), btn = $('#qBehavRun');
    const txs = Portfolio.txs().filter(t => (t.type === 'buy' || t.type === 'sell') && !Manual.is(t.key))
      .map(t => ({ key: t.key, type: t.type, date: t.date, qty: parseNum(t.qty), price: parseNum(t.price) }));
    if (!txs.some(t => t.type === 'buy')) { this.quantEmpty(box, 'Saisis tes achats pour auditer tes décisions.'); return; }
    this.quantBusy(btn, true);
    try {
      const keys = Array.from(new Set(txs.map(t => t.key)));
      const first = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
      const series = {}, fx = {};
      for (const k of keys) {
        try { series[k] = await Api.daily(k, addDaysISO(first, -60)); } catch (e) { continue; }
        const f = Api.fxCached((Store.instrument(k) || {}).currency || this.base());
        fx[k] = isFinite(f) && f > 0 ? f : 1;
      }
      const r = Quant.behavior(txs, series, fx);
      if (!r.buys.length) throw new Error('Cours historiques indisponibles pour tes achats.');
      // écart entre rendement de l'investisseur (pondéré par l'argent) et des placements (pondéré par le temps)
      let gap = null;
      if (this.historyPoints && this.historyPoints.length > 60) {
        const st = Portfolio.riskStats(Portfolio.twr(this.historyPoints));
        const x = Portfolio.portfolioXirr(Portfolio.snapshot().totals.value);
        if (st && isFinite(st.cagr) && isFinite(x)) gap = { investor: x, fund: st.cagr * 100 };
      }
      this.behavResult = Object.assign(r, { gap });
      this.renderBehavior();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Relancer'); }
  },

  renderBehavior() {
    const r = this.behavResult, box = $('#qBehavBody');
    if (!r || !box) return;
    const cur = this.base();
    const score = r.chase;
    const profile = !isFinite(score) ? null : score > 0.62
      ? { t: 'Tu achètes plutôt après les hausses', d: 'En moyenne, le mois précédant tes achats était meilleur que ' + fmtNum(score * 100, 0) + ' % des mois. C\'est le biais le plus répandu (la peur de rater le train) : des versements à date fixe le neutralisent.', cls: 'down' }
      : score < 0.38
        ? { t: 'Tu achètes plutôt dans les replis', d: 'En moyenne, le mois précédant tes achats était moins bon que ' + fmtNum((1 - score) * 100, 0) + ' % des mois : tu profites des baisses au lieu de les fuir.', cls: 'up' }
        : { t: 'Tes achats ne suivent pas l\'humeur du marché', d: 'Le mois précédant tes achats est dans la moyenne : tu investis de façon régulière, sans courir après les hausses.', cls: 'up' };
    const regret = r.panic.reduce((s, x) => s + x.regret, 0);
    box.replaceChildren(
      el('div', { class: 'q-kpis' },
        el('div', { class: 'q-kpi' }, el('span', {}, 'Ton timing', infoTip('Ce que tes dates d\'achat t\'ont fait gagner ou perdre (en valeur d\'aujourd\'hui) par rapport à acheter les mêmes montants le premier jour de cotation du mois.')),
          el('b', { class: 'mono ' + trendClass(r.timing) }, fmtSignedMoney(r.timing, cur)), el('small', { class: 'muted' }, `vs achat le 1er du mois · ${r.buys.length} achats`)),
        el('div', { class: 'q-kpi' }, el('span', {}, 'Timing parfait / pire'),
          el('b', { class: 'mono' }, fmtSignedMoney(r.best, cur) + ' / ' + fmtSignedMoney(r.worst, cur)), el('small', { class: 'muted' }, 'meilleur et pire jour de chaque mois')),
        r.gap ? el('div', { class: 'q-kpi' }, el('span', {}, 'Écart comportemental', infoTip('Rendement de l\'investisseur (XIRR, tient compte du moment et du montant de chaque versement) moins rendement des placements (TWR, indépendant des versements). Négatif : tes versements sont arrivés plutôt avant des baisses. Les études Morningstar mesurent environ −1,7 point par an pour l\'investisseur moyen.')),
          el('b', { class: 'mono ' + trendClass(r.gap.investor - r.gap.fund) }, fmtNum(r.gap.investor - r.gap.fund, 1) + ' pt/an'), el('small', { class: 'muted' }, `toi ${fmtPct(r.gap.investor, 1)} · tes placements ${fmtPct(r.gap.fund, 1)}`)) : null,
        r.sells.length ? el('div', { class: 'q-kpi' }, el('span', {}, 'Ventes dans une baisse', infoTip('Ventes faites alors que la ligne était à plus de 10 % sous son plus haut d\'un an, et ce qu\'elles auraient valu aujourd\'hui en les gardant.')),
          el('b', { class: 'mono ' + (r.panic.length ? trendClass(-regret) : '') }, `${r.panic.length} / ${r.sells.length}`), el('small', { class: 'muted' }, r.panic.length ? `manque à gagner : ${fmtSignedMoney(regret, cur)}` : 'aucune vente de panique')) : null),
      profile ? el('div', { class: 'q-verdict ' + profile.cls }, el('b', {}, profile.t), el('p', {}, profile.d)) : null,
      el('p', { class: 'small' }, Math.abs(r.timing) < Math.max(1, (r.best - r.worst) * 0.15)
        ? `Le timing a presque rien changé (${fmtSignedMoney(r.timing, cur)}), alors que l'écart entre le meilleur et le pire jour possible était de ${fmtMoney(r.best - r.worst, cur, 0)} : chercher le bon jour fait perdre du temps, pas de l'argent… ni en gagner.`
        : r.timing > 0 ? `Tes dates d'achat t'ont rapporté ${fmtMoney(r.timing, cur, 0)} de plus qu'un achat le 1er du mois. Bien joué — mais sur la durée, ce genre d'avance tend à s'effacer.`
          : `Tes dates d'achat t'ont coûté ${fmtMoney(-r.timing, cur, 0)} par rapport à un achat le 1er du mois : un versement programmé à date fixe t'aurait évité de réfléchir… et cette perte.`),
      noteTip('Chaque achat est comparé au même montant investi au premier cours du mois, valorisé au cours d\'aujourd\'hui. « Achat après hausse » : rang de la performance des 21 séances précédant l\'achat parmi toutes les périodes de 21 séances. Les opérations dont le prix est très éloigné du cours du jour (division non saisie, autre unité) sont écartées. Rien ne dit que le passé se répétera : ce sont des tendances, pas un jugement.', 'Méthode et limites'));
  },
});

App.on('view:shown', function (view) {
  if (view !== 'quant' || this._quantAuto) return;
  this._quantAuto = true;
  if (Api.hasProxy && Api.hasProxy()) this.runRegime(); // la météo se charge seule (une requête, indépendante du portefeuille)
});
