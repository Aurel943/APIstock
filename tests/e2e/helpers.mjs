/*
 * Outils des tests de bout en bout : serveur local du site, relais Yahoo simulé (réponses enregistrées dans
 * tests/fixtures/relay/, voir scripts/record-fixtures.mjs) et navigateur Playwright.
 * Aucune requête ne sort de la machine : tout ce qui n'est ni le site local ni le relais simulé est bloqué et signalé.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { root } from '../harness.mjs';

const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');

const FIX = join(root, 'tests', 'fixtures');
const RELAY = 'https://apistock-yahoo.aurelien-potot.workers.dev';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Serveur statique du site (port libre choisi par le système) */
export function startServer() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const slug = s => s.replace(/[^A-Za-z0-9]+/g, '_');
const fixture = name => { const f = join(FIX, 'relay', name + '.json'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };

/** Réponse du relais simulé pour une URL donnée */
export function relayResponse(url, calls) {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams);
  calls.push(q);
  const json = body => ({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  if (q.type === 'chart') {
    const kind = q.events ? 'events' : q.period1 ? 'daily' : 'quote';
    const body = fixture(`${kind}-${slug(q.symbol || '')}`);
    return json(body || { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } });
  }
  if (q.type === 'search') return json(fixture('search-' + slug(q.q || '')) || { quotes: [] });
  if (q.type === 'news') return json({ news: [], lang: 'fr' });
  if (q.type === 'ogimage') return { status: 404, body: '' };
  return json({ unsupported: true }); // stats, sync, push… : fonctions du worker Cloudflare non simulées
}

/**
 * Ouvre le site dans un nouveau contexte. `state` : données initiales (localStorage « apistock:v1 »).
 * Renvoie { page, errors, calls, blocked } : erreurs JavaScript, appels au relais, requêtes externes bloquées.
 */
export async function openApp(browser, baseUrl, { state, device, theme, hash = '' } = {}) {
  const context = await browser.newContext(Object.assign({ locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme: theme || 'light', serviceWorkers: 'block' },
    device ? devices[device] : { viewport: { width: 1280, height: 900 } }));
  const errors = [], calls = [], blocked = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(baseUrl)) return route.continue();
    if (url.startsWith(RELAY)) return route.fulfill(relayResponse(url, calls));
    if (/cdnjs\.cloudflare\.com\/.*chart/i.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(FIX, 'chart-stub.js'), 'utf8') });
    if (!/fonts\.(googleapis|gstatic)\.com/.test(url)) blocked.push(url);
    return route.abort();
  });
  if (state) await context.addInitScript(s => { if (!sessionStorage.getItem('e2e:seeded')) { localStorage.setItem('apistock:v1', s); sessionStorage.setItem('e2e:seeded', '1'); } }, JSON.stringify(state));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + 'index.html' + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => typeof App !== 'undefined' && App.view && document.readyState === 'complete');
  return { page, context, errors, calls, blocked };
}

/** Portefeuille d'exemple : deux ETF en euros et un en dollars, sur un PEA et un compte-titres */
export function sampleState(extra = {}) {
  return Object.assign({
    settings: { baseCurrency: 'EUR', refreshSec: 0 },
    accounts: [{ id: 'pea', name: 'PEA', type: 'pea', taxRate: 17.2 }, { id: 'cto', name: 'Compte-titres', type: 'cto', taxRate: 30 }],
    instruments: {
      'CW8@XPAR': { symbol: 'CW8', mic: 'XPAR', exchange: 'Paris', name: 'Amundi MSCI World UCITS ETF', currency: 'EUR', type: 'ETF', provider: 'yahoo', ysymbol: 'CW8.PA' },
      'ESE@XPAR': { symbol: 'ESE', mic: 'XPAR', exchange: 'Paris', name: 'BNP Paribas Easy S&P 500 UCITS ETF', currency: 'EUR', type: 'ETF', provider: 'yahoo', ysymbol: 'ESE.PA' },
      'SPY@ARCX': { symbol: 'SPY', mic: 'ARCX', exchange: 'NYSE Arca', name: 'SPDR S&P 500 ETF Trust', currency: 'USD', type: 'ETF', provider: 'yahoo', ysymbol: 'SPY' },
    },
    transactions: [
      { id: 't1', key: 'CW8@XPAR', type: 'buy', date: '2024-01-15', account: 'pea', qty: 5, price: 430, fees: 2 },
      { id: 't2', key: 'ESE@XPAR', type: 'buy', date: '2024-03-04', account: 'pea', qty: 100, price: 24.5, fees: 1 },
      { id: 't3', key: 'SPY@ARCX', type: 'buy', date: '2024-02-01', account: 'cto', qty: 3, price: 490, fees: 1 },
      { id: 't4', key: 'SPY@ARCX', type: 'sell', date: '2025-02-03', account: 'cto', qty: 1, price: 600, fees: 1 },
    ],
    watchlist: ['CW8@XPAR'],
  }, extra);
}
