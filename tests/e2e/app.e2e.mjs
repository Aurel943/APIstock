/*
 * Tests de bout en bout (navigateur Chromium via Playwright) : `npm run test:e2e`.
 * Site servi en local, relais Yahoo simulé avec les réponses de tests/fixtures/relay/ : aucun appel réseau réel.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startServer, openApp, sampleState } from './helpers.mjs';

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
  await page.locator('#txInstrument button', { hasText: 'ESE · XPAR' }).click();
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

  // modification depuis le tableau des opérations
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
  await page.locator('#txInstrument button', { hasText: 'CW8 · XPAR' }).click();
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
  const item = page.locator('#todoList .todo-item.plan', { hasText: 'Versement programmé · CW8' }).first();
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
  assert.equal(await page.locator('#todoList .todo-item.plan', { hasText: 'Versement programmé · CW8' }).count(), 1); // reste l'échéance de ce mois
}));

test('mouvement d\'espèces : le solde du compte apparaît', () => run({ state: sampleState() }, async ({ page }) => {
  await page.click('#cashAdd');
  await page.selectOption('#cashAcc', 'pea');
  await page.fill('#cashDate', '2024-01-02');
  await page.fill('#cashAmount', '5000');
  await page.click('#cashForm button[type=submit]');
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
