import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));

test('revue du mois : bornes, mois proposés, synthèse du P&L explain', () => {
  const R = loadApp({}).get('Review');
  assert.deepEqual(plain(R.bounds('2026-02', '2026-11-18')), { start: '2026-01-31', first: '2026-02-01', end: '2026-02-28', partial: false, next: '2026-03-01' });
  const cur = plain(R.bounds('2026-11', '2026-11-18'));
  assert.equal(cur.end, '2026-11-18'); assert.equal(cur.partial, true);
  assert.deepEqual(plain(R.months('2026-11-18', '2026-08-20')), ['2026-11', '2026-10', '2026-09', '2026-08']);
  assert.equal(R.months('2026-11-18').length, 12);
  const E = { total: 120, twr: 0.02, startValue: 6000, endValue: 7120, inflow: 1000, outflow: 0, price: 150, fx: -40, exec: 5, div: 10, fees: 5,
    lines: [{ key: 'a', total: 90 }, { key: 'b', total: 60 }, { key: 'c', total: -30 }] };
  const S = plain(R.summary(E, 0.015, [{ type: 'buy' }, { type: 'div' }, { type: 'buy' }]));
  near(S.vsBench, 0.005); near(S.net, 1000); near(S.parts.fees, -5);
  near(S.parts.price + S.parts.fx + S.parts.exec + S.parts.div + S.parts.fees, S.pnl);
  assert.deepEqual(S.top.map(l => l.key), ['a', 'b']);
  assert.deepEqual(S.flop.map(l => l.key), ['c']);
  assert.equal(S.ops, 2); assert.equal(S.divs, 1);
  assert.ok(isNaN(R.summary(E, NaN, []).vsBench));
});
