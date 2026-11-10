import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const state = () => ({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea' }, { id: 'cto', name: 'CTO', type: 'cto' }],
  instruments: {
    'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' },
    'IWDA@XAMS': { symbol: 'IWDA', mic: 'XAMS', name: 'iShares Core MSCI World', currency: 'EUR' },
    'SXR8@XETR': { symbol: 'SXR8', mic: 'XETR', name: 'iShares Core S&P 500', currency: 'EUR' },
  },
  transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 1, price: 100, fees: 2 },
    { id: '2', key: 'CW8@XPAR', type: 'div', date: '2024-06-01', account: 'pea', qty: 1, price: 5, fees: 1 },
  ],
});

test('coût du TER sur la durée, intérêts composés perdus compris', () => {
  const { get } = loadApp(state());
  const Expo = get('Expo');
  // 10 000 € à 6 %/an, TER 0,38 % sur 10 ans
  near(Expo.feeDrag(10000, 0.38, 6, 10), 10000 * 1.06 ** 10 - 10000 * (1.06 * 0.9962) ** 10);
  assert.ok(Expo.feeDrag(10000, 0.38, 6, 20) > 2 * Expo.feeDrag(10000, 0.38, 6, 10)); // effet composé
  near(Expo.feeDrag(10000, 0, 6, 10), 0);
  assert.ok(Number.isNaN(Expo.feeDrag(10000, NaN, 6, 10)));
});

test('courtage payé et intérêts perdus jusqu\'à l\'horizon (dividendes exclus)', () => {
  const { get, Store } = loadApp(state());
  const b = get('Expo').brokerage(Store.state.transactions, 6, 10, '2025-01-01');
  near(b.paid, 2);
  near(b.cost, 2 * 1.06 ** (366 / 365.25 + 10), 1e-9);
});

test('équivalents moins chers : même profil, TER plus bas, éligibles PEA si besoin, sans fonds américains', () => {
  const { get } = loadApp(state());
  const Expo = get('Expo');
  const all = plain(Expo.cheaper('CW8@XPAR'));
  assert.ok(all.length > 0 && all.length <= 3);
  assert.ok(all.every(a => a.ter < 0.38 && !['URTH', 'CW8'].includes(a.symbol)));
  assert.deepEqual(all.map(a => a.ter), all.map(a => a.ter).slice().sort((x, y) => x - y));
  const pea = plain(Expo.cheaper('CW8@XPAR', { pea: true }));
  assert.ok(pea.length > 0 && pea.every(a => a.pea));
  assert.ok(pea.some(a => a.symbol === 'WPEA'));
  assert.deepEqual(plain(Expo.cheaper('SXR8@XETR')).map(a => a.symbol), ['SPY5', 'SPXS']); // VOO et IVV (américains) exclus
});
