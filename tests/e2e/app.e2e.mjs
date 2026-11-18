/*
 * Tests de bout en bout (navigateur Chromium via Playwright) : `npm run test:e2e`.
 * Site servi en local, relais Yahoo simulé avec les réponses de tests/fixtures/relay/ : aucun appel réseau réel.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openApp, sampleState, realCharts } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../harness.mjs';

/* Toutes les pages : 5 espaces en sous-onglets, et les réglages */
const PAGES = [['portfolio', 'synthese'], ['portfolio', 'patrimoine'], ['portfolio', 'revenus'], ['portfolio', 'operations'],
  ['analysis', 'composition'], ['analysis', 'performance'], ['analysis', 'risque'], ['analysis', 'optimiser'],
  ['markets', 'suivi'], ['markets', 'monde'], ['markets', 'comparer'], ['markets', 'etf'], ['markets', 'signaux'],
  ['agenda', 'agenda'], ['agenda', 'actus'], ['agenda', 'alertes'],
  ['plan', 'investir'], ['plan', 'objectifs'], ['plan', 'simuler'], ['plan', 'arene'], ['settings', '']];
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
        for (const [v, sub] of PAGES) {
          await page.evaluate(([v, sub]) => App.show(v, sub), [v, sub]);
          await page.waitForTimeout(150);
          assert.ok(await page.locator('#view-' + v).isVisible(), 'espace ' + v + ' affiché');
          if (sub) assert.ok(await page.locator(`#view-${v} > [data-sub~="${sub}"]:not(.sub-off)`).count() > 0, `cartes de ${v}/${sub}`);
        }
      });
    }
  });
}

test('affichage mobile : aucun défilement horizontal, quel que soit l\'onglet', () => run({ state: sampleState({ assets: [{ id: 'a', type: 'immo', name: 'Appartement', value: 250000, debt: 100000, date: '2025-01-01' }] }), device: 'iPhone 13' }, async ({ page }) => {
  await page.waitForTimeout(800);
  for (const [v, sub] of PAGES) {
    await page.evaluate(([v, sub]) => { App.show(v, sub); window.scrollTo(0, 0); }, [v, sub]);
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
  assert.equal(await page.evaluate(() => localStorage.getItem('apistock:sub:portfolio')), 'operations', 'sous-onglet mémorisé');
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
  // contribution : une ligne par ETF dans Analyse › Performance
  await page.click('.tabs .tab[data-view="analysis"]');
  await page.click('#anSubnav [data-tab="performance"]');
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

test('menu « ⋯ » au clavier, sous-onglets mémorisés et indicateur hors ligne', () => run({ state: sampleState() }, async ({ page, context }) => {
  await page.focus('#tabMoreBtn');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'termOpen');
  // terminal → année en bourse → thème → visite guidée → réglages
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Réglages/);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => App.view), 'settings');
  assert.equal(await page.locator('#tabMore.open').count(), 0);
  // espaces : chaque espace rouvre son dernier sous-onglet, l'adresse suit (#espace/sous-onglet)
  await page.click('.tabs .tab[data-view="analysis"]');
  await page.click('#anSubnav [data-tab="risque"]');
  assert.ok(await page.locator('#qCrashCard').isVisible());
  assert.ok(await page.locator('#healthCard').isHidden());
  await page.click('.tabs .tab[data-view="markets"]');
  assert.equal(await page.evaluate(() => location.hash), '#markets/suivi');
  await page.click('.tabs .tab[data-view="analysis"]');
  assert.equal(await page.evaluate(() => App.page), 'analysis/risque');
  // comparateur d'ETF : CW8 (MSCI World) contre ESE (S&P 500) → fort recouvrement, sociétés communes
  await page.evaluate(() => App.show('markets', 'comparer'));
  await page.waitForSelector('#etfCmpOut .etfcmp-verdict', { timeout: 15000 });
  assert.match(await page.locator('#etfCmpOut .etfcmp-verdict').innerText(), /Fort recouvrement : environ 68 %/);
  await page.selectOption('#etfCmpForm select >> nth=1', 'SPY@ARCX');
  await page.waitForFunction(() => /BNP Paribas Easy S&P 500|SPDR/.test(document.querySelector('#etfCmpOut').innerText) && /recouvrement|Doublon/.test(document.querySelector('#etfCmpOut .etfcmp-verdict')?.innerText || ''));
  await page.selectOption('#etfCmpForm select >> nth=0', 'ESE@XPAR');
  await page.waitForFunction(() => /^Doublon/.test(document.querySelector('#etfCmpOut .etfcmp-verdict')?.innerText || ''));
  // anciens noms de pages (liens, boutons « voir… ») toujours compris
  await page.evaluate(() => App.show('world'));
  assert.equal(await page.evaluate(() => App.page), 'markets/monde');
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
  assert.equal(await page.evaluate(() => App.page), 'plan/investir');
  assert.equal(await page.inputValue('#alertKey'), 'CW8@XPAR');
  assert.ok(parseFloat(await page.inputValue('#alertValue')) > 0);
}));

test('agenda (filtres, résultats, macro, export .ics) et bilan de santé', () => run({ state: sampleState({ plans: [
  { id: 'p1', key: 'CW8@XPAR', account: 'pea', amount: 300, day: 5, start: '2026-01-01', active: true, done: {} }],
instruments: Object.assign({}, sampleState().instruments, {
  'NVDA@XNAS': { symbol: 'NVDA', mic: 'XNAS', exchange: 'Nasdaq', name: 'NVIDIA Corporation', currency: 'USD', type: 'Action', provider: 'yahoo', ysymbol: 'NVDA' } }),
watchlist: ['CW8@XPAR', 'NVDA@XNAS'] }) }, async ({ page, calls }) => {
  // bilan de santé en tête d'Analyse › Composition
  await page.click('.tabs .tab[data-view="analysis"]');
  await page.click('#anSubnav [data-tab="composition"]');
  await page.waitForSelector('#healthCard:not(.hidden) .health-ring');
  const score = +(await page.locator('.health-ring b').innerText());
  assert.ok(score >= 0 && score <= 100, String(score));
  assert.ok(await page.locator('.health-item').count() >= 5);
  // agenda : onglet principal
  await page.click('.tabs > .tab[data-view=agenda]');
  await page.waitForSelector('#agendaList .agenda-item');
  assert.ok(await page.locator('#agendaList .agenda-item.plan').count() >= 11, 'versements des 12 prochains mois');
  // résultats de NVIDIA (watchlist) et des grandes lignes des ETF (S&P 500 et MSCI World, via SPY et URTH) : pas de résultats pour un ETF
  await page.waitForSelector('#agendaList .agenda-item.earn');
  assert.deepEqual(calls.filter(c => c.type === 'summary').map(c => c.symbols.split(',').sort().join()), ['SPY,URTH']);
  const cal = calls.filter(c => c.type === 'calendar').flatMap(c => c.symbols.split(','));
  assert.ok(cal[0] === 'NVDA' && cal.includes('AAPL') && cal.includes('MSFT'), cal.join());
  assert.ok(!cal.some(s => ['CW8.PA', 'ESE.PA', 'SPY'].includes(s)), 'pas d\'ETF');
  const earn = await page.locator('#agendaList .agenda-item.earn', { hasText: 'NVIDIA' }).first().innerText();
  assert.match(earn, /Résultats T\d .*NVIDIA/);
  assert.match(earn, /Pèse \d+,\d % de .*S&P 500.*MSCI World|Pèse \d+,\d % de .*MSCI World.*S&P 500/);
  assert.match(earn, /bénéfice par action attendu/);
  assert.ok(await page.locator('#agendaNote').isHidden());
  await page.locator('#agendaKinds button', { hasText: 'Indices' }).click();
  assert.ok(await page.locator('#agendaList .agenda-item.eco', { hasText: 'Quatre sorcières' }).count() >= 3);
  await page.locator('#agendaKinds button', { hasText: 'Bourse' }).click();
  const kinds = await page.locator('#agendaList .agenda-item').evaluateAll(l => Array.from(new Set(l.map(e => e.className.replace('agenda-item', '').replace('today', '').trim()))));
  assert.deepEqual(kinds, ['market']);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#agendaExport')]);
  assert.equal(dl.suggestedFilename(), 'apistock-agenda.ics');
  // liste de suivi enrichie : colonnes en option, tri par potentiel
  await page.evaluate(() => App.show('markets', 'suivi'));
  await page.click('#watchCols summary');
  for (const c of ['Résultats', 'Potentiel', 'Avis', 'PER']) await page.locator('.watch-cols-menu label', { hasText: c }).locator('input').check();
  await page.click('#watchCols summary');
  await page.waitForFunction(() => /Achat/.test(document.querySelector('#watchTable').innerText), null, { timeout: 15000 });
  assert.ok(await page.locator('.grid-2.markets.watch-wide').count(), 'liste en pleine largeur');
  await page.locator('#watchTable th', { hasText: 'Potentiel' }).click();
  assert.match(await page.locator('#watchTable tbody tr').first().innerText(), /NVIDIA[\s\S]*\+71 %[\s\S]*Achat/);
  assert.match(await page.locator('#watchTable th.sorted').innerText(), /Potentiel ▼/);
  // fiche de NVIDIA : résultats des derniers trimestres et prochaine publication
  await page.evaluate(() => { App.show('markets'); App.selectDetail('NVDA@XNAS'); });
  await page.waitForSelector('#detailEarnings .earn-col');
  assert.equal(await page.locator('#detailEarnings .earn-col').count(), 5, '4 trimestres publiés + le prochain');
  assert.match(await page.locator('#detailEarnings').innerText(), /Prochaine publication/);
  // analyse fondamentale de NVIDIA : avis des analystes, objectif de cours, valorisation, profil
  await page.waitForSelector('#detailFund .fund-split');
  const fund = await page.locator('#detailFund').innerText();
  assert.match(fund, /Avis des analystes/i);
  assert.match(fund, /54 analystes/);
  assert.match(fund, /Objectif de cours/i);
  assert.match(fund, /PER attendu/i);
  assert.equal(await page.locator('#detailFund .fund-split .seg').count(), 4, 'achat fort, achat, conserver, vente (pas de vente forte)');
  // révisions des prévisions, avis des banques et ventes des dirigeants (appel séparé, modules « trends »)
  await page.waitForSelector('#detailFund .fund-table tbody tr');
  assert.equal(await page.locator('#detailFund .fund-table tbody tr').count(), 4);
  const trends = await page.locator('#detailFund').innerText();
  assert.match(trends, /Prévisions revues à la hausse/);
  assert.match(trends, /Melius Research abaisse à Conserver \(était Achat\)/);
  assert.match(trends, /Vente · Timothy S Teter, Directeur juridique/);
  assert.ok(calls.some(c => c.type === 'summary' && /insiderTransactions/.test(c.modules || '')));
  // fiche de CW8 (ETF) : frais, secteurs et principales lignes de l'indice suivi (via URTH)
  await page.evaluate(() => App.selectDetail('CW8@XPAR'));
  await page.waitForSelector('#detailFund .fund-bars li');
  const etf = await page.locator('#detailFund').innerText();
  assert.match(etf, /Composition & frais/i);
  assert.match(etf, /0,38 % par an/i);
  assert.match(etf, /Technologie/i);
  assert.match(etf, /URTH/);
  assert.equal(await page.locator('#detailEarnings .earn-col').count(), 0, 'pas de résultats trimestriels pour un ETF');
  // radiographie : poids réels (SPY, URTH)
  await page.evaluate(() => App.show('analysis', 'composition'));
  await page.waitForSelector('#xrayCard:not(.hidden) .xr-list li');
  assert.match(await page.locator('#xrayCard').innerText(), /Apple|NVIDIA/);
}));

test('catalogue : portefeuille type appliqué comme cible ; moyennes mobiles sur la fiche', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState({ instruments: Object.assign({}, sampleState().instruments, {
  'DCAM@XPAR': { symbol: 'DCAM', mic: 'XPAR', exchange: 'Paris', name: 'Amundi PEA Monde (MSCI World) UCITS ETF', currency: 'EUR', type: 'ETF', provider: 'yahoo', ysymbol: 'DCAM.PA' } }) }) }, async ({ page }) => {
  await page.evaluate(() => App.show('catalog'));
  await page.waitForSelector('#catalogBody .model-card');
  assert.ok(await page.locator('#catalogBody input[type=checkbox]').isChecked(), 'PEA coché par défaut (un PEA existe)');
  assert.ok(await page.locator('#catalogBody tbody tr').count() >= 2);
  await page.locator('.model-card', { hasText: 'Monde, un seul ETF' }).locator('button').click();
  await page.waitForFunction(() => App.page === 'plan/investir');
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
  await page.evaluate(() => App.show('plan', 'objectifs'));
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
  // alerte sans valeur à saisir (Agenda › Alertes)
  await page.evaluate(() => App.show('agenda', 'alertes'));
  await page.selectOption('#alertKey', 'CW8@XPAR');
  await page.selectOption('#alertKind', 'belowPru');
  assert.ok(!(await page.locator('#alertValue').isVisible()), 'pas de valeur à saisir');
  await page.click('#alertForm button[type=submit]');
  const alerts = await page.evaluate(() => Store.state.alerts);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'belowPru');
  await page.waitForFunction(() => /prix de revient \(/.test(document.querySelector('#alertTable').innerText));
}));

test('carte du portefeuille, optimiseur de répartition et « Ton année en bourse »', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  await page.evaluate(() => App.show('analysis', 'composition'));
  // carte : une tuile par ligne, qui ouvre la fiche
  await page.waitForSelector('#mapCard:not(.hidden) .map-tile');
  // la ligne en dollars arrive avec le taux de change : la carte se complète sans changer de page
  await page.waitForFunction(() => document.querySelectorAll('.map-tile').length === 3, null, { timeout: 20000 });
  await page.click('#mapMode [data-mode=gain]');
  assert.match(await page.locator('.map-tile').first().getAttribute('title'), /plus-value/);
  // optimiseur (Analyse › Optimiser) : nuage, trois répartitions, application comme cible
  await page.click('#anSubnav [data-tab="optimiser"]');
  await page.click('#optRun');
  await page.waitForFunction(() => Chart.getChart('optChart') && Chart.getChart('optChart').data.datasets.length === 5, null, { timeout: 20000 });
  assert.equal(await page.locator('.opt-col').count(), 4, 'ta répartition, la moins risquée, meilleur rendement / risque, rendement maximal');
  // rendement maximal : 100 % sur une seule ligne
  assert.match(await page.locator('.opt-col.maxret').innerText(), /100 %/);
  // coût de passage sous chaque répartition proposée
  assert.match(await page.locator('.opt-col.minvol').innerText(), /Pour y passer : vendre [\d\s ]+€, acheter[\s\S]*frais ≈[\s\S]*impôt ≈/);
  // poids maximum de 50 % par ligne : recalcul, le rendement maximal n'est plus à 100 %
  await page.selectOption('#optOpts select', '0.5');
  await page.waitForFunction(() => !/100 %/.test(document.querySelector('.opt-col.maxret')?.innerText || '100 %') && /50 %/.test(document.querySelector('.opt-col.maxret').innerText), null, { timeout: 20000 });
  await page.selectOption('#optOpts select', '1');
  await page.waitForFunction(() => /100 %/.test(document.querySelector('.opt-col.maxret')?.innerText || ''), null, { timeout: 20000 });
  // survol d'un point du nuage : l'info-bulle donne sa répartition
  const box = await page.locator('#optChart').boundingBox();
  const target = await page.evaluate(() => {
    const ch = Chart.getChart('optChart'), el = ch.getDatasetMeta(0).data[40];
    return { x: el.x, y: el.y };
  });
  await page.mouse.move(box.x + target.x, box.y + target.y);
  await page.waitForFunction(() => { const t = Chart.getChart('optChart').tooltip; return t.opacity > 0 && t.body.some(b => b.lines.some(l => / : \d+ %$/.test(l))); });
  // clic : le point rejoint la comparaison, puis « retirer »
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await page.waitForSelector('.opt-col.pick');
  assert.equal(await page.locator('.opt-col').count(), 5);
  assert.equal(await page.evaluate(() => Chart.getChart('optChart').data.datasets.length), 6, 'point choisi entouré sur le graphique');
  assert.match(await page.locator('.opt-col.pick').innerText(), /Point choisi[\s\S]*Utiliser comme cible/);
  await page.click('.opt-col.pick .opt-unpick');
  assert.equal(await page.locator('.opt-col.pick').count(), 0);
  await page.locator('.opt-col.minvol button').click();
  await page.waitForFunction(() => App.page === 'plan/investir');
  const sum = await page.evaluate(() => Object.values(Store.state.targets).reduce((a, b) => a + b, 0));
  assert.ok(Math.abs(sum - 100) < 0.5, 'cible à 100 % : ' + sum);
  // récap de l'année depuis le menu « ⋯ »
  await page.click('#tabMoreBtn');
  await page.click('#wrappedOpen');
  await page.waitForSelector('.wrapped .w-big', { timeout: 20000 });
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.wrapped .w-summary');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.wrapped').count(), 0);
}));

test('laboratoire de stratégies et répartition partagée par lien', { skip: !realCharts && 'Chart.js non installé' }, async () => {
  await run({ state: sampleState() }, async ({ page }) => {
    await page.evaluate(() => App.show('simulation'));
    await page.selectOption('#labYears', '3');
    await page.click('#labRun');
    await page.waitForFunction(() => Chart.getChart('labChart') && Chart.getChart('labChart').data.datasets.length === 5, null, { timeout: 20000 });
    assert.equal(await page.locator('.lab-rank li').count(), 4);
    assert.equal(await page.locator('.lab-rank li.best').count(), 1);
    assert.ok(await page.locator('.lab-lessons li').count() >= 2);
  });
  // lien partagé ouvert par quelqu'un d'autre : aperçu, puis adoption comme cible
  const link = 'share=' + Buffer.from(JSON.stringify({ v: 1, t: 'Monde + émergents', l: [['CW8', 'XPAR', 'CW8.PA', 'Amundi MSCI World', 'EUR', 88], ['ESE', 'XPAR', 'ESE.PA', 'BNP S&P 500', 'EUR', 12]] })).toString('base64url');
  await run({ state: sampleState(), hash: link }, async ({ page }) => {
    await page.waitForSelector('dialog.share-dialog[open]');
    assert.match(await page.locator('dialog.share-dialog').innerText(), /Monde \+ émergents/);
    assert.ok(!/share=/.test(await page.evaluate(() => location.hash)), 'le lien est retiré de l\'adresse');
    await page.locator('dialog.share-dialog button', { hasText: 'Utiliser comme cible' }).click();
    await page.waitForFunction(() => App.page === 'plan/investir');
    const t = await page.evaluate(() => Object.fromEntries(Object.entries(Store.state.targets).filter(([, v]) => v > 0)));
    assert.deepEqual(t, { 'CW8@XPAR': 88, 'ESE@XPAR': 12 });
  });
});

test('labo quant : météo des marchés, anatomie du risque, scénarios, crash-test et audit', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  await page.evaluate(() => App.show('markets', 'monde'));
  // la météo se lance seule à l'ouverture de Marchés › Monde (MSCI World enregistré)
  await page.waitForSelector('#qRegimeBody .q-weather', { timeout: 20000 });
  assert.ok(await page.evaluate(() => !!Chart.getChart('qRegimeChart')));
  assert.match(await page.locator('#qRegimeBody .q-weather').innerText(), /Marché (calme|agité)/);

  await page.evaluate(() => App.show('analysis', 'risque'));
  await page.click('#qRiskRun');
  await page.waitForSelector('#qRiskBody .q-kpis', { timeout: 20000 });
  assert.match(await page.locator('#qRiskBody .q-lead').innerText(), /risque/);
  assert.ok(await page.evaluate(() => Chart.getChart('qRiskChart').data.datasets[1].data.reduce((a, b) => a + b, 0)) > 99.9, 'contributions = 100 %');
  assert.equal(await page.locator('#qRiskBody .q-parity button', { hasText: 'Utiliser comme cible' }).count(), 1);

  // scénarios : seuls les facteurs enregistrés (MSCI World, dollar) sont disponibles, les autres sont ignorés
  await page.click('#qScenRun');
  await page.waitForSelector('#qScenBody .q-factors', { timeout: 20000 });
  assert.equal(await page.locator('#qScenBody .q-factors label').count(), 2);
  await page.locator('#qScenBody .q-factors input').first().fill('-20');
  await page.waitForSelector('#qScenBody .q-big');
  assert.match(await page.locator('#qScenBody .q-big').innerText(), /−|-/);
  assert.ok(await page.locator('#qScenBody .q-table tbody tr').count() >= 3);

  // crash-test : pas d'historique enregistré pour les crises passées → message, sans erreur
  await page.click('#qCrashRun');
  await page.waitForFunction(() => !document.querySelector('#qCrashRun').disabled, null, { timeout: 30000 });
  assert.ok(await page.locator('#qCrashBody').innerText());

  await page.evaluate(() => App.show('analysis', 'performance'));
  await page.click('#qBehavRun');
  await page.waitForSelector('#qBehavBody .q-kpis', { timeout: 20000 });
  assert.match(await page.locator('#qBehavBody').innerText(), /Ton timing/);
  await page.evaluate(() => App.show('analysis', 'risque'));

  // « Tout analyser » : progression visible, les cinq étapes terminées, confirmation
  await page.click('#qAllRun');
  await page.waitForSelector('#qAllProgress .q-step');
  await page.waitForFunction(() => $$('#qAllProgress .q-step.ok').length === 5, null, { timeout: 60000 });
  assert.equal(await page.locator('#qAllRun').innerText(), 'Tout réanalyser');
  assert.match(await page.locator('#toast').innerText(), /5 analyses sont prêtes/);
}));

test('copilote (Ctrl+K), retrait malin et radar fiscal', () => run({ state: sampleState({ transactions: sampleState().transactions.concat([
  { id: 't5', key: 'ESE@XPAR', type: 'buy', date: '2024-05-02', account: 'cto', qty: 20, price: 40, fees: 1 },
]) }) }, async ({ page }) => {
  await page.waitForFunction(() => Api.cachedQuote('CW8@XPAR') && Api.cachedQuote('ESE@XPAR'), null, { timeout: 20000 });
  // Ctrl+K ouvre le copilote ; une question reçoit une réponse chiffrée
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#copilot[open]');
  assert.ok(await page.locator('#cpOut .cp-chip').count() >= 4, 'exemples proposés');
  await page.fill('#cpInput', 'combien vaut mon portefeuille ?');
  await page.waitForSelector('#cpOut .cp-value');
  assert.match(await page.locator('#cpOut .cp-answer').innerText(), /Ton portefeuille vaut[\s\S]*€/);
  await page.fill('#cpInput', 'plus-value sur CW8');
  await page.waitForFunction(() => /Gain sur/.test(document.querySelector('#cpOut .cp-answer')?.innerText || ''));
  // un raccourci ouvre la carte concernée
  await page.fill('#cpInput', 'crash test');
  await page.waitForFunction(() => /Crash-test/.test(document.querySelector('#cpOut .cp-item.active')?.innerText || ''));
  assert.equal(await page.locator('#cpOut .cp-answer').count(), 0, 'pas de réponse chiffrée pour un raccourci');
  await page.keyboard.press('Escape');

  // « j'ai besoin de 1 000 € » : plan de retrait depuis le copilote
  await page.keyboard.press('Control+k');
  await page.fill('#cpInput', 'j\'ai besoin de 1 000 €');
  await page.waitForFunction(() => /Pour obtenir/.test(document.querySelector('#cpOut .cp-answer')?.innerText || ''));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#wdBody .wd-hero');
  assert.equal(await page.evaluate(() => App.page), 'portfolio/revenus');
  assert.equal(await page.inputValue('#wdAmount'), '1000');
  const plan = await page.locator('#wdBody').innerText();
  assert.match(plan, /Vendre/);
  assert.match(plan, /Compte-titres/, 'le PEA récent (moins de 5 ans) est laissé de côté');
  assert.match(plan, /PEA : un retrait avant les 5 ans/);
  // enregistrement des ventes proposées
  const before = await page.evaluate(() => Store.state.transactions.length);
  await page.click('#wdBody button:has-text("Enregistrer ces ventes")');
  assert.ok(await page.evaluate(() => Store.state.transactions.filter(t => t.note === 'Retrait malin').length) >= 1);
  assert.ok(await page.evaluate(() => Store.state.transactions.length) > before);

  // radar fiscal visible dans Portefeuille › Revenus & impôts (pas d'erreur, contenu présent)
  await page.evaluate(() => App.show('portfolio', 'revenus'));
  assert.ok(await page.locator('#radarCard').isVisible());
  assert.ok((await page.locator('#radarBody').innerText()).length > 20);
}));

test('une erreur au démarrage d\'un module ne désactive pas les autres boutons, et elle est signalée', () => run({ state: sampleState() }, async (app) => {
  const { page } = app;
  // page incomplète (ex. ancienne page en cache avec des scripts récents) : la carte « Retrait malin » manque
  await page.route('**/index.html', async route => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/<div data-sub="revenus" class="card wd-card" id="wdCard">[\s\S]*?(<div data-sub="operations")/, '$1');
    await route.fulfill({ response: res, body: html });
  });
  await page.reload();
  await page.waitForFunction(() => typeof App !== 'undefined' && App._booted && document.readyState === 'complete');
  assert.equal(await page.locator('#wdCard').count(), 0);
  await page.waitForSelector('#toast.show');
  assert.match(await page.locator('#toast').innerText(), /erreur[\s\S]*Recharger/);
  // les modules branchés après continuent de fonctionner
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#copilot[open]');
  await page.keyboard.press('Escape');
  await page.click('.tabs .tab[data-view="markets"]');
  assert.equal(await page.evaluate(() => App.view), 'markets');
  await page.click('.tabs .tab[data-view="portfolio"]');
  await page.click('#addTxBtn');
  await page.waitForSelector('#txDialog[open]');
  assert.ok(app.errors.some(e => /addEventListener|null/.test(e)), 'erreur notée dans la console');
  app.errors.length = 0;
}));

test('salle des marchés : P&L explain, signaux et stratégies, journal de trades avec alertes', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  await page.waitForFunction(() => Api.cachedQuote('CW8@XPAR') && Api.cachedQuote('ESE@XPAR'), null, { timeout: 20000 });
  await page.evaluate(() => App.show('analysis', 'performance'));
  // P&L explain lancé à l'ouverture d'Analyse › Performance, période modifiable ; le pont de valeur boucle
  await page.waitForSelector('#dkPnlBody .dk-hero', { timeout: 30000 });
  await page.click('#dkPeriods button[data-p="ytd"]');
  await page.waitForFunction(() => App.explainResult && App.explainResult.period === 'ytd' && !App._explaining, null, { timeout: 30000 });
  const R = await page.evaluate(() => { const r = App.explainResult; return { gap: r.endValue - r.startValue - r.inflow + r.outflow - r.total, rows: $$('#dkPnlBody .dk-bridge-row').length, lines: $$('#dkPnlBody .dk-table tbody tr').length }; });
  assert.ok(Math.abs(R.gap) < 1e-6, 'identité comptable');
  assert.equal(R.rows, 8);
  assert.equal(R.lines, 3);
  assert.match(await page.locator('#dkPnlBody').innerText(), /dollar t'a (rapporté|coûté)/i);
  assert.ok(await page.locator('#dkPnlBody .dk-cell').count() > 20, 'calendrier des séances');
  // « Depuis le début » : le calendrier couvre toute la période, une ligne par année
  await page.click('#dkPeriods button[data-p="all"]');
  await page.waitForFunction(() => App.explainResult && App.explainResult.period === 'all' && !App._explaining, null, { timeout: 30000 });
  const years = await page.locator('#dkPnlBody .dk-year-head b').allInnerTexts();
  assert.deepEqual(years, ['2026', '2025', '2024']);
  await page.locator('#dkPnlBody .dk-year').last().locator('.dk-cell.pos, .dk-cell.neg').first().click();
  assert.match(await page.locator('#dkPnlBody .dk-heat-detail').innerText(), /2024 : [+−-]/);
  assert.doesNotMatch(await page.locator('#dkPnlCard').innerText(), /\bnull\b|-0,00/);

  // signaux et stratégies (Marchés › Signaux) : 4 règles comparées, courbes dessinées
  await page.evaluate(() => App.show('markets', 'signaux'));
  await page.click('#dkSigRun');
  await page.waitForSelector('#dkSigBody .dk-sig', { timeout: 60000 });
  assert.equal(await page.locator('#dkSigBody .dk-sig').count(), 3);
  assert.equal(await page.evaluate(() => Chart.getChart('dkSigChart').data.datasets.length), 4);
  assert.match(await page.locator('#dkSigBody').innerText(), /Tendance 10 mois[\s\S]*Momentum 12-1/);

  // journal (Portefeuille › Opérations) : taille de position, ajout, alertes sur l'objectif et le stop
  await page.evaluate(() => App.show('portfolio', 'operations'));
  await page.selectOption('#dkJKey', 'ESE@XPAR');
  const px = await page.evaluate(() => Api.cachedQuote('ESE@XPAR').price);
  await page.fill('#dkJStop', String(Math.floor(px * 0.9)));
  await page.fill('#dkJTarget', String(Math.ceil(px * 1.25)));
  await page.fill('#dkJText', 'Rebond du S&P 500');
  await page.waitForFunction(() => /parts? au maximum/.test(document.querySelector('#dkJSize').innerText));
  assert.match(await page.locator('#dkJSize').innerText(), /Rapport gain \/ risque : [\d,]+ pour 1/);
  await page.click('#dkJForm button[type="submit"]');
  await page.waitForSelector('#dkJList .dk-trade');
  assert.match(await page.locator('#dkJList .dk-trade').innerText(), /en cours[\s\S]*Rebond du S&P 500/);
  await page.click('#dkJList button:has-text("Alertes")');
  const alerts = await page.evaluate(() => Store.state.alerts.filter(a => a.thesis).map(a => a.kind).sort());
  assert.deepEqual(alerts, ['above', 'below']);
  assert.equal(await page.evaluate(() => Store.state.theses.length), 1);
}));

test('arène : univers parallèles, défi à l\'aveugle jusqu\'à la révélation, briefing vocal et musique', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  await page.waitForFunction(() => Api.cachedQuote('CW8@XPAR') && Api.cachedQuote('ESE@XPAR'), null, { timeout: 20000 });
  await page.evaluate(() => App.show('arena'));
  // univers : lancés à l'ouverture ; ceux sans historique enregistré sont signalés, pas d'erreur
  await page.waitForSelector('#arMvBody .ar-podium', { timeout: 30000 });
  const podium = await page.locator('#arMvBody .ar-podium li').allInnerTexts();
  assert.equal(podium.length, 5, podium.join(' | '));
  assert.ok(podium.some(x => /Ton vrai portefeuille/.test(x)) && podium.some(x => /Livret A/.test(x)) && podium.some(x => /MSCI World/.test(x)));
  assert.match(await page.locator('#arMvBody .q-lead').innerText(), /Tu as investi [\d\s ]+€ depuis le/);
  assert.match(await page.locator('#arMvBody .lab-warn').innerText(), /Bitcoin/);
  assert.equal(await page.locator('#arMvBody .ar-row').count(), 5);
  // défi : une partie complète, au clavier et aux boutons
  await page.click('#arGameNew');
  await page.waitForSelector('#arGameBody .ar-game-head');
  assert.match(await page.locator('#arGameBody .ar-game-head').innerText(), /0 \/ 104/);
  await page.locator('#arGameBody button', { hasText: 'Liquidités' }).click();
  await page.keyboard.press('Space');
  await page.keyboard.press('b');
  assert.match(await page.locator('#arGameBody .ar-game-head').innerText(), /3 \/ 104/);
  for (let i = 0; i < 26; i++) { const b = page.locator('#arGameBody button', { hasText: '+4' }); if (await b.count()) await b.click(); }
  await page.waitForSelector('#arGameBody .ar-reveal');
  const reveal = await page.locator('#arGameBody .ar-reveal').innerText();
  assert.match(reveal, /C'était .+ du .+ au /);
  assert.match(reveal, /Allers-retours\s*2/);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('apistock:arena:best')).title.length > 3), 'record enregistré');
  // briefing vocal (texte affiché même sans voix) et parcours en musique
  await page.click('#arBrief');
  assert.match(await page.locator('#arBriefText').innerText(), /^Bonjour|^Bonsoir/);
  assert.match(await page.locator('#arBriefText').innerText(), /Ton portefeuille vaut \d+ euros/);
  assert.equal(await page.locator('#arPlay').isDisabled(), false);
  await page.click('#arPlay');
  await page.waitForSelector('#toast.show');
  assert.match(await page.locator('#toast').innerText(), /semaines de ton parcours/);
}));

test('outils institutionnels : stress test inversé, Black-Litterman appliqué comme cible, planificateur probabiliste', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState({ goals: [{ id: 'g1', name: 'Apport maison', target: 60000, date: '2034-06-01', monthly: 400, rate: 6, accounts: [] }] }) }, async ({ page }) => {
  await page.waitForFunction(() => Api.cachedQuote('CW8@XPAR') && Api.cachedQuote('ESE@XPAR'), null, { timeout: 20000 });
  await page.evaluate(() => App.show('quant'));
  // stress test inversé : la perte visée est atteinte, l'horizon change la fréquence
  await page.click('#iStressRun');
  await page.waitForSelector('#iStressBody .q-table', { timeout: 30000 });
  await page.locator('#iStressBody input[type=range]').fill('20');
  const lead = await page.locator('#iStressBody .q-lead').innerText();
  assert.match(lead, /perdre 20 %/);
  const pnl = await page.evaluate(() => { const r = Inst.reverseStress(App.stress.model, App.stress.values, -0.2, App.stress.weeks); return r.pnl / r.total; });
  assert.ok(Math.abs(pnl + 0.2) < 1e-9, 'perte exacte');
  const f1 = await page.locator('#iStressBody .q-kpi b').first().innerText();
  await page.click('#iStressBody .seg button:has-text("1 an")');
  assert.notEqual(await page.locator('#iStressBody .q-kpi b').first().innerText(), f1);
  // Black-Litterman (Analyse › Optimiser) : une conviction forte change la répartition, appliquée comme cible
  await page.evaluate(() => App.show('analysis', 'optimiser'));
  await page.click('#iBlRun');
  await page.waitForSelector('#iBlBody .i-views', { timeout: 30000 });
  assert.match(await page.locator('#iBlBody .q-lead').innerText(), /Sans conviction/);
  await page.locator('#iBlBody .i-views input').nth(1).fill('20');
  await page.locator('#iBlBody .i-views select').nth(1).selectOption('high');
  await page.waitForFunction(() => /1 conviction/.test($('#iBlBody .q-lead').innerText));
  await page.click('#iBlBody button:has-text("Utiliser comme cible")');
  const targets = await page.evaluate(() => Store.state.targets);
  const sum = Object.values(targets).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, 'cible à 100 % : ' + sum);
  assert.ok(Object.values(targets).every(v => v <= 60.05), 'poids maximum respecté');
  assert.equal(await page.evaluate(() => App.page), 'plan/investir');
  // planificateur (Planifier › Objectifs) : objectif choisi, probabilité et versements nécessaires croissants
  await page.evaluate(() => App.show('plan', 'objectifs'));
  await page.selectOption('#iPlanGoal', 'g1');
  assert.equal(await page.inputValue('#iPlanTarget'), '60000');
  await page.click('#iPlanRun');
  await page.waitForSelector('#iPlanBody .i-gauge', { timeout: 60000 });
  assert.match(await page.locator('#iPlanBody .i-gauge').innerText(), /\d+ %/);
  const need = await page.evaluate(() => App.plan.need.map(([, v]) => v));
  assert.ok(need[0] <= need[1] && need[1] <= need[2], need.join(' ≤ '));
  assert.ok(await page.evaluate(() => Chart.getChart('iPlanChart').data.datasets.length === 4));
}));

test('mode terminal (commandes, touches F), scanner de signaux et radiographie', { skip: !realCharts && 'Chart.js non installé' }, () => run({ state: sampleState() }, async ({ page }) => {
  await page.waitForFunction(() => Api.cachedQuote('CW8@XPAR') && Api.cachedQuote('ESE@XPAR') && Api.cachedQuote('SPY@ARCX'), null, { timeout: 20000 });
  // radiographie : les 7 Magnifiques vus à travers les ETF
  await page.evaluate(() => App.show('analysis', 'composition'));
  await page.waitForSelector('#xrayCard:not(.hidden) .xr-list');
  assert.match(await page.locator('#xrayBody .q-lead').innerText(), /7 Magnifiques[\s\S]*représentent [\d,]+ %/);
  assert.match(await page.locator('#xrayBody .xr-list li').first().innerText(), /NVIDIA|Apple|Microsoft/);
  // scanner
  await page.evaluate(() => App.show('desk'));
  await page.click('#scanRun');
  await page.waitForSelector('#scanBody .sc-table');
  assert.equal(await page.locator('#scanBody .sc-table tbody tr').count(), 3);
  // terminal : menu Plus, 4 fenêtres, commandes, touches F, Échap
  await page.evaluate(() => { try { localStorage.setItem('apistock:term', 'null'); } catch (e) { /* stockage indisponible */ } });
  await page.click('#tabMoreBtn');
  await page.click('#termOpen');
  await page.waitForSelector('#term:not(.hidden) #termPort tbody tr');
  const pane = n => page.locator('#termGrid .tp').nth(n);
  const run = async c => { await page.fill('#termCmd', c); await page.keyboard.press('Enter'); };
  assert.equal(await page.locator('#termGrid .tp').count(), 4, 'quatre fenêtres');
  assert.equal(await page.locator('#termPort tbody tr').count(), 3);
  assert.ok(await page.locator('#termTape .term-tk').count() >= 6, 'bandeau défilant (dupliqué pour boucler)');
  // graphique en chandeliers dans la fenêtre 2 : « 2 SPY GP 5A »
  await run('2 spy gp 5a');
  // attendre le graphique 5 ans lui-même (le précédent, sur 1 an, compte déjà plus de 100 bougies)
  await page.waitForFunction(() => /SPY/.test($$('#termGrid .tp')[1].querySelector('.tp-bar').innerText) && App._termCharts[1] && App._termCharts[1].data
    && App._termCharts[1].data.bars.length > 100 && App._termCharts[1].data.unit === 'S');
  assert.match(await pane(1).locator('.tp-acts button.on').innerText(), /5A/);
  assert.match(await page.locator('#termPrompt').innerText(), /2</);
  assert.equal(await page.evaluate(() => App._termCharts[1].data.style), 'candle');
  assert.equal(await page.evaluate(() => App._termCharts[1].data.unit), 'S', '5 ans : bougies hebdomadaires');
  // outils : barres OHLC, RSI et MACD (panneaux sous le graphique), échelle log
  for (const b of ['BARRES', 'RSI', 'MACD', 'LOG']) await pane(1).locator('.tc-tools button', { hasText: new RegExp('^' + b + '$') }).click();
  await page.waitForFunction(() => { const c = App._termCharts[1]; return c.data.style === 'ohlc' && c.data.studies.rsi && c.data.studies.macd && c.data.log && c.layout().panels.length === 2; });
  // réticule et zoom à la molette
  const box = await pane(1).locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  const n0 = await page.evaluate(() => App._termCharts[1].view.to - App._termCharts[1].view.from);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(n => App._termCharts[1].view.to - App._termCharts[1].view.from < n, n0);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForFunction(n => App._termCharts[1].view.to - App._termCharts[1].view.from === n, n0);
  // « 3 » : action n° 3 du menu (6M) ; GPC remet les chandeliers
  await run('3');
  assert.match(await pane(1).locator('.tp-acts button.on').innerText(), /6M/);
  await run('GPC');
  await page.waitForFunction(() => App._termCharts[1].data.style === 'candle' && App._termCharts[1].data.unit === 'J');
  // fenêtre 4 : description avec performances
  await page.waitForFunction(() => /PERFORMANCE/.test($$('#termGrid .tp')[3].innerText) && /1A/.test(($$('#termGrid .tp')[3].querySelector('.des-perf') || {}).innerText || ''));
  // HP : cours d'ouverture, haut, bas, clôture ; DVD : dividendes
  await run('4 HP');
  await page.waitForFunction(() => /CLÔT/.test($$('#termGrid .tp')[3].innerText) && $$('#termGrid .tp')[3].querySelectorAll('tbody tr').length > 30);
  await run('4 DVD');
  await page.waitForFunction(() => /DIVIDENDE 12 MOIS/.test($$('#termGrid .tp')[3].innerText));
  // toutes les matières premières, par famille
  await run('3 CMDTY');
  const nC = await page.evaluate(() => TERM_CMDTY.length);
  assert.equal(await pane(2).locator('tbody tr:not(.grp)').count(), nC);
  assert.equal(await pane(2).locator('tbody tr.grp').count(), 6);
  assert.match(await pane(2).innerText(), /CACAO[\s\S]*\$\/tonne/);
  await run('3 CMAP');
  assert.equal(await pane(2).locator('.term-tile').count(), nC);
  // comparaison, corrélations, risque
  await run('2 COMP SPY CW8 ESE 5A');
  await page.waitForFunction(() => App._termCharts[1] && App._termCharts[1].data && App._termCharts[1].data.lines && App._termCharts[1].data.lines.length === 3 && $$('#termGrid .tp')[1].querySelectorAll('.tc-table tbody tr').length === 3);
  await run('1 CORR SPY CW8 ESE');
  await page.waitForFunction(() => $$('#termGrid .tp')[0].querySelectorAll('.corr tbody tr').length === 3);
  assert.equal(await pane(0).locator('.corr tbody tr').first().locator('td').nth(1).innerText(), '1,00');
  await run('1 RSK');
  await page.waitForFunction(() => /VAR 95 %/.test($$('#termGrid .tp')[0].innerText) && $$('#termGrid .tp')[0].querySelectorAll('tbody tr').length === 3);
  // recherche de valeurs, journal des opérations, liste de suivi
  await run('3 SECF SPY');
  await page.waitForFunction(() => $$('#termGrid .tp')[2].querySelectorAll('tbody tr').length > 0);
  await run('3 BLT');
  assert.ok(await pane(2).locator('tbody tr').count() >= 3, 'opérations listées');
  await run('ADD GOLD');
  await page.waitForFunction(() => /GOLD/.test($$('#termGrid .tp')[2].innerText) && /MON/.test($$('#termGrid .tp')[2].querySelector('.tp-bar').innerText));
  // écrans prédéfinis et zoom
  await run('LAY 4');
  assert.deepEqual(await page.evaluate(() => App.termPanes.map(p => p.fn)), ['CMDTY', 'GP', 'CMAP', 'DES']);
  assert.equal(await page.evaluate(() => App.termKey), 'Y:GC=F');
  await run('ZOOM');
  assert.equal(await page.locator('#termGrid .tp:visible').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#termGrid .tp:visible').count(), 4, 'Échap : sortie du zoom d\'abord');
  // saisie assistée et historique
  await page.fill('#termCmd', '');
  await page.type('#termCmd', 'cma');
  await page.waitForSelector('#termSug:not(.hidden) li');
  assert.match(await page.locator('#termSug li').first().innerText(), /CMAP/);
  await page.keyboard.press('Tab');
  assert.equal((await page.inputValue('#termCmd')).trim(), 'CMAP');
  await page.fill('#termCmd', '');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.inputValue('#termCmd'), 'ZOOM', 'dernière commande rappelée');
  await page.fill('#termCmd', '');
  // touche F4 : XRAY ; commande inconnue ; aide ; touches jaunes
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('F4');
  assert.match(await pane(0).locator('.tp-bar').innerText(), /XRAY/);
  await run('inconnu');
  await page.waitForFunction(() => /commande inconnue/.test($('#termMsg').innerText));
  await page.locator('#termKeys button', { hasText: 'HELP' }).click();
  assert.match(await page.locator('#termGrid').innerText(), /CW8 GP <GO>/);
  await page.locator('#termKeys .k-yel', { hasText: 'INDEX' }).click();
  assert.match(await page.inputValue('#termCmd'), /INDEX/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#term').evaluate(t => t.classList.contains('hidden')));
}));

test('terminal : fréquence RFR (barre du haut, liste mobile, commande) et appel groupé au relais', () => run({ state: sampleState({ settings: { baseCurrency: 'EUR', refreshSec: 60 } }) }, async ({ page, context, calls }) => {
  // relais simulé : un cours pour chaque symbole de l'appel groupé (indices compris), pour ne pas dépendre de l'heure d'ouverture des bourses
  const spy = readFileSync(join(root, 'tests/fixtures/relay/quote-SPY.json'), 'utf8');
  await context.route('https://apistock-yahoo.aurelien-potot.workers.dev/**', route => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams);
    if (q.type !== 'quotes') return route.fallback();
    calls.push(q);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"results":{' + q.symbols.split(',').map(s => JSON.stringify(s) + ':' + spy).join(',') + '}}' });
  });
  await page.click('#tabMoreBtn');
  await page.click('#termOpen');
  await page.waitForSelector('#term:not(.hidden) #termPort tbody tr');
  const lit = () => page.evaluate(() => $$('#termRfr .k-rfr.on').map(b => b.textContent).join(','));
  assert.equal(await lit(), '1M', 'réglage en cours allumé');
  await page.click('#termRfr .k-rfr[data-rfr="1"]');
  assert.equal(await lit(), '1S');
  assert.equal(await page.evaluate(() => Store.state.settings.refreshSec), 1, 'réglage commun modifié');
  assert.equal(await page.evaluate(() => $('#setRefresh').value), '1', 'Réglages suit');
  await page.fill('#termCmd', 'WEI'); await page.keyboard.press('Enter');
  // à la seconde, les cotations Yahoo du terminal partent par paquets (type=quotes), pas une requête par symbole
  const n0 = calls.length;
  await page.waitForTimeout(3500);
  const recent = calls.slice(n0);
  const batches = recent.filter(q => q.type === 'quotes');
  assert.ok(batches.length >= 2, 'appels groupés à chaque tour');
  assert.ok(batches.every(q => q.symbols.split(',').length <= 40), '40 symboles au plus par appel');
  assert.ok(batches.filter(q => q.symbols.split(',').includes('^GSPC')).length >= 2, 'indices de WEI redemandés à chaque tour, dans les paquets');
  assert.equal(recent.filter(q => q.type === 'chart' && !q.period1 && !q.events && q.symbol && q.symbol.startsWith('^')).length, 0, 'pas d\'appel un par un pour les indices');
  assert.match(await page.locator('#termStatus').innerText(), /RFR\s+1S/);
  // clignotement : vert à la hausse, rouge à la baisse, rien au premier affichage ni sans changement
  assert.deepEqual(await page.evaluate(() => [App.termFl('T', 10).class, App.termFl('T', 10).class, App.termFl('T', 11).class, App.termFl('U', 5).class, App.termFl('U', 4).class]),
    [undefined, undefined, 'fl-up', undefined, 'fl-dn']);
  // commande RFR, puis OFF : plus aucun appel automatique
  await page.fill('#termCmd', 'RFR 5M'); await page.keyboard.press('Enter');
  assert.equal(await lit(), '5M');
  await page.fill('#termCmd', 'RFR OFF'); await page.keyboard.press('Enter');
  assert.equal(await lit(), 'OFF');
  await page.waitForTimeout(1500);
  const n1 = calls.length;
  await page.waitForTimeout(3000);
  assert.equal(calls.length, n1, 'OFF : aucun appel');
  // mobile : liste déroulante à la place des boutons
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await page.locator('#termRfrSel').isVisible());
  assert.ok(!(await page.locator('#termRfr .k-rfr').first().isVisible()));
  await page.selectOption('#termRfrSel', '15');
  assert.equal(await page.evaluate(() => Store.state.settings.refreshSec), 15);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pas de débordement horizontal');
}));

test('terminal : relais sans appel groupé (worker pas redéployé) → cotations une par une', () => run({ state: sampleState({ settings: { baseCurrency: 'EUR', refreshSec: 1 } }) }, async ({ page, context }) => {
  // le relais simulé répond comme un ancien worker à type=quotes
  await context.route('https://apistock-yahoo.aurelien-potot.workers.dev/**', route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'quotes') return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"requête invalide"}' });
    return route.fallback();
  });
  await page.click('#tabMoreBtn');
  await page.click('#termOpen');
  await page.waitForSelector('#term:not(.hidden) #termPort tbody tr');
  await page.waitForFunction(() => Api._noBatch === true && Api.cachedQuote('SPY@ARCX'));
  await page.fill('#termCmd', 'SPY US DES'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /\d/.test(($('#termGrid .des-head b') || {}).textContent || ''));
}));

test('visite guidée : au premier lancement, au clavier, puis relançable depuis le menu ⋯', async () => {
  const app = await openApp(browser, url, { state: sampleState(), tour: true });
  const { page } = app;
  try {
    await page.waitForSelector('.tour .tour-bubble h3');
    assert.match(await page.locator('.tour-bubble h3').innerText(), /Bienvenue/);
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('.tour-bubble h3').innerText(), /Portefeuille/);
    // le projecteur entoure l'onglet présenté
    await page.waitForFunction(() => { // fin de l'animation du projecteur
      const s = document.querySelector('.tour-spot').getBoundingClientRect(), t = document.querySelector('.tabs .tab[data-view="portfolio"]').getBoundingClientRect();
      return Math.abs(s.x + 6 - t.x) < 2 && Math.abs(s.y + 6 - t.y) < 2;
    });
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('.tour-bubble h3').innerText(), /C'est parti/);
    await page.click('.tour-next');
    assert.equal(await page.locator('.tour').count(), 0);
    assert.ok(await page.evaluate(() => localStorage.getItem('apistock:tourDone')));
    // pas de nouvelle visite au rechargement, mais relançable depuis le menu
    await page.reload();
    await page.waitForFunction(() => typeof App !== 'undefined' && App._booted);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.tour').count(), 0);
    await page.click('#tabMoreBtn');
    await page.click('#tourOpen');
    await page.waitForSelector('.tour .tour-bubble');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.tour').count(), 0);
    assert.deepEqual(app.errors, [], 'erreurs JavaScript');
  } finally { await app.context.close(); }
});

test('performance réelle, attribution face au MSCI World, styles, écart de suivi, ordre, crédit et filtre d\'actions', () => run({ state: sampleState({
  assets: [{ id: 'a1', type: 'immo', name: 'Appartement', value: 300000, debt: 182000, date: '2025-01-01' }],
}) }, async ({ page }) => {
  // performance réelle : historique chargé à la demande, gain en pouvoir d'achat et tableau par année
  await page.evaluate(() => App.show('analysis', 'performance'));
  if (await page.locator('#inflRun').count()) await page.click('#inflRun');
  await page.waitForSelector('#inflBody .infl-table', { timeout: 20000 });
  assert.match(await page.locator('#inflBody').innerText(), /pouvoir d'achat/);
  assert.match(await page.locator('#inflBody .infl-table').innerText(), /2025/);
  // attribution : écart total = répartition géographique + choix des lignes
  await page.click('#attrPeriods button[data-period="max"]');
  await page.click('#attrRun');
  await page.waitForSelector('#attrBody .attr-bars', { timeout: 30000 });
  const attr = await page.locator('#attrBody').innerText();
  assert.match(attr, /contre .* pour le MSCI World/);
  assert.match(attr, /Répartition géographique[\s\S]*Choix des lignes[\s\S]*Écart total/);
  assert.match(attr, /États-Unis/);
  // styles : expositions du portefeuille et de chaque ligne
  await page.evaluate(() => App.show('analysis', 'risque'));
  await page.click('#styleRun');
  await page.waitForSelector('#styleBody .style-table', { timeout: 30000 });
  assert.match(await page.locator('#styleBody .style-verdict').innerText(), /Ton portefeuille/);
  assert.equal(await page.locator('#styleBody .style-table tbody tr').count(), 3);
  // fiche de CW8 : passer un ordre (Euronext : fourchette estimée) et écart de suivi face au MSCI World
  await page.evaluate(() => { App.show('markets', 'suivi'); App.selectDetail('CW8@XPAR'); });
  await page.waitForSelector('#detailOrder .order-panel', { timeout: 15000 });
  const order = await page.locator('#detailOrder').innerText();
  assert.match(order, /passer un ordre/i);
  assert.match(order, /Bon moment|attendre|Bourse fermée/);
  assert.match(order, /New York/);
  await page.fill('#detailOrder .order-amount', '250000');
  await page.waitForFunction(() => /découpe-le|Montant échangé/.test(document.querySelector('#detailOrder .order-cost').innerText));
  await page.click('#tdRun');
  await page.waitForSelector('#detailTrackBody .td-table', { timeout: 30000 });
  assert.equal(await page.locator('#detailTrackBody [data-tip*="URTH"]').count(), 1);
  assert.match(await page.locator('#detailTrackBody .td-verdict').innerText(), /frais/);
  // crédit : capital restant repris du patrimoine, verdict et point d'équilibre
  await page.evaluate(() => App.show('plan', 'simuler'));
  await page.waitForSelector('#creditForm');
  assert.equal(await page.inputValue('#crCapital'), '182000');
  await page.fill('#crAmount', '30000');
  await page.fill('#crRet', '2');
  await page.waitForFunction(() => /rembourser est plus intéressant/.test(document.querySelector('#creditOut .credit-verdict').innerText));
  assert.match(await page.locator('#creditOut').innerText(), /Point d'équilibre/);
  // filtre d'actions : NVIDIA (seule société enregistrée) apparaît sans filtre, disparaît avec « Rendement »
  await page.evaluate(() => App.show('markets', 'signaux'));
  await page.click('#screenRun');
  await page.waitForSelector('#screenOut p.small', { timeout: 20000 });
  await page.click('#screenPresets button[data-preset="all"]');
  await page.waitForSelector('#screenOut .screen-table');
  assert.match(await page.locator('#screenOut .screen-table').innerText(), /NVIDIA/);
  await page.click('#screenPresets button[data-preset="yield"]');
  assert.doesNotMatch(await page.locator('#screenOut').innerText(), /NVIDIA/);
}));

test('courtiers, obligations, devises, diversification, budget, revue du mois et export Excel', () => run({ state: sampleState({
  instruments: Object.assign({}, sampleState().instruments, {
    'EUAGG@': { symbol: 'EUAGG', mic: '', name: 'Fonds Euro Aggregate Bond', currency: 'EUR', type: 'Valeur saisie', provider: 'manual', values: [['2025-01-02', 100], ['2026-10-01', 104]] },
  }),
  transactions: sampleState().transactions.concat([{ id: 't9', key: 'EUAGG@', type: 'buy', date: '2025-01-02', account: 'cto', qty: 20, price: 100, fees: 0 }]),
  assets: [{ id: 'l1', type: 'livretA', name: 'Livret A', value: 9000, rate: 1.5, date: '2026-10-01' }],
}) }, async ({ page }) => {
  // comparateur de courtiers : tes frais réels et les barèmes relevés
  await page.evaluate(() => App.show('portfolio', 'operations'));
  await page.waitForSelector('#brokerBody .broker-table');
  const brk = await page.locator('#brokerBody').innerText();
  assert.match(brk, /Ce que tu as payé/);
  assert.match(brk, /BoursoBank · Découverte/);
  assert.match(brk, /Fortuneo · Starter/);
  // obligations : saisie du rendement et de la sensibilité, effet d'une hausse des taux
  await page.evaluate(() => App.show('analysis', 'risque'));
  await page.waitForSelector('#bondBody .bond-table');
  await page.fill('#bondBody .bond-table input[aria-label^="ytm"]', '3.1');
  await page.locator('#bondBody .bond-table input[aria-label^="ytm"]').dispatchEvent('change');
  await page.fill('#bondBody .bond-table input[aria-label^="dur"]', '6');
  await page.locator('#bondBody .bond-table input[aria-label^="dur"]').dispatchEvent('change');
  await page.waitForFunction(() => /Si les taux montent de 1 point/.test(document.querySelector('#bondBody .bond-verdict').innerText));
  assert.equal(await page.evaluate(() => Store.instrument('EUAGG@').bond.dur), '6');
  // diversification dans le temps : corrélations glissantes et graphique
  await page.click('#divtRun');
  await page.waitForSelector('#divtBody .div-verdict', { timeout: 30000 });
  assert.match(await page.locator('#divtBody .div-verdict').innerText(), /pari/);
  // devises : exposition en regardant dans les ETF
  await page.evaluate(() => App.show('analysis', 'composition'));
  await page.waitForSelector('#fxBody .fx-table');
  assert.match(await page.locator('#fxBody .fx-table').innerText(), /USD/);
  assert.match(await page.locator('#fxBody .fx-verdict').innerText(), /dollar/);
  assert.doesNotMatch(await page.locator('#fxBody').innerText(), /\[object /);
  // budget : précaution complète → plan du mois préparé
  await page.evaluate(() => App.show('plan', 'investir'));
  await page.waitForSelector('#budgetForm');
  await page.fill('#bud-income', '3000');
  await page.fill('#bud-expenses', '1500');
  await page.selectOption('#bud-months', '3');
  await page.waitForSelector('#budgetToPlan');
  await page.click('#budgetToPlan');
  assert.equal(await page.inputValue('#planAmount'), '1500');
  assert.doesNotMatch(await page.locator('#budgetOut').innerText(), /\[object /);
  // revue du mois
  await page.evaluate(() => App.show('analysis', 'performance'));
  await page.waitForSelector('#revOut .rev-verdict', { timeout: 20000 });
  assert.match(await page.locator('#revOut .rev-verdict').innerText(), /ton portefeuille a (gagné|perdu)/);
  assert.doesNotMatch(await page.locator('#revOut').innerText() + await page.locator('#bondBody').innerText(), /\[object /);
  // export Excel : un vrai fichier .xlsx (zip)
  await page.evaluate(() => App.show('portfolio', 'operations'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlsxExport')]);
  assert.match(dl.suggestedFilename(), /^apistock-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(await dl.path());
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b]);
}));
