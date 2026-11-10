import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadApp, root } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const fixture = f => readFileSync(join(root, 'tests', 'fixtures', 'csv', f), 'utf8');
const state = () => ({ accounts: [{ id: 'pea', name: 'PEA', type: 'pea' }], instruments: {}, transactions: [] });
const cand = (symbol, mic, currency, ysymbol) => ({ source: 'yahoo', provider: 'yahoo', symbol, mic, currency, ysymbol, name: symbol + ' ETF', type: 'ETF' });

test('Degiro (en-têtes anglais) : sens d\'après le signe, dates JJ-MM-AAAA, frais en euros convertis, ISIN à confirmer', () => {
  const { App, Store } = loadApp(state());
  const res = App.parseCsv(fixture('degiro-en.csv'));
  assert.equal(res.format.id, 'degiro');
  assert.deepEqual(plain(res.errors), []);
  const t = plain(res.txs);
  assert.equal(t.length, 3);
  assert.deepEqual(t.map(x => [x.date, x.type, x.qty]), [['2025-02-03', 'sell', 1], ['2024-11-20', 'buy', 2], ['2024-01-15', 'buy', 3]]);
  near(t[0].price, 560.1); near(t[0].fees, 1);
  near(t[1].fees, (2.8 + 1) * 1.0536, 0.01);           // AutoFX + courtage, en dollars
  assert.deepEqual(plain(res.unresolved).map(u => [u.isin, u.mic, u.currency, u.count]), [['FR0010315770', 'XPAR', 'EUR', 2], ['US78462F1030', 'XNYS', 'USD', 1]]);
  assert.equal(res.ready().length, 0);                   // rien tant que le symbole n'est pas choisi
  res.resolve('FR0010315770', cand('CW8', 'XPAR', 'EUR', 'CW8.PA'));
  res.resolve('US78462F1030', null);                      // ignoré
  assert.equal(res.ready().length, 2);
  assert.equal(res.commit(), 2);
  const inst = Store.instrument('CW8@XPAR');
  assert.equal(inst.isin, 'FR0010315770');
  assert.equal(inst.ysymbol, 'CW8.PA');
  assert.equal(Store.state.transactions.length, 2);
  assert.ok(Store.state.transactions.every(x => x.key === 'CW8@XPAR' && !x.isin));
  // second import : l'ISIN est déjà connu, plus rien à confirmer
  const again = App.parseCsv(fixture('degiro-en.csv'));
  assert.deepEqual(plain(again.unresolved).map(u => u.isin), ['US78462F1030']);
  assert.equal(again.txs.filter(x => x.key === 'CW8@XPAR').length, 2);
});

test('Degiro (en-têtes français, ancien format avec colonnes de devise)', () => {
  const { App } = loadApp(state());
  const res = App.parseCsv(fixture('degiro-fr.csv'));
  assert.equal(res.format.id, 'degiro');
  const [t] = plain(res.txs);
  assert.deepEqual([t.date, t.type, t.qty, t.price, t.fees], ['2024-03-04', 'buy', 4, 480.5, 2]);
  assert.equal(res.unresolved[0].mic, 'XETR');
});

test('Trade Republic : achats, plan d\'épargne sans type, vente, lignes d\'espèces ignorées', () => {
  const { App } = loadApp(state());
  const res = App.parseCsv(fixture('trade-republic.csv'));
  assert.equal(res.format.id, 'traderepublic');
  assert.equal(res.format.verified, false);
  assert.equal(res.skipped, 2);                           // versement et intérêts
  const t = plain(res.txs);
  assert.deepEqual(t.map(x => [x.date, x.type, x.qty]), [['2024-05-03', 'buy', 10.5], ['2024-06-03', 'buy', 2.3456], ['2025-01-10', 'sell', 3]]);
  near(t[0].price, 85.2); near(t[0].fees, 1);
  assert.deepEqual(plain(res.unresolved).map(u => [u.isin, u.count]), [['IE00B4L5Y983', 3]]);
});

test('relevé générique (Boursorama, Fortuneo…) : sens, ISIN, dates JJ/MM/AAAA, prix déduit du montant', () => {
  const { App } = loadApp(state());
  const res = App.parseCsv(fixture('generique-isin.csv'));
  assert.equal(res.format.id, 'generic');
  assert.deepEqual(plain(res.errors), []);
  const t = plain(res.txs);
  assert.deepEqual(t.map(x => [x.date, x.type, x.qty]), [['2024-02-12', 'buy', 2], ['2024-03-14', 'sell', 1], ['2024-04-02', 'buy', 3]]);
  near(t[2].price, (1500.5 - 2) / 3);                     // montant net (frais inclus) ÷ quantité
  assert.equal(res.unresolved.length, 2);
});

test('format APIstock : inchangé (symbole, place, compte créé à la volée)', () => {
  const { App, Store } = loadApp(state());
  const res = App.parseCsv('date;type;compte;symbole;place;nom;quantite;prix;frais;devise\n2024-03-15;achat;CTO;CW8;EURONEXT;Amundi;10;470,50;2;EUR\n2024-04-01;vente;CTO;CW8;XPAR;Amundi;-2;480;1;EUR\n2024-05-01;bizarre;CTO;CW8;XPAR;Amundi;1;1;0;EUR\n');
  assert.equal(res.format.id, 'generic');
  assert.equal(res.errors.length, 1);
  assert.deepEqual(plain(res.txs).map(x => [x.key, x.type, x.qty]), [['CW8@XPAR', 'buy', 10], ['CW8@XPAR', 'sell', 2]]);
  assert.equal(res.commit(), 2);
  assert.ok(Store.state.accounts.some(a => a.name === 'CTO' && a.type === 'cto'));
});

test('fichier sans colonnes utilisables : erreur explicite', () => {
  const { App } = loadApp(state());
  assert.throws(() => App.parseCsv('a;b;c\n1;2;3'), /obligatoires/);
});
