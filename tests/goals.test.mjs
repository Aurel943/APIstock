import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const state = () => ({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6 }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 31.4 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' } },
  transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-02', account: 'pea', qty: 10, price: 400, fees: 0 },
    { id: '2', key: 'CW8@XPAR', type: 'buy', date: '2024-01-02', account: 'cto', qty: 2, price: 400, fees: 0 },
  ],
  goal: { target: 100000, date: '2036-11-12', monthly: 300, rate: 6 },
  goals: [{ id: 'g2', name: 'Apport', target: 2000, date: '2027-11-12', monthly: 0, rate: 0, accounts: ['cto'] }],
});
const load = () => { const a = loadApp(state()); a.Api.cachedQuote = () => ({ price: 500, change: 0, percentChange: 0 }); a.Portfolio.invalidate(); return a; };

test('objectifs : le principal en premier, chacun financé par ses comptes', () => {
  const a = load();
  const Goals = a.get('Goals');
  const all = Goals.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].main, true);
  near(Goals.current(all[0]).value, 6000);   // tous les comptes : 12 parts × 500 €
  near(Goals.current(all[1]).value, 1000);   // compte-titres seul : 2 parts
});

test('objectifs : projection, date d\'atteinte et versement nécessaire', () => {
  const a = load();
  const Goals = a.get('Goals');
  // sans rendement ni versement : 1 000 € sur 2 000 € → jamais atteint, il faut 1 000 € en 12 mois
  const p = Goals.project({ target: 2000, date: '2027-11-12', monthly: 0, rate: 0 }, 1000, '2026-11-12');
  assert.equal(p.reach, null);
  near(p.need, 1000 / 12);
  assert.equal(p.onTrack, false);
  near(p.pct, 50);
  // 100 €/mois sans rendement : atteint en 10 mois, en avance sur la date
  const q = Goals.project({ target: 2000, date: '2027-11-12', monthly: 100, rate: 0 }, 1000, '2026-11-12');
  assert.equal(q.reach, 10);
  assert.equal(q.onTrack, true);
  assert.equal(Goals.project({ target: 500, date: '2027-01-01', monthly: 0, rate: 0 }, 1000, '2026-11-12').reach, 0);
});

test('alertes avancées : seuils tirés du prix de revient et du plus haut 1 an', () => {
  const a = load();
  const App = a.App;
  a.Api.cachedQuote = () => ({ price: 380, change: 0, percentChange: 0, high52: 450 });
  near(App.alertThreshold({ kind: 'belowPru', key: 'CW8@XPAR' }), 400);
  near(App.alertThreshold({ kind: 'fromHigh', key: 'CW8@XPAR', value: 10 }), 405);
  a.Store.state.alerts = [
    { id: 'a1', key: 'CW8@XPAR', kind: 'belowPru', value: 0, active: true },
    { id: 'a2', key: 'CW8@XPAR', kind: 'fromHigh', value: 20, active: true },  // seuil 360 : pas encore
  ];
  App.renderAlerts = () => {}; App.notify = () => {}; a.ctx.toast = () => {};
  App.checkAlerts('CW8@XPAR', { price: 380, percentChange: 0, high52: 450 });
  assert.equal(a.Store.state.alerts[0].active, false, 'sous le prix de revient : déclenchée');
  assert.equal(a.Store.state.alerts[1].active, true);
});
