import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadApp, root } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('filtre d\'actions : indicateurs lus dans les modules Yahoo (NVIDIA enregistré)', () => {
  const S = loadApp({}).get('Screener');
  const d = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'relay', 'summary-NVDA.json'), 'utf8'));
  const m = S.metrics(d);
  near(m.pe, d.summaryDetail.trailingPE.raw);
  near(m.roe, d.financialData.returnOnEquity.raw * 100);
  near(m.upside, (d.financialData.targetMeanPrice.raw / d.financialData.currentPrice.raw - 1) * 100);
  assert.ok(m.dy >= 0 && m.dy < 1);
  const empty = S.metrics(null);
  assert.equal(empty.pe, null); assert.equal(empty.dy, 0); assert.equal(empty.upside, null);
});

test('filtre d\'actions : seuils, valeurs inconnues, zone et PEA', () => {
  const S = loadApp({}).get('Screener');
  const rows = [
    { sym: 'A', zone: 'fr', pea: true, m: { pe: 12, dy: 4, payout: 50, roe: 18, debtEq: 80 } },
    { sym: 'B', zone: 'us', pea: false, m: { pe: 35, dy: 0.5, payout: 20, roe: 40, debtEq: 30 } },
    { sym: 'C', zone: 'eu', pea: true, m: { pe: null, dy: 6, payout: 120, roe: null, debtEq: null } },
    { sym: 'D', zone: 'fr', pea: true, m: null },
  ];
  const ids = l => l.map(r => r.sym).join(',');
  assert.equal(ids(S.filter(rows, {})), 'A,B,C');
  assert.equal(ids(S.filter(rows, { filters: { peMax: 15 } })), 'A');             // PER inconnu : exclu
  assert.equal(ids(S.filter(rows, { filters: { dyMin: 3.5, payoutMax: 80 } })), 'A');
  assert.equal(ids(S.filter(rows, { filters: { roeMin: 15, debtMax: '' } })), 'A,B'); // seuil vide ignoré
  assert.equal(ids(S.filter(rows, { zone: 'us' })), 'B');
  assert.equal(ids(S.filter(rows, { pea: true })), 'A,C');
  const U = loadApp({}).get('SCREEN_UNIVERSE');
  assert.equal(new Set(U.map(u => u[0])).size, U.length, 'pas de doublon dans l\'univers');
  assert.ok(U.every(u => ['fr', 'eu', 'us'].includes(u[2])));
});
