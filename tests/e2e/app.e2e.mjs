/*
 * Tests de bout en bout (navigateur Chromium via Playwright) : `npm run test:e2e`.
 * Site servi en local, relais Yahoo simulé avec les réponses de tests/fixtures/relay/ : aucun appel réseau réel.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openApp, sampleState, realCharts } from './helpers.mjs';

const VIEWS = ['portfolio', 'markets', 'agenda', 'catalog', 'compare', 'world', 'invest', 'simulation', 'settings'];
let server, url, browser;

before(async () => { ({ server, url } = await startServer()); browser = await chromium.launch(); });
after(async () => { await browser.close(); server.close(); });

/** Ouvre le site, exécute le scénario, puis vérifie : aucune erreur JavaScript, aucune requête réseau externe */
async function run(opts, fn) {
  const app = await openApp(browser, url, opts);
  try {
    await fn(app);
    assert.deepEqual(app.errors, [], 'erreurs JavaScript');
    assert.deepEqual(app.blocked, [], 'requêtes vers l\'extérieur');
  } finally { await app.context.close(); }
}
const state = page => page.evaluate(() => JSON.parse(JSON.stringify(Store.state)));
const monthStart = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 8) + '01'; };

test('ajout, modification et suppression d\'une opération, avec « Annuler »', () => run({ state: sampleState() }, async ({ page }) => {
  await page.click('#addTxBtn');
  await page.locator('#txInstrument button', { hasText: 'BNP Paribas Easy S&P 500' }).click();
  await page.selectOption('#txAccount', 'pea');
  await page.fill('#txDate', '2025-05-12');
  await page.fill('#txQty', '7');
  await page.fill('#txPrice', '26.5');
  await page.fill('#txNote', 'test e2e');
  await page.click('#txSave');
  let s = await state(page);
  const tx = s.transactions.find(t => t.note === 'test e2e');
  assert.ok(tx, 'opération ajoutée');
  assert.equal(tx.qty, 7);

  // modification depuis le tableau des opérations (sous-onglet « Opérations » du portefeuille)
  await page.click('#pfSubnav [data-tab=operations]');
  const row = page.locator('#txTable tbody tr', { hasText: 'test e2e' });
  await row.locator('button[title=Modifier]').click();
  assert.equal(await page.inputValue('#txQty'), '7');
  await page.fill('#txQty', '8');
  await page.click('#txSave');
  s = await state(page);
  assert.equal(s.transactions.find(t => t.id === tx.id).qty, 8);

  // suppression puis « Annuler »
  await page.locator('#txTable tbody tr', { hasText: 'test e2e' }).locator('button[title=Supprimer]').click();
  s = await state(page);
  assert.ok(!s.transactions.some(t => t.id === tx.id));
  assert.ok(s.deleted[tx.id] > 0);
  await page.click('#toast .toast-action');
  s = await state(page);
  assert.ok(s.transactions.some(t => t.id === tx.id));
  assert.equal(s.deleted[tx.id], undefined);
  assert.equal(await page.locator('#txTable tbody tr', { hasText: 'test e2e' }).count(), 1);
}));

test('division : le nombre de parts est multiplié, le prix de revient total ne change pas', () => run({ state: sampleState() }, async ({ page }) => {
  const before = await page.evaluate(() => Portfolio.positions('pea').find(p => p.key === 'CW8@XPAR'));
  await page.click('#addTxBtn');
  await page.locator('#txInstrument button', { hasText: 'Amundi MSCI World' }).click();
  await page.selectOption('#txType', 'split');
  await page.selectOption('#txAccount', 'pea');
  await page.fill('#txDate', '2025-06-02');
  await page.fill('#txQty', '1:10');
  assert.match(await page.inputValue('#txTotal'), /5 → 50 parts/);
  await page.click('#txSave');
  const afterSplit = await page.evaluate(() => Portfolio.positions('pea').find(p => p.key === 'CW8@XPAR'));
  assert.equal(afterSplit.qty, before.qty * 10);
  assert.ok(Math.abs(afterSplit.cost - before.cost) < 1e-6);
  assert.equal(await page.locator('#txTable .chip.split', { hasText: 'Division' }).count(), 1);
}));

test('versement programmé confirmé depuis « À faire »', () => run({ state: sampleState({
  plans: [{ id: 'p1', key: 'CW8@XPAR', account: 'pea', amount: 1500, day: 5, start: monthStart(-1), fractional: false, active: true, done: {} }],
}) }, async ({ page }) => {
  // deux échéances : une ligne récapitulative, le détail se déplie
  await page.locator('#todoList .todo-item', { hasText: 'versements programmés à enregistrer' }).locator('button', { hasText: 'Détail' }).click();
  const item = page.locator('#todoList .todo-item.plan', { hasText: 'Versement programmé · Amundi MSCI World' }).first();
  await item.waitFor();
  await item.locator('button', { hasText: 'Enregistrer…' }).click();
  await page.waitForSelector('#txDialog[open]');
  assert.equal(await page.inputValue('#txDate'), monthStart(-1).slice(0, 8) + '05');
  assert.ok(+(await page.inputValue('#txQty')) >= 1, 'quantité calculée à partir du montant');
  assert.ok(+(await page.inputValue('#txPrice')) > 0, 'cours de clôture pré-rempli');
  await page.click('#txSave');
  const s = await state(page);
  const plan = s.plans[0];
  const doneId = plan.done[monthStart(-1).slice(0, 7)];
  assert.ok(s.transactions.some(t => t.id === doneId && t.note.startsWith('Versement programmé')));
  assert.equal(await page.locator('#todoList .todo-item.plan', { hasText: 'Versement programmé · Amundi MSCI World' }).count(), 1); // reste l'échéance de ce mois
}));

test('mouvement d\'espèces : le solde du compte apparaît', () => run({ state: sampleState() }, async ({ page }) => {
  await page.click('#pfSubnav [data-tab=operations]');
  await page.click('#cashAdd');
  await page.selectOption('#cashAcc', 'pea');
  await page.fill('#cashDate', '2024-01-02');
  await page.fill('#cashAmount', '5000');
  await page.click('#cashForm button[type=submit]');
  await page.click('#pfSubnav [data-tab=synthese]');
  await page.waitForSelector('#cashCard:not(.hidden)');
  const s = await state(page);
  assert.equal(s.cashMoves.length, 1);
  const cash = await page.evaluate(() => Portfolio.cashBalance('pea').cash);
  assert.ok(Math.abs(cash - (5000 - (5 * 430 + 2) - (100 * 24.5 + 1))) < 0.01);
  assert.match(await page.locator('#kpis').innerText(), /Liquidités/i);
}));

test('recherche par ISIN dans l\'onglet Marchés', () => run({ state: sampleState() }, async ({ page, calls }) => {
  await page.click('.tab[data-view=markets]');
  const input = page.locator('#marketSearch input[type=search]');
  await input.fill('FR0010315770');
  await input.press('Enter');
  const item = page.locator('#marketSearch .picker-item', { hasText: 'WLD' }).first();
  await item.waitFor();
  assert.match(await item.innerText(), /FR0010315770/);
  await item.click();
  const s = await state(page);
  const key = s.watchlist.find(k => k.startsWith('WLD@'));
  assert.ok(key, 'ajouté à la liste de suivi');
  assert.equal(s.instruments[key].isin, 'FR0010315770');
  assert.ok(calls.some(c => c.type === 'search' && c.q === 'FR0010315770'));
}));

test('rapport annuel généré dans une nouvelle fenêtre', () => run({ state: sampleState() }, async ({ page, context }) => {
  await page.click('#pfSubnav [data-tab=operations]');
  await page.click('#reportBtn');
  await page.selectOption('#reportYear', '2025');
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#reportForm button[type=submit]')]);
  popup.on('dialog', d => d.dismiss());
  await popup.waitForFunction(() => /Rapport annuel 2025/.test(document.body.innerText), null, { timeout: 15000 });
  const text = await popup.evaluate(() => document.body.innerText);
  assert.match(text, /Plus-values réalisées/i);
  assert.match(text, /Cessions/i);
  assert.match(text, /prélèvement forfaitaire unique de 31,4 %/i);
  await popup.close();
}));

for (const [label, device] of [['bureau', null], ['iPhone', 'iPhone 13']]) {
  test(`aucune erreur JavaScript sur chaque onglet (${label}, thèmes clair et sombre)`, async () => {
    for (const theme of ['light', 'dark']) {
      await run({ state: sampleState(), device, theme }, async ({ page }) => {
        for (const v of VIEWS) {
          await page.evaluate(v => App.show(v), v);
          await page.waitForTimeout(150);
          assert.ok(await page.locator('#view-' + v).isVisible(), 'onglet ' + v + ' affiché');
        }
      });
    }
  });
}

test('affichage mobile : aucun défilement horizontal, quel que soit l\'onglet', () => run({ state: sampleState({ assets: [{ id: 'a', type: 'immo', name: 'Appartement', value: 250000, debt: 100000, date: '2025-01-01' }] }), device: 'iPhone 13' }, async ({ page }) => {
  await page.waitForTimeout(800);
  for (const v of VIEWS) {
    await page.evaluate(v => { App.show(v); window.scrollTo(0, 0); }, v);
    await page.waitForTimeout(200);
    // ni défilement de la page, ni contenu coupé par overflow-x: hidden (les tableaux défilent dans leur cadre .table-wrap)
    const over = await page.evaluate(() => {
      const W = window.innerWidth;
      const cut = [...document.querySelectorAll('.view.active *')].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > W + 1 && !e.closest('.table-wrap, .seg, .quick-assets, .tl-track, canvas');
      }).map(e => e.tagName.toLowerCase() + '.' + e.className).slice(0, 3);
      return { doc: document.documentElement.scrollWidth - W, cut };
    });
    assert.ok(over.doc <= 0 && !over.cut.length, `onglet ${v} : ${JSON.stringify(over)}`);
  }
  assert.ok(await page.locator('#bottomNav').isVisible(), 'barre de navigation basse');
}));

test('import d\'avis d\'opéré PDF : aperçu, import sur le PEA, réimport ignoré', () => run({ state: sampleState() }, async ({ page }) => {
  await page.evaluate(() => {
    Store.instrument('ESE@XPAR').isin = 'FR0011550193';
    // lecture du PDF simulée (pdf.js vient d'un CDN, bloqué dans les tests) : texte d'un avis Boursorama fictif
    Avis.lines = async file => ['OPERATION DE BOURSE', 'Références de votre compte titres', '00000 00000 00000000000   Compte PEA', 'ACHAT COMPTANT   000000',
      `27/10/2026   ${file.name.match(/\d+/)[0]}   BNP PAR.EASY STOX.EU.600 U.ETF   Référence :   0101000${file.name.match(/\d+/)[0]}`,
      'Code ISIN :   FR0011550193   Cours exécuté :   21,155 EUR', 'Lieu d\'exécution :   EURONEXT PARIS',
      'Montant brut   Commission   Frais (¨)   Montant net au débit de votre compte', '359,64 EUR   1,80 EUR   361,44 EUR'];
  });
  const files = [17, 3].map(n => ({ name: `avis-${n}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }));
  await page.click('#addTxBtn');
  await page.setInputFiles('#txAvis input', files);
  await page.waitForSelector('#csvDialog[open] #csvPreview tbody tr');
  assert.equal(await page.locator('#csvPreview tbody tr').count(), 2);
  assert.match(await page.textContent('#csvSummary'), /2 opération\(s\) à importer/);
  await page.click('#csvOk');
  const s = await state(page);
  const imported = s.transactions.filter(t => t.ref);
  assert.deepEqual(imported.map(t => [t.key, t.account, t.qty, t.price, t.fees, t.date]).sort(),
    [['ESE@XPAR', 'pea', 17, 21.155, 1.8, '2026-10-27'], ['ESE@XPAR', 'pea', 3, 21.155, 1.8, '2026-10-27']]);
  // mêmes avis sélectionnés à nouveau : rien n'est ajouté
  await page.setInputFiles('#txCount ~ label input.avisImport', files);
  await page.waitForFunction(() => /déjà enregistrés/.test(document.querySelector('#toast').textContent));
  assert.equal((await state(page)).transactions.length, s.transactions.length);
}));

test('portefeuille en sous-onglets et bulles d\'information', () => run({ state: sampleState() }, async ({ page }) => {
  assert.ok(await page.locator('#positionsTable').isVisible(), 'positions visibles dans la synthèse');
  assert.ok(!(await page.locator('#txTable').isVisible()), 'opérations masquées dans la synthèse');
  await page.click('#pfSubnav [data-tab=operations]');
  assert.ok(await page.locator('#txTable').isVisible(), 'opérations visibles dans leur sous-onglet');
  assert.ok(!(await page.locator('#positionsTable').isVisible()));
  assert.equal(await page.evaluate(() => localStorage.getItem('apistock:pfTab')), 'operations', 'sous-onglet mémorisé');
  // bulle « i » : s'ouvre au clic, se ferme au clic ailleurs
  await page.click('#pfSubnav [data-tab=synthese]');
  await page.locator('#view-portfolio .info:visible').first().click();
  assert.equal(await page.locator('.info-bubble').count(), 1);
  assert.ok((await page.locator('.info-bubble').innerText()).length > 10);
  await page.click('#kpis');
  assert.equal(await page.locator('.info-bubble').count(), 0);
}));

test('placement à valeur saisie : création, achat, mise à jour de la valeur', () => run({ state: sampleState() }, async ({ page }) => {
  await page.click('#addTxBtn');
  await page.click('#txInstrument .picker-manual');
  await page.fill('#manualName', 'GS Luxury Leaders 2038');
  await page.fill('#manualPrice', '1000');
  await page.fill('#manualDate', '2026-01-15');
  await page.click('#manualForm button[type=submit]');
  await page.selectOption('#txAccount', 'cto');
  await page.fill('#txDate', '2026-01-15');
  await page.fill('#txQty', '3');
  await page.fill('#txPrice', '1000');
  await page.click('#txSave');
  const key = await page.evaluate(() => Object.keys(Store.state.instruments).find(k => Store.instrument(k).provider === 'manual'));
  assert.ok(key, 'instrument créé');
  await page.waitForFunction(k => { const p = Portfolio.snapshot().rows.find(r => r.key === k); return p && Math.abs(p.valueBase - 3000) < 0.01; }, key);
  // mise à jour depuis la fiche (onglet Marchés)
  await page.evaluate(k => { App.show('markets'); App.selectDetail(k); }, key);
  await page.waitForSelector('#detailManual form');
  await page.fill('#detailManual input[type=date]', '2026-04-15');
  await page.fill('#detailManual input[type=number]', '1100');
  await page.click('#detailManual button[type=submit]');
  await page.waitForFunction(k => { const p = Portfolio.snapshot().rows.find(r => r.key === k); return p && Math.abs(p.valueBase - 3300) < 0.01; }, key);
  assert.equal(await page.locator('#detailManual tbody tr').count(), 2);
}));

test('graphique d\'évolution dessiné avec la courbe « mêmes versements dans le MSCI World »', { skip: !realCharts && 'Chart.js non installé (npm install --no-save chart.js@4.4.1)' }, () => run({ state: sampleState() }, async ({ page }) => {
  // chargé tout seul (relais Yahoo simulé), sans clic sur « Charger l'historique »
  await page.waitForFunction(() => window.Chart && Chart.getChart('historyChart'), null, { timeout: 15000 });
  const info = await page.evaluate(() => {
    const c = Chart.getChart('historyChart');
    const ds = c.data.datasets;
    const bench = ds.find(d => /MSCI World/.test(d.label));
    return { n: ds.length, labels: ds.map(d => d.label), points: c.data.labels.length,
      benchOk: !!bench && bench.data.filter(v => v > 0).length > 0.9 * bench.data.length,
      drawn: c.canvas.width > 0 && c.getDatasetMeta(0).data.length === c.data.labels.length };
  });
  assert.equal(info.n, 3, JSON.stringify(info.labels));
  assert.ok(info.points > 100, 'historique de plus de 100 jours');
  assert.ok(info.benchOk, 'courbe MSCI World renseignée');
  assert.ok(info.drawn, 'graphique dessiné');
  assert.match(await page.locator('#historyInfo').innerText(), /vs MSCI World/);
  // option désactivée : plus que deux courbes
  await page.uncheck('#histBench');
  await page.waitForFunction(() => Chart.getChart('historyChart') && Chart.getChart('historyChart').data.datasets.length === 2);
}));

test('frais de courtage calculés avec le barème du compte, sauf saisie manuelle', () => run({ state: sampleState({ accounts: [
  { id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6, fees: { pct: 0.5, min: 1.99, fixed: 0 } },
  { id: 'cto', name: 'Compte-titres', type: 'cto', taxRate: 31.4 }] }) }, async ({ page }) => {
  await page.click('#addTxBtn');
  await page.locator('#txInstrument button', { hasText: 'BNP Paribas Easy S&P 500' }).click();
  await page.selectOption('#txAccount', 'pea');
  await page.fill('#txPrice', '30');
  await page.fill('#txQty', '100');                 // 3 000 € × 0,5 %
  assert.equal(await page.inputValue('#txFees'), '15');
  assert.ok(await page.locator('#txFeesAuto').isVisible());
  await page.fill('#txQty', '10');                  // 300 € : minimum 1,99 €
  assert.equal(await page.inputValue('#txFees'), '1.99');
  await page.selectOption('#txAccount', 'cto');     // pas de barème : frais laissés tels quels
  assert.ok(!(await page.locator('#txFeesAuto').isVisible()));
  await page.selectOption('#txAccount', 'pea');
  await page.fill('#txFees', '0.5');                // saisie manuelle : plus de recalcul
  await page.fill('#txQty', '200');
  assert.equal(await page.inputValue('#txFees'), '0.5');
}));

test('opérations filtrées, contribution des lignes et vente simulée', () => run({ state: sampleState({ transactions: [
  ...sampleState().transactions,
  ...[1, 2, 3, 4, 5, 6].map(i => ({ id: 'x' + i, key: 'CW8@XPAR', type: 'buy', date: `2025-0${i}-10`, account: 'pea', qty: 1, price: 500, fees: 1 })),
] }) }, async ({ page }) => {
  await page.click('#pfSubnav [data-tab=operations]');
  const total = await page.locator('#txTable tbody tr').count();
  await page.selectOption('#txFilters select >> nth=2', '2025');
  const n2025 = await page.locator('#txTable tbody tr').count();
  assert.ok(n2025 >= 6 && n2025 < total, `${n2025} opérations en 2025 sur ${total}`);
  assert.match(await page.locator('#txCount').innerText(), /sur/);
  await page.click('#txFilters .link');
  assert.equal(await page.locator('#txTable tbody tr').count(), total);
  // contribution : une ligne par ETF dans « Analyse »
  await page.click('#pfSubnav [data-tab=analyse]');
  await page.waitForSelector('#contribCard:not(.hidden)');
  assert.ok(await page.locator('#contribList li').count() >= 2);
  // vente simulée depuis la fiche
  await page.evaluate(() => { App.show('markets'); App.selectDetail('CW8@XPAR'); });
  await page.waitForSelector('#detailSale .sale-grid');
  await page.fill('#detailSale .sale-qty', '1');
  await page.press('#detailSale .sale-qty', 'Enter');
  await page.waitForFunction(() => /Net pour toi/.test(document.querySelector('#detailSale').innerText));
  assert.equal(await page.inputValue('#detailSale .sale-qty'), '1');
}));

test('menu « Plus » au clavier et indicateur hors ligne', () => run({ state: sampleState() }, async ({ page, context }) => {
  await page.focus('#tabMoreBtn');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.view), 'catalog');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => App.view), 'simulation');
  assert.equal(await page.locator('#tabMore.open').count(), 0);
  // hors ligne : pastille visible, pas de tentative de mise à jour
  await context.setOffline(true);
  await page.waitForSelector('#offlinePill:not(.hidden)');
  await context.setOffline(false);
  await page.waitForSelector('#offlinePill.hidden', { state: 'attached' });
}));

test('fiche : achats sur le graphique, « M\'alerter » ; répartition par compte ; performance de l\'année', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  // performance de l'année, une fois l'historique chargé tout seul
  await page.waitForFunction(() => /\d{4} : [+-−]/.test(document.querySelector('#kpis').innerText), null, { timeout: 15000 });
  // répartition par compte
  await page.click('#allocByAccount');
  await page.waitForFunction(() => Chart.getChart('allocChart') && Chart.getChart('allocChart').data.labels.includes('PEA'));
  assert.equal(await page.locator('#allocLegend li').count(), 2);
  // fiche : repères d'achat et prix de revient sur le graphique 5 ans
  await page.evaluate(() => { App.show('markets'); App.selectDetail('CW8@XPAR'); });
  await page.click('#rangeSel [data-range="5A"]');
  await page.waitForFunction(() => { const c = Chart.getChart('detailChart'); return c && c.data.datasets.some(d => d.label === 'Achat'); });
  const labels = await page.evaluate(() => Chart.getChart('detailChart').data.datasets.map(d => d.label || ''));
  assert.ok(labels.includes('Ton prix de revient'), JSON.stringify(labels));
  // « M'alerter » : formulaire d'alerte pré-rempli
  await page.click('.alert-shortcut');
  assert.equal(await page.evaluate(() => App.view), 'invest');
  assert.equal(await page.inputValue('#alertKey'), 'CW8@XPAR');
  assert.ok(parseFloat(await page.inputValue('#alertValue')) > 0);
}));

test('agenda (filtres, export .ics) et bilan de santé', () => run({ state: sampleState({ plans: [
  { id: 'p1', key: 'CW8@XPAR', account: 'pea', amount: 300, day: 5, start: '2026-01-01', active: true, done: {} }] }) }, async ({ page }) => {
  // bilan de santé en tête de l'onglet Analyse
  await page.click('#pfSubnav [data-tab=analyse]');
  await page.waitForSelector('#healthCard:not(.hidden) .health-ring');
  const score = +(await page.locator('.health-ring b').innerText());
  assert.ok(score >= 0 && score <= 100, String(score));
  assert.ok(await page.locator('.health-item').count() >= 5);
  // agenda : onglet principal
  await page.click('.tabs > .tab[data-view=agenda]');
  await page.waitForSelector('#agendaList .agenda-item');
  assert.ok(await page.locator('#agendaList .agenda-item.plan').count() >= 11, 'versements des 12 prochains mois');
  await page.locator('#agendaKinds button', { hasText: 'Bourse' }).click();
  const kinds = await page.locator('#agendaList .agenda-item').evaluateAll(l => Array.from(new Set(l.map(e => e.className.replace('agenda-item', '').replace('today', '').trim()))));
  assert.deepEqual(kinds, ['market']);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#agendaExport')]);
  assert.equal(dl.suggestedFilename(), 'apistock-agenda.ics');
}));

test('catalogue : portefeuille type appliqué comme cible ; moyennes mobiles sur la fiche', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState({ instruments: Object.assign({}, sampleState().instruments, {
  'DCAM@XPAR': { symbol: 'DCAM', mic: 'XPAR', exchange: 'Paris', name: 'Amundi PEA Monde (MSCI World) UCITS ETF', currency: 'EUR', type: 'ETF', provider: 'yahoo', ysymbol: 'DCAM.PA' } }) }) }, async ({ page }) => {
  await page.evaluate(() => App.show('catalog'));
  await page.waitForSelector('#catalogBody .model-card');
  assert.ok(await page.locator('#catalogBody input[type=checkbox]').isChecked(), 'PEA coché par défaut (un PEA existe)');
  assert.ok(await page.locator('#catalogBody tbody tr').count() >= 2);
  await page.locator('.model-card', { hasText: 'Monde, un seul ETF' }).locator('button').click();
  await page.waitForFunction(() => App.view === 'invest');
  const targets = await page.evaluate(() => Object.fromEntries(Object.entries(Store.state.targets).filter(([, v]) => v > 0)));
  assert.deepEqual(targets, { 'DCAM@XPAR': 100 });
  // fiche : moyennes mobiles et indicateurs
  await page.evaluate(() => { App.show('markets'); App.selectDetail('CW8@XPAR'); });
  await page.check('#detailInd');
  await page.waitForFunction(() => { const c = Chart.getChart('detailChart'); return c && c.data.datasets.some(d => d.label === 'Moyenne 200 jours' && d.data.some(v => v !== null)); });
  await page.waitForFunction(() => /tendance/i.test(document.querySelector('#detailStats').innerText));
  assert.equal(await page.evaluate(() => localStorage.getItem('apistock:ind')), '1');
}));

test('objectifs multiples et alerte « sous mon prix de revient »', () => run({ state: sampleState() }, async ({ page }) => {
  await page.evaluate(() => App.show('invest'));
  await page.waitForSelector('#goalList .goal-item');
  assert.equal(await page.locator('#goalList .goal-item').count(), 1, 'objectif principal');
  await page.click('#goalAdd');
  assert.equal(await page.locator('#goalList .goal-item').count(), 2);
  const form = page.locator('#goalList .goal-item.editing');
  await form.locator('input[type=text]').fill('Apport immobilier');
  await form.locator('input[type=text]').press('Tab');
  await form.locator('.goal-accs label', { hasText: 'PEA' }).locator('input').uncheck();     // financé par le compte-titres seul
  const g = await page.evaluate(() => Store.state.goals[0]);
  assert.equal(g.name, 'Apport immobilier');
  assert.deepEqual(g.accounts, ['cto']);
  assert.match(await page.locator('#goalList .goal-item').nth(1).innerText(), /Apport immobilier/);
  // alerte sans valeur à saisir
  await page.selectOption('#alertKey', 'CW8@XPAR');
  await page.selectOption('#alertKind', 'belowPru');
  assert.ok(!(await page.locator('#alertValue').isVisible()), 'pas de valeur à saisir');
  await page.click('#alertForm button[type=submit]');
  const alerts = await page.evaluate(() => Store.state.alerts);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'belowPru');
  await page.waitForFunction(() => /prix de revient \(/.test(document.querySelector('#alertTable').innerText));
}));
