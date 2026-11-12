/*
 * Tests de bout en bout (navigateur Chromium via Playwright) : `npm run test:e2e`.
 * Site servi en local, relais Yahoo simulé avec les réponses de tests/fixtures/relay/ : aucun appel réseau réel.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openApp, sampleState, realCharts } from './helpers.mjs';

const VIEWS = ['portfolio', 'markets', 'compare', 'world', 'invest', 'simulation', 'settings'];
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
  await page.click('#pfSubnav [data-tab=patrimoine]');
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
