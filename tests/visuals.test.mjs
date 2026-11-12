import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('optimiseur : alignement des dates, statistiques annualisées, répartitions remarquables', () => {
  const { get } = loadApp({});
  const O = get('Optimizer');
  // A : +0,1 %/jour régulier (volatilité nulle) ; B : ±1 % en alternance
  const days = Array.from({ length: 300 }, (_, i) => `d${String(i).padStart(3, '0')}`);
  const A = days.map((d, i) => [d, 100 * Math.pow(1.001, i)]);
  const B = days.map((d, i) => [d, 100 * (i % 2 ? 1.01 : 1)]);
  B.splice(10, 1); // un jour manquant : retiré des deux séries
  const al = O.align({ A, B });
  assert.equal(al.keys.length, 2);
  assert.equal(al.dates.length, 299);
  const st = O.stats(al.returns);
  assert.ok(st.cov[0][0] < st.cov[1][1] / 100, 'A presque sans variation (sauf le jour retiré), B très variable');
  const fr = O.frontier(st, { n: 500, current: [0.5, 0.5] });
  assert.ok(fr.minVol.w[0] > 0.95, 'la moins risquée est presque tout A');
  near(fr.minVol.w.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(fr.maxSharpe.sharpe >= fr.current.sharpe);
  assert.equal(fr.points.length, 502);                // 500 tirages + 2 répartitions à 100 %
  // reproductible
  assert.equal(O.frontier(st, { n: 50, seed: 7 }).maxSharpe.ret, O.frontier(st, { n: 50, seed: 7 }).maxSharpe.ret);
});

test('carte : tuiles d\'aires proportionnelles, sans chevauchement, dans le cadre', () => {
  const { get } = loadApp({});
  const T = get('Treemap');
  const vals = [50, 25, 12, 8, 5];
  const tiles = JSON.parse(JSON.stringify(T.layout(vals, 0, 0, 200, 100)));
  assert.equal(tiles.length, 5);
  for (const t of tiles) {
    near(t.w * t.h, vals[t.i] / 100 * 20000, 1e-6);
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= 200 + 1e-9 && t.y + t.h <= 100 + 1e-9);
  }
  for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) {
    const p = tiles[a], q = tiles[b];
    const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, 'pas de chevauchement');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(T.layout([0, 0]))), []);
});

test('ton année en bourse : performance, mois, opérations, ligne star, comparaison au marché', () => {
  const { get } = loadApp({});
  const W = get('Wrapped');
  const points = [
    { date: '2025-12-31', invested: 1000, value: 1000 },
    { date: '2026-03-31', invested: 1000, value: 1100 },
    { date: '2026-06-30', invested: 2000, value: 2050 },   // 1 000 € versés, puis une baisse
    { date: '2026-11-30', invested: 2000, value: 2300 },
  ];
  const txs = [
    { date: '2026-06-01', type: 'buy', key: 'A', qty: 10, price: 100, fees: 2 },
    { date: '2026-09-01', type: 'div', key: 'A', qty: 1, price: 15, fees: 0 },
    { date: '2025-05-01', type: 'buy', key: 'A', qty: 10, price: 100, fees: 2 },  // année précédente : ignoré
  ];
  const prices = { A: [['2025-12-31', 100], ['2026-11-30', 120]], B: [['2025-12-31', 50], ['2026-11-30', 45]] };
  const d = W.compute(2026, { points, prices, bench: [['2025-12-31', 80], ['2026-11-30', 88]], txs, today: '2026-12-10' });
  near(d.gain, (2300 - 1000) - (2000 - 1000));
  near(d.perf, (1100 / 1000) * (2050 - 1000) / 1100 * (2300 / 2050) * 100 - 100, 1e-9);
  assert.equal(d.buys, 1); near(d.invested, 1002); near(d.divs, 15); near(d.fees, 2);
  assert.equal(d.star.key, 'A'); near(d.star.perf, 20);
  assert.equal(d.flop.key, 'B');
  near(d.benchPerf, 10);
  assert.equal(d.best.m, 11); assert.equal(d.worst.m, 6); // novembre +12,2 %, juin −4,5 %
  assert.equal(d.partial, true);
  assert.equal(W.compute(2024, { points }), null);
  assert.equal(W.defaultYear('2027-01-15'), 2026);
  assert.equal(W.defaultYear('2026-12-05'), 2026);
});
