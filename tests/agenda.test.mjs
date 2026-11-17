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

/* Réponse Yahoo (quoteSummary : calendarEvents + earnings) réduite, d'après NVIDIA le 17/11/2026 */
const nvda = () => ({
  calendarEvents: { earnings: {
    earningsDate: [{ raw: 1794949200 }], isEarningsDateEstimate: false,
    earningsAverage: { raw: 2.47071 }, earningsLow: { raw: 2.25754 }, earningsHigh: { raw: 2.7 },
    revenueAverage: { raw: 108710527430 },
  } },
  earnings: { financialCurrency: 'USD', earningsChart: {
    quarterly: [
      { actual: { raw: 1.87 }, estimate: { raw: 1.77191 }, fiscalQuarter: '1Q2027', calendarQuarter: '1Q2026', reportedDate: { raw: 1779308400 } },
      { actual: { raw: 2.22 }, estimate: { raw: 2.09113 }, fiscalQuarter: '2Q2027', calendarQuarter: '2Q2026', reportedDate: { raw: 1787775600 } },
    ],
    currentQuarterEstimate: { raw: 2.47071 }, currentFiscalQuarter: '3Q2027', currentCalendarQuarter: '3Q2026',
    currentPeriodEndDate: { raw: 1793404800 }, earningsDate: [{ raw: 1794949200 }], isEarningsDateEstimate: false,
  } },
});

test('résultats : prochaine publication, trimestre, attentes des analystes et trimestre précédent', () => {
  const a = load();
  const E = a.get('Earnings');
  const [e] = JSON.parse(JSON.stringify(E.eventsFor(nvda(), 'NVIDIA', { mic: 'XNAS', currency: 'USD' }, '2026-11-12', '2027-11-12')));
  assert.equal(e.date, '2026-11-17');
  assert.equal(e.kind, 'earn');
  assert.equal(e.title, 'Résultats T3 de l\'exercice 2027 · NVIDIA', 'exercice décalé de NVIDIA');
  assert.match(e.sub, /^Après la clôture de Wall Street \(vers 22h00, heure de Paris\)/);
  assert.match(e.sub, /trimestre clos le 31 oct\. 2026/);
  assert.match(e.sub, /bénéfice par action attendu 2,47\s\$US \(estimations de 2,26\s\$US à 2,70\s\$US\)/);
  assert.match(e.sub, /chiffre d'affaires attendu 108,7\sMd\s\$US/);
  assert.match(e.sub, /trimestre précédent : bénéfice par action 2,22\s\$US contre 2,09\s\$US attendu \(\+6,2\s%, au-dessus des attentes\)/);
  assert.equal(E.quarterLabel('4Q2026', '4Q2026'), 'T4 2026');
  // date passée : rien
  assert.equal(E.eventsFor(nvda(), 'NVIDIA', { mic: 'XNAS' }, '2026-11-18', '2027-11-18').length, 0);
});

test('résultats : date estimée (fourchette) et publication du jour', () => {
  const a = load();
  const E = a.get('Earnings');
  const d = nvda();
  d.calendarEvents.earnings.isEarningsDateEstimate = true;
  d.calendarEvents.earnings.earningsDate = [{ raw: Date.UTC(2027, 1, 24, 12) / 1000 }, { raw: Date.UTC(2027, 2, 1, 12) / 1000 }];
  const [e] = E.eventsFor(d, 'NVIDIA', { mic: 'XNAS' }, '2026-11-18', '2027-11-18');
  assert.equal(e.date, '2027-02-24');
  assert.match(e.sub, /^Date estimée, entre le 24 févr\. 2027 et le 01 mars 2027/);
  // le jour de la publication : résultat réel contre attendu
  d.earnings.earningsChart.quarterly.push({ actual: { raw: 2.1 }, estimate: { raw: 2.47 }, fiscalQuarter: '3Q2027', calendarQuarter: '3Q2026', reportedDate: { raw: Date.UTC(2026, 10, 18, 21) / 1000 } });
  const pub = E.eventsFor(d, 'NVIDIA', { mic: 'XNAS' }, '2026-11-18', '2027-11-18').find(x => /publiés/.test(x.title));
  assert.equal(pub.date, '2026-11-18');
  assert.match(pub.sub, /en dessous des attentes/);
});

test('résultats : seules les actions suivies sont interrogées, les réponses en cache alimentent l\'agenda', () => {
  const a = loadApp(Object.assign(state(), {
    instruments: Object.assign(state().instruments, {
      'NVDA@XNAS': { symbol: 'NVDA', mic: 'XNAS', name: 'NVIDIA', currency: 'USD', type: 'Action' },
      'Y:^FCHI': { symbol: '^FCHI', ysymbol: '^FCHI', provider: 'yahoo', mic: '', name: 'CAC 40', currency: 'EUR', type: 'Indice' },
    }),
    watchlist: ['NVDA@XNAS', 'Y:^FCHI'],
  }));
  a.Api.cachedQuote = () => ({ price: 500, change: 0, percentChange: 0 });
  const E = a.get('Earnings');
  const syms = E.targets().map(t => t.sym);
  assert.ok(syms.includes('NVDA') && !syms.includes('^FCHI'), syms.join());
  E.cache = { NVDA: { ts: Date.now(), data: nvda() } };
  const ev = a.get('Agenda').events('2026-11-12', 366).filter(e => e.kind === 'earn');
  assert.equal(ev.length, 1);
  assert.match(ev[0].title, /NVIDIA/);
});

test('macro : banques centrales, inflation et emploi américains, quatre sorcières, heure de Paris', () => {
  const a = load();
  const ev = JSON.parse(JSON.stringify(a.get('Agenda').events('2026-11-17', 366))).filter(e => e.kind === 'eco');
  const fed = ev.filter(e => /Fed/.test(e.title));
  assert.equal(fed[0].date, '2026-12-09');
  assert.match(fed[0].sub, /^À 20h00 \(heure de Paris\)/);
  assert.match(fed[0].sub, /dot plot/);
  // mi-mars : heure d'été déjà en vigueur aux États-Unis, pas encore en Europe
  assert.match(fed.find(e => e.date === '2027-03-17').sub, /^À 19h00/);
  assert.ok(ev.some(e => e.date === '2026-12-17' && /BCE/.test(e.title) && /^À 14h15/.test(e.sub)));
  assert.ok(ev.some(e => e.date === '2027-01-13' && /inflation \(CPI\) de décembre/.test(e.title)));
  assert.ok(ev.some(e => e.date === '2026-12-04' && /emploi de novembre/.test(e.title) && /^À 14h30/.test(e.sub)));
  const w = ev.filter(e => /Quatre sorcières/.test(e.title)).map(e => e.date);
  assert.deepEqual(w, ['2026-12-18', '2027-03-19', '2027-06-18', '2027-09-17']);
  assert.match(ev.find(e => e.date === '2027-06-18' && /sorcières/.test(e.title)).sub, /Wall Street est fermée/);
});
