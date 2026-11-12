import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const state = (instruments, transactions, extra = {}) => Object.assign({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6 }], instruments, transactions }, extra);
const app = (st, prices) => {
  const a = loadApp(st);
  a.Api.cachedQuote = k => ({ price: prices[k], change: 0, percentChange: 0 });
  a.Portfolio.invalidate();
  return a;
};
const byId = h => Object.fromEntries(h.checks.map(c => [c.id, c]));

test('bilan de santé : portefeuille monde peu cher, sans doublon', () => {
  const a = app(state({ 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' } },
    [{ id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-02', account: 'pea', qty: 10, price: 400, fees: 2 }]), { 'CW8@XPAR': 500 });
  const h = a.get('Health').evaluate();
  const c = byId(h);
  assert.equal(c.country.status, 'ok');          // ~72 % US : sous le seuil de 75 %
  assert.equal(c.dups.status, 'ok');
  assert.equal(c.brokerage.status, 'ok');        // 2 € pour 4 000 €
  assert.equal(c.target.status, 'info');         // pas d'allocation cible : hors note
  assert.ok(h.score >= 50 && h.score <= 100, String(h.score));
});

test('bilan de santé : doublon S&P 500, concentration US et action individuelle', () => {
  const a = app(state({
    'ESE@XPAR': { symbol: 'ESE', mic: 'XPAR', name: 'BNP Paribas Easy S&P 500 UCITS ETF', currency: 'EUR' },
    'PSP5@XPAR': { symbol: 'PSP5', mic: 'XPAR', name: 'Amundi PEA S&P 500 UCITS ETF', currency: 'EUR' },
    'AAPL@XNAS': { symbol: 'AAPL', mic: 'XNAS', name: 'Apple Inc', currency: 'EUR', type: 'Common Stock' },
  }, [
    { id: '1', key: 'ESE@XPAR', type: 'buy', date: '2024-01-02', account: 'pea', qty: 100, price: 20, fees: 30 },
    { id: '2', key: 'PSP5@XPAR', type: 'buy', date: '2024-01-02', account: 'pea', qty: 50, price: 40, fees: 30 },
    { id: '3', key: 'AAPL@XNAS', type: 'buy', date: '2024-01-02', account: 'pea', qty: 10, price: 200, fees: 30 },
  ]), { 'ESE@XPAR': 20, 'PSP5@XPAR': 40, 'AAPL@XNAS': 200 });
  const h = a.get('Health').evaluate();
  const c = byId(h);
  assert.equal(c.dups.status, 'warn');
  assert.equal(c.country.status, 'bad');         // tout américain
  assert.equal(c.single.status, 'warn');         // Apple : 1/3 du portefeuille
  assert.equal(c.brokerage.status, 'bad');       // 90 € pour 6 000 € = 1,5 % : au-delà de 1 %
  assert.ok(h.checks[0].status === 'bad', 'les points rouges en premier');
  assert.ok(h.score < 60, String(h.score));
});

test('bilan de santé : rien à évaluer sans position', () => {
  const a = app(state({}, []), {});
  assert.equal(a.get('Health').evaluate(), null);
});
