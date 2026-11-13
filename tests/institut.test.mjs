import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const I = () => loadApp({}).get('Inst');

test('algèbre : inverse, produit, loi normale', () => {
  const i = I();
  const A = [[4, 7], [2, 6]];
  const Ai = plain(i.inv(A));
  near(Ai[0][0], 0.6); near(Ai[0][1], -0.7); near(Ai[1][0], -0.2); near(Ai[1][1], 0.4);
  const id = plain(i.mm(A, Ai));
  near(id[0][0], 1); near(id[0][1], 0); near(id[1][1], 1);
  assert.equal(i.inv([[1, 2], [2, 4]]), null);
  near(i.normCdf(0), 0.5, 1e-7); near(i.normCdf(1.96), 0.975, 1e-3); near(i.normCdf(-3), 0.00135, 1e-4);
});

test('stress test inversé : choc le plus plausible, perte exacte, probabilité cohérente', () => {
  const i = I();
  // deux facteurs indépendants, vol hebdo 2 % et 1 % ; ligne A = 1×F1, ligne B = 1×F2 ; portefeuille 50/50
  const model = { factorKeys: ['f1', 'f2'], lineKeys: ['A', 'B'], cov: [[0.0004, 0], [0, 0.0001]],
    betas: { A: { beta: [1, 0], r2: 0.9 }, B: { beta: [0, 1], r2: 0.8 } }, weeks: [] };
  const r = plain(i.reverseStress(model, { A: 5000, B: 5000 }, -0.1, 1));
  // le choc est réparti selon les variances : Σb = (0,0002 ; 0,00005) → s = −0,1 × Σb / bᵀΣb
  near(r.shock.f1, -0.1 * 0.0002 / 0.000125, 1e-12); near(r.shock.f2, -0.1 * 0.00005 / 0.000125, 1e-12);
  near(r.pnl, -1000, 1e-6, 'la perte visée est atteinte exactement');
  near(r.d, 0.1 / Math.sqrt(0.000125), 1e-9);
  assert.ok(r.p > 0 && r.p < 1e-10, 'perte de 10 % en une semaine avec 1,1 % de vol : quasi impossible en loi normale');
  // sur un an, la même perte devient bien plus plausible
  const y = plain(i.reverseStress(model, { A: 5000, B: 5000 }, -0.1, 52));
  assert.ok(y.d < r.d && y.years < 1000);
  assert.equal(i.reverseStress(model, { A: 0, B: 0 }, -0.1), null);
});

test('Black-Litterman : sans vue on retrouve l\'équilibre, une vue forte tire le rendement, l\'optimum respecte les contraintes', () => {
  const i = I();
  const cov = [[0.04, 0.012], [0.012, 0.09]], w = [0.6, 0.4];
  const r0 = plain(i.blackLitterman({ cov, w }));
  near(r0.pi[0], 2.5 * (0.04 * 0.6 + 0.012 * 0.4)); near(r0.mu[1], r0.pi[1]);
  // sans vue, l'optimum sans plafond retrouve les poids d'équilibre (Σ a posteriori = Σ(1+τ) → poids identiques à l'échelle près)
  const w0 = plain(i.optimize(r0.pi, cov, { delta: 2.5 }));
  near(w0[0], 0.6, 1e-3); near(w0[1], 0.4, 1e-3);
  const strong = plain(i.blackLitterman({ cov, w, views: [{ p: [0, 1], q: 0.2, conf: 0.95 }] }));
  const weak = plain(i.blackLitterman({ cov, w, views: [{ p: [0, 1], q: 0.2, conf: 0.1 }] }));
  assert.ok(strong.mu[1] > weak.mu[1] && weak.mu[1] > r0.pi[1], 'plus la confiance est forte, plus le rendement révisé s\'approche de la vue');
  near(strong.mu[1], 0.2, 0.02);
  const wo = plain(i.optimize(strong.mu, strong.sigma, { cap: 0.7 }));
  near(wo[0] + wo[1], 1, 1e-9); assert.ok(wo.every(x => x >= -1e-12 && x <= 0.7 + 1e-9), 'poids entre 0 et le plafond');
  assert.ok(wo[1] > 0.4, 'la conviction augmente le poids de la ligne');
  const relative = plain(i.blackLitterman({ cov, w, views: [{ p: [1, -1], q: 0.05, conf: 0.8 }] }));
  assert.ok(relative.mu[0] - relative.mu[1] > r0.pi[0] - r0.pi[1], 'vue relative : l\'écart s\'élargit');
  const p = plain(i.project([0.9, 0.3, -0.2], 0.6));
  near(p.reduce((s, x) => s + x, 0), 1, 1e-9); assert.ok(p[0] <= 0.6 + 1e-9 && p[2] >= 0);
});

test('planificateur : bootstrap par blocs, simulation, probabilité et versement nécessaire', () => {
  const i = I();
  const rets = Array.from({ length: 120 }, (_, k) => (k % 12 === 5 ? -0.08 : 0.012));
  const scen = i.scenarios(rets, 60, { paths: 500, block: 12, seed: 3 });
  assert.equal(scen.length, 500); assert.equal(scen[0].length, 60);
  assert.ok(Array.from(scen[0]).every(x => rets.includes(x)), 'chaque rendement vient de l\'historique');
  // sans aléa : rendement nul, 100 €/mois pendant 60 mois = 6 000 €
  const flat = i.scenarios([0, 0, 0, 0], 60, { paths: 10 });
  const s0 = i.simulate(flat, { start: 1000, monthly: 100 });
  near(s0.finals[0], 7000, 1e-9);
  near(i.simulate(flat, { start: 1000, monthly: 0, inflation: 0.02 }).finals[0], 1000 / 1.02 ** 5, 1e-6, 'euros d\'aujourd\'hui');
  assert.equal(i.prob(s0.finals, 7000), 1); assert.equal(i.prob(s0.finals, 7001), 0);
  const need = i.requiredMonthly(flat, { start: 1000, target: 10000, p: 0.9 });
  assert.ok(need >= 150 && need <= 151, `150 €/mois nécessaires, obtenu ${need}`);
  assert.equal(i.requiredMonthly(flat, { start: 20000, target: 10000, p: 0.9 }), 0);
  // plus de chances demandées = plus d'effort, sur les mêmes scénarios
  const n50 = i.requiredMonthly(scen, { start: 5000, target: 30000, p: 0.5 }), n90 = i.requiredMonthly(scen, { start: 5000, target: 30000, p: 0.9 });
  assert.ok(n90 >= n50, `${n90} ≥ ${n50}`);
  near(i.quantile([1, 2, 3, 4, 5], 0.5), 3); near(i.quantile([1, 2, 3, 4, 5], 0.9), 4.6, 1e-9);
});

test('loi normale : queues extrêmes positives et décroissantes', () => {
  const i = I();
  const a = i.normCdf(-6), b = i.normCdf(-9);
  near(a, 9.866e-10, 2e-12); assert.ok(b > 0 && b < a);
  near(i.normCdf(-5.0001), i.normCdf(-4.9999), 1e-8, 'continuité au raccord');
});
