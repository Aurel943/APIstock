import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadApp, root } from './harness.mjs';

/* Réponses Yahoo enregistrées (relais, type=summary) le 17/11/2026 */
const fixture = name => JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'relay', name + '.json'), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x));
const state = () => ({
  accounts: [{ id: 'cto', name: 'CTO', type: 'cto', taxRate: 31.4 }],
  instruments: {
    'NVDA@XNAS': { symbol: 'NVDA', mic: 'XNAS', name: 'NVIDIA Corporation', currency: 'USD', type: 'Action', provider: 'yahoo', ysymbol: 'NVDA' },
    'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World UCITS ETF', currency: 'EUR', type: 'ETF', provider: 'yahoo', ysymbol: 'CW8.PA' },
    'Y:^FCHI': { symbol: '^FCHI', ysymbol: '^FCHI', provider: 'yahoo', mic: '', name: 'CAC 40', currency: 'EUR', type: 'Indice' },
  },
  transactions: [{ id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-10', account: 'cto', qty: 10, price: 500, fees: 0 }],
  watchlist: ['NVDA@XNAS', 'Y:^FCHI'],
});

test('fiche : action, ETF ou rien (indice)', () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals');
  assert.deepEqual(plain(F.kindOf('NVDA@XNAS')), { kind: 'stock', sym: 'NVDA' });
  assert.deepEqual(plain(F.kindOf('CW8@XPAR')), { kind: 'etf', sym: 'CW8.PA', profile: 'world' });
  assert.equal(F.kindOf('Y:^FCHI'), null);
});

test('action : avis des analystes, objectif de cours, valorisation, santé, profil', () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals');
  const v = plain(F.stockView(fixture('summary-NVDA'), 156.14));
  assert.equal(v.analysts.n, 54);
  assert.deepEqual(v.analysts.consensus, { label: 'Achat', tone: 'up' });
  assert.deepEqual(v.analysts.counts, { strongBuy: 11, buy: 36, hold: 14, sell: 1, strongSell: 0 });
  assert.ok(Math.abs(v.analysts.buyShare - 47 / 62 * 100) < 1e-9);
  assert.ok(Math.abs(v.analysts.prevBuyShare - 59 / 62 * 100) < 1e-9, 'plus optimistes il y a un mois');
  assert.ok(Math.abs(v.target.upside - (267.6463 / 156.14 - 1) * 100) < 1e-9);
  assert.equal(v.target.low, 130);
  assert.equal(v.target.high, 515);
  assert.ok(Math.abs(v.valuation.pe - 19.73957) < 1e-9);
  assert.ok(v.valuation.forwardPe < v.valuation.pe);
  assert.equal(v.health.financialCcy, 'USD');
  assert.equal(v.profile.sector, 'Technologie');
  assert.equal(v.profile.country, 'États-Unis');
  assert.equal(v.profile.website, 'https://www.nvidia.com');
  assert.deepEqual(['Achat fort', 'Achat', 'Conserver', 'Vente', 'Vente forte'], [1.2, 2.1, 3, 4, 4.8].map(m => F.consensus(m).label));
  assert.equal(F.consensus(null), null);
});

test('ETF : frais, performances, secteurs en français, lignes de l\'indice suivi si l\'ETF ne publie pas les siennes', () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals');
  const v = plain(F.etfView(fixture('summary-CW8_PA'), { sym: 'URTH', list: [{ sym: 'AAPL', name: 'Apple', pct: 5.6 }, { sym: 'NVDA', name: 'NVIDIA', pct: 5.2 }] }));
  assert.ok(Math.abs(v.ter - 0.38) < 1e-9);
  assert.match(v.family, /Amundi/);
  assert.equal(v.inception, '2024-03-15');
  assert.ok(v.r5 > 0 && v.r3 > 0);
  assert.equal(v.sectors[0].name, 'Technologie');
  assert.ok(v.sectors.every((s, i) => i === 0 || v.sectors[i - 1].pct >= s.pct), 'triés');
  assert.ok(Math.abs(v.sectors.reduce((s, x) => s + x.pct, 0) - 100) < 1, 'environ 100 %');
  assert.equal(v.source, 'URTH');
  assert.deepEqual(v.holdings.map(h => h.name), ['Apple', 'NVIDIA']);
  // ETF qui publie sa composition : ses propres lignes
  const own = plain(F.etfView({ topHoldings: { holdings: [{ symbol: 'TTE.PA', holdingName: 'TotalEnergies SE', holdingPercent: { raw: 0.098 } }] } }, { sym: 'X', list: [{ name: 'Y', pct: 1 }] }));
  assert.equal(own.source, 'own');
  assert.equal(own.holdings[0].name, 'TotalEnergies');
});

test('radiographie : poids réels des indices quand la composition est connue, noms rapprochés', () => {
  const a = loadApp(state());
  const H = a.get('Holdings'), X = a.get('Xray');
  const list = H.parse({ holdings: [
    { symbol: 'AAPL', holdingName: 'Apple Inc', holdingPercent: { raw: 0.056 } }, { symbol: 'NVDA', holdingName: 'NVIDIA Corp', holdingPercent: { raw: 0.052 } },
    { symbol: 'MSFT', holdingName: 'Microsoft Corp', holdingPercent: { raw: 0.041 } }, { symbol: 'JPM', holdingName: 'JPMorgan Chase & Co', holdingPercent: { raw: 0.011 } },
    { symbol: 'LLY', holdingName: 'Eli Lilly and Co', holdingPercent: { raw: 0.0126 } }, { symbol: '2330.TW', holdingName: 'Taiwan Semiconductor Manufacturing Co Ltd', holdingPercent: { raw: 0.017 } },
  ] });
  assert.deepEqual(plain(list.map(x => x.name)), ['Apple', 'NVIDIA', 'Microsoft', 'TSMC', 'Eli Lilly', 'JPMorgan']);
  H.cache = { URTH: { ts: Date.now(), list } };
  const live = X.liveHoldings();
  assert.deepEqual(plain(live.live.map(l => [l.prof, l.sym])), [['world', 'URTH']]);
  assert.equal(live.holdings.world[0][0], 'Apple');
  assert.ok(live.holdings.sp500.length > 5, 'les autres indices gardent les poids approximatifs');
  const r = X.lookthrough([{ key: 'CW8@XPAR', label: 'CW8', value: 10000, profile: 'world' }], live.holdings);
  assert.ok(Math.abs(r.companies.find(c => c.name === 'Apple').value - 560) < 1e-6);
  assert.ok(r.mag7 > 0);
});
