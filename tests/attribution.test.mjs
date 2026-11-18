import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));

test('attribution : zones d\'après les pays, poids du portefeuille en regardant dans les ETF', () => {
  const A = loadApp({}).get('Attribution');
  const w = plain(A.zoneWeights({ US: 72, JP: 5.5, GB: 3.6, FR: 2.6, CA: 3, other: 13.3 }));
  near(w.us, 0.72); near(w.japan, 0.055); near(w.europe, 0.062); near(w.other, 0.163);
  assert.deepEqual(plain(A.zoneWeights({})), { other: 1 });
  const p = plain(A.portfolioZones({ a: 300, b: 100 }, { a: { us: 1 }, b: { europe: 0.5, us: 0.5 } }));
  near(p.us, 0.875); near(p.europe, 0.125);
});

test('attribution : effets d\'un mois (Brinson-Fachler) et liaison de Cariño exactement additive', () => {
  const A = loadApp({}).get('Attribution');
  // indice : 70 % US (+5 %), 30 % Europe (−1 %) → +3,2 % ; portefeuille 100 % US, mais sur un ETF qui fait +4 %
  const m = plain(A.month({ rp: 0.04, rb: 0.032, wp: { us: 1 }, wb: { us: 0.7, europe: 0.3 }, rz: { us: 0.05, europe: -0.01 } }));
  near(m.alloc, 0.3 * (0.05 - 0.032) + (-0.3) * (-0.01 - 0.032));
  near(m.alloc + m.sel, 0.008);
  near(m.byZone.us + m.byZone.europe, m.alloc);
  // une zone sans rendement connu suit l'indice : effet nul
  near(A.month({ rp: 0.01, rb: 0.02, wp: { other: 1 }, wb: { us: 1 }, rz: {} }).byZone.other, 0);

  const months = [{ rp: 0.05, rb: 0.02, effects: { a: 0.01, b: 0.02 } }, { rp: -0.03, rb: 0.01, effects: { a: -0.05, b: 0.01 } }, { rp: 0.02, rb: 0.02, effects: { a: 0, b: 0 } }];
  const L = plain(A.link(months));
  near(L.rp, 1.05 * 0.97 * 1.02 - 1);
  near(L.rb, 1.02 * 1.01 * 1.02 - 1);
  near(L.effects.a + L.effects.b, L.active, 1e-12);
  near(A.carino(0.1, 0.1), 1 / 1.1);
});

test('attribution : fins de mois et analyse complète sur des séries simulées', () => {
  const a = loadApp({});
  const A = a.get('Attribution');
  assert.deepEqual(plain(A.monthEnds('2024-01-15', '2024-04-10')), ['2024-01-15', '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-10']);
  const dates = ['2024-01-31', '2024-02-29', '2024-03-31'];
  // indice = 70 % US + 30 % Europe ; portefeuille = un ETF S&P 500 qui colle à la zone US
  const us = [['2024-01-31', 100], ['2024-02-29', 106], ['2024-03-31', 103]];
  const eu = [['2024-01-31', 100], ['2024-02-29', 99], ['2024-03-31', 104]];
  const bench = dates.map((d, i) => [d, i === 0 ? 100 : null]);
  bench[1][1] = 100 * (0.7 * 1.06 + 0.3 * 0.99);
  bench[2][1] = bench[1][1] * (0.7 * (103 / 106) + 0.3 * (104 / 99));
  const R = plain(A.analyze({ dates, twr: us, bench, lineValues: { spx: [1000, 1060, 1030] }, split: { spx: { us: 1 } },
    zones: { us, europe: eu }, wb: { us: 0.7, europe: 0.3 } }));
  near(R.rp, 0.03);
  near(R.alloc + R.sel, R.active, 1e-12);
  near(R.sel, 0, 1e-9); // l'ETF suit exactement sa zone : tout l'écart vient de la répartition
  assert.equal(R.months, 2);
  assert.equal(R.zones.find(z => z.id === 'us').wp, 1);
});
