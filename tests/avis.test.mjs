import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const plain = o => JSON.parse(JSON.stringify(o));
const base = extra => Object.assign({
  settings: { baseCurrency: 'EUR' },
  accounts: [{ id: 'pea', name: 'Mon PEA', type: 'pea', taxRate: 17.2 }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 30 }],
  instruments: {}, transactions: [],
}, extra);

/** Texte d'un avis d'opéré Boursorama tel que reconstitué ligne par ligne (données fictives) */
const avis = ({ sens = 'ACHAT', date = '27/10/2026', qty = '17', name = 'BNP PAR.EASY STOX.EU.600 U.ETF', ref = '010100000001', isin = 'FR0011550193',
  cours = '21,155', brut = '359,64', commission = '1,80', net = '361,44', compte = 'Compte PEA' } = {}) => [
  'OPERATION DE BOURSE', `le ${date}`, 'Références de votre compte titres', `00000 00000 00000000000   ${compte}`, 'Résident Français',
  `${sens} COMPTANT   000000`, 'ACTION', 'Date et heure', 'locale d\'exécution   Quantité   Informations sur la valeur   Informations sur l\'exécution',
  `${date}   ${qty}   ${name}   Référence :   ${ref}`, 'Type d\'ordre :   au marché', '14:39:15',
  `Code ISIN :   ${isin}   Cours exécuté :   ${cours} EUR`, 'Lieu d\'exécution :   EURONEXT PARIS',
  'Montant brut   Commission   Frais (¨)   Montant net au débit de votre compte', `${brut} EUR   ${commission} EUR   ${net} EUR`, 'Sous réserve de bonne fin.'];

test('avis d\'opéré : achat lu en entier, frais = net − brut', () => {
  const { get } = loadApp(base());
  const r = plain(get('Avis').parse(avis()));
  assert.deepEqual(
    { type: r.type, date: r.date, isin: r.isin, name: r.name, qty: r.qty, price: r.price, fees: r.fees, mic: r.mic, accType: r.accType, ref: r.ref },
    { type: 'buy', date: '2026-10-27', isin: 'FR0011550193', name: 'BNP PAR.EASY STOX.EU.600 U.ETF', qty: 17, price: 21.155, fees: 1.8, mic: 'XPAR', accType: 'pea', ref: '010100000001' });
});

test('avis d\'opéré : vente, milliers, compte-titres, sans commission', () => {
  const { get } = loadApp(base());
  const r = plain(get('Avis').parse(avis({ sens: 'VENTE', qty: '1 200', cours: '1 021,50', brut: '1 225 800,00', commission: '0,00', net: '1 225 790,00', compte: 'Compte-titres ordinaire' })));
  assert.equal(r.type, 'sell');
  assert.equal(r.qty, 1200);
  assert.equal(r.price, 1021.5);
  assert.equal(r.fees, 10);
  assert.equal(r.accType, 'cto');
});

test('avis d\'opéré : document non reconnu', () => {
  const { get } = loadApp(base());
  assert.match(get('Avis').parse(['Relevé de compte', 'Solde : 12,00 EUR']).error, /ISIN/);
});

test('avis d\'opéré : compte PEA retrouvé, ISIN connu, doublons écartés', () => {
  const { App, Store, get } = loadApp(base({
    instruments: { 'ETZ@XPAR': { symbol: 'ETZ', mic: 'XPAR', name: 'BNP Stoxx 600', currency: 'EUR', isin: 'FR0011550193' } },
    transactions: [{ id: 'x', key: 'ETZ@XPAR', type: 'buy', date: '2026-10-27', account: 'pea', qty: 17, price: 21.155, fees: 1.8 }],
  }));
  const Avis = get('Avis');
  const recs = [avis(), avis({ date: '05/11/2026', qty: '9', ref: '010100000002', cours: '22,000', brut: '198,00', commission: '0,00', net: '198,00' }),
    avis({ date: '05/11/2026', qty: '9', ref: '010100000002', cours: '22,000', brut: '198,00', commission: '0,00', net: '198,00' })]
    .map((l, i) => { const r = Avis.parse(l); return Object.assign(r, { line: 'avis ' + i }, App.avisAccount(r)); });
  const res = App.prepareImport(recs, { id: 'avis' }, { dedupe: true });
  assert.equal(res.dups, 2); // déjà saisi à la main + même avis sélectionné deux fois
  assert.equal(res.txs.length, 1);
  assert.equal(res.unresolved.length, 0);
  assert.equal(res.commit(), 1);
  const t = Store.state.transactions.find(x => x.ref === '010100000002');
  assert.deepEqual(plain({ key: t.key, account: t.account, qty: t.qty, price: t.price, fees: t.fees, date: t.date }),
    { key: 'ETZ@XPAR', account: 'pea', qty: 9, price: 22, fees: 0, date: '2026-11-05' });
  // second import des mêmes avis : tout est reconnu comme déjà enregistré
  assert.equal(App.prepareImport(recs, { id: 'avis' }, { dedupe: true }).txs.length, 0);
});

test('avis d\'opéré : sans compte PEA, un compte « PEA » est créé', () => {
  const { App, Store, get } = loadApp(base({ accounts: [{ id: 'cto', name: 'CTO', type: 'cto', taxRate: 30 }] }));
  const r = get('Avis').parse(avis());
  const res = App.prepareImport([Object.assign(r, { line: 'a' }, App.avisAccount(r))], { id: 'avis' }, { dedupe: true });
  assert.deepEqual(plain(res.newAcc), ['PEA']);
  res.resolve('FR0011550193', { symbol: 'ETZ', mic: 'XPAR', currency: 'EUR', provider: 'yahoo', ysymbol: 'ETZ.PA' });
  assert.equal(res.commit(), 1);
  assert.equal(Store.state.accounts.find(a => a.name === 'PEA').type, 'pea');
});

test('mise en page du texte PDF : lignes regroupées, colonnes séparées', () => {
  const { get } = loadApp(base());
  const lines = plain(get('Avis').layout([
    { str: 'Quantité', x: 100, y: 500, w: 40, h: 8 }, { str: 'ACHAT', x: 10, y: 600, w: 30, h: 8 }, { str: '27/10/2026', x: 10, y: 499, w: 45, h: 8 },
    { str: 'COMPTANT', x: 42, y: 600.5, w: 50, h: 8 }]));
  assert.deepEqual(lines, ['ACHAT COMPTANT', '27/10/2026   Quantité']);
});
