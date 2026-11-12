import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); // tableaux créés dans un autre contexte vm
const state = () => ({
  accounts: [{ id: 'av', name: 'Assurance-vie', type: 'av', taxRate: 24.7 }],
  instruments: { 'PERSO-AB12@': { symbol: 'PERSO-AB12', mic: '', name: 'GS Luxury Leaders 2038', currency: 'EUR', provider: 'manual',
    values: [['2026-07-01', 1000], ['2026-10-01', 1080], ['2026-04-01', 950]] } },
  transactions: [{ id: '1', key: 'PERSO-AB12@', type: 'buy', date: '2026-04-01', account: 'av', qty: 2, price: 950, fees: 0 }],
});

test('valeur saisie : la dernière valeur sert de cours, sans variation du jour', async () => {
  const { get } = loadApp(state());
  const Api = get('Api'), Manual = get('Manual');
  assert.equal(Manual.is('PERSO-AB12@'), true);
  assert.equal(Api.provider('PERSO-AB12@'), 'manual');
  const q = Manual.quote('PERSO-AB12@');
  assert.equal(q.price, 1080);
  assert.equal(q.percentChange, 0);
  assert.equal(q.datetime, '2026-10-01');
});

test('valeur saisie : série journalière en escalier, jours ouvrés seulement', () => {
  const { get } = loadApp(state());
  const s = get('Manual').daily('PERSO-AB12@', '2026-06-29');
  same(s.slice(0, 4), [['2026-06-29', 950], ['2026-06-30', 950], ['2026-07-01', 1000], ['2026-07-02', 1000]]);
  assert.ok(s.every(([d]) => ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())), 'pas de week-end');
  assert.equal(s.find(v => v[0] === '2026-10-01')[1], 1080);
});

test('valeur saisie : ajout, remplacement à la même date, suppression (au moins une valeur gardée)', () => {
  const { get, Store } = loadApp(state());
  const Manual = get('Manual');
  get('Api').quote = () => Promise.resolve(); // pas de rafraîchissement dans le test
  Manual.setValue('PERSO-AB12@', '2026-10-01', 1100);
  same(Manual.values('PERSO-AB12@').map(v => v[1]), [950, 1000, 1100]);
  assert.equal(Manual.removeValue('PERSO-AB12@', '2026-04-01'), true);
  Manual.removeValue('PERSO-AB12@', '2026-07-01');
  assert.equal(Manual.removeValue('PERSO-AB12@', '2026-10-01'), false);
  assert.equal(Store.instrument('PERSO-AB12@').values.length, 1);
});

test('valeur saisie : libellés lisibles', () => {
  const { Store } = loadApp(state());
  assert.equal(Store.label('PERSO-AB12@'), 'GS Luxury Leaders 2038');
  assert.match(Store.code('PERSO-AB12@'), /^Valeur saisie le /);
});

test('rappel : valeur saisie de plus de 100 jours pour un placement encore détenu', () => {
  const { App, Store } = loadApp(state());
  const ids = d => JSON.parse(JSON.stringify(App.manualTodos(d).map(i => i.id)));
  assert.deepEqual(ids('2026-12-01'), [], 'dernière valeur du 1er octobre : récente');
  assert.deepEqual(ids('2027-01-15'), ['manual:PERSO-AB12@:2026-10-01']);
  Store.state.dismissed = { 'manual:PERSO-AB12@:2026-10-01': Date.now() };
  assert.deepEqual(ids('2027-01-15'), []);
  Store.state.transactions.push({ id: '2', key: 'PERSO-AB12@', type: 'sell', date: '2026-11-01', account: 'av', qty: 2, price: 1080, fees: 0 });
  Store.state.dismissed = {};
  assert.deepEqual(ids('2027-01-15'), [], 'placement vendu : plus de rappel');
});
