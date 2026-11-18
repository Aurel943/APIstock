import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));

test('devises : exposition en regardant dans les ETF, ETF couvert compté dans sa devise de couverture, choc', () => {
  const a = loadApp({ settings: { baseCurrency: 'EUR' }, instruments: {
    'W@XPAR': { symbol: 'W', mic: 'XPAR', name: 'Amundi MSCI World UCITS ETF', currency: 'EUR' },
    'H@XPAR': { symbol: 'H', mic: 'XPAR', name: 'Amundi MSCI World UCITS ETF EUR Hedged', currency: 'EUR' },
    'M@XPAR': { symbol: 'M', mic: 'XPAR', name: 'Amundi S&P 500 UCITS ETF', currency: 'EUR', hedged: true },
  } });
  const E = a.get('Expo'), F = a.get('Fx');
  assert.equal(E.hedgeOf(E.of('H@XPAR').inst), 'EUR');
  assert.equal(E.hedgeOf(E.of('W@XPAR').inst), null);
  assert.equal(E.hedgeOf(E.of('M@XPAR').inst), 'EUR'); // coché à la main
  const exp = plain(F.exposure([{ key: 'W@XPAR', value: 1000 }, { key: 'H@XPAR', value: 1000 }], k => E.split(k)));
  const usd = exp.find(e => e.ccy === 'USD'), eur = exp.find(e => e.ccy === 'EUR');
  near(usd.value, 730); near(eur.value, 1000 + 85); near(usd.pct, 36.5);
  near(F.shock(exp, 'USD', -10), -73);
  near(F.shock(exp, 'JPY', 5), 55 * 0.05);
  near(F.shock(exp, 'XXX', 5), 0);
  assert.deepEqual(plain(F.exposure([], () => ({}))), []);
});
