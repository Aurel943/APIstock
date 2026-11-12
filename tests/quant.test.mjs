import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const Q = () => loadApp({}).get('Quant');

/** Générateur gaussien reproductible */
function gauss(seed = 7) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}
/** Série de cours quotidiens (jours ouvrés) à partir de rendements */
function prices(rets, start = '2020-01-06', p0 = 100) {
  const out = [];
  let d = Date.parse(start + 'T00:00:00Z'), p = p0;
  for (const r of rets) {
    while ([0, 6].includes(new Date(d).getUTCDay())) d += 864e5;
    p *= 1 + r; out.push([new Date(d).toISOString().slice(0, 10), p]); d += 864e5;
  }
  return out;
}

test('quant : résolution linéaire et valeurs propres', () => {
  const q = Q();
  const x = plain(q.solve([[2, 1], [1, 3]], [3, 5]));
  near(x[0], 0.8); near(x[1], 1.4);
  assert.equal(q.solve([[1, 2], [2, 4]], [1, 2]), null, 'matrice singulière');
  const { values, vectors } = plain(q.eigen([[2, 1], [1, 2]]));
  near(values[0], 3); near(values[1], 1);
  near(Math.abs(vectors[0][0]), Math.SQRT1_2); near(Math.abs(vectors[0][1]), Math.SQRT1_2);
});

test('quant : la régression retrouve les bêtas, le scénario conditionnel suit les corrélations', () => {
  const q = Q();
  const g = gauss(3);
  const X = Array.from({ length: 400 }, () => [g() * 0.02, g() * 0.01]);
  const y = X.map(([a, b]) => 0.001 + 1.2 * a - 0.5 * b + g() * 0.002);
  const fit = q.ols(y, X, 0);
  near(fit.beta[0], 1.2, 0.03); near(fit.beta[1], -0.5, 0.05); assert.ok(fit.r2 > 0.9);
  // deux facteurs corrélés à 0,8, même volatilité : imposer -10 % au premier → le second baisse de 8 %
  const cov = [[1, 0.8], [0.8, 1]];
  const full = plain(q.conditional(cov, { 0: -0.1 }));
  near(full[0], -0.1); near(full[1], -0.08);
  assert.deepEqual(plain(q.conditional(cov, {})), [0, 0]);
});

test('quant : modèle à facteurs hebdomadaire et impact d\'un scénario sur les lignes', () => {
  const q = Q();
  const g = gauss(11);
  const f = Array.from({ length: 900 }, () => g() * 0.01);
  const noise = () => g() * 0.002;
  const factor = prices(f);
  const lev = prices(f.map(r => 1.5 * r + noise()));     // ligne 1,5 fois plus sensible
  const hedge = prices(f.map(() => noise()));             // ligne indépendante du facteur
  const model = q.factorModel({ A: lev, B: hedge }, { world: factor });
  assert.ok(model && model.weeks.length > 150);
  near(model.betas.A.beta[0], 1.5, 0.12, 'bêta hebdomadaire');
  near(model.betas.B.beta[0], 0, 0.12);
  const sc = q.scenario(model, { world: -0.2 }, { A: 1000, B: 1000 });
  near(sc.lines.find(l => l.key === 'A').ret, -0.3, 0.03);
  near(sc.pnl, -300, 40);
  assert.deepEqual(plain(sc.imposed), ['world']);
});

test('quant : décomposition du risque, paris effectifs et parité de risque', () => {
  const q = Q();
  // trois lignes indépendantes de même volatilité, poids égaux : contributions égales, 3 paris effectifs
  const d = q.riskDecomp([1 / 3, 1 / 3, 1 / 3], [[0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.04]]);
  for (const s of d.share) near(s, 1 / 3);
  near(d.enb, 3, 1e-6); near(d.divRatio, Math.sqrt(3), 1e-9);
  // deux lignes presque identiques : un seul vrai pari
  const twin = q.riskDecomp([0.5, 0.5], [[0.04, 0.0399], [0.0399, 0.04]]);
  assert.ok(twin.enb < 1.05, 'jumeaux ≈ 1 pari');
  // parité de risque : chaque ligne contribue autant
  const cov = [[0.09, 0.01, 0.0], [0.01, 0.01, 0.002], [0.0, 0.002, 0.0025]];
  const w = plain(q.riskParity(cov));
  near(w.reduce((a, b) => a + b, 0), 1);
  for (const s of q.riskDecomp(w, cov).share) near(s, 1 / 3, 1e-6);
  assert.ok(w[2] > w[1] && w[1] > w[0], 'la ligne la plus calme pèse le plus');
});

test('quant : VaR, Expected Shortfall et Cornish-Fisher', () => {
  const q = Q();
  near(q.normInv(0.95), 1.6448536, 1e-6); near(q.normInv(0.5), 0, 1e-9); near(q.normInv(0.01), -2.3263479, 1e-6);
  const g = gauss(5);
  const w = Array.from({ length: 600 }, () => 0.002 + g() * 0.02);
  const t = q.tailRisk(w, { h: 4, level: 0.95 });
  assert.ok(t.hVar < 0 && t.es <= t.hVar, 'la perte moyenne au-delà de la VaR est plus forte');
  near(t.gauss, 0.008 - 1.645 * 0.04, 0.01, 'VaR normale ≈ μh − 1,645 σ√h');
  near(t.cf, t.gauss, 0.01, 'loi normale : Cornish-Fisher ≈ VaR normale');
  assert.equal(q.tailRisk([0.01, 0.02]), null);
});

test('quant : modèle de Markov caché, deux régimes retrouvés', () => {
  const q = Q();
  const g = gauss(21);
  const x = [], truth = [];
  for (let b = 0; b < 8; b++) {
    const rough = b % 2 === 1;
    for (let i = 0; i < 60; i++) { x.push(rough ? -0.004 + g() * 0.04 : 0.003 + g() * 0.01); truth.push(rough); }
  }
  const h = q.hmm(x);
  near(h.sigma[0], 0.01, 0.003, 'volatilité calme'); near(h.sigma[1], 0.04, 0.008, 'volatilité agitée');
  const acc = h.gamma.filter((p, i) => (p > 0.5) === truth[i]).length / x.length;
  assert.ok(acc > 0.85, 'régimes reconnus : ' + acc);
  assert.ok(h.now > 0.5, 'la série finit en régime agité');
  assert.ok(h.P[0][0] > 0.9 && h.P[1][1] > 0.9, 'régimes persistants');
});

test('quant : crash-test d\'un portefeuille sur une crise', () => {
  const q = Q();
  const crisis = { start: '2020-01-06', end: '2020-01-20' };
  const A = [['2020-01-03', 100], ['2020-01-06', 100], ['2020-01-10', 80], ['2020-01-20', 50], ['2020-02-03', 90], ['2020-03-02', 101]];
  const B = [['2020-01-03', 100], ['2020-01-06', 100], ['2020-01-10', 100], ['2020-01-20', 100], ['2020-02-03', 100], ['2020-03-02', 100]];
  assert.ok(q.covers(A, crisis));
  assert.ok(!q.covers(A.slice(1), { start: '2020-01-01', end: '2020-01-20' }), 'pas de cours avant le début');
  const r = plain(q.crash({ A, B }, { A: 0.5, B: 0.5 }, crisis));
  near(r.mdd, -0.25); assert.equal(r.troughDate, '2020-01-20');
  assert.equal(r.recoveryDate, '2020-03-02'); assert.equal(r.recoveryDays, 42);
  assert.equal(q.crash({ A: A.slice(0, 4) }, { A: 1 }, crisis).recoveryDate, null, 'pas encore remonté');
});

test('quant : audit comportemental (timing, achat après hausse, vente dans une baisse)', () => {
  const q = Q();
  const s = [];
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2023, 0, 2) + i * 864e5).toISOString().slice(0, 10);
    s.push([d, 100 + 20 * Math.sin(i / 20)]);
  }
  const at = d => s.find(p => p[0] === d)[1];
  const first = d => s.find(p => p[0].slice(0, 7) === d.slice(0, 7))[1];
  const txs = [
    { key: 'X', type: 'buy', date: '2023-03-15', qty: 1000 / at('2023-03-15'), price: at('2023-03-15') },
    { key: 'X', type: 'sell', date: '2023-06-20', qty: 2, price: at('2023-06-20') },
    { key: 'X', type: 'buy', date: '2023-07-10', qty: 1, price: at('2023-07-10') * 3 }, // prix incohérent : écarté
  ];
  const r = q.behavior(txs, { X: s }, { X: 1 });
  assert.equal(r.buys.length, 1);
  const now = s[s.length - 1][1];
  near(r.timing, (1000 / at('2023-03-15') - 1000 / first('2023-03-15')) * now, 1e-9);
  assert.ok(r.best >= r.timing && r.worst <= r.timing, 'le timing réel est entre le pire et le meilleur jour du mois');
  assert.ok(r.chase >= 0 && r.chase <= 1);
  assert.equal(r.sells.length, 1);
  assert.equal(r.sells[0].panic, s.find(p => p[0] === '2023-06-20')[1] / Math.max(...s.filter(p => p[0] <= '2023-06-20').map(p => p[1])) - 1 <= -0.1);
});
