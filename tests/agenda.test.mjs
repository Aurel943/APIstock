import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const state = () => ({
  accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 18.6, openDate: '2022-03-01' }, { id: 'cto', name: 'CTO', type: 'cto', taxRate: 31.4 }],
  instruments: {
    'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', name: 'Amundi MSCI World', currency: 'EUR' },
    'SPY@ARCX': { symbol: 'SPY', mic: 'ARCX', name: 'SPDR S&P 500', currency: 'EUR' },
  },
  transactions: [
    { id: '1', key: 'CW8@XPAR', type: 'buy', date: '2022-03-01', account: 'pea', qty: 10, price: 400, fees: 0 },
    { id: '2', key: 'SPY@ARCX', type: 'buy', date: '2025-01-10', account: 'cto', qty: 3, price: 500, fees: 0 },
    { id: '3', key: 'SPY@ARCX', type: 'sell', date: '2026-03-10', account: 'cto', qty: 1, price: 600, fees: 0 },
  ],
  plans: [{ id: 'p', key: 'CW8@XPAR', account: 'pea', amount: 200, day: 5, start: '2026-01-01', active: true, done: {} }],
});
const load = () => {
  const a = loadApp(state());
  a.Api.cachedQuote = k => ({ price: k === 'CW8@XPAR' ? 500 : 600, change: 0, percentChange: 0 });
  a.Portfolio.invalidate();
  return a;
};

test('agenda : versements mensuels, jalon des 5 ans du PEA, jours fériés de la bourse, déclaration', () => {
  const a = load();
  const ev = JSON.parse(JSON.stringify(a.get('Agenda').events('2026-11-12', 366)));
  const plans = ev.filter(e => e.kind === 'plan');
  assert.equal(plans.length, 12);
  assert.equal(plans[0].date, '2026-12-05');
  assert.ok(ev.some(e => e.kind === 'tax' && e.date === '2027-03-01' && /5 ans/.test(e.title)), 'PEA : 5 ans');
  assert.ok(ev.some(e => e.kind === 'market' && e.date === '2026-12-25' && /Euronext Paris/.test(e.title)), 'Noël : Paris fermée');
  assert.ok(ev.some(e => e.kind === 'market' && /clôture anticipée/.test(e.title)), 'clôture anticipée du 24 ou du 31');
  const decl = ev.find(e => e.kind === 'tax' && /Déclaration des revenus 2026/.test(e.title));
  assert.ok(decl && decl.date === '2027-04-10' && /3VG/.test(decl.sub), 'vente de 2026 à déclarer en 2027');
  assert.deepEqual(ev.map(e => e.date), ev.map(e => e.date).slice().sort(), 'trié par date');
});

test('agenda : export iCalendar valide (journées entières, lignes CRLF ≤ 75 octets, caractères échappés)', () => {
  const a = load();
  const ics = a.get('Agenda').ics([{ date: '2026-12-05', kind: 'plan', title: 'Versement, programmé; test', sub: 'Une description très longue '.repeat(6) }], new Date('2026-11-12T10:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261206\r\n/);
  assert.ok(ics.includes('SUMMARY:Versement\\, programmé\\; test\r\n'), 'virgule et point-virgule échappés');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
