import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('crédit : mensualité, indemnités de remboursement anticipé (6 mois d\'intérêts, 3 % au plus)', () => {
  const C = loadApp({}).get('Credit');
  near(C.payment(100000, 3, 120), 965.61, 0.01);
  near(C.payment(1200, 0, 12), 100, 1e-9);
  near(C.iraRate(2), 0.01, 1e-12);   // 6 mois à 2 % = 1 %
  near(C.iraRate(7), 0.03, 1e-12);   // plafonné à 3 %
});

test('crédit : rembourser ou investir — mêmes sorties d\'argent, équilibre près du coût du crédit', () => {
  const C = loadApp({}).get('Credit');
  const p = { capital: 150000, rate: 3.5, months: 180, insurance: 0, amount: 20000, ret: 3.5, tax: 0, mode: 'duration' };
  const S = C.simulate(p);
  near(S.repaid * (1 + S.ira), 20000, 1e-6);
  near(S.fees, S.repaid * 0.0175, 1e-6);
  assert.ok(S.newMonths < 180 && S.newMonths > 140, 'crédit fini plus tôt : ' + S.newMonths);
  assert.ok(S.saved > 0);
  // sans impôt ni indemnités, placer au taux du crédit revient au même
  const free = C.simulate(Object.assign({}, p, { rate: 0.0001 }));
  near(C.simulate(Object.assign({}, p, { rate: 0, ret: 0 })).diff, 0, 1e-6);
  assert.ok(free.ira < 0.001);
  // indemnités : elles pénalisent le remboursement, placer l'emporte un peu en dessous du taux du crédit
  const be = C.breakEven(p);
  assert.ok(be > 3.2 && be < 3.5, 'équilibre ' + be);
  near(C.simulate(Object.assign({}, p, { ret: be })).diff, 0, 1);
  assert.ok(C.simulate(Object.assign({}, p, { ret: 7 })).diff > 0);
  assert.ok(C.simulate(Object.assign({}, p, { ret: 2 })).diff < 0);
  // l'impôt sur les gains relève le point d'équilibre ; la mensualité allégée aussi possible
  assert.ok(C.breakEven(Object.assign({}, p, { tax: 31.4 })) > be);
  const P = C.simulate(Object.assign({}, p, { mode: 'payment' }));
  assert.ok(P.m1 < P.m0 && P.newMonths === 180);
  // somme supérieure au capital : tout est remboursé, le surplus placé
  const big = C.simulate(Object.assign({}, p, { capital: 10000, amount: 20000 }));
  near(big.repaid, 10000, 1e-9);
  near(big.rest, 20000 - 10000 * (1 + big.ira), 1e-9);
  assert.equal(big.newMonths, 0);
});
