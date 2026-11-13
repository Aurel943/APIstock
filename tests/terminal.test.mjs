import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const app = () => loadApp({});
const series = closes => closes.map((c, i) => [new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), c]);

test('scanner : RSI, moyennes, croisement, plus haut, mouvement inhabituel, séries', () => {
  const S = app().get('Scan');
  near(S.sma([1, 2, 3, 4], 2), 3.5); assert.ok(isNaN(S.sma([1], 2)));
  assert.equal(S.rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100, 'que des hausses');
  assert.equal(S.rsi(Array.from({ length: 30 }, (_, i) => 100 - i)), 0, 'que des baisses');
  near(S.rsi([1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1]), 50, 6, 'alternance : RSI proche de 50');
  // 230 séances de baisse douce puis remontée franche : la moyenne 50 repasse au-dessus de la 200 (golden cross)
  const c = [];
  for (let i = 0; i < 230; i++) c.push(100 - i * 0.1);
  for (let i = 0; i < 60; i++) c.push(c[c.length - 1] * 1.006);
  let golden = null;
  for (let n = 240; n <= c.length; n++) { const x = S.cross(c.slice(0, n), 50, 200, 1); if (x) { golden = x; break; } }
  assert.equal(golden && golden.type, 'golden');
  // série plate puis saut de +6 % : mouvement inhabituel + plus haut 52 semaines
  const flat = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i) * 0.5);
  flat.push(flat[flat.length - 1] * 1.06);
  const a = plain(S.analyze(series(flat)));
  assert.ok(a.z > 5, 'écarts-types : ' + a.z);
  assert.equal(a.signals[0].kind, 'move', 'le mouvement inhabituel passe en premier');
  assert.ok(a.signals.some(s => s.kind === 'high'), 'plus haut 52 semaines');
  // 7 baisses d'affilée et 25 % sous le plus haut : série + marché baissier
  const down = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 7 }, (_, i) => 100 * 0.96 ** (i + 1))];
  const d = plain(S.analyze(series(down)));
  assert.equal(d.streak, -7);
  assert.ok(d.signals.some(s => s.kind === 'streak') && d.signals.some(s => s.kind === 'bear') && d.signals.some(s => s.kind === 'rsi'));
  assert.equal(S.analyze(series([1, 2, 3])), null);
});

test('radiographie : entreprises vues à travers les ETF, actions en direct rapprochées, part des 7 Magnifiques', () => {
  const X = app().get('Xray');
  const H = { sp500: [['NVIDIA', 10], ['Apple', 5]], cac: [['LVMH', 8]] };
  const r = plain(X.lookthrough([
    { key: 'A', label: 'S&P 500', value: 10000, profile: 'sp500' },
    { key: 'B', label: 'CAC 40', value: 5000, profile: 'cac' },
    { key: 'C', label: 'Apple Inc.', value: 1000, profile: 'stock' },
    { key: 'D', label: 'Ma pépite', value: 500, profile: 'stock' },
    { key: 'E', label: 'Fonds obscur', value: 3500, profile: 'none' },
  ], H));
  assert.deepEqual(r.companies.map(c => c.name), ['Apple', 'NVIDIA', 'Ma pépite', 'LVMH']);
  near(r.companies[0].value, 1500, 1e-9, 'Apple via l\'ETF + en direct');
  assert.equal(r.companies[0].via.length, 2);
  near(r.total, 20000); near(r.covered, (1500 + 1000 + 500 + 400) / 200, 1e-9);
  near(r.mag7, 2500 / 200, 1e-9); near(r.mag7Value, 2500);
  assert.equal(X.norm('L\'Oréal S.A.'), 'l oreal s a');
});
