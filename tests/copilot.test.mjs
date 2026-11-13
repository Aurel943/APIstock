import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const plain = x => JSON.parse(JSON.stringify(x));
const C = () => loadApp({}).get('Copilot');
const CAT = [
  { key: 'CW8@XPAR', symbol: 'CW8', names: ['Amundi MSCI World'] },
  { key: 'PANX@XPAR', symbol: 'PANX', names: ['Amundi PEA Nasdaq-100'] },
  { key: 'CSPX@XLON', symbol: 'CSPX', names: ['iShares Core S&P 500'] },
];

test('copilote : normalisation et lecture des nombres (milliers, k, %, années, durées)', () => {
  const c = C();
  assert.equal(c.norm('  Plus-Value  sur l’ÉTF  '), 'plus-value sur l\'etf');
  const n = s => plain(c.numbers(c.norm(s))).map(x => [x.value, x.unit]);
  assert.deepEqual(n('j\'ai besoin de 10 000 €'), [[10000, 'money']]);
  assert.deepEqual(n('retirer 5k'), [[5000, 'money']]);
  assert.deepEqual(n('1,5 million'), [[1500000, 'money']]);
  assert.deepEqual(n('dividendes 2025'), [[2025, 'year']]);
  assert.deepEqual(n('300 €/mois pendant 20 ans à 6,5 %'), [[300, 'money'], [20, 'years'], [6.5, 'pct']]);
  assert.deepEqual(n('cw8'), [], 'chiffre collé à un symbole');
});

test('copilote : reconnaissance des lignes par symbole ou par nom', () => {
  const c = C();
  const f = s => (c.findInstrument(c.norm(s), CAT) || {}).key;
  assert.equal(f('plus-value sur CW8'), 'CW8@XPAR');
  assert.equal(f('mon nasdaq'), 'PANX@XPAR');
  assert.equal(f('combien de s&p 500'), 'CSPX@XLON');
  assert.equal(f('combien vaut mon portefeuille'), undefined);
});

test('copilote : intentions des questions courantes', () => {
  const c = C();
  const p = s => plain(c.parse(s, CAT));
  assert.equal(p('Combien vaut mon portefeuille ?').intent, 'value');
  assert.deepEqual(p('J\'ai besoin de 8 000 €'), { intent: 'withdraw', amount: 8000 });
  assert.deepEqual(p('je dois retirer 2000'), { intent: 'withdraw', amount: 2000 });
  assert.deepEqual(p('dividendes 2024'), { intent: 'dividends', year: 2024, key: null });
  assert.deepEqual(p('plus-value sur CW8'), { intent: 'pnl', key: 'CW8@XPAR' });
  assert.deepEqual(p('acheter 3 CW8 à 520'), { intent: 'trade', side: 'buy', key: 'CW8@XPAR', qty: 3, price: 520 });
  assert.deepEqual(p('vendre 2 panx'), { intent: 'trade', side: 'sell', key: 'PANX@XPAR', qty: 2 });
  const proj = p('300 €/mois pendant 20 ans à 6 %');
  assert.equal(proj.intent, 'projection'); assert.equal(proj.monthly, 300); assert.equal(proj.years, 20); assert.equal(proj.rate, 6);
  const e = p('Quelle part des États-Unis ?');
  assert.equal(e.intent, 'expo'); assert.deepEqual(e.expo.keys, ['US']);
  assert.equal(p('part en dollar').expo.dim, 'ccy');
  assert.equal(p('rendement annualisé').intent, 'annual');
  assert.equal(p('ma meilleure ligne').intent, 'best');
  assert.equal(p('pire ligne').intent, 'worst');
  assert.equal(p('combien j\'ai investi en 2025').year, 2025);
  assert.equal(p('mode sombre').intent, 'theme');
  assert.equal(p('PANX').intent, 'position');
  assert.equal(p('crash test').intent, 'search');
  assert.equal(p('').intent, 'empty');
});

test('copilote : raccourcis classés par pertinence', () => {
  const c = C();
  const labels = s => plain(c.search(s).map(x => x.label));
  assert.match(labels('crash test')[0], /Crash-test/);
  assert.match(labels('fiscalité')[0], /Fiscalit/);
  assert.match(labels('retrait')[0], /Retrait malin/);
  assert.deepEqual(labels('de la'), []);
});
