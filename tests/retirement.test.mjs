import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('sans rendement ni volatilité : 120 000 € à 1 000 €/mois tiennent exactement 10 ans', () => {
  const { Portfolio } = loadApp({});
  const p = { initial: 120000, withdraw: 1000, inflation: 0, rate: 0, vol: 0, paths: 50 };
  const r10 = Portfolio.retirement(Object.assign({ years: 10 }, p));
  assert.equal(r10.probSuccess, 1);
  near(r10.years[10].p50, 0, 1e-6);
  near(r10.years[5].p50, 60000, 1e-6);
  near(r10.withdrawn[10], 120000);
  const r15 = Portfolio.retirement(Object.assign({ years: 15 }, p));
  assert.equal(r15.probSuccess, 0);
  assert.equal(r15.depletion.p50, 121);                  // épuisé au 121e mois
  near(Portfolio.maxWithdrawal(Object.assign({ years: 10 }, p)), 1000, 1);
});

test('indexation sur l\'inflation : retraits plus élevés chaque année, épuisement plus tôt', () => {
  const { Portfolio } = loadApp({});
  const base = { initial: 120000, withdraw: 1000, rate: 0, vol: 0, years: 15, paths: 10 };
  const flat = Portfolio.retirement(Object.assign({ inflation: 0 }, base));
  const indexed = Portfolio.retirement(Object.assign({ inflation: 3 }, base));
  assert.ok(indexed.depletion.p50 < flat.depletion.p50);
  near(indexed.withdrawn[2], 12000 + 12000 * 1.03);
});

test('avec volatilité : scénarios ordonnés, résultat reproductible, probabilité entre 0 et 1', () => {
  const { Portfolio } = loadApp({});
  const p = { initial: 500000, withdraw: 2000, inflation: 2, rate: 5, vol: 15, years: 30 };
  const a = Portfolio.retirement(p), b = Portfolio.retirement(p);
  assert.equal(a.probSuccess, b.probSuccess);
  assert.ok(a.probSuccess > 0 && a.probSuccess < 1);
  const last = a.years[30];
  assert.ok(last.p10 <= last.p50 && last.p50 <= last.p90);
  assert.ok(a.depletion.p10 <= a.depletion.p50 && a.depletion.p50 <= a.depletion.p90);
  const w = Portfolio.maxWithdrawal(p, 0.9);
  assert.ok(w > 0 && w < 2000 * 1.5);
  assert.ok(Portfolio.retirement(Object.assign({}, p, { withdraw: w, paths: 1000 })).probSuccess >= 0.9);
  assert.ok(Portfolio.retirement(Object.assign({}, p, { withdraw: w * 1.1, paths: 1000 })).probSuccess < 0.9);
});
