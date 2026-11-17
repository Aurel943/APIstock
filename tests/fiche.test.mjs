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

/* Révisions, avis des banques et dirigeants de NVIDIA (relais, type=summary, 17/11/2026) */
const NOW = Date.UTC(2026, 10, 17, 12);

test('révisions des prévisions : évolution sur 30 et 90 jours, verdict sur les exercices', () => {
  const a = loadApp(state());
  const R = plain(a.get('Fundamentals').revisionsView(fixture('trends-NVDA')));
  assert.deepEqual(R.rows.map(x => x.period), ['0q', '+1q', '0y', '+1y']);
  const y1 = R.rows.find(x => x.period === '+1y');
  assert.equal(y1.label, 'Exercice suivant');
  assert.ok(Math.abs(y1.ch90 - (15.84302 / 12.85483 - 1) * 100) < 1e-9, '+23 % en 90 jours');
  assert.equal(y1.up30, 7);
  assert.equal(R.up, 9, 'exercices : 2 + 7 révisions à la hausse');
  assert.equal(R.down, 0);
  assert.equal(R.verdict.tone, 'up');
  assert.equal(R.verdict.label, 'Prévisions revues à la hausse');
  // baisse : plus de révisions à la baisse
  const down = plain(a.get('Fundamentals').revisionsView({ earningsTrend: { trend: [{ period: '0y', epsTrend: { current: { raw: 9.4 }, '30daysAgo': { raw: 9.6 } }, epsRevisions: { upLast30days: { raw: 7 }, downLast30days: { raw: 23 } } }] } }));
  assert.equal(down.verdict.tone, 'down');
  assert.equal(a.get('Fundamentals').revisionsView({}), null);
});

test('avis des banques : 90 derniers jours, relèvements / abaissements, objectifs, libellés français', () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals');
  const G = plain(F.ratingsView(fixture('trends-NVDA'), NOW));
  assert.equal(G.list[0].firm, 'Melius Research');
  assert.equal(G.list[0].action, 'down');
  assert.equal(G.list[0].from, 'Achat');
  assert.equal(G.list[0].to, 'Conserver');
  assert.equal(G.list[0].prior, 315);
  assert.equal(G.list[0].pt, 185);
  assert.equal(G.down, 9);
  assert.equal(G.up, 0);
  assert.ok(G.lowered >= 10 && G.raised === 0);
  assert.ok(G.list.every((x, i) => i === 0 || G.list[i - 1].date >= x.date), 'du plus récent au plus ancien');
  assert.equal(F.gradeFr('Overweight'), 'Surpondérer');
  assert.equal(F.gradeFr('Equal-Weight'), 'Pondération neutre');
  assert.equal(F.ratingsView(fixture('trends-NVDA'), NOW + 400 * 86400000), null, 'rien de récent');
});

test('dirigeants : seules les ventes et achats en bourse comptent, noms et fonctions en français', () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals');
  const I = plain(F.insidersView(fixture('trends-NVDA'), NOW));
  assert.ok(I.sells.count > 0 && I.buys.count === 0, 'ventes seulement');
  assert.ok(I.others > 0, 'attributions et donations mises de côté');
  assert.ok(I.market.every(t => t.kind === 'sell'));
  const t = I.market[0];
  assert.equal(t.name, 'Timothy S Teter');
  assert.equal(t.role, 'Directeur juridique');
  assert.deepEqual(t.price, [222.19, 223.75]);
  assert.equal(t.indirect, true);
  assert.equal(F.personName('HUANG JEN HSUN'), 'Jen Hsun Huang');
  assert.deepEqual(['sell', 'buy', 'award', 'exercise', 'gift', 'other'],
    ['Sale at price 10 per share.', 'Purchase at price 5 per share.', 'Stock Award(Grant) at price 0.00 per share.', 'Conversion of Exercise of derivative security', 'Stock Gift at price 0.00 per share.', ''].map(x => F.txKind(x)));
  assert.equal(F.roleFr('Chief Executive Officer'), 'PDG');
  assert.equal(F.roleFr('Director'), 'Administrateur');
});

test('relais d\'avant novembre 2026 : révisions et avis des banques sans les dirigeants', async () => {
  const a = loadApp(state());
  const F = a.get('Fundamentals'), Api = a.get('Api');
  const asked = [];
  Api.hasProxy = () => true;
  Api.yahoo = async p => {
    asked.push(p.modules);
    if (/insider/.test(p.modules)) { const ApiError = a.get('ApiError'); throw new ApiError('requête invalide', 0); }
    const d = fixture('trends-NVDA');
    return { results: { NVDA: { earningsTrend: d.earningsTrend, upgradeDowngradeHistory: d.upgradeDowngradeHistory } } };
  };
  const d = await F.getTrends('NVDA');
  assert.equal(asked.length, 2);
  assert.equal(d.noInsiders, true);
  assert.ok(F.revisionsView(d));
  assert.ok(F.load()['NVDA|trends'], 'gardé en cache');
});

test('liste de suivi : valeurs des colonnes en option et tri (valeurs inconnues à la fin)', () => {
  const a = loadApp(state());
  const W = a.get('WatchCols');
  const v = plain(W.values(fixture('summary-NVDA'), null, 156.14));
  assert.ok(Math.abs(v.upside - (267.6463 / 156.14 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(v.pe - 19.73957) < 1e-9);
  assert.ok(Math.abs(v.yield - 0.64) < 1e-9);
  assert.ok(v.reco > 1 && v.reco < 2);
  assert.equal(v.earn, null);
  const etf = plain(W.values(fixture('summary-CW8_PA'), null, 700));
  assert.equal(etf.upside, null);
  const vals = { a: 5, b: null, c: 12, d: -3 };
  assert.deepEqual(plain(W.sort(['a', 'b', 'c', 'd'], k => vals[k], 'desc')), ['c', 'a', 'd', 'b']);
  assert.deepEqual(plain(W.sort(['a', 'b', 'c', 'd'], k => vals[k], 'asc')), ['d', 'a', 'c', 'b']);
});

test('comparateur d\'ETF : recouvrement des lignes (plus petit poids commun) et des indices', () => {
  const a = loadApp(state());
  const C = a.get('EtfCompare');
  const ov = plain(C.overlap(
    [{ name: 'Apple', pct: 5.6 }, { name: 'NVIDIA', pct: 5.2 }, { name: 'Nestlé', pct: 0.4 }],
    [{ name: 'NVIDIA', pct: 7.6 }, { name: 'Apple', pct: 7.7 }, { name: 'Berkshire Hathaway', pct: 1.6 }]));
  assert.deepEqual(ov.common.map(c => c.name), ['Apple', 'NVIDIA']);
  assert.ok(Math.abs(ov.shared - (5.6 + 5.2)) < 1e-9, 'somme des plus petits poids');
  assert.deepEqual(ov.onlyA.map(h => h.name), ['Nestlé']);
  assert.deepEqual(ov.onlyB.map(h => h.name), ['Berkshire Hathaway']);
  assert.equal(C.indexOverlap('world', 'sp500'), 68);
  assert.equal(C.indexOverlap('sp500', 'sp500'), 100);
  assert.equal(C.indexOverlap('world', 'none'), null);
  assert.equal(C.indexOverlap('japan', 'em'), 0);
});
