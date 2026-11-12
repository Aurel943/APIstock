import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const monthly = (prices) => prices.map((p, i) => [`2024-${String(i + 1).padStart(2, '0')}-02`, p]);

test('laboratoire : marché en hausse régulière → tout au début gagne, attendre les baisses perd', () => {
  const { get } = loadApp({});
  const Lab = get('Lab');
  const up = monthly([100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122]);
  const r = Lab.run({ A: up }, { A: 1 }, { monthly: 100, start: '2024-01-01' });
  assert.equal(r.dates.length, 12);
  near(r.total, 1200);
  near(r.strategies.lump.final, 1200 / 100 * 122);           // 12 parts achetées à 100
  assert.ok(r.strategies.lump.final > r.strategies.dca.final);
  near(r.strategies.dip.final, 1200 / 122 * 122, 1e-6);       // jamais de baisse de 10 % : tout investi à la fin
  assert.ok(r.strategies.dip.final < r.strategies.dca.final);
  near(r.strategies.dca.maxDrawdown, 0);
});

test('laboratoire : baisse puis rebond → les versements mensuels battent le tout au début', () => {
  const { get } = loadApp({});
  const Lab = get('Lab');
  const vshape = monthly([100, 80, 60, 50, 60, 70, 80, 90, 100, 100, 100, 100]);
  const r = Lab.run({ A: vshape }, { A: 1 }, { monthly: 100, start: '2024-01-01' });
  assert.ok(r.strategies.dca.final > r.strategies.lump.final);
  near(r.strategies.lump.final, 1200);                        // revenu au point de départ
  near(r.strategies.lump.maxDrawdown, -50);
});

test('laboratoire : rééquilibrage annuel remis à la cible, deux lignes', () => {
  const { get } = loadApp({});
  const Lab = get('Lab');
  const days = n => Array.from({ length: n }, (_, i) => `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-02`);
  const d = days(14);
  const A = d.map((x, i) => [x, 100 * Math.pow(1.05, i)]), B = d.map(x => [x, 100]);
  const r = Lab.run({ A, B }, { A: 0.5, B: 0.5 }, { monthly: 100, start: '2024-01-01' });
  assert.equal(r.dates.length, 14);
  assert.notEqual(r.strategies.rebal.final, r.strategies.dca.final, 'le rééquilibrage de janvier 2025 change le résultat');
});

test('partage : aller-retour du lien, sans montant, et liens invalides refusés', () => {
  const { get } = loadApp({});
  const Share = get('Share');
  const hash = Share.encode('Ma répartition', [
    { symbol: 'CW8', mic: 'XPAR', ysymbol: 'CW8.PA', name: 'Amundi MSCI World', currency: 'EUR', weight: 70 },
    { symbol: 'PAEEM', mic: 'XPAR', ysymbol: 'PAEEM.PA', name: 'Amundi PEA Émergents', currency: 'EUR', weight: 30 },
  ]);
  const back = JSON.parse(JSON.stringify(Share.decode('#' + hash)));
  assert.equal(back.title, 'Ma répartition');
  assert.deepEqual(back.lines.map(l => [l.symbol, l.weight]), [['CW8', 70], ['PAEEM', 30]]);
  assert.equal(back.lines[1].name, 'Amundi PEA Émergents', 'accents conservés');
  assert.ok(!/\d{4,}/.test(Share.unb64(hash.slice(6)).replace(/"[^"]*"/g, '')), 'aucun montant dans le lien');
  assert.equal(Share.decode('#share=pas-du-json'), null);
  assert.equal(Share.decode('#portfolio'), null);
  const tooMuch = Share.encode('x', [{ symbol: 'A', weight: 80 }, { symbol: 'B', weight: 80 }]);
  assert.equal(Share.decode('#' + tooMuch), null, 'plus de 100 % : refusé');
  const evil = 'share=' + Share.b64(JSON.stringify({ v: 1, t: '<img src=x onerror=alert(1)>', l: [['<SCRIPT>', '', '', '', '', 50], ['CW8', 'XPAR', '', '<b>x</b>', 'EUR', 50]] }));
  const e = JSON.parse(JSON.stringify(Share.decode('#' + evil)));
  assert.ok(!/[<>]/.test(e.title) && e.lines.every(l => !/[<>]/.test(l.name)));
  assert.deepEqual(e.lines.map(l => l.symbol), ['CW8'], 'symbole invalide écarté');
});

test('laboratoire : historique d\'un ETF récent prolongé par son indice, recalé sur son premier cours', () => {
  const { get } = loadApp({});
  const Lab = get('Lab');
  const etf = [['2019-04-25', 20], ['2019-05-02', 21]];
  const index = [['2011-11-14', 500], ['2015-01-02', 800], ['2019-04-25', 1000], ['2019-05-02', 1100]];
  const s = JSON.parse(JSON.stringify(Lab.extend(etf, index)));
  assert.deepEqual(s, [['2011-11-14', 10], ['2015-01-02', 16], ['2019-04-25', 20], ['2019-05-02', 21]]); // indice × 20/1000, puis l'ETF tel quel
  assert.deepEqual(JSON.parse(JSON.stringify(Lab.extend(etf, [['2020-01-02', 5]]))), etf, 'indice plus court : rien à prolonger');
  // avec la prolongation, la comparaison démarre au début de l'indice
  const months = Array.from({ length: 30 }, (_, i) => `20${18 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-02`);
  const old = months.map((d, i) => [d, 100 + i]);
  const young = months.slice(18).map((d, i) => [d, 50 + i]);
  assert.equal(Lab.run({ A: old, B: young }, { A: 0.5, B: 0.5 }, { monthly: 100, start: '2018-01-01' }).dates.length, 12);
  const longB = Lab.extend(young, months.map((d, i) => [d, 200 + 2 * i]));
  assert.equal(Lab.run({ A: old, B: longB }, { A: 0.5, B: 0.5 }, { monthly: 100, start: '2018-01-01' }).dates.length, 30);
});
