import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const state = () => ({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' } },
  transactions: [{ id: '1', key: 'CW8@XPAR', type: 'buy', date: '2026-01-05', account: 'pea', qty: 1, price: 500, fees: 1 }],
});
const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); // tableaux créés dans un autre contexte vm
const NOW = Date.parse('2026-11-12T10:00:00Z');

test('rappel de sauvegarde : jamais sauvegardé, puis plus de 30 jours, puis masqué pour le mois', () => {
  const { App, Store, ctx } = loadApp(state());
  const ids = () => App.backupTodos(NOW).map(i => i.id);
  same(ids(), ['backup:2026-11']);
  ctx.localStorage.setItem('apistock:lastBackup', String(NOW - 10 * 864e5));
  same(ids(), [], 'sauvegarde récente : pas de rappel');
  ctx.localStorage.setItem('apistock:lastBackup', String(NOW - 45 * 864e5));
  assert.match(App.backupTodos(NOW)[0].sub, /il y a 45 jours/);
  Store.state.dismissed = { 'backup:2026-11': NOW };
  same(ids(), []);
});

test('rappel de sauvegarde : rien avec la synchronisation active, ni sans opération', () => {
  const { App, ctx, get } = loadApp(state());
  get('Sync').setConf({ code: 'xxxxxxxxxxxx' });
  assert.equal(App.backupTodos(NOW).length, 0);
  const empty = loadApp({ accounts: state().accounts, transactions: [] });
  assert.equal(empty.App.backupTodos(NOW).length, 0);
  void ctx;
});

test('conseil iPhone : seulement dans Safari sur iPhone, hors écran d\'accueil', () => {
  const { App, ctx } = loadApp(state());
  ctx.localStorage.setItem('apistock:lastBackup', String(NOW));
  assert.equal(App.backupTodos(NOW).length, 0, 'navigateur de bureau');
  ctx.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
  same(App.backupTodos(NOW).map(i => i.id), ['ios-install']);
  ctx.navigator.standalone = true;
  assert.equal(App.backupTodos(NOW).length, 0, 'installé sur l\'écran d\'accueil');
});
