import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/** Cours de bourse quotidiens (jours ouvrés) d'une date à une autre, croissance annuelle `g`, bruit ±`noise` */
function daily(from, to, g, noise = 0, seed = 3) {
  const out = [];
  let s = seed;
  const t0 = Date.parse(from);
  for (let t = t0; t <= Date.parse(to); t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    s = (s * 16807) % 2147483647;
    const yrs = (t - t0) / (365.25 * 864e5);
    out.push([new Date(t).toISOString().slice(0, 10), 100 * Math.pow(1 + g, yrs) * (1 + noise * (s / 2147483647 - 0.5))]);
  }
  return out;
}

test('écart de suivi : dividendes réinvestis, ajustement annuel et conversion', () => {
  const T = loadApp({}).get('TrackDiff');
  const tr = T.totalReturn([['2024-01-02', 100], ['2024-01-03', 98], ['2024-01-04', 99]], [{ date: '2024-01-03', amount: 2 }]);
  near(tr[1][1], 100, 1e-9);           // 98 + 2 de dividende : rien perdu
  near(tr[2][1], 100 * 99 / 98, 1e-9);
  const g = T.grossUp([['2024-01-01', 100], ['2025-01-01', 100]], 0.5);
  near(g[1][1], 100 * Math.pow(1.005, 366 / 365.25), 1e-9);
  assert.equal(T.grossUp(g, 0), g);
  const c = T.convert([['2024-01-01', 10]], () => 0.9);
  near(c[0][1], 9, 1e-12);
});

test('écart de suivi : pente du rapport robuste au bruit des clôtures, années complètes et verdict face aux frais', () => {
  const T = loadApp({}).get('TrackDiff');
  // indice +8 %/an ; ETF qui perd 0,3 point par an, avec ±0,5 % de bruit de clôture chaque jour
  const idx = daily('2020-12-31', '2024-06-28', 0.08, 0.005, 11);
  const etf = idx.map(([d, v]) => [d, v * Math.pow(0.997, (Date.parse(d) - Date.parse('2020-12-31')) / (365.25 * 864e5)) * (1 + 0.005 * Math.sin(Date.parse(d) / 864e5))]);
  const S = T.summary(etf, idx);
  assert.deepEqual(JSON.parse(JSON.stringify(S.years.map(y => y.year + (y.full ? '' : 'p')))), ['2021', '2022', '2023', '2024p']);
  assert.equal(S.fullYears, 3);
  near(S.avg, -0.003, 0.0015);
  near(S.ann, -0.003, 0.0006);
  assert.ok(S.margin > 0 && S.margin < 0.003);
  for (const y of S.years) near(y.a - y.b, -0.003, 0.02); // performances de l'année : comparables à l'écart
  assert.equal(T.verdict(-0.0035, 0.38).key, 'inline');
  assert.equal(T.verdict(0.001, 0.38).key, 'better');
  assert.equal(T.verdict(-0.01, 0.2).key, 'worse');
  assert.equal(T.verdict(NaN, 0.2), null);
  assert.equal(T.verdict(-0.002, NaN).key, 'unknown');
  assert.equal(T.slope([['2024-01-01', 1, 1]]).rate, NaN);
});
