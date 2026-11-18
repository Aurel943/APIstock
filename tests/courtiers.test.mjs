import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('courtiers : barèmes relevés (paliers, minimum, 1er ordre du mois offert, plafond du PEA)', () => {
  const a = loadApp({});
  const T = a.get('BROKER_TARIFFS'), B = a.get('Brokers');
  const fee = (id, amt, o = {}) => T.find(t => t.id === id).fee(amt, o);
  near(fee('bourso-decouverte', 400), 1.99); near(fee('bourso-decouverte', 2000), 12);
  near(fee('bourso-classic', 900), 5.5); near(fee('bourso-classic', 1200), 8.95); near(fee('bourso-classic', 5000), 24);
  near(fee('fortuneo-starter', 400, { firstOfMonth: true }), 0); near(fee('fortuneo-starter', 400, {}), 1.4);
  near(fee('fortuneo-progress', 5000), 4.9 + 3); near(fee('fortuneo-traderpro', 8000), 9.5);
  near(fee('degiro', 1000, {}), 2); near(fee('degiro', 1000, { foreign: true }), 4.5);
  const orders = [{ date: '2026-01-05', amount: 300 }, { date: '2026-01-20', amount: 300 }, { date: '2026-03-02', amount: 1000 }];
  const s = B.simulate(orders, T.find(t => t.id === 'fortuneo-starter'), { until: '2026-03-31' });
  near(s.total, 0 + 1.05 + 3.5);
  const c = B.simulate(orders, T.find(t => t.id === 'bourso-classic'), { until: '2026-04-30' });
  near(c.inactivity, 5.95 * 2); // février et avril sans ordre
  near(c.total, 5.5 * 3 + 11.9);
  // PEA : 0,50 % du montant au plus (4,90 € sur un ordre de 300 € → 1,50 €)
  near(B.simulate([{ date: '2026-01-05', amount: 300 }], T.find(t => t.id === 'fortuneo-progress'), { pea: true }).total, 1.5);
  const cmp = B.compare(orders, { pea: true, until: '2026-03-31' });
  assert.equal(cmp.find(r => r.broker.id === 'degiro').available, false);
  assert.ok(cmp[0].available && cmp.every((r, i) => i === 0 || !r.available || !cmp[i - 1].available || r.total >= cmp[i - 1].total), 'du moins cher au plus cher');
  const cu = B.custom({ name: 'Mon courtier', fixed: '0,99', pct: '0,1', min: '' });
  near(cu.fee(1000), 1.99);
  assert.equal(B.custom({ fixed: '' }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(B.months('2025-11', '2026-02'))), ['2025-11', '2025-12', '2026-01', '2026-02']);
});
