import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 0.01, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const F = () => loadApp({}).get('Fisc');

/** Contexte fiscal minimal : taux 2026 (PFU 31,4 %, PS 18,6 %, AV 17,2 % + 7,5 %) */
function ctx(accounts, extra = {}) {
  return Object.assign({ today: '2026-11-13', year: 2026, pfu: 0.314, social: 0.186, socialAv: 0.172, avIr8: 0.075, ir: 0.128, ytd: 0, carry: [], divs12: 0, accounts }, extra);
}
const line = (key, qty, price, pmp) => ({ key, label: key, qty, price, priceLocal: price, pmp });
const cto = (id, lines, cash = 0, fees = null) => ({ id, name: id, type: 'cto', rate: 31.4, fees, cash, lines, value: cash + lines.reduce((s, l) => s + l.qty * l.price, 0), missing: [] });

test('fisc : moins-values reportables vivantes, plus anciennes imputées d\'abord, expirées après 10 ans', () => {
  const f = F();
  assert.deepEqual(plain(f.carryAt({ 2014: -500, 2016: -300, 2018: 200 }, 2026)), [{ year: 2016, amount: 300 }], '2014 : 500 − 200 imputés, reste 300 qui expire fin 2024');
  assert.deepEqual(plain(f.carryAt({ 2016: -1000, 2020: 400 }, 2026)), [{ year: 2016, amount: 600 }]);
  assert.deepEqual(plain(f.carryAt({ 2016: -1000 }, 2027)), [], 'perdue après 2026');
  assert.deepEqual(plain(f.carryAt({}, 2026)), []);
});

test('fisc : barème de courtage (pourcentage, minimum, fixe)', () => {
  const f = F();
  assert.equal(f.fee(null, 1000), 0);
  assert.equal(f.fee({ pct: 0.5, min: 2 }, 1000), 5);
  assert.equal(f.fee({ pct: 0.5, min: 2 }, 100), 2);
  assert.equal(f.fee({ fixed: 1 }, 100), 1);
});

test('retrait malin : vend d\'abord la ligne en perte et les liquidités, pas la ligne en forte plus-value', () => {
  const f = F();
  const c = ctx([cto('ct', [line('WIN', 100, 100, 40), line('LOSE', 50, 100, 120)], 1000)]);
  const r = f.plan(c, 5000);
  const acc = r.plan.accounts.find(a => a.id === 'ct');
  assert.ok(r.plan.net >= 5000 - 0.01);
  near(acc.cash, 1000, 0.01, 'liquidités utilisées');
  assert.equal(acc.sales.find(s => s.key === 'LOSE').qty, 40, 'ligne en perte : 4 000 €');
  assert.ok(!acc.sales.find(s => s.key === 'WIN'), 'la ligne gagnante est épargnée');
  assert.ok(r.plan.tax <= 0.01, 'aucun impôt');
  assert.ok(r.naive.tax > 0, 'vendre un peu de tout réalise des plus-values imposées');
  assert.ok(r.saving > 100);
});

test('retrait malin : les moins-values reportées couvrent les gains, au-delà la flat tax s\'applique', () => {
  const f = F();
  const c = ctx([cto('ct', [line('A', 100, 100, 50)])], { carry: [{ year: 2020, amount: 1000 }] });
  // 4 000 € de ventes = 2 000 € de gains, 1 000 € couverts par le report → 1 000 × 31,4 % d'impôt
  const ev = f.evaluate(c, { ct: { lines: { A: 40 } } });
  near(ev.tax, 314);
  near(ev.net, 4000 - 314);
  // gains déjà réalisés cette année : vendre une ligne en perte efface de l'impôt dû (impôt négatif)
  const c2 = ctx([cto('ct', [line('L', 10, 100, 150)])], { ytd: 2000 });
  near(f.evaluate(c2, { ct: { lines: { L: 10 } } }).tax, -500 * 0.314);
});

test('retrait malin : PEA de plus de 5 ans imposé sur la part de gains, PEA récent et PER exclus', () => {
  const f = F();
  const pea = { id: 'p', name: 'PEA', type: 'pea', rate: 18.6, fees: null, cash: 0, lines: [line('CW8', 20, 500, 300)], value: 10000, missing: [], pea: { deposits: 6000, five: '2020-01-01', ok: true } };
  const ev = f.evaluate(ctx([pea]), { p: f.wrapperSales(pea, 2000, true) });
  near(ev.accounts[0].gainPart, 800, 0.01, '40 % de gains dans le PEA');
  near(ev.tax, 800 * 0.186);
  assert.equal(ev.accounts[0].sales[0].qty, 4);
  const young = Object.assign({}, pea, { id: 'y', name: 'PEA récent', pea: { deposits: 6000, five: '2029-01-01', ok: false } });
  const per = { id: 'r', name: 'PER', type: 'per', rate: 0, cash: 0, lines: [line('X', 1, 1000, 500)], value: 1000, missing: [] };
  const r = f.plan(ctx([young, per]), 500);
  assert.equal(r.short, true);
  assert.equal(r.warnings.length, 2);
});

test('retrait malin : assurance-vie de plus de 8 ans, abattement puis 7,5 %', () => {
  const f = F();
  const av = { id: 'v', name: 'AV', type: 'av', rate: 24.7, fees: null, cash: 0, lines: [line('UC', 100, 200, 100)], value: 20000, missing: [],
    av: { ratio: 0.5, gains: 10000, left: 4600, allowance: 4600, eight: true, eightDate: '2010-01-01' } };
  const ev = f.evaluate(ctx([av]), { v: f.wrapperSales(av, 12000, true) });
  // 6 000 € de gains : 4 600 dans l'abattement, 1 400 × 7,5 % + 6 000 × 17,2 %
  near(ev.tax, 1400 * 0.075 + 6000 * 0.172);
  // le plan préfère la tranche dans l'abattement : un compte-titres très imposé vient après
  const r = f.plan(ctx([av, cto('ct', [line('B', 100, 100, 10)])]), 3000);
  const used = r.plan.accounts.filter(a => a.withdraw > 1).map(a => a.id);
  assert.deepEqual(plain(used), ['v']);
});

test('retrait malin : montant impossible signalé avec le maximum disponible', () => {
  const f = F();
  const r = f.plan(ctx([cto('ct', [line('A', 10, 100, 100)])]), 5000);
  assert.equal(r.short, true);
  near(r.max, 1000);
});

test('radar fiscal : moins-values à constater, réserve à utiliser, purge assurance-vie, échéances, dividendes', () => {
  const f = F();
  const harvest = f.opportunities(ctx([cto('ct', [line('L', 10, 80, 100)])], { ytd: 500 }));
  assert.equal(harvest[0].id, 'harvest');
  near(harvest[0].save, 200 * 0.314);
  const purge = f.opportunities(ctx([cto('ct', [line('G', 10, 150, 100)])], { carry: [{ year: 2016, amount: 300 }] }));
  const p = purge.find(o => o.id === 'purge-cto');
  assert.ok(p.urgent, 'report de 2016 qui expire fin 2026');
  near(p.save, 300 * 0.314);
  const av = { id: 'v', name: 'AV', type: 'av', cash: 0, lines: [], value: 20000, missing: [], av: { ratio: 0.25, gains: 5000, left: 4600, allowance: 4600, eight: true, eightDate: '2015-01-01' } };
  const pea = { id: 'p', name: 'PEA', type: 'pea', cash: 0, lines: [], value: 10000, missing: [], pea: { deposits: 7000, five: '2027-03-01', ok: false } };
  const ops = f.opportunities(ctx([av, pea], { divs12: 300 }));
  near(ops.find(o => o.id === 'purge-av-v').save, 4600 * 0.075);
  near(ops.find(o => o.id === 'wait-pea-p').save, 3000 * (0.314 - 0.186));
  near(ops.find(o => o.id === 'divs').save, 300 * 0.314);
  assert.deepEqual(plain(f.opportunities(ctx([cto('ct', [line('A', 1, 100, 100)])]))), []);
});
