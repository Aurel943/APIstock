/*
 * Relais Yahoo Finance pour Vercel (fonction serverless).
 * Si le site est déployé sur Vercel, ce fichier est servi à /api/yahoo et
 * l'application le détecte automatiquement (rien à configurer).
 *
 * Seuls deux appels en lecture sont autorisés : graphique/cotation et recherche.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SYMBOL_RE = /^[A-Za-z0-9.\-=^&]{1,25}$/;

function buildUpstream(q) {
  if (q.type === 'chart') {
    if (!SYMBOL_RE.test(q.symbol || '')) return null;
    const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(q.symbol));
    for (const k of ['range', 'interval', 'period1', 'period2']) if (q[k]) u.searchParams.set(k, String(q[k]).slice(0, 20));
    u.searchParams.set('includePrePost', 'false');
    return u;
  }
  if (q.type === 'search') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', String(q.q || '').slice(0, 40));
    u.searchParams.set('quotesCount', '20');
    u.searchParams.set('newsCount', '0');
    return u;
  }
  return null;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  const q = req.query || {};
  if (q.type === 'ping') { res.status(200).json({ ok: true }); return; }
  const upstream = buildUpstream(q);
  if (!upstream) { res.status(400).json({ error: 'requête invalide' }); return; }

  try {
    const r = await fetch(upstream, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } });
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', q.type === 'search' ? 's-maxage=86400' : 's-maxage=15');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'Yahoo injoignable : ' + e.message });
  }
};
