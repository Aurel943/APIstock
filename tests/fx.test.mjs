import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const state = extra => Object.assign({
  settings: { baseCurrency: 'EUR' },
  accounts: [{ id: 'cto', name: 'CTO', type: 'cto', taxRate: 30 }],
  instruments: {
    'SPY@ARCX': { symbol: 'SPY', mic: 'ARCX', name: 'SPDR', currency: 'USD' },
    'VUSA@XLON': { symbol: 'VUSA', mic: 'XLON', name: 'Vanguard', currency: 'GBp' },
  },
  transactions: [],
}, extra);

/** Taux USD → EUR : 0,90 en janvier 2024, 0,80 à partir de juin 2024 ; taux du jour 0,95 */
function withRates(app) {
  app.Api.fxCached = from => (from === 'USD' ? 0.95 : from === 'GBp' ? 0.0117 : from === 'GBP' ? 1.17 : 1);
  app.Api.fxHist['USD/EUR'] = { start: '2023-12-01', ts: Date.now(), values: [['2024-01-02', 0.9], ['2024-01-03', 0.91], ['2024-06-03', 0.8], ['2024-06-04', 0.81]] };
  app.Api.fxHist['GBP/EUR'] = { start: '2023-12-01', ts: Date.now(), values: [['2024-01-02', 1.15]] };
  return app;
}

test('fxAt : dernière clôture connue à la date, veille pour un week-end, repli sur le taux du jour', () => {
  const { Api } = withRates(loadApp(state()));
  near(Api.fxAt('EUR', '2024-01-02'), 1);
  near(Api.fxAt('USD', '2024-01-02'), 0.9);
  near(Api.fxAt('USD', '2024-01-06'), 0.91);       // samedi → dernier cours connu
  near(Api.fxAt('USD', '2023-06-01'), 0.95);       // avant l'historique → taux du jour
  near(Api.fxAt('USD', '2024-09-01'), 0.95);       // trou de plus de 7 jours → taux du jour
  near(Api.fxAt('USD', '2999-01-01'), 0.95);       // aujourd'hui ou plus tard → taux du jour
  near(Api.fxAt('GBp', '2024-01-05'), 0.0115);     // pence : 1/100 de livre
  near(Api.fxAt('JPY', '2024-01-05'), 1);          // devise inconnue → repli (ici 1)
});

test('fxAt relit un historique déjà mis en cache dans le stockage local', () => {
  const app = loadApp(state());
  app.ctx.localStorage.setItem('apistock:daily:Y:CHFEUR=X', JSON.stringify({ ts: 1, start: '2024-01-01', values: [['2024-01-02', 1.07]] }));
  app.Api.fxCached = () => 1.05;
  near(app.Api.fxAt('CHF', '2024-01-03'), 1.07);
});

test('fiscalité : prix de revient au taux de l\'achat, prix de cession au taux de la vente', () => {
  const { Tax, Store } = withRates(loadApp(state({ transactions: [
    { id: '1', key: 'SPY@ARCX', type: 'buy', date: '2024-01-02', account: 'cto', qty: 10, price: 100, fees: 0 },
    { id: '2', key: 'SPY@ARCX', type: 'buy', date: '2024-01-03', account: 'cto', qty: 10, price: 110, fees: 10 },
    { id: '3', key: 'SPY@ARCX', type: 'sell', date: '2024-06-03', account: 'cto', qty: 5, price: 120, fees: 2 },
    { id: '4', key: 'SPY@ARCX', type: 'div', date: '2024-06-04', account: 'cto', qty: 1, price: 50, fees: 0 },
  ] })));
  const { sales, divs } = Tax.events(Store.state.accounts[0]);
  const costBase = 1000 * 0.9 + 1110 * 0.91;               // 1 910,10 € pour 20 parts
  near(sales[0].proceeds, (5 * 120 - 2) * 0.8);
  near(sales[0].cost, costBase / 4);
  near(sales[0].gain, (5 * 120 - 2) * 0.8 - costBase / 4);
  near(divs[0].amount, 50 * 0.81);
  const y = Tax.yearly(Store.state.accounts).out[2024];
  near(y.gross, sales[0].gain);
});

test('liquidités et XIRR : chaque flux converti au taux de sa date', () => {
  const { Portfolio, Store } = withRates(loadApp(state({
    cashMoves: [{ id: 'c', account: 'cto', type: 'deposit', date: '2024-01-01', amount: 2000 }],
    transactions: [
      { id: '1', key: 'SPY@ARCX', type: 'buy', date: '2024-01-02', account: 'cto', qty: 10, price: 100, fees: 0 },
      { id: '2', key: 'SPY@ARCX', type: 'sell', date: '2024-06-03', account: 'cto', qty: 5, price: 120, fees: 0 },
    ],
  })));
  near(Portfolio.cashBalance('cto').cash, 2000 - 1000 * 0.9 + 600 * 0.8);
  Store.state.accountFilter = 'cto';
  const x = Portfolio.portfolioXirr(900);
  assert.ok(isFinite(x));
});

test('replay : valeur quotidienne au taux de change du jour concerné', () => {
  const { Portfolio } = loadApp(state());
  const series = { A: [['2024-01-02', 10], ['2024-01-03', 10], ['2024-01-04', 10]] };
  const rate = { '2024-01-02': 0.9, '2024-01-03': 0.8, '2024-01-04': 1 };
  const { points, lines } = Portfolio.replay(series, { A: d => rate[d] }, [{ date: '2024-01-02', key: 'A', type: 'buy', qty: 10, price: 10, fees: 0 }]);
  near(points[0].invested, 90);   // coût au taux de l'achat
  near(points[0].value, 90);
  near(points[1].value, 80);      // même cours, taux différent
  near(points[2].value, 100);
  near(points[2].invested, 90);
  near(lines.A.value, 100);
  // taux fixe (ancien comportement) toujours accepté
  near(Portfolio.replay(series, { A: 0.5 }, [{ date: '2024-01-02', key: 'A', type: 'buy', qty: 1, price: 10, fees: 0 }]).points[0].value, 5);
});

test('preloadFxHistory demande une fois chaque devise, depuis la première opération', async () => {
  const app = loadApp(state({ transactions: [
    { id: '1', key: 'SPY@ARCX', type: 'buy', date: '2024-03-10', account: 'cto', qty: 1, price: 1, fees: 0 },
    { id: '2', key: 'SPY@ARCX', type: 'buy', date: '2024-01-10', account: 'cto', qty: 1, price: 1, fees: 0 },
    { id: '3', key: 'VUSA@XLON', type: 'buy', date: '2024-02-10', account: 'cto', qty: 1, price: 1, fees: 0 },
  ] }));
  const calls = [];
  app.Api.hasProxy = () => true;
  app.Api.daily = async (key, start) => { calls.push([key, start]); return [['2024-01-02', 0.9]]; };
  assert.equal(await app.Api.preloadFxHistory(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['Y:USDEUR=X', '2024-01-03'], ['Y:GBPEUR=X', '2024-02-03']]);
  assert.equal(await app.Api.preloadFxHistory(), false); // déjà chargé
  assert.equal(calls.length, 2);
});
