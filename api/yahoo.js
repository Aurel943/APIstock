/*
 * Relais Yahoo Finance pour Vercel (fonction serverless).
 * Si le site est déployé sur Vercel, ce fichier est servi à /api/yahoo et
 * l'application le détecte automatiquement (rien à configurer).
 *
 * Appels Yahoo autorisés, en lecture seule : graphique/cotation (avec dividendes et divisions), recherche, et actualités (Google Actualités en français, Yahoo en secours).
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SYMBOL_RE = /^[A-Za-z0-9.\-=^&]{1,25}$/;

function buildUpstream(q) {
  if (q.type === 'chart') {
    if (!SYMBOL_RE.test(q.symbol || '')) return null;
    const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(q.symbol));
    for (const k of ['range', 'interval', 'period1', 'period2']) if (q[k]) u.searchParams.set(k, String(q[k]).slice(0, 20));
    u.searchParams.set('includePrePost', 'false');
    if (q.events && /^(div|split)(,(div|split))?$/.test(q.events)) u.searchParams.set('events', q.events);
    return u;
  }
  if (q.type === 'search') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', String(q.q || '').slice(0, 60));
    u.searchParams.set('quotesCount', '20');
    u.searchParams.set('newsCount', '0');
    return u;
  }
  return null;
}

/* Actualités en français : Google Actualités (flux RSS France), Yahoo (anglais) en secours */
const decodeXml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function parseGoogleNews(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = t => { const x = m[1].match(new RegExp('<' + t + '(?: [^>]*)?>([\\s\\S]*?)<\\/' + t + '>')); return x ? decodeXml(x[1]).trim() : ''; };
    const source = tag('source');
    const site = (m[1].match(/<source url="([^"]+)"/) || [])[1] || '';
    let title = tag('title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = tag('link');
    if (!title || !/^https:\/\//.test(link)) continue;
    out.push({ uuid: tag('guid') || link, title, link, publisher: source, site, providerPublishTime: Math.floor(Date.parse(tag('pubDate')) / 1000) || 0 });
    if (out.length >= 12) break;
  }
  return out;
}

async function news(q) {
  const query = String(q.q || '').slice(0, 80).trim();
  try {
    const u = new URL('https://news.google.com/rss/search');
    u.searchParams.set('q', query + ' when:14d');
    u.searchParams.set('hl', 'fr'); u.searchParams.set('gl', 'FR'); u.searchParams.set('ceid', 'FR:fr');
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)' } });
    if (r.ok) { const items = parseGoogleNews(await r.text()); if (items.length) return { lang: 'fr', news: items }; }
  } catch (e) { /* on passe à Yahoo */ }
  const y = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  y.searchParams.set('q', String(q.en || query).slice(0, 60)); y.searchParams.set('quotesCount', '0'); y.searchParams.set('newsCount', '10');
  const j = await (await fetch(y, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } })).json();
  return { lang: 'en', news: j.news || [] };
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
  const q = req.query || {};
  if (['pushkey', 'push-sync', 'push-delete', 'push-test'].includes(q.type)) { res.status(200).json({ configured: false, unsupported: true }); return; } // alertes push : Cloudflare uniquement
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  if (q.type === 'ping') { res.status(200).json({ ok: true }); return; }
  if (q.type === 'sync') { res.status(200).json({ configured: false, unsupported: true }); return; } // synchronisation : Cloudflare uniquement
  if (q.type === 'stats') { res.status(200).json({ configured: false, unsupported: true }); return; } // compteur global : Cloudflare uniquement
  if (q.type === 'news') {
    if (!String(q.q || '').trim()) { res.status(400).json({ error: 'requête invalide' }); return; }
    try { res.setHeader('Cache-Control', 's-maxage=600'); res.status(200).json(await news(q)); }
    catch (e) { res.status(502).json({ error: 'actualités indisponibles : ' + e.message }); }
    return;
  }
  const upstream = buildUpstream(q);
  if (!upstream) { res.status(400).json({ error: 'requête invalide' }); return; }

  try {
    const r = await fetch(upstream, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } });
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', q.type === 'search' ? 's-maxage=86400' : 's-maxage=1');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'Yahoo injoignable : ' + e.message });
  }
};
