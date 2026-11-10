/*
 * Relais Yahoo Finance pour Cloudflare Workers (gratuit : 100 000 requêtes/jour).
 *
 * Installation :
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
 *   2. Donne-lui un nom (ex. "apistock-yahoo") → Deploy → Edit code
 *   3. Remplace tout le code par ce fichier → Deploy
 *   4. Copie l'URL du worker (https://apistock-yahoo.<ton-compte>.workers.dev)
 *      dans APIstock → Réglages → « Relais Yahoo Finance »
 *
 * Seuls deux appels en lecture sont autorisés : graphique/cotation et recherche.
 * Pour réserver le relais à ton site, liste ses adresses ci-dessous.
 */
const ALLOWED_ORIGINS = [
  'https://aurel943.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];
const SYMBOL_RE = /^[A-Za-z0-9.\-=^&]{1,25}$/;

function buildUpstream(q) {
  const type = q.get('type');
  if (type === 'chart') {
    const symbol = q.get('symbol') || '';
    if (!SYMBOL_RE.test(symbol)) return null;
    const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol));
    for (const k of ['range', 'interval', 'period1', 'period2']) if (q.get(k)) u.searchParams.set(k, q.get(k).slice(0, 20));
    u.searchParams.set('includePrePost', 'false');
    return u;
  }
  if (type === 'search') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', (q.get('q') || '').slice(0, 40));
    u.searchParams.set('quotesCount', '20');
    u.searchParams.set('newsCount', '0');
    return u;
  }
  return null;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, {});
    const cors = { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

    const q = new URL(request.url).searchParams;
    if (q.get('type') === 'ping') return json({ ok: true }, 200, cors);
    const upstream = buildUpstream(q);
    if (!upstream) return json({ error: 'requête invalide' }, 400, cors);

    try {
      const r = await fetch(upstream, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' },
        cf: { cacheTtl: q.get('type') === 'search' ? 86400 : 1, cacheEverything: true }, // 1 s : compatible avec le rafraîchissement chaque seconde
      });
      return new Response(await r.text(), { status: r.status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
    } catch (e) {
      return json({ error: 'Yahoo injoignable : ' + e.message }, 502, cors);
    }
  },
};
