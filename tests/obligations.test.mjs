import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('obligations : profil d\'après le nom, devise (couverte, dollar ou cotation)', () => {
  const a = loadApp({ instruments: {
    'A@XPAR': { symbol: 'A', mic: 'XPAR', name: 'iShares Core Euro Aggregate Bond UCITS ETF', currency: 'EUR' },
    'B@XLON': { symbol: 'B', mic: 'XLON', name: 'iShares $ Treasury Bond 1-3yr UCITS ETF', currency: 'GBp' },
    'C@XETR': { symbol: 'C', mic: 'XETR', name: 'Xtrackers Global Government Bond UCITS ETF EUR Hedged', currency: 'EUR' },
    'D@XPAR': { symbol: 'D', mic: 'XPAR', name: 'Amundi MSCI World UCITS ETF', currency: 'EUR' },
  } });
  const E = a.get('Expo'), plain = x => JSON.parse(JSON.stringify(x));
  assert.equal(E.of('A@XPAR').profile, 'bond');
  assert.deepEqual(plain(E.split('A@XPAR').ccy), { EUR: 100 });
  assert.deepEqual(plain(E.split('B@XLON').ccy), { USD: 100 });
  assert.deepEqual(plain(E.split('C@XETR').ccy), { EUR: 100 });
  assert.equal(E.of('D@XPAR').profile, 'world');
});

test('obligations : choc de taux (duration + convexité), moyennes pondérées, fonds à échéance', () => {
  const B = loadApp({}).get('Bonds');
  near(B.shock(6, 1), -0.06 + 0.5 * 42 * 0.0001);
  near(B.shock(6, -1), 0.06 + 0.5 * 42 * 0.0001);
  near(B.shock(0, 2), 0);
  assert.ok(isNaN(B.shock(NaN, 1)));
  const P = B.portfolio([{ value: 3000, ytm: 3, dur: 6 }, { value: 1000, ytm: 4, dur: 2 }, { value: 1000, ytm: NaN, dur: NaN }]);
  near(P.value, 5000); near(P.ytm, 3.25); near(P.dur, 5); near(P.known, 0.8);
  const D = B.dated({ amount: 10000, ytm: 3.2, ter: 0.2, years: 4, euro: 2.5, livret: 1.7 });
  near(D.fund, 10000 * Math.pow(1.03, 4));
  near(D.euro, 10000 * Math.pow(1.025, 4));
  near(D.livret, 10000 * Math.pow(1.017, 4));
  const T = B.dated({ amount: 10000, ytm: 3, years: 2, euro: 2, livret: 2, tax: 30 });
  near(T.fund, 10000 + (10000 * 1.03 ** 2 - 10000) * 0.7);
  near(T.livret, 10000 * 1.02 ** 2); // le Livret A n'est pas imposé
  near(B.years('2027-11-18', '2026-11-18'), 365 / 365.25);
});
