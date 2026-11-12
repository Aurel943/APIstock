import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const state = () => ({
  settings: { baseCurrency: 'EUR' },
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' } },
  transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2026-08-05', account: 'pea', qty: 2, price: 500, fees: 2 },
    { id: '2', key: 'CW8@XPAR', type: 'buy', date: '2026-10-06', account: 'pea', qty: 1, price: 600, fees: 1 },
    { id: '3', key: 'CW8@XPAR', type: 'div', date: '2026-10-20', account: 'pea', qty: 1, price: 12.5, fees: 0 },
  ],
  plans: [{ id: 'p', key: 'CW8@XPAR', account: 'pea', amount: 300, day: 5, start: '2026-01-01', active: true, done: {} }],
});

test('bilan mensuel : achats, dividendes et versements programmés du mois écoulé', () => {
  const { App } = loadApp(state());
  const r = App.monthRecap('2026-11-03');
  assert.equal(r.month, '2026-10');
  assert.equal(r.buys, 1);
  near(r.bought, 601);
  near(r.divs, 12.5);
  near(r.planned, 300);
  assert.equal(r.gain, null, 'sans historique, pas de performance');
});

test('bilan mensuel : performance tirée de l\'historique, hors versements', () => {
  const { App } = loadApp(state());
  App.historyPoints = [
    { date: '2026-09-30', invested: 1002, value: 1100 },
    { date: '2026-10-15', invested: 1603, value: 1750 },
    { date: '2026-10-30', invested: 1603, value: 1800 },
  ];
  const r = App.monthRecap('2026-11-03');
  near(r.gain, (1800 - 1100) - (1603 - 1002)); // gain du mois, sans compter l'argent versé
  assert.match(App.recapText(r), /1 achat\(s\)/);
});

test('bilan mensuel : visible les 15 premiers jours, masqué une fois vu, rien avant la première opération', () => {
  const { App, Store } = loadApp(state());
  assert.ok(App.recapTodo('2026-11-10'));
  assert.equal(App.recapTodo('2026-11-20'), null);
  Store.state.dismissed = { 'recap:2026-10': Date.now() };
  assert.equal(App.recapTodo('2026-11-10'), null);
  assert.equal(App.monthRecap('2026-08-02'), null);
});
