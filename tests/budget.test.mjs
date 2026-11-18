import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('budget : épargne de précaution d\'abord, puis montant à investir', () => {
  const B = loadApp({}).get('Budget');
  // précaution incomplète : 6 × 2 000 = 12 000 visés, 11 500 disponibles → 500 au livret, 300 à investir
  let r = B.compute({ income: 2800, expenses: 2000, months: 6, liquid: 11500, planned: 200 });
  near(r.saving, 800); near(r.rate, 800 / 2800); near(r.target, 12000); near(r.gap, 500);
  near(r.toSafety, 500); near(r.invest, 300); near(r.extra, 100); near(r.covered, 5.75);
  // très incomplète : tout au livret, objectif dans 5 mois
  r = B.compute({ income: 2800, expenses: 2000, months: 6, liquid: 8000 });
  near(r.invest, 0); assert.equal(r.monthsToTarget, 5);
  // complète : toute l'épargne est investissable
  r = B.compute({ income: 3000, expenses: 2000, months: 3, liquid: 9000, planned: 1500 });
  near(r.invest, 1000); near(r.extra, 0); assert.equal(r.monthsToTarget, 0);
  // dépenses supérieures aux revenus
  r = B.compute({ income: 2000, expenses: 2500, months: 6, liquid: 1000 });
  near(r.invest, 0); near(r.toSafety, 0); assert.equal(r.monthsToTarget, Infinity);
});
