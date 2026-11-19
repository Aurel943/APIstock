/* Nouveautés : stockage (cache, quota), chargement à la demande, courbe d'évolution, enveloppes, dérive, jalons, accueil */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadApp, root } from './harness.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const read = f => readFileSync(join(root, f), 'utf8');

/* ---------------- stockage ---------------- */

test('cache : sans IndexedDB, les historiques restent dans le localStorage (comportement d\'avant)', () => {
  const app = loadApp({});
  const Cache = app.get('Cache');
  assert.equal(Cache.mem, null);
  Cache.setItem('apistock:daily:X', '{"ts":1}');
  assert.equal(app.ctx.localStorage.getItem('apistock:daily:X'), '{"ts":1}');
  assert.equal(Cache.getItem('apistock:daily:X'), '{"ts":1}');
  assert.equal(JSON.stringify(Cache.keys('apistock:daily:')), '["apistock:daily:X"]');
  assert.equal(Cache.clear(), 1);
  assert.equal(Cache.getItem('apistock:daily:X'), null);
});

test('cache : en mémoire (IndexedDB chargé), migration des anciens historiques du localStorage', () => {
  const app = loadApp({});
  const Cache = app.get('Cache');
  const ls = app.ctx.localStorage;
  ls.setItem('apistock:daily:CW8@XPAR', '{"old":1}');
  ls.setItem('apistock:events:SPY', '{"e":1}');
  ls.setItem('apistock:quotes', '{}');
  const puts = [];
  Cache.db = { transaction: () => ({ objectStore: () => ({ put: (v, k) => puts.push([k, v]), delete: () => {} }) }) };
  Cache.mem = new Map([['apistock:daily:CW8@XPAR', '{"stale":1}']]);
  Cache.migrate();
  assert.equal(ls.getItem('apistock:daily:CW8@XPAR'), null, 'retiré du localStorage');
  assert.equal(ls.getItem('apistock:quotes'), '{}', 'les autres clés ne bougent pas');
  assert.equal(Cache.getItem('apistock:daily:CW8@XPAR'), '{"old":1}', 'la copie du localStorage, plus récente, l\'emporte');
  assert.equal(Cache.getItem('apistock:events:SPY'), '{"e":1}');
  assert.equal(puts.length, 2);
});

test('stockage plein : les caches sont effacés pour enregistrer tes données, sinon un message clair', () => {
  const app = loadApp({ transactions: [] });
  const ls = app.ctx.localStorage;
  ls.setItem('apistock:fundamentals', 'x'.repeat(100));
  ls.setItem('apistock:daily:A', 'y');
  const real = ls.setItem;
  let full = true;
  ls.setItem = (k, v) => { if (full && k === 'apistock:v1') { const e = new Error('plein'); e.name = 'QuotaExceededError'; full = ls.getItem('apistock:fundamentals') !== null; if (full) throw e; } real(k, v); };
  app.Store.state.transactions.push({ id: 'n', key: 'A@B', type: 'buy', date: '2026-01-02', qty: 1, price: 1 });
  app.Store.save();
  assert.equal(app.Store.saveFailed, false);
  assert.equal(ls.getItem('apistock:fundamentals'), null, 'cache effacé');
  assert.match(ls.getItem('apistock:v1'), /"id":"n"/);
  assert.equal(app.get('isQuotaError')({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(app.get('isQuotaError')(new Error('autre')), false);
});

/* ---------------- chargement à la demande ---------------- */

test('chargement à la demande : modules absents de la page, présents hors ligne, méthodes appelées d\'ailleurs remplacées', () => {
  const app = loadApp({});
  const LAZY = app.get('LAZY');
  const html = read('index.html'), sw = read('sw.js'), harness = read('tests/harness.mjs');
  const lazyFiles = new Set(Object.values(LAZY).flatMap(m => m.files));
  for (const f of lazyFiles) {
    assert.ok(!html.includes(`src="${f}`), `${f} ne doit plus être chargé au démarrage`);
    assert.ok(sw.includes(`'${f}'`), `${f} doit rester dans le cache hors ligne`);
    assert.ok(harness.includes(`'${f}'`), `${f} doit être testé`);
  }
  // sondes et méthodes de remplacement : bien définies par leur module
  for (const [name, m] of Object.entries(LAZY)) {
    const src = m.files.map(read).join('\n');
    for (const meth of [m.probe, m.bind, ...(m.stubs || [])].filter(Boolean)) {
      assert.match(src, new RegExp(`^  (async )?${meth}\\(`, 'm'), `${name} : ${meth} introuvable`);
    }
    for (const d of m.deps || []) assert.ok(LAZY[d], `${name} : dépendance ${d} inconnue`);
  }
  // toute méthode d'un module différé appelée depuis un module chargé au démarrage doit avoir un remplaçant
  const own = new Map();
  for (const [name, m] of Object.entries(LAZY)) for (const f of m.files) for (const x of read(f).matchAll(/^ {2}(?:async )?([a-zA-Z_]\w*)\s*\(/gm)) if (typeof app.App[x[1]] === 'function') own.set(x[1], name);
  const eager = Array.from(html.matchAll(/src="(js\/[^"?]+\.js)/g), x => x[1]);
  for (const f of eager) {
    const src = read(f);
    for (const [meth, name] of own) {
      if (!new RegExp(`\\b(?:this|App|A)\\.${meth}\\b`).test(src)) continue;
      const m = LAZY[name];
      // les écouteurs internes au module et le chargeur lui-même ne comptent pas
      if (f === 'js/lazy.js' || f === 'js/app.js' && meth === m.bind) continue;
      assert.ok((m.stubs || []).includes(meth) || meth === m.probe, `${f} appelle ${meth} (${name}) : à ajouter aux « stubs » de LAZY`);
    }
  }
});

test('chargement à la demande : les éléments utilisés par un module sont sur ses pages', () => {
  const app = loadApp({});
  const LAZY = app.get('LAZY');
  const html = read('index.html');
  // page de chaque identifiant : sous-onglet de la carte qui le contient (data-sub) dans l'espace (section)
  const pageOf = id => {
    const at = html.indexOf(`id="${id}"`);
    if (at < 0) return null;
    const before = html.slice(0, at);
    const sec = before.lastIndexOf('<section id="view-');
    const main = before.lastIndexOf('</main>');
    if (sec < 0 || main > sec) return 'hors-page';
    const view = before.slice(sec).match(/view-([a-z]+)/)[1];
    const subs = Array.from(before.slice(sec).matchAll(/\n {6}<div[^>]*data-sub="([^"]+)"/g));
    return view === 'settings' ? 'settings' : view + '/' + (subs.length ? subs[subs.length - 1][1].split(' ')[0] : '');
  };
  for (const [name, m] of Object.entries(LAZY)) {
    const src = m.files.map(f => read(f)).join('\n');
    // éléments auxquels le module branche un écouteur au chargement : ils doivent être sur ses pages
    const ids = new Set(Array.from(src.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)\.(?:addEventListener|onclick|onchange|oninput)/g), x => x[1]));
    for (const id of ids) {
      const p = pageOf(id);
      if (!p || p === 'hors-page') { if (p === 'hors-page') assert.ok(Object.keys(m.triggers || {}).includes('#' + id) || name === 'terminal', `${name} : #${id} hors des pages sans déclencheur`); continue; }
      const ok = m.pages.includes(p) || m.pages.includes(p.split('/')[0]) || (LAZY[name].deps || []).some(d => LAZY[d].pages.includes(p));
      assert.ok(ok, `${name} : #${id} est sur ${p}, absent de ses pages (${m.pages.join(', ')})`);
    }
  }
});

/* ---------------- courbe d'évolution ---------------- */

const pts = [
  { date: '2025-01-02', value: 1000, invested: 1000, flow: 1000 },
  { date: '2025-06-02', value: 1100, invested: 1000, flow: 0 },
  { date: '2025-11-03', value: 2100, invested: 2000, flow: 1000 },
  { date: '2026-01-05', value: 2310, invested: 2000, flow: 0 },
  { date: '2026-11-18', value: 2541, invested: 2000, flow: 0 },
];

test('évolution : début de période, point de base, performance hors versements', () => {
  const E = loadApp({}).get('Evolution');
  assert.equal(E.start('MAX', '2025-01-02', '2026-11-19'), '2025-01-02');
  assert.equal(E.start('YTD', '2025-01-02', '2026-11-19'), '2026-01-01');
  assert.equal(E.start('1A', '2025-01-02', '2026-11-19'), '2025-11-19');
  assert.equal(E.start('3A', '2025-01-02', '2026-11-19'), '2025-01-02', 'pas avant le début de l\'historique');
  assert.equal(E.startIndex(pts, '2026-01-01'), 2, 'dernier point avant la date : la base de la période');
  const p = E.perf(pts);
  near(p[0], 0); near(p[1], 10); near(p[2], 10, 1e-9); // le versement de 1 000 € n'est pas un gain
  near(p[4], (1.1 * (2310 / 2100) * (2541 / 2310) - 1) * 100);
  const s = E.summary(pts.slice(2));
  near(s.gain, 441); near(s.flows, 0);
  const b = E.benchPerf(pts, [['2024-12-31', 100], ['2025-06-01', 110], ['2026-11-18', 121]]);
  near(b[0], 0); near(b[1], 10); near(b[4], 21);
});

test('évolution : opérations placées sur la courbe (achats, ventes, dividendes de la période)', () => {
  const app = loadApp({});
  const E = app.get('Evolution');
  const txs = [{ type: 'buy', key: 'A', date: '2025-01-02', qty: 2, price: 500 }, { type: 'sell', key: 'A', date: '2025-11-01', qty: 1, price: 600 },
    { type: 'div', key: 'A', date: '2026-02-10', qty: 1, price: 5 }, { type: 'split', key: 'A', date: '2026-03-01', qty: 2 }, { type: 'buy', key: 'A', date: '2024-01-01', qty: 1, price: 1 }];
  const m = E.markers(pts, txs, k => 'Ligne ' + k);
  assert.equal(JSON.stringify(m.map(x => [x.kind, x.i])), JSON.stringify([['buy', 0], ['sell', 2], ['div', 4]]));
  assert.match(m[0].text, /Achat · Ligne A · 2 part\(s\)/);
});

/* ---------------- enveloppes ---------------- */

test('prochain euro : précaution, puis PEA jusqu\'au plafond, puis assurance-vie ; PER selon la tranche', () => {
  const app = loadApp({});
  const Env = app.get('Envelopes');
  const base = { tmi: '', precautionGap: 3000, livretRoom: 10000, pea: { exists: true, deposits: 148000, cap: 150000, five: '2020-01-01' }, av: { exists: true, eight: '2030-01-01' }, per: { exists: false }, today: '2026-11-19' };
  let r = Env.plan(Object.assign({}, base, { amount: 10000 }));
  const put = id => r.steps.find(s => s.id === id).put;
  assert.equal(put('safety'), 3000);
  assert.equal(put('pea'), 2000, 'place restante sous le plafond');
  assert.equal(put('av'), 5000, 'le reste');
  assert.equal(r.left, 0);
  assert.ok(!r.steps.some(s => s.id === 'per'), 'tranche inconnue : pas d\'avis sur le PER');
  // livrets presque pleins : la précaution est limitée par les plafonds
  r = Env.plan(Object.assign({}, base, { amount: 10000, livretRoom: 1000 }));
  assert.equal(put('safety'), 1000);
  // précaution complète, pas de PEA : on conseille d'en ouvrir un et tout y va
  r = Env.plan(Object.assign({}, base, { amount: 4000, precautionGap: 0, pea: { exists: false, cap: 150000 }, tmi: 41 }));
  assert.equal(r.steps.find(s => s.id === 'safety').status, 'ok');
  assert.equal(put('pea'), 4000);
  assert.equal(r.steps.find(s => s.id === 'per').status, 'info');
  assert.match(r.steps.find(s => s.id === 'per').why, /410/);
  // tranche à 11 % : PER déconseillé ; budget non renseigné
  r = Env.plan(Object.assign({}, base, { amount: 0, precautionGap: NaN, tmi: 11 }));
  assert.equal(r.steps.find(s => s.id === 'per').status, 'skip');
  assert.equal(r.steps.find(s => s.id === 'safety').status, 'info');
  assert.equal(r.steps[r.steps.length - 1].id, 'cto', 'compte-titres en dernier');
});

/* ---------------- dérive d'allocation ---------------- */

test('dérive : cours à partir duquel une ligne s\'écarte de sa cible du seuil choisi', () => {
  const Drift = loadApp({}).get('Drift');
  const lines = [{ key: 'A', qty: 10, value: 600, target: 60 }, { key: 'B', qty: 4, value: 400, target: 40 }];
  const fx = k => (k === 'B' ? 0.5 : 1); // B coté dans une devise qui vaut 0,5 €
  const bands = Drift.bands(lines, 5, fx);
  const a = bands.find(b => b.key === 'A' && b.dir === 'up');
  // à ce cours, A pèse 65 % (les autres lignes inchangées)
  near((10 * a.price) / (10 * a.price + 400), 0.65);
  const bd = bands.find(b => b.key === 'B' && b.dir === 'down');
  near((4 * bd.price * 0.5) / (4 * bd.price * 0.5 + 600), 0.35);
  assert.equal(Drift.bands(lines, 0).length, 0, 'seuil nul : pas d\'alerte');
  assert.equal(Drift.bands([{ key: 'A', qty: 1, value: 100, target: 100 }], 5).length, 0, 'une seule ligne : pas de dérive possible');
});

/* ---------------- jalons ---------------- */

test('jalons : premier achat, paliers, record de gains, caps fiscaux à venir', () => {
  const M = loadApp({}).get('Milestones');
  const points = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, invested: 5000, value: 5000 + i * 50 }));
  points[29].value = 6000; // dernier jour : sous le record de la veille
  const R = M.compute({ points, today: '2026-02-15', txs: [{ type: 'buy', key: 'CW8', date: '2026-01-01', qty: 1, price: 5000 }],
    accounts: [{ id: 'pea', name: 'PEA', type: 'pea' }], envelope: () => ({ id: 'pea5', date: '2031-01-01', what: 'cap des 5 ans', sub: 'exonération' }) });
  const ids = R.done.map(x => x.id);
  assert.ok(ids.includes('first-buy'));
  assert.ok(ids.includes('value-5000'));
  assert.ok(ids.includes('gain-1000'));
  assert.ok(!ids.includes('value-10000'));
  assert.ok(ids.some(id => id.startsWith('ath-')));
  const nv = R.next.find(x => x.id === 'next-value');
  assert.match(nv.title, /10\s000/);
  near(nv.progress, (6000 - 5000) / 5000);
  assert.ok(R.next.some(x => x.id === 'pea5-pea'));
  assert.ok(R.next.some(x => x.id === 'back-ath'));
  assert.deepEqual(R.done.map(x => x.date), R.done.map(x => x.date).slice().sort().reverse(), 'du plus récent au plus ancien');
});

/* ---------------- accueil ---------------- */

test('accueil : ordre des cartes (nouvelles cartes à la suite), mini-courbe des 30 derniers jours', () => {
  const Home = loadApp({}).get('Home');
  assert.deepEqual(Home.orderOf(['a', 'b', 'c', 'd'], ['c', 'x', 'a']), ['c', 'a', 'b', 'd']);
  const points = [{ date: '2026-09-01', value: 100, invested: 100 }, { date: '2026-10-20', value: 110, invested: 100 },
    { date: '2026-11-01', value: 1210, invested: 1200, flow: 1100 }, { date: '2026-11-18', value: 1331, invested: 1200, flow: 0 }];
  const s = Home.spark(points, '2026-11-19');
  assert.equal(s.from, '2026-10-20');
  near(s.pct, 10); // versement de 1 100 € exclu (0 %), puis +10 %
  assert.equal(Home.spark(points.slice(0, 2), '2026-11-19'), null);
});
