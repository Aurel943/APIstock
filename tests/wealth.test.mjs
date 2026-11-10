import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const state = extra => Object.assign({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea' }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi', currency: 'EUR' } },
  transactions: [{ id: 't', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 10, price: 100, fees: 0 }],
  cashMoves: [{ id: 'c', account: 'pea', type: 'deposit', date: '2024-01-01', amount: 1500 }],
  assets: [
    { id: 'a1', type: 'livretA', name: 'Livret A', value: 10000, date: '2025-01-01', rate: 2 },
    { id: 'a2', type: 'immo', name: 'Appartement', value: 300000, debt: 180000, date: '2025-01-01' },
    { id: 'a3', type: 'courant', name: 'Compte courant', value: 2000, date: '2025-01-01', rate: 5 },
  ],
}, extra);

test('valeur estimée : intérêts composés des livrets depuis la mise à jour, crédit déduit de l\'immobilier', () => {
  const { get } = loadApp(state());
  const W = get('Wealth');
  const [livret, immo, courant] = W.list();
  near(W.valueOf(livret, '2025-01-01'), 10000);
  near(W.valueOf(livret, '2026-01-01'), 10000 * Math.pow(1.02, 365 / 365.25), 1e-6);
  near(W.valueOf(immo, '2026-01-01'), 120000);
  near(W.valueOf(courant, '2026-01-01'), 2000);          // pas de taux pour un compte courant
});

test('patrimoine global : titres + espèces + épargne + immobilier net', () => {
  const app = loadApp(state());
  app.Api.cachedQuote = () => ({ price: 120, change: 0, percentChange: 0 });
  app.Portfolio.invalidate();
  const s = app.get('Wealth').summary('2025-01-01');
  near(s.securities, 1200);
  near(s.cash, 500 + 2000);                                // espèces du PEA + compte courant
  near(s.savings, 10000);
  near(s.realEstate, 120000);
  near(s.total, 1200 + 2500 + 10000 + 120000);
});

test('historique mensuel : une écriture par jour au plus, jamais avec des cours manquants', () => {
  const { get, Store } = loadApp(state());
  const W = get('Wealth');
  assert.equal(W.record({ total: 1000, securities: 10, missing: 1 }), false);
  assert.equal(W.record({ total: 1000, securities: 10, missing: 0 }), true);
  assert.equal(W.record({ total: 1001, securities: 10, missing: 0 }), false);
  assert.equal(Object.values(plain(Store.state.wealthHistory))[0].total, 1000);
});

test('objectif patrimonial : autres actifs inclus seulement sur demande ; actifs synchronisés avec les suppressions', () => {
  const { get } = loadApp(state());
  const W = get('Wealth');
  assert.ok(W.othersTotal() > 130000);
  const Sync = get('Sync');
  const out = plain(Sync.merge(state(), state({ assets: [state().assets[0]], deleted: { a2: Date.now() } })));
  assert.deepEqual(out.assets.map(a => a.id).sort(), ['a1', 'a3']);
});
