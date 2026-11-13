import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ' : ' : ''}${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
const app = () => loadApp({});

test('indicateurs : moyennes simple et exponentielle, Bollinger', () => {
  const TA = app().get('TA');
  assert.deepEqual(plain(TA.sma([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4]);
  const e = TA.ema([1, 2, 3, 4, 5], 3);
  near(e[2], 2, 1e-12, 'amorce = moyenne simple');
  near(e[3], 4 * 0.5 + 2 * 0.5); near(e[4], 5 * 0.5 + 3 * 0.5);
  assert.equal(e[1], null);
  // valeurs null en tête (MACD) : l'amorce démarre au premier point connu
  const e2 = TA.ema([null, null, 2, 4, 6, 8], 2);
  assert.equal(e2[2], null); near(e2[3], 3); near(e2[4], 6 * 2 / 3 + 3 / 3);
  const bb = TA.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  near(bb.mid[7], 5); near(bb.up[7], 9, 1e-12, 'écart-type 2'); near(bb.lo[7], 1);
  assert.equal(bb.up[6], null);
});

test('indicateurs : RSI de Wilder (série) identique au scanner, MACD', () => {
  const ctx = app(), TA = ctx.get('TA'), Scan = ctx.get('Scan');
  const c = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 8 + i * 0.1);
  const r = TA.rsi(c, 14);
  assert.equal(r[13], null);
  near(r[r.length - 1], Scan.rsi(c, 14), 1e-9, 'même valeur finale que Scan.rsi');
  assert.equal(TA.rsi(Array.from({ length: 30 }, (_, i) => i), 14)[29], 100);
  const m = TA.macd(c);
  assert.equal(m.macd[24], null); assert.ok(m.macd[25] !== null, 'MACD dès la 26e séance');
  assert.ok(m.signal[33] !== null && m.signal[32] === null, 'signal = moyenne 9 du MACD');
  near(m.hist[100], m.macd[100] - m.signal[100]);
  // tendance haussière régulière : MACD positif
  const up = TA.macd(Array.from({ length: 80 }, (_, i) => 100 * 1.01 ** i));
  assert.ok(up.macd[79] > 0);
});

test('bougies : regroupement par semaine et par mois, Heikin-Ashi', () => {
  const TA = app().get('TA');
  // du lundi 2 au vendredi 13 février 2026 (deux semaines), puis lundi 2 mars
  const days = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-09', '2026-02-10', '2026-02-13', '2026-03-02'];
  const bars = days.map((d, i) => ({ d, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i, v: 100 }));
  const w = plain(TA.resample(bars, 'S'));
  assert.equal(w.length, 3);
  assert.deepEqual([w[0].d, w[0].o, w[0].h, w[0].l, w[0].c, w[0].v], ['2026-02-02', 10, 16, 9, 15, 500], 'semaine 1 : ouverture du lundi, clôture du vendredi');
  assert.equal(w[1].dEnd, '2026-02-13');
  const m = plain(TA.resample(bars, 'M'));
  assert.deepEqual(m.map(x => [x.d.slice(0, 7), x.o, x.c, x.v]), [['2026-02', 10, 18, 800], ['2026-03', 18, 19, 100]]);
  assert.equal(TA.resample(bars, 'J'), bars, 'journalier : inchangé');
  const ha = TA.heikin([{ o: 10, h: 12, l: 9, c: 11 }, { o: 11, h: 14, l: 10, c: 13 }]);
  near(ha[0].c, 10.5); near(ha[0].o, 10.5); near(ha[1].o, 10.5); near(ha[1].c, 12);
  assert.ok(ha[1].h >= Math.max(ha[1].o, ha[1].c) && ha[1].l <= Math.min(ha[1].o, ha[1].c));
  for (const [r, step] of [[7, 2], [100, 25], [0.37, 0.1], [3400, 1000]]) near(TA.niceStep(r, 4), step, 1e-12, 'pas rond pour ' + r);
});

test('réponse Yahoo → bougies : valeurs manquantes, doublon du jour, intraday', () => {
  const ctx = app(), parse = ctx.get('termParseBars');
  const t0 = Date.UTC(2026, 1, 2, 14, 30) / 1000;
  const json = { chart: { result: [{ meta: { gmtoffset: 3600 }, timestamp: [t0, t0 + 86400, t0 + 2 * 86400, t0 + 2 * 86400 + 3600],
    indicators: { quote: [{ open: [10, null, 12, 12], high: [11, 13, null, 13], low: [9, 10, 11, 11], close: [10.5, 12.5, null, 12.8], volume: [5, 6, 7, 8] }] } }] } };
  const b = plain(parse(json, false));
  assert.equal(b.length, 3, 'clôture manquante ignorée, doublon du même jour fusionné');
  assert.deepEqual([b[1].o, b[1].h, b[1].l, b[1].c], [12.5, 13, 10, 12.5], 'ouverture manquante = clôture');
  assert.equal(b[2].d, '2026-02-04'); assert.equal(b[2].c, 12.8);
  const intra = plain(parse(json, true, true));
  assert.equal(intra[0].d, '02/02 15:30', 'heure locale de la place (décalage Yahoo)');
  assert.deepEqual(plain(parse({ chart: { result: null } }, false)), []);
});

test('terminal : noms, secteurs et univers des matières premières', () => {
  const ctx = app();
  const C = ctx.get('TERM_CMDTY'), name = ctx.get('termName'), sector = ctx.get('TERM_SECTOR_OF'), alias = ctx.get('TERM_ALIAS');
  assert.ok(C.length >= 29, 'au moins 29 contrats');
  assert.equal(new Set(C.map(x => x[0])).size, C.length, 'pas de doublon');
  for (const g of ['ÉNERGIE', 'MÉTAUX PRÉCIEUX', 'MÉTAUX INDUSTRIELS', 'CÉRÉALES & OLÉAGINEUX', 'SOFTS', 'ÉLEVAGE & LAIT']) assert.ok(C.some(x => x[3] === g), g);
  assert.ok(C.every(x => /=F$/.test(x[0]) && x[2]), 'symbole de contrat à terme et unité');
  assert.equal(name('CC=F'), 'CACAO'); assert.equal(name('^GSPC'), 'S&P 500'); assert.equal(name('XYZ'), 'XYZ');
  assert.equal(sector('GC=F'), 'CMDTY'); assert.equal(sector('EURUSD=X'), 'CURNCY'); assert.equal(sector('BTC-USD'), 'CRYPTO');
  assert.equal(sector('^TNX'), 'GOVT'); assert.equal(sector('^FCHI'), 'INDEX'); assert.equal(sector('MC.PA'), 'EQUITY');
  for (const a of ['GOLD', 'BRENT', 'COCOA', 'WHEAT', 'CATTLE', 'CACAO', 'BLE']) assert.ok(C.some(x => x[0] === alias[a]), a + ' pointe vers un contrat connu');
});
