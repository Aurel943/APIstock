import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/** Séries hebdomadaires (un cours par vendredi) construites à partir de rendements donnés */
function series(rets, start = Date.UTC(2023, 0, 6)) {
  let v = 100;
  const out = [[new Date(start).toISOString().slice(0, 10), v]];
  rets.forEach((r, i) => { v *= 1 + r; out.push([new Date(start + (i + 1) * 7 * 864e5).toISOString().slice(0, 10), v]); });
  return out;
}

test('styles : une ligne construite comme marché + 0,5 × value − 0,3 × petites capitalisations est bien reconnue', () => {
  const a = loadApp({});
  const S = a.get('Styles');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const n = 150;
  const mkt = [], usd = [], val = [], size = [], mom = [], qual = [], low = [], line = [], flat = [];
  for (let i = 0; i < n; i++) {
    const m = rnd() * 0.04, u = m + rnd() * 0.01;
    const fv = rnd() * 0.02, fs = rnd() * 0.02, fm = rnd() * 0.02, fq = rnd() * 0.02, fl = rnd() * 0.02;
    mkt.push(m); usd.push(u);
    val.push(u + fv); size.push(u + fs); mom.push(u + fm); qual.push(u + fq); low.push(u + fl);
    line.push(m + 0.5 * fv - 0.3 * fs + rnd() * 0.001);
    flat.push(m);
  }
  const fit = S.fit({ lines: { tilt: series(line), world: series(flat) }, market: series(mkt), marketUsd: series(usd),
    factors: { value: series(val), size: series(size), momentum: series(mom), quality: series(qual), lowvol: series(low) } });
  assert.ok(fit && fit.weeks.length === n);
  const b = fit.betas.tilt;
  near(b.market, 1, 0.03); near(b.value, 0.5, 0.05); near(b.size, -0.3, 0.05);
  near(b.momentum, 0, 0.05); near(b.quality, 0, 0.05); near(b.lowvol, 0, 0.05);
  assert.ok(b.r2 > 0.95);
  near(fit.betas.world.value, 0, 0.01);
  const p = S.portfolio(fit.betas, { tilt: 300, world: 100 });
  near(p.value, 0.75 * b.value + 0.25 * fit.betas.world.value, 1e-9);
  assert.equal(S.level(0.05), 'neutre'); assert.equal(S.level(-0.2), 'légère'); assert.equal(S.level(0.6), 'marquée');
  assert.match(S.sentence({ value: 0.4, size: -0.15, momentum: 0 }), /bon marché \(value\) \(marquée\) et les géants de la cote \(légère\)/);
  assert.match(S.sentence({ value: 0.02 }), /aucun penchant/);
  // pas assez d'historique : rien
  assert.equal(S.fit({ lines: { x: series(line.slice(0, 20)) }, market: series(mkt.slice(0, 20)), marketUsd: series(usd.slice(0, 20)), factors: {} }), null);
});
