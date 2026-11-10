import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const plain = x => JSON.parse(JSON.stringify(x)); // objets créés dans un autre contexte vm
const ids = list => plain(list).map(x => x.id).sort();
const tx = (id, extra) => Object.assign({ id, key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'a', qty: 1, price: 100, fees: 0 }, extra);
const DAY = 864e5;
const state = extra => Object.assign({
  accounts: [{ id: 'a', name: 'PEA', type: 'pea', taxRate: 17.2 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi', currency: 'EUR' } },
  transactions: [tx('t1'), tx('t2'), tx('t3')],
  cashMoves: [], plans: [], alerts: [], watchlist: [], targets: {},
}, extra);

test('suppression sur un appareil, modification d\'un autre élément sur l\'autre : la suppression est conservée', () => {
  const { get } = loadApp(state());
  const Sync = get('Sync');
  const now = Date.now();
  // appareil A : supprime t2 ; appareil B (distant) : modifie t3 et ajoute t4, sans connaître la suppression
  const local = state({ transactions: [tx('t1'), tx('t3')], deleted: { t2: now - 1000 } });
  const remote = state({ transactions: [tx('t1'), tx('t2'), tx('t3', { qty: 5 }), tx('t4')] });
  const out = plain(Sync.merge(remote, local));
  assert.deepEqual(ids(out.transactions), ['t1', 't3', 't4']);
  assert.ok(out.deleted.t2 > 0);
  // dans l'autre sens (B fusionne la version de A) : même résultat
  const back = plain(Sync.merge(local, remote));
  assert.deepEqual(ids(back.transactions), ['t1', 't3', 't4']);
  assert.equal(back.transactions.find(t => t.id === 't3').qty, 5);
});

test('suppression puis « Annuler » : l\'élément revient, même si la suppression a déjà été envoyée', () => {
  const app = loadApp(state());
  const { Store } = app;
  const Sync = app.get('Sync');
  const t = Store.state.transactions[1];
  Store.removeTransaction('t2');
  assert.ok(Store.state.deleted.t2 > 0);
  const sent = plain(Store.state);                 // version envoyée avant l'annulation
  Store.state.transactions.splice(1, 0, t);        // bouton « Annuler »
  Store.unmarkDeleted('t2');
  assert.equal(Store.state.deleted.t2, undefined);
  assert.ok(Store.state.restored.t2 >= sent.deleted.t2);
  const out = plain(Sync.merge(sent, plain(Store.state)));
  assert.deepEqual(ids(out.transactions), ['t1', 't2', 't3']);
  assert.equal(out.deleted.t2, undefined);
});

test('suppression de chaque type d\'élément synchronisé', () => {
  const { get } = loadApp(state());
  const Sync = get('Sync');
  const now = Date.now();
  const remote = state({
    accounts: [{ id: 'a', name: 'PEA', type: 'pea' }, { id: 'b', name: 'CTO', type: 'cto' }],
    transactions: [tx('t1'), tx('t9', { account: 'b' })],
    cashMoves: [{ id: 'c1', account: 'a', type: 'deposit', date: '2024-01-01', amount: 10 }, { id: 'c2', account: 'b', type: 'deposit', date: '2024-01-01', amount: 10 }],
    plans: [{ id: 'p1', key: 'CW8@XPAR', account: 'a', amount: 100, day: 5, start: '2024-01-01' }],
    alerts: [{ id: 'al1', key: 'CW8@XPAR', kind: 'above', value: 1, active: true }],
  });
  const local = state({ accounts: [{ id: 'a', name: 'PEA', type: 'pea' }], transactions: [tx('t1')], cashMoves: [], plans: [], alerts: [],
    deleted: { b: now, c1: now, p1: now, al1: now } });
  const out = plain(Sync.merge(remote, local));
  assert.deepEqual(ids(out.accounts), ['a']);
  assert.deepEqual(ids(out.cashMoves), ['c2']);
  assert.equal(out.cashMoves[0].account, 'a');        // rattaché au compte restant
  assert.equal(out.transactions.find(t => t.id === 't9').account, 'a');
  assert.equal(out.plans.length, 0);
  assert.equal(out.alerts.length, 0);
});

test('les suppressions de plus de 180 jours sont oubliées', () => {
  const app = loadApp(state({ deleted: { old: Date.now() - 200 * DAY, recent: Date.now() - DAY }, restored: { gone: Date.now() - 181 * DAY } }));
  assert.deepEqual(Object.keys(plain(app.Store.state.deleted)), ['recent']);
  assert.deepEqual(plain(app.Store.state.restored), {});
  const Sync = app.get('Sync');
  const out = plain(Sync.merge({ deleted: { x: Date.now() - 365 * DAY } }, { deleted: { y: Date.now() } }));
  assert.deepEqual(Object.keys(out.deleted), ['y']);
});
