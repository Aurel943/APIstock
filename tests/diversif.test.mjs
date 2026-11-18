import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('diversification : corrélation pondérée, paris indépendants, glissement et alerte', () => {
  const D = loadApp({}).get('Diversif');
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  // 2 lignes identiques : corrélation 1, un seul pari ; 2 lignes indépendantes de même risque : ≈ 0 et ≈ 2 paris
  const same = Array.from({ length: 200 }, () => { const x = rnd() * 0.04; return [x, x]; });
  const r1 = D.window(same, [0.5, 0.5]);
  near(r1.corr, 1, 1e-9); near(r1.bets, 1, 1e-9);
  const indep = Array.from({ length: 4000 }, () => [rnd() * 0.04, rnd() * 0.04]);
  const r2 = D.window(indep, [0.5, 0.5]);
  near(r2.corr, 0, 0.05); near(r2.bets, 2, 0.1);
  // régime : indépendantes puis liées → la fin est « haute »
  const rows = [], weeks = [];
  for (let i = 0; i < 260; i++) { const c = rnd() * 0.04; rows.push(i < 200 ? [rnd() * 0.04, rnd() * 0.04] : [c, c + rnd() * 0.004]); weeks.push(new Date(Date.UTC(2021, 0, 8) + i * 7 * 864e5).toISOString().slice(0, 10)); }
  const roll = D.rolling({ returns: rows, weeks }, [0.5, 0.5], 52, 2);
  assert.equal(roll[roll.length - 1].date, weeks[weeks.length - 1]);
  assert.ok(roll.every((p, i) => i === 0 || p.date > roll[i - 1].date));
  const S = D.status(roll);
  assert.equal(S.level, 'haute');
  assert.ok(S.now > 0.8 && S.median < 0.3);
  near(D.quantile([1, 2, 3, 4], 0.5), 2.5, 1e-12);
});
