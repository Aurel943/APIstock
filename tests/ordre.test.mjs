import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const utc = s => Date.parse(s + 'Z');
const iso = t => new Date(t).toISOString().slice(0, 16);
const plain = x => JSON.parse(JSON.stringify(x));

test('passer un ordre : place de cotation, créneaux conseillés selon la bourse des titres sous-jacents', () => {
  const a = loadApp({});
  const O = a.get('OrderTiming'), EX = a.get('EXCHANGES');
  const ex = id => EX.find(e => e.id === id);
  assert.equal(O.exchangeOf({ mic: 'XPAR' }).id, 'paris');
  assert.equal(O.exchangeOf({ ysymbol: 'SAP.DE' }).id, 'xetra');
  assert.equal(O.exchangeOf({ ysymbol: 'AAPL' }).id, 'newyork');
  assert.equal(O.exchangeOf({ ysymbol: 'BTC-EUR' }), null);
  // mercredi 18 novembre 2026 : Paris 9 h – 17 h 30 (8 h – 16 h 30 UTC), New York 14 h 30 – 21 h UTC
  const sp = O.windows(ex('paris'), ex('newyork'), '2026-11-18');
  assert.deepEqual(plain(sp.best.map(w => w.map(iso))), [['2026-11-18T14:45', '2026-11-18T16:20']]);
  assert.equal(sp.underlyingClosed, false);
  const eu = O.windows(ex('paris'), null, '2026-11-18');
  assert.deepEqual(plain(eu.best.map(w => w.map(iso))), [['2026-11-18T08:15', '2026-11-18T16:20']]);
  // ETF japonais coté à Paris : Tokyo est fermé pendant toute la séance européenne
  const jp = O.windows(ex('paris'), ex('tokyo'), '2026-11-18');
  assert.equal(jp.underlyingClosed, true);
  assert.deepEqual(plain(jp.best.map(w => w.map(iso))), [['2026-11-18T08:30', '2026-11-18T16:20']]);
  assert.deepEqual(plain(O.windows(ex('paris'), ex('newyork'), '2026-11-21').best), []); // samedi
});

test('passer un ordre : état du moment, prochain créneau, fourchette et ordre de grandeur', () => {
  const a = loadApp({});
  const O = a.get('OrderTiming'), EX = a.get('EXCHANGES');
  const paris = EX.find(e => e.id === 'paris'), ny = EX.find(e => e.id === 'newyork');
  let s = O.status(paris, ny, utc('2026-11-18T10:00'));
  assert.equal(s.state, 'meh');
  assert.equal(iso(s.next[0]), '2026-11-18T14:45');
  s = O.status(paris, ny, utc('2026-11-18T15:00'));
  assert.equal(s.state, 'good');
  assert.equal(iso(s.current[1]), '2026-11-18T16:20');
  s = O.status(paris, ny, utc('2026-11-20T18:00')); // vendredi soir → lundi
  assert.equal(s.state, 'closed');
  assert.equal(iso(s.next[0]), '2026-11-23T14:45');
  assert.equal(iso(O.nextSession(ny, utc('2026-11-18T22:00'))[0]), '2026-11-19T14:30');
  const sp = O.spread(99.95, 100.05);
  assert.ok(Math.abs(sp.pct - 0.001) < 1e-12);
  assert.equal(O.grade(sp.pct), 'excellente');
  assert.equal(O.grade(0.005), 'large');
  assert.equal(O.spread(0, 0), null);          // place sans fourchette publiée (Euronext)
  assert.equal(O.spread(155.19, 163.89), null); // cours hors séance : pas une vraie fourchette
  assert.deepEqual(JSON.parse(JSON.stringify(O.typical(5e6))), [0.0005, 0.0015]);
  assert.equal(O.typical(0), null);
});
