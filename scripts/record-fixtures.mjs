#!/usr/bin/env node
/*
 * Enregistre des réponses Yahoo Finance réelles dans tests/fixtures/relay/ pour les tests de bout en bout
 * (le relais y est simulé : aucun appel réseau pendant les tests).
 *   node scripts/record-fixtures.mjs
 * Seuls des symboles publics sont demandés à Yahoo : aucune donnée personnelle n'est envoyée.
 * Les réponses sont allégées (cours de clôture uniquement) pour garder des fichiers petits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'relay');
mkdirSync(out, { recursive: true });
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; apistock-fixtures)' };
const get = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(url + ' → ' + r.status); return r.json(); };
const slug = s => s.replace(/[^A-Za-z0-9]+/g, '_');

const SYMBOLS = ['CW8.PA', 'ESE.PA', 'WLD.PA', 'SPY', 'IWDA.AS', 'USDEUR=X', 'GBPEUR=X'];
const SEARCHES = ['CW8', 'ESE', 'SPY', 'FR0010315770', 'Amundi MSCI World Swap II UCITS ETF Dist', 'IE00B5BMR087', 'iShares Core S&P 500 UCITS ETF USD (Acc)'];
const p1 = Math.floor(Date.UTC(2022, 0, 1) / 1000), p2 = Math.floor(Date.now() / 1000);

function slim(json, keepEvents) {
  const r = json.chart.result[0];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const res = { meta: r.meta, timestamp: r.timestamp, indicators: { quote: [{ close: q.close, open: q.open }] } };
  if (keepEvents && r.events) res.events = r.events;
  return { chart: { result: [res], error: null } };
}

for (const s of SYMBOLS) {
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s);
  writeFileSync(join(out, `quote-${slug(s)}.json`), JSON.stringify(slim(await get(base + '?range=1d&interval=5m'))));
  writeFileSync(join(out, `daily-${slug(s)}.json`), JSON.stringify(slim(await get(base + `?interval=1d&period1=${p1}&period2=${p2}`))));
  writeFileSync(join(out, `events-${slug(s)}.json`), JSON.stringify(slim(await get(base + `?interval=1mo&events=div,split&period1=${p1}&period2=${p2}`), true)));
  console.log('✔', s);
}
for (const q of SEARCHES) {
  const j = await get('https://query1.finance.yahoo.com/v1/finance/search?quotesCount=20&newsCount=0&q=' + encodeURIComponent(q));
  writeFileSync(join(out, `search-${slug(q)}.json`), JSON.stringify({ quotes: j.quotes || [] }));
  console.log('✔ recherche', q);
}
