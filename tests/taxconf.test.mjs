import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const accounts = () => [
  { id: 'pea', name: 'PEA', type: 'pea', taxRate: 17.2 }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 30 },
  { id: 'av', name: 'AV', type: 'av', taxRate: 24.7 }, { id: 'perso', name: 'CTO perso', type: 'cto', taxRate: 25 },
];

test('taux par défaut des revenus 2026 : PFU 31,4 %, PEA 18,6 %, assurance-vie 24,7 %', () => {
  const { get } = loadApp({});
  const c = get('taxConf')();
  assert.equal(c.year, 2026);
  assert.equal(c.social, 18.6);
  assert.equal(c.pfu, 31.4);
  assert.equal(c.peaCap, 150000);
  const rate = get('taxRateFor');
  assert.equal(rate('pea'), 18.6);
  assert.equal(rate('cto'), 31.4);
  assert.equal(rate('av'), 24.7);
  assert.equal(rate('autre'), 0);
});

test('les comptes restés sur l\'ancien taux par défaut passent aux taux 2026, pas les taux personnalisés', () => {
  const { Store } = loadApp({ accounts: accounts() });
  const r = Object.fromEntries(Store.state.accounts.map(a => [a.id, a.taxRate]));
  assert.deepEqual(r, { pea: 18.6, cto: 31.4, av: 24.7, perso: 25 });
});

test('taux modifiés dans Réglages : pris en compte partout et répercutés sur les comptes par défaut', () => {
  const { Store, get } = loadApp({ accounts: accounts() });
  Store.state.settings.tax = { social: 20 };
  const c = get('taxConf')();
  assert.equal(c.pfu, 32.8);
  assert.ok(c.custom);
  assert.ok(Store.syncAccountRates());
  const r = Object.fromEntries(Store.state.accounts.map(a => [a.id, a.taxRate]));
  assert.deepEqual(r, { pea: 20, cto: 32.8, av: 24.7, perso: 25 });
  // retour aux valeurs par défaut
  Store.state.settings.tax = {};
  Store.syncAccountRates();
  assert.equal(Store.state.accounts[0].taxRate, 18.6);
  assert.ok(!get('taxConf')().custom);
});

test('valeur invalide ignorée', () => {
  const { Store, get } = loadApp({});
  Store.state.settings.tax = { ir: 'abc', peaCap: -5 };
  const c = get('taxConf')();
  assert.equal(c.ir, 12.8);
  assert.equal(c.peaCap, 150000);
});

test('PEA : date estimée du plafond avec les versements programmés du compte', () => {
  const { get, Store } = loadApp({
    accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6 }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 31.4 }],
    plans: [
      { id: 'a', key: 'X@', account: 'pea', amount: 500, day: 5, start: '2026-01-01', active: true, done: {} },
      { id: 'b', key: 'Y@', account: 'pea', amount: 500, day: 5, start: '2026-01-01', active: false, done: {} },
      { id: 'c', key: 'Z@', account: 'cto', amount: 900, day: 5, start: '2026-01-01', active: true, done: {} },
    ],
  });
  const Tax = get('Tax');
  const r = Tax.peaCapDate(Store.account('pea'), 144000, 150000, '2026-11-12');
  assert.equal(r.monthly, 500);              // seul le versement actif du PEA compte
  assert.equal(r.months, 12);
  assert.equal(r.date, '2027-11-12');
  assert.equal(Tax.peaCapDate(Store.account('cto'), 0, 150000), null);
  assert.equal(Tax.peaCapDate(Store.account('pea'), 150000, 150000), null);
});
