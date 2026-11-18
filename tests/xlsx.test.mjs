import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApp } from './harness.mjs';

const state = {
  settings: { baseCurrency: 'EUR' },
  accounts: [{ id: 'cto', name: 'Compte-titres', type: 'cto', taxRate: 31.4 }],
  cashMoves: [{ id: 'c1', account: 'cto', type: 'deposit', date: '2024-01-10', amount: 5000 }, { id: 'c2', account: 'cto', type: 'withdraw', date: '2025-04-01', amount: 800, note: 'travaux' }],
  instruments: { 'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World <Acc> & co', currency: 'EUR', isin: 'LU1681043599' } },
  transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-15', account: 'cto', qty: 10, price: 400, fees: 2 },
    { id: '2', key: 'CW8@XPAR', type: 'sell', date: '2025-03-10', account: 'cto', qty: 4, price: 500, fees: 2, note: 'prise de bénéfices' },
    { id: '3', key: 'CW8@XPAR', type: 'div', date: '2025-06-01', account: 'cto', qty: 6, price: 1.5, fees: 0 },
  ],
};

test('export tableur : zip valide (CRC-32), colonnes, dates Excel, échappement XML', () => {
  const a = loadApp(state);
  const X = a.get('Xlsx');
  assert.equal(X.crc32(new TextEncoder().encode('123456789')), 0xcbf43926); // valeur de contrôle du CRC-32
  assert.equal(X.col(0), 'A'); assert.equal(X.col(25), 'Z'); assert.equal(X.col(26), 'AA'); assert.equal(X.col(701), 'ZZ');
  assert.equal(X.serial('2024-01-15'), 45306);
  assert.match(X.cell('a<b&c', 'A1'), /a&lt;b&amp;c/);
  assert.match(X.cell({ v: '2024-01-15', f: 'date' }, 'B2'), /s="5"><v>45306</);
  assert.equal(X.cell(NaN, 'A1'), '');
  const z = X.zip([{ name: 'a.txt', data: 'bonjour' }]);
  assert.deepEqual(Array.from(z.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
});

test('export tableur : le classeur s\'ouvre (openpyxl) avec ses feuilles, nombres et dates', (t) => {
  try { execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' }); } catch (e) { t.skip('openpyxl absent'); return; }
  const a = loadApp(state);
  const bytes = a.get('Xlsx').build(a.App.xlsxSheets());
  const file = join(mkdtempSync(join(tmpdir(), 'apistock-xlsx-')), 'export.xlsx');
  writeFileSync(file, bytes);
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ops = wb['Opérations']; cs = wb['Versements et retraits']; pv = wb['Plus-values réalisées']; yr = wb['Par année']; dv = wb['Dividendes']
print(json.dumps({ 'sheets': wb.sheetnames, 'op': [str(ops['A2'].value)[:10], ops['D2'].value, ops['K2'].value, ops['L3'].value, ops['A2'].number_format],
  'cash': [cs['C2'].value, cs['D2'].value, cs['C3'].value, cs['D3'].value, cs['E3'].value], 'pv': [pv['I2'].value], 'yr': [yr['A2'].value, yr['E2'].value, yr['F2'].value], 'dv': [dv['D2'].value], 'freeze': ops.freeze_panes }))`, file]).toString());
  assert.deepEqual(out.sheets, ['Synthèse', 'Positions', 'Opérations', 'Versements et retraits', 'Plus-values réalisées', 'Par année', 'Dividendes']);
  assert.deepEqual(out.cash, ['Versement', 5000, 'Retrait', -800, 'travaux']);
  assert.deepEqual(out.op.slice(0, 4), ['2024-01-15', 'Amundi MSCI World <Acc> & co', 4002, 'prise de bénéfices']);
  assert.equal(out.op[4], 'dd/mm/yyyy');
  // vente de 4 parts à 500 € (2 € de frais), prix moyen 400,20 € : 1 998 − 1 600,80
  assert.ok(Math.abs(out.pv[0] - (1998 - 1600.8)) < 1e-6, String(out.pv[0]));
  assert.equal(out.yr[0], 2025);
  assert.ok(Math.abs(out.yr[1] - 397.2) < 1e-6 && Math.abs(out.yr[2] - 9) < 1e-6);
  assert.ok(Math.abs(out.dv[0] - 9) < 1e-9);
  assert.equal(out.freeze, 'A2');
});
