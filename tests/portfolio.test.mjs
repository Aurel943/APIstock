import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); // tableaux créés dans un autre contexte vm
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const base = extra => Object.assign({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 17.2 }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 30 }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' }, 'SPY@ARCX': { symbol: 'SPY', mic: 'ARCX', name: 'SPDR', currency: 'USD' } },
  transactions: [],
}, extra);

test('PRU moyen pondéré, frais inclus, et plus-value réalisée', () => {
  const { Portfolio } = loadApp(base({ transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 10, price: 100, fees: 10 },
    { id: '2', key: 'CW8@XPAR', type: 'buy', date: '2024-02-01', account: 'pea', qty: 10, price: 200, fees: 0 },
    { id: '3', key: 'CW8@XPAR', type: 'sell', date: '2024-03-01', account: 'pea', qty: 5, price: 300, fees: 5 },
  ] }));
  const [p] = Portfolio.positions('all');
  near(p.qty, 15);
  near(p.pru, 3010 / 20);                    // le PRU ne change pas après une vente
  near(p.realized, 5 * 300 - 5 - 5 * 150.5); // produit net − prix de revient des parts vendues
});

test('division : nombre de parts × parité, prix de revient total inchangé, PRU ÷ parité', () => {
  const { Portfolio } = loadApp(base({ transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 3, price: 400, fees: 0 },
    { id: '2', key: 'CW8@XPAR', type: 'split', date: '2024-06-01', account: 'pea', qty: 10, price: 0, fees: 0 },
    { id: '3', key: 'CW8@XPAR', type: 'buy', date: '2024-07-01', account: 'pea', qty: 10, price: 41, fees: 0 },
  ] }));
  const [p] = Portfolio.positions('all');
  near(p.qty, 40);
  near(p.cost, 1200 + 410);
  near(p.pru, 1610 / 40);
});

test('historyEvents convertit les opérations antérieures à une division en parts « après division »', () => {
  const { Portfolio } = loadApp(base());
  const ev = Portfolio.historyEvents([
    { key: 'A', type: 'buy', date: '2020-01-01', qty: 2, price: 400 },
    { key: 'A', type: 'split', date: '2020-08-31', qty: 4 },
    { key: 'A', type: 'buy', date: '2021-01-01', qty: 1, price: 130 },
    { key: 'B', type: 'buy', date: '2020-01-01', qty: 1, price: 50 },
  ]);
  assert.equal(ev.length, 3);
  near(ev[0].qty, 8); near(ev[0].price, 100);
  near(ev[1].qty, 1); near(ev[1].price, 130);
  near(ev[2].qty, 1); near(ev[2].price, 50);
});

test('parité saisie : « 10 », « 1:10 », « 10:1 »', () => {
  const { get } = loadApp(base());
  const parseSplit = get('parseSplit');
  assert.equal(parseSplit('10'), 10);
  assert.equal(parseSplit('1:10'), 10);
  assert.equal(parseSplit('10:1'), 0.1);
  assert.equal(parseSplit('2/3'), 1.5);
  assert.ok(Number.isNaN(parseSplit('abc')));
});

test('XIRR : 1 000 € devenus 1 100 € en un an ≈ 10 %', () => {
  const { Portfolio } = loadApp(base());
  near(Portfolio.xirr([{ date: '2023-01-01', amount: -1000 }, { date: '2024-01-01', amount: 1100 }]), 10, 0.05);
});

test('liquidités : versements − achats + ventes + dividendes', () => {
  const { Portfolio } = loadApp(base({
    cashMoves: [{ id: 'c1', account: 'pea', type: 'deposit', date: '2024-01-01', amount: 5000 }, { id: 'c2', account: 'pea', type: 'withdraw', date: '2024-05-01', amount: 500 }],
    transactions: [
      { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-02', account: 'pea', qty: 10, price: 300, fees: 2 },
      { id: '2', key: 'CW8@XPAR', type: 'sell', date: '2024-03-01', account: 'pea', qty: 2, price: 350, fees: 1 },
      { id: '3', key: 'CW8@XPAR', type: 'div', date: '2024-04-01', account: 'pea', qty: 1, price: 20, fees: 3 },
      { id: '4', key: 'CW8@XPAR', type: 'split', date: '2024-04-02', account: 'pea', qty: 2, price: 0, fees: 0 },
      { id: '5', key: 'SPY@ARCX', type: 'buy', date: '2024-01-02', account: 'cto', qty: 1, price: 400, fees: 0 },
    ],
  }));
  assert.ok(Portfolio.cashTracked('pea'));
  assert.ok(!Portfolio.cashTracked('cto'));
  const b = Portfolio.cashBalance('pea');
  near(b.cash, 5000 - 500 - 3002 + 699 + 17);
  near(b.deposits, 5000); near(b.withdrawals, 500);
  near(Portfolio.cashTotal('all').cash, b.cash); // le CTO n'est pas suivi
});

test('PEA : les versements enregistrés remplacent l\'estimation', () => {
  const { Tax, Store } = loadApp(base({
    cashMoves: [{ id: 'c1', account: 'pea', type: 'deposit', date: '2023-03-01', amount: 8000 }],
    transactions: [{ id: '1', key: 'CW8@XPAR', type: 'buy', date: '2023-03-02', account: 'pea', qty: 10, price: 500, fees: 0 }],
  }));
  const p = Tax.pea(Store.state.accounts[0]);
  near(p.deposits, 8000);
  assert.equal(p.tracked, true);
  assert.equal(p.open, '2023-03-01');
  assert.equal(p.five, '2028-03-01');
});

test('compte-titres : division prise en compte dans le prix moyen pondéré d\'une vente', () => {
  const { Tax, Store } = loadApp(base({ transactions: [
    { id: '1', key: 'SPY@ARCX', type: 'buy', date: '2023-01-01', account: 'cto', qty: 1, price: 400, fees: 0 },
    { id: '2', key: 'SPY@ARCX', type: 'split', date: '2023-06-01', account: 'cto', qty: 4, price: 0, fees: 0 },
    { id: '3', key: 'SPY@ARCX', type: 'sell', date: '2023-09-01', account: 'cto', qty: 2, price: 150, fees: 0 },
  ] }));
  const { sales } = Tax.events(Store.state.accounts[1]);
  assert.equal(sales.length, 1);
  near(sales[0].cost, 200);
  near(sales[0].gain, 100);
});

test('moins-values reportées et imputées l\'année suivante', () => {
  const { Tax, Store } = loadApp(base({ transactions: [
    { id: '1', key: 'SPY@ARCX', type: 'buy', date: '2022-01-01', account: 'cto', qty: 10, price: 100, fees: 0 },
    { id: '2', key: 'SPY@ARCX', type: 'sell', date: '2022-06-01', account: 'cto', qty: 5, price: 80, fees: 0 },  // −100
    { id: '3', key: 'SPY@ARCX', type: 'sell', date: '2023-06-01', account: 'cto', qty: 5, price: 150, fees: 0 }, // +250
  ] }));
  const { out } = Tax.yearly([Store.state.accounts[1]]);
  near(out[2022].loss, 100);
  near(out[2023].used, 100);
  near(out[2023].taxable, 150);
});

test('versements programmés : échéances dues, jour ramené à la fin du mois, échéances déjà traitées ignorées', () => {
  const { Portfolio } = loadApp(base());
  const plan = { id: 'p', key: 'CW8@XPAR', amount: 200, day: 31, start: '2026-01-15', active: true, done: { '2026-03': 'skip' } };
  const due = Portfolio.planDue(plan, '2026-05-10').map(d => d.date);
  same(due, ['2026-01-31', '2026-02-28', '2026-04-30']);
  assert.equal(Portfolio.planNext(plan, '2026-05-10'), '2026-05-31');
  same(Portfolio.planDue(Object.assign({}, plan, { active: false }), '2026-05-10'), []);
  assert.equal(Portfolio.planShares(200, 45, 1, false), 4);
  near(Portfolio.planShares(200, 45, 1, true), 4.4444);
  assert.equal(Portfolio.planShares(200, 450, 1, false), 0);
});

test('rééquilibrage sans vente : montant minimal pour revenir à la cible', () => {
  const { Portfolio } = loadApp(base());
  const lines = [{ key: 'A', value: 7000, target: 50, unitPrice: 10 }, { key: 'B', value: 3000, target: 50, unitPrice: 10 }];
  near(Portfolio.rebalanceAmount(lines), 4000); // 7 000 doit représenter 50 % → total 14 000
  near(Portfolio.drift(lines).max, 20);
  const plan = Portfolio.plan(lines, 4000, { fractional: true });
  near(plan.lines.find(l => l.key === 'B').cost, 4000, 0.01);
  near(Portfolio.rebalanceAmount([{ value: 5000, target: 50 }, { value: 5000, target: 50 }]), 0);
});

test('indicateurs de risque : volatilité nulle pour une progression régulière, pire baisse détectée', () => {
  const { Portfolio } = loadApp(base());
  const days = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
  const smooth = days.map((d, i) => [d, 100 * Math.pow(1.0003, i)]);
  const s = Portfolio.riskStats(smooth, 0);
  near(s.vol, 0, 1e-9);
  assert.equal(s.mdd, 0);
  const bumpy = days.map((d, i) => [d, i === 200 ? 80 : 100 + i * 0.01]);
  const b = Portfolio.riskStats(bumpy, 0);
  near(b.mdd, 80 / (100 + 199 * 0.01) - 1, 1e-9);
  assert.equal(b.mddTrough, days[200]);
  const beta = Portfolio.beta(bumpy.map(([d, v]) => [d, v * 2]), bumpy);
  near(beta.beta, 1, 1e-9); near(beta.corr, 1, 1e-9);
});

test('Monte-Carlo : sans volatilité, tous les scénarios égalent la projection régulière', () => {
  const { Portfolio } = loadApp(base());
  const args = { initial: 10000, monthly: 100, rate: 5, fees: 0, years: 10 };
  const mc = Portfolio.monteCarlo(Object.assign({ vol: 0, target: 1 }, args));
  const det = Portfolio.project(args);
  const end = mc.years[10];
  near(end.p10, end.p90, 1e-6);
  near(end.p50, det[det.length - 1].value, 1e-6);
  assert.equal(mc.probTarget, 1);
  const risky = Portfolio.monteCarlo(Object.assign({ vol: 20, target: 0 }, args));
  assert.ok(risky.years[10].p10 < risky.years[10].p50 && risky.years[10].p50 < risky.years[10].p90);
  same(Portfolio.monteCarlo(Object.assign({ vol: 20, target: 0 }, args)).years[10], JSON.parse(JSON.stringify(risky.years[10]))); // résultats reproductibles
});

test('CSV : export puis import d\'une division et d\'une note', () => {
  const { App, Store } = loadApp(base({ transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 2, price: 400.5, fees: 1, note: 'Premier achat; "test"' },
    { id: '2', key: 'CW8@XPAR', type: 'split', date: '2024-06-01', account: 'pea', qty: 10, price: 0, fees: 0 },
  ] }));
  const csv = App.toCsv();
  Store.state.transactions = [];
  const res = App.parseCsv(csv);
  same(res.errors, []);
  assert.equal(res.txs.length, 2);
  assert.equal(res.txs[0].note, 'Premier achat; "test"');
  assert.equal(res.txs[1].type, 'split');
  assert.equal(res.txs[1].qty, 10);
});

test('snapshot : résultat mis en cache, recalculé après un changement de données, de cotation ou de taux', () => {
  const { Portfolio, Store, Api } = loadApp(base({ transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-01', account: 'pea', qty: 10, price: 100, fees: 0 },
  ] }));
  let price = 110;
  Api.cachedQuote = () => ({ price, change: 1, percentChange: 1 });
  Portfolio.invalidate();
  const s0 = Portfolio.stats.misses;
  const a = Portfolio.snapshot('all');
  const b = Portfolio.snapshot('all');
  assert.equal(Portfolio.stats.misses - s0, 1);         // deuxième appel servi par le cache
  near(a.totals.value, 1100);
  b.rows.length = 0; b.totals.value = 0;                  // modifier une copie ne touche pas le cache
  near(Portfolio.snapshot('all').totals.value, 1100);
  price = 120; Api.touch();                               // nouvelle cotation
  near(Portfolio.snapshot('all').totals.value, 1200);
  Store.addTransaction({ key: 'CW8@XPAR', type: 'buy', date: '2024-02-01', account: 'pea', qty: 1, price: 100, fees: 0 });
  near(Portfolio.snapshot('all').totals.value, 1320);     // Store.save invalide le cache
  near(Portfolio.snapshot('cto').totals.value, 0);        // un cache par compte
});

test('indice de référence : mêmes versements aux mêmes dates', () => {
  const { Portfolio } = loadApp(base());
  const points = [
    { date: '2024-01-02', invested: 1000, value: 1000 },
    { date: '2024-01-03', invested: 1000, value: 1010 },
    { date: '2024-01-04', invested: 1500, value: 1600 },
  ];
  const bench = [['2024-01-02', 100], ['2024-01-03', 110], ['2024-01-04', 110]];
  const b = Portfolio.benchmark(points, bench);
  near(b[0], 1000);        // 10 parts à 100
  near(b[1], 1100);        // l'indice prend 10 %
  near(b[2], 1600);        // + 500 € investis à 110
  assert.equal(Portfolio.benchmark(points, []).every(v => v === null), true);
});
