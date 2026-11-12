import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('catalogue : ETF d\'une zone du moins cher au plus cher, filtre PEA, sans fonds américains', () => {
  const { get } = loadApp({});
  const Catalog = get('Catalog');
  const world = JSON.parse(JSON.stringify(Catalog.list('world')));
  assert.ok(world.length >= 5);
  assert.ok(world.every((e, i) => i === 0 || world[i - 1].ter <= e.ter), 'trié par frais');
  assert.ok(!world.some(e => e.symbol === 'URTH'), 'pas de fonds américain');
  const pea = JSON.parse(JSON.stringify(Catalog.list('world', { pea: true })));
  assert.ok(pea.length >= 2 && pea.every(e => e.pea));
  assert.equal(pea[0].symbol, 'DCAM');            // 0,20 %, le moins cher éligible PEA
});

test('portefeuille type : l\'ETF le moins cher par zone, report sur PEA quand une zone n\'y existe pas', () => {
  const { get } = loadApp({});
  const Catalog = get('Catalog'), models = get('MODEL_PORTFOLIOS');
  const b = Catalog.build(models.find(m => m.id === 'world-em'));
  same(b.lines.map(l => [l.zone, l.weight]), [['world', 88], ['em', 12]]);
  const p = Catalog.build(models.find(m => m.id === 'world-em'), { pea: true });
  assert.ok(p.lines.every(l => l.pea));
  near(p.lines.reduce((s, l) => s + l.weight, 0), 100);
  // or : aucun ETF éligible PEA → les 10 % sont répartis sur le reste
  const g = Catalog.build(models.find(m => m.id === 'world-gold'), { pea: true });
  assert.equal(g.dropped, 10);
  same(g.lines.map(l => [l.zone, l.weight]), [['world', 100]]);
  assert.ok(g.ter > 0 && g.ter < 1);
});

test('indicateurs : moyennes mobiles, baisse depuis le plus haut, tendance', () => {
  const { Portfolio } = loadApp({});
  same(Portfolio.movingAverage([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  // 300 séances en hausse régulière puis une baisse de 10 %
  const series = Array.from({ length: 300 }, (_, i) => [`d${i}`, 100 + i]);
  series.push(['fin', 399 * 0.9]);
  const ind = Portfolio.indicators(series);
  near(ind.fromHigh, -10, 1e-9);
  assert.equal(ind.trend, 'up');                  // MM50 encore au-dessus de la MM200
  assert.equal(ind.ma200.filter(v => v !== null).length, 102);
  assert.equal(Portfolio.indicators(series.slice(0, 120)).trend, null, 'pas assez d\'historique pour la MM200');
});
