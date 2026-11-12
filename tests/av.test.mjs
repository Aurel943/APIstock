import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const state = extra => Object.assign({
  accounts: [{ id: 'av', name: 'Assurance-vie', type: 'av', taxRate: 24.7 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' } },
  transactions: [{ id: '1', key: 'CW8@XPAR', type: 'buy', date: '2017-03-01', account: 'av', qty: 100, price: 150, fees: 0 }],
}, extra);
const withPrice = (app, price) => { app.Api.cachedQuote = () => ({ price, percentChange: 0, change: 0 }); app.Portfolio.invalidate(); };

test('assurance-vie : 8 ans, abattement entier et rachat sans impôt sur le revenu', () => {
  const app = loadApp(state());
  withPrice(app, 200);                                   // valeur 20 000 €, gains 5 000 € (25 %)
  const v = app.get('Tax').av(app.Store.account('av'), '2026-11-12');
  assert.equal(v.open, '2017-03-01');
  assert.equal(v.eight, '2025-03-01');
  assert.equal(v.done, true);
  assert.equal(v.allowance, 4600);
  near(v.ratio, 0.25);
  near(v.taxFree, 4600 / 0.25);                          // 18 400 € de rachat contiennent 4 600 € de gains
});

test('assurance-vie : couple, gains déjà rachetés dans l\'année, contrat de moins de 8 ans', () => {
  const app = loadApp(state({
    accounts: [{ id: 'av', name: 'AV', type: 'av', taxRate: 24.7, couple: true, openDate: '2020-06-15' }],
    transactions: [
      { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2020-06-15', account: 'av', qty: 100, price: 150, fees: 0 },
      { id: '2', key: 'CW8@XPAR', type: 'sell', date: '2026-02-01', account: 'av', qty: 20, price: 200, fees: 0 },
    ],
  }));
  withPrice(app, 200);
  const v = app.get('Tax').av(app.Store.account('av'), '2026-11-12');
  assert.equal(v.allowance, 9200);
  assert.equal(v.done, false);                           // 8 ans le 15 juin 2028
  near(v.used, 20 * 50);                                 // 1 000 € de gains rachetés en 2026
  near(v.left, 8200);
});

test('assurance-vie : contrat en perte, tout est rachetable sans impôt sur le revenu', () => {
  const app = loadApp(state());
  withPrice(app, 100);
  const v = app.get('Tax').av(app.Store.account('av'), '2026-11-12');
  near(v.ratio, 0);
  near(v.taxFree, v.value);
});
