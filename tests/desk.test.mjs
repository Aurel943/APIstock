import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const D = () => loadApp({}).get('Desk');

/** Série quotidienne (jours ouvrés) à partir d'une liste de cours */
function daily(values, start = '2026-01-05') {
  const out = [];
  let d = Date.parse(start + 'T00:00:00Z');
  for (const v of values) {
    while ([0, 6].includes(new Date(d).getUTCDay())) d += 864e5;
    out.push([new Date(d).toISOString().slice(0, 10), v]); d += 864e5;
  }
  return out;
}

test('P&L explain : effets prix, change, exécution, dividendes et frais ; l\'identité comptable tient', () => {
  const desk = D();
  const A = daily([100, 102, 101, 105, 104]); // en dollars
  const fxA = d => ({ '2026-01-05': 0.9, '2026-01-06': 0.9, '2026-01-07': 0.92, '2026-01-08': 0.91, '2026-01-09': 0.95 }[d] || 0.9);
  const B = daily([50, 50, 49, 51, 52]); // en euros
  const txs = [
    { date: '2026-01-02', key: 'A', type: 'buy', qty: 10, price: 99, fees: 1 },   // avant la période
    { date: '2026-01-07', key: 'B', type: 'buy', qty: 20, price: 48.5, fees: 2 }, // pendant : acheté sous la clôture (49)
    { date: '2026-01-08', key: 'A', type: 'sell', qty: 4, price: 106, fees: 1 },  // vendu au-dessus de la clôture (105)
    { date: '2026-01-09', key: 'B', type: 'div', qty: 20, price: 0.5, fees: 0 },
  ];
  const r = desk.explain({ txs, prices: { A, B }, fx: { A: fxA, B: () => 1 }, start: '2026-01-05', end: '2026-01-09' });
  near(r.startValue, 10 * 100 * 0.9);
  // identité : fin − début − achats + ventes (nettes de frais) + dividendes = P&L
  near(r.endValue - r.startValue - r.inflow + r.outflow, r.total, 1e-9, 'identité comptable');
  near(r.price + r.fx + r.exec + r.div - r.fees, r.total, 1e-9);
  const b = r.lines.find(l => l.key === 'B'), a = r.lines.find(l => l.key === 'A');
  near(b.exec, 20 * (49 - 48.5), 1e-9, 'achat sous la clôture');
  near(a.exec, 4 * (106 - 105) * 0.91, 1e-9, 'vente au-dessus de la clôture');
  near(b.div, 10);
  assert.ok(a.fx > 0, 'le dollar a monté : effet de change positif');
  near(plain(desk.fxByCurrency(r.lines, k => (k === 'A' ? 'USD' : 'EUR'))).USD, a.fx, 1e-9);
  assert.equal(r.days.length, 4);
  near(r.days.reduce((s, d) => s + d.pnl, 0), r.total, 1e-9, 'somme des P&L quotidiens');
});

test('P&L explain : statistiques de trader et part du marché (bêta)', () => {
  const desk = D();
  const s = desk.dayStats([{ pnl: 100, ret: 0.01 }, { pnl: -50, ret: -0.005 }, { pnl: 30, ret: 0.003 }, { pnl: -80, ret: -0.008 }]);
  near(s.hit, 0.5); near(s.avgWin, 65); near(s.avgLoss, -65); near(s.profitFactor, 130 / 130);
  assert.equal(s.best.pnl, 100); assert.equal(s.worst.pnl, -80);
  assert.ok(s.maxDrawdown < 0);
  // portefeuille = 2 × l'indice : bêta 2, P&L entièrement expliqué par le marché
  const bench = daily([100, 101, 99, 102, 103, 101, 104]);
  const P = daily([100, 102, 98, 104, 106, 102, 108].map(x => x * 10));
  const r = desk.explain({ txs: [{ date: '2026-01-01', key: 'P', type: 'buy', qty: 1, price: 1000, fees: 0 }], prices: { P }, start: '2026-01-05', bench });
  near(r.market.beta, 2, 0.05);
  near(r.market.market, r.total, Math.abs(r.total) * 0.1 + 1);
});

test('périodes : début du mois, de l\'année, borné par la première opération', () => {
  const desk = D();
  assert.equal(desk.periodStart('mtd', '2026-11-13', '2020-01-01'), '2026-10-31');
  assert.equal(desk.periodStart('ytd', '2026-11-13', '2020-01-01'), '2025-12-31');
  assert.equal(desk.periodStart('1y', '2026-11-13', '2026-06-01'), '2026-05-31');
  assert.equal(desk.periodStart('all', '2026-11-13', '2024-03-04'), '2024-03-03');
});

test('signaux : fins de mois, tendance 10 mois, momentum 12-1', () => {
  const desk = D();
  assert.deepEqual(plain(desk.monthEnds([['2026-01-05', 1], ['2026-01-30', 2], ['2026-02-02', 3]])), [['2026-01-30', 2], ['2026-02-02', 3]]);
  // 24 mois de hausse régulière de 1 %
  const px = Array.from({ length: 24 }, (_, i) => [100 * 1.01 ** i]);
  const s = desk.signals(px, 23, 0);
  assert.ok(s.trend > 0); near(s.mom, 1.01 ** 11 - 1, 1e-9); near(s.vol, 0, 1e-9);
  assert.ok(!isFinite(desk.signals(px, 5, 0).sma), 'pas assez d\'historique');
});

test('stratégies : la tendance sort pendant un krach, la volatilité cible réduit l\'exposition', () => {
  const desk = D();
  // 3 ans de hausse, krach de 40 % sur 8 mois, puis reprise lente
  const path = [];
  let p = 100;
  for (let i = 0; i < 36; i++) path.push(p *= 1.01);
  for (let i = 0; i < 8; i++) path.push(p *= 0.94);
  for (let i = 0; i < 24; i++) path.push(p *= 1.012);
  const months = path.map((_, i) => `20${String(10 + Math.floor(i / 12)).padStart(2, '0')}-${String(i % 12 + 1).padStart(2, '0')}`);
  const P = { keys: ['X'], months, px: path.map(x => [x]) };
  const hold = desk.backtest(P, [1], 'hold', { cost: 0 });
  const trend = desk.backtest(P, [1], 'trend', { cost: 0 });
  assert.ok(trend.metrics.mdd > hold.metrics.mdd, `pire baisse réduite : ${trend.metrics.mdd} vs ${hold.metrics.mdd}`);
  assert.ok(trend.metrics.invested < 1, 'du temps passé en liquidités');
  near(hold.equity[hold.equity.length - 1], path[path.length - 1] / path[12], 1e-9, '« conserver » suit le cours');
  // volatilité cible très basse : exposition toujours sous 100 %
  const g = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647 - 0.5; }; })();
  const noisy = []; let q = 100;
  for (let i = 0; i < 60; i++) noisy.push([q *= 1.01 + g() * 0.15]);
  const vt = desk.backtest({ keys: ['Y'], months: noisy.map((_, i) => 'm' + i), px: noisy }, [1], 'voltarget', { volTarget: 0.05, cost: 0 });
  assert.ok(vt.exposure.every(x => x <= 1 + 1e-9));
  assert.ok(vt.exposure.some(x => x > 0 && x < 0.9), 'exposition réduite quand la volatilité dépasse la cible');
  const m = desk.metrics([0.01, -0.02, 0.03]);
  near(m.total, 1.01 * 0.98 * 1.03 - 1, 1e-12); near(m.worst, -0.02);
});

test('journal : rapport gain / risque, progression, statut ; taille de position au risque fixé', () => {
  const desk = D();
  const t = { entry: 100, target: 130, stop: 90 };
  const s = desk.thesisState(t, 110);
  near(s.rr, 20 / 20); near(s.progress, 0.5); near(s.rMultiple, 1); assert.equal(s.status, 'open');
  assert.equal(desk.thesisState(t, 131).status, 'target');
  assert.equal(desk.thesisState(t, 89).status, 'stop');
  // position vendeuse (objectif sous le stop)
  assert.equal(desk.thesisState({ entry: 100, target: 80, stop: 105 }, 79).status, 'target');
  const z = desk.positionSize({ capital: 50000, riskPct: 1, price: 100, stop: 92 });
  assert.equal(z.qty, 62); near(z.risk, 62 * 8); near(z.budget, 500);
  assert.equal(desk.positionSize({ capital: 50000, riskPct: 1, price: 100, stop: 92, cash: 3000 }).qty, 30, 'plafonné par les liquidités');
  assert.equal(desk.positionSize({ capital: 50000, riskPct: 1, price: 100, stop: 100 }), null);
});

test('calendrier des séances : toute la période, une ligne par année, mois repérés, échelle robuste', () => {
  const desk = D();
  const days = [];
  let d = Date.parse('2024-05-17T00:00:00Z');
  for (let i = 0; i < 420; i++) {
    const iso = new Date(d).toISOString().slice(0, 10);
    if (![0, 6].includes(new Date(d).getUTCDay())) days.push({ date: iso, pnl: i % 3 ? 10 : -5, ret: i % 3 ? 0.001 : -0.0005, value: 1000 });
    d += 864e5;
  }
  days.push({ date: '2025-07-09', pnl: -900, ret: -0.2, value: 800 }); // krach isolé
  const cal = plain(desk.calendar(days));
  assert.deepEqual(cal.years.map(y => y.year), [2025, 2024], 'la plus récente en haut, depuis le début');
  const y24 = cal.years[1];
  assert.equal(y24.weeks[0].monday, '2024-05-13');
  assert.equal(y24.weeks[0].month, 'mai');
  assert.ok(y24.weeks.some(w => w.month === 'déc.'));
  assert.equal(y24.weeks.filter(w => w.month).length, 8, 'un repère par mois, de mai à décembre');
  assert.ok(cal.scale < 0.01, 'le krach isolé ne fixe pas l\'échelle');
  assert.equal(desk.heatLevel(-0.2, cal.scale), 4);
  assert.equal(desk.heatLevel(0, cal.scale), 0);
  near(y24.total, days.filter(x => x.date < '2025').reduce((s, x) => s + x.pnl, 0), 1e-9);
  assert.equal(desk.calendar(days.slice(0, 3)), null);
});
