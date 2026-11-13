import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const A = () => loadApp({}).get('Arena');

test('univers parallèles : flux réels, actif qui double, retraits, Livret A et matelas', () => {
  const a = A();
  const flows = plain(a.flows([
    { key: 'X', type: 'buy', date: '2024-01-10', qty: 10, price: 100, fees: 2 },
    { key: 'X', type: 'div', date: '2024-06-01', qty: 10, price: 1 },
    { key: 'X', type: 'sell', date: '2024-09-02', qty: 2, price: 150, fees: 1 },
  ], () => 1));
  assert.deepEqual(flows, [{ date: '2024-01-10', amount: 1002 }, { date: '2024-09-02', amount: -299 }]);
  const series = [['2024-01-01', 50], ['2024-06-01', 100], ['2024-12-31', 100]];
  const v = plain(a.universe(flows, series, ['2024-01-31', '2024-06-30', '2024-12-31']));
  near(v[0], 1002); near(v[1], 2004, 1e-9, 'l\'actif a doublé'); near(v[2], 2004 - 299, 1e-9, 'retrait du même montant');
  assert.equal(a.universe(flows, [['2024-03-01', 10], ['2024-04-01', 11]], ['2024-12-31']), null, 'historique trop court');
  const mat = plain(a.savings(flows, ['2024-01-31', '2024-12-31'], []));
  near(mat[0], 1002); near(mat[1], 703);
  const liv = plain(a.savings([{ date: '2024-01-01', amount: 1000 }], ['2024-01-01', '2025-01-01'], [['2023-02-01', 3]]));
  near(liv[1], 1000 * 1.03 ** (366 / 365), 1e-6, 'intérêts au jour le jour');
  const R = plain(a.ranking({ real: [0, 1500], btc: [0, 3000], mattress: [0, 1000] }));
  assert.deepEqual(R.list.map(x => x.id), ['btc', 'real', 'mattress']);
  assert.equal(R.real.rank, 2); near(R.regret, 1500); near(R.pride, 500);
  const w = plain(a.weeks('2024-01-03', '2024-01-24'));
  assert.deepEqual(w, ['2024-01-05', '2024-01-12', '2024-01-19', '2024-01-24']);
});

test('défi à l\'aveugle : semaines, partie, coût des allers-retours, bilan et titre', () => {
  const a = A();
  assert.deepEqual(plain(a.weekly([['2024-01-01', 1], ['2024-01-05', 2], ['2024-01-08', 3]])), [['2024-01-05', 2], ['2024-01-08', 3]]);
  const prices = Array.from({ length: 200 }, (_, i) => [`w${String(i).padStart(3, '0')}`, 100 * 1.01 ** i]);
  assert.equal(a.newGame(prices.slice(0, 100), 0.5), null, 'historique insuffisant');
  const g = a.newGame(prices, 0.999);
  assert.equal(g.w.length, 157);
  // toujours investi = acheter et conserver
  const g1 = a.newGame(prices, 0);
  for (let i = 0; i < 104; i++) a.step(g1, true);
  const r1 = a.result(g1);
  near(r1.vs, 0, 1e-9); near(r1.market, (1.01 ** 104 - 1) * 100, 1e-6); assert.equal(r1.trades, 0);
  assert.match(r1.title, /zen/);
  // en liquidités tout le temps dans un marché haussier : titre de vendeur paniqué
  const g2 = a.newGame(prices, 0);
  for (let i = 0; i < 104; i++) a.step(g2, false);
  const r2 = a.result(g2);
  assert.equal(r2.trades, 1); near(r2.you, -0.1, 1e-9, 'seulement le coût de la vente');
  assert.match(r2.title, /paniqué/);
  assert.equal(r2.invested, 0);
  a.step(g2, true);
  assert.equal(g2.t, 104, 'partie terminée : plus de pas');
});

test('écoute : montants lus à voix haute, briefing, partition musicale', () => {
  const a = A();
  assert.equal(a.spoken(12345.6), '12346 euros');
  assert.equal(a.spoken(-12.5, 'USD'), 'moins 12,5 dollars');
  const t = a.briefingText({ value: 25000, day: 180, dayPct: 0.72, best: { name: 'CW8', pct: 1.2 }, worst: { name: 'Or', pct: -0.4 }, total: 3200, totalPct: 14.7, alerts: 2, hour: 20 });
  assert.match(t, /^Bonsoir\./);
  assert.match(t, /vaut 25000 euros/);
  assert.match(t, /gagne 180 euros, soit 0,7 pour cent/);
  assert.match(t, /En tête, CW8, en hausse de 1,2 pour cent\. En queue, Or, en baisse de 0,4 pour cent/);
  assert.match(t, /2 alertes se sont déclenchées/);
  assert.match(a.briefingText({ value: 0 }), /vide/);
  const notes = plain(a.score([100, 110, 99, 99, 120]));
  assert.equal(notes.length, 4);
  const tonic = 440 * 2 ** (-9 / 12); // do
  assert.ok(notes[0].freq > tonic && notes[1].freq < tonic, 'hausse aiguë, baisse grave');
  near(notes[2].freq, tonic, 1e-9, 'rendement nul : la tonique');
  assert.ok(notes[3].freq >= notes[0].freq, 'la plus forte hausse est la plus aiguë');
});
