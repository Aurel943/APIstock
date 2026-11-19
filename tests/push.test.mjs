/* Chiffrement Web Push du worker : déchiffrement de contrôle selon la RFC 8291, et vérification de la signature VAPID */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './harness.mjs';

const src = readFileSync(join(root, 'proxy/cloudflare-worker.js'), 'utf8').replace('export default {', 'const __worker = {')
  + '\nexport { encryptPayload, vapidAuth, b64u, unb64u, parseRss, cleanDigest, weekReturn, digestSummary, digestWeek, digestText, weeklyDigests, __worker };';
const W = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { subtle } = globalThis.crypto;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const te = new TextEncoder();

test('le message chiffré par le worker se déchiffre côté navigateur (aes128gcm)', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await W.encryptPayload({ keys: { p256dh: W.b64u(uaPub), auth: W.b64u(auth) } }, '{"title":"Alerte","body":"CW8 ≤ 500 €"}');
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  assert.equal(pt[pt.length - 1], 2); // délimiteur du dernier enregistrement
  assert.deepEqual(JSON.parse(new TextDecoder().decode(pt.slice(0, -1))), { title: 'Alerte', body: 'CW8 ≤ 500 €' });
});

test('jeton VAPID signé (ES256) et vérifiable avec la clé publique', async () => {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = W.b64u(await subtle.exportKey('raw', kp.publicKey));
  const env = { VAPID_PUBLIC: pub, VAPID_PRIVATE: (await subtle.exportKey('jwk', kp.privateKey)).d };
  const h = await W.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', env);
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  assert.equal(m[4], pub);
  const claims = JSON.parse(new TextDecoder().decode(W.unb64u(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.ok(claims.exp > Date.now() / 1000);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, W.unb64u(m[3]), te.encode(m[1] + '.' + m[2])));
});

test('le worker refuse un abonnement invalide et ignore les alertes malformées', async () => {
  const store = new Map();
  const env = { VAPID_PUBLIC: 'x', VAPID_PRIVATE: 'y', SYNC: {
    get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) } };
  const call = body => W.__worker.fetch(new Request('https://w/?type=push-sync', { method: 'POST', body: JSON.stringify(body) }), env).then(r => r.json());
  const id = 'a'.repeat(32);
  assert.match((await call({ id, sub: { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } } })).error, /invalide/);
  const ok = await call({ id, sub: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } },
    alerts: [{ id: '1', s: 'CW8.PA', k: 'below', v: 500, t: 'CW8' }, { id: '2', s: 'bad symbol!', k: 'below', v: 1 }, { id: '3', s: 'SPY', k: 'hack', v: 1 }] });
  assert.equal(ok.count, 1);
  assert.equal(JSON.parse(store.get('push:' + id)).alerts[0].s, 'CW8.PA');
});

test('actualités : lecture des flux RSS Yahoo France et Google Actualités', () => {
  const yahoo = `<rss><channel><title>Yahoo! Finance</title><item><description>…</description><guid isPermaLink="false">abc</guid>
    <link>https://www.capital.fr/bourse/article-123?.tsrc=rss</link><pubDate>Mon, 09 Nov 2026 18:00:00 +0000</pubDate>
    <title>La Bourse de Paris &amp; l&#39;IA</title></item></channel></rss>`;
  const [y] = W.parseRss(yahoo);
  assert.equal(y.title, "La Bourse de Paris & l'IA");
  assert.equal(y.publisher, 'Capital');
  assert.equal(y.link, 'https://www.capital.fr/bourse/article-123');
  assert.equal(y.providerPublishTime, Date.parse('2026-11-09T18:00:00Z') / 1000);
  const google = '<item><title>PEA : les ETF monde restent éligibles - Boursorama</title><link>https://news.google.com/rss/articles/x?oc=5</link>'
    + '<pubDate>Fri, 06 Nov 2026 08:00:00 GMT</pubDate><source url="https://www.boursorama.com">Boursorama</source></item><item><title>Sans lien</title><link>javascript:alert(1)</link></item>';
  const g = W.parseRss(google);
  assert.equal(g.length, 1); // lien non https ignoré
  assert.equal(g[0].title, 'PEA : les ETF monde restent éligibles');
  assert.equal(g[0].publisher, 'Boursorama');
});

test('appel groupé type=quotes : une requête, une réponse Yahoo par symbole, symboles refusés', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async u => {
    const url = new URL(String(u));
    seen.push(url);
    const sym = decodeURIComponent(url.pathname.split('/').pop());
    if (sym === 'BAD') return new Response('<html>erreur</html>', { status: 500 });
    return new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: sym, regularMarketPrice: 1 } }], error: null } }), { status: 200 });
  };
  try {
    const call = qs => W.__worker.fetch(new Request('https://w/?' + qs), {});
    const r = await call('type=quotes&symbols=' + encodeURIComponent('^GSPC,GC=F,BAD,^GSPC'));
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(Object.keys(j.results), ['^GSPC', 'GC=F', 'BAD'], 'doublons retirés');
    assert.equal(j.results['^GSPC'].chart.result[0].meta.symbol, '^GSPC');
    assert.equal(j.results['GC=F'].chart.result[0].meta.regularMarketPrice, 1);
    assert.equal(j.results.BAD, null, 'réponse non JSON → null');
    assert.equal(seen.length, 3);
    assert.ok(seen.every(u => u.searchParams.get('range') === '1d' && u.searchParams.get('interval') === '5m'));
    // 41 symboles, symbole invalide, liste vide : refusés
    const many = Array.from({ length: 41 }, (_, i) => 'S' + i).join(',');
    for (const qs of ['type=quotes&symbols=' + many, 'type=quotes&symbols=' + encodeURIComponent('A,B C'), 'type=quotes']) assert.equal((await call(qs)).status, 400, qs);
  } finally { globalThis.fetch = realFetch; }
});

test('résumé de la semaine : parts nettoyées, rendement sur 7 jours, devises et comparaison au MSCI World', () => {
  assert.equal(W.cleanDigest(null), null);
  assert.equal(W.cleanDigest({ on: true, base: 'EUR', lines: [{ s: 'bad sym!', w: 0.5, c: 'EUR' }] }), null);
  const d = W.cleanDigest({ on: true, base: 'EUR', lines: [{ s: 'CW8.PA', w: 0.6, c: 'EUR', n: 'Amundi MSCI World', amount: 9999 }, { s: 'SPY', w: 0.4, c: 'USD', n: 'SPDR S&P 500' }, { s: 'X', w: 2, c: 'EUR' }] });
  assert.equal(d.lines.length, 2);
  assert.equal(d.lines[0].amount, undefined, 'aucun montant gardé');
  // dernier cours face au dernier cours d'au moins 7 jours avant (vendredi précédent)
  near(W.weekReturn([['2026-11-10', 90], ['2026-11-13', 100], ['2026-11-16', 101], ['2026-11-20', 102]]), 0.02);
  assert.ok(Number.isNaN(W.weekReturn([['2026-11-20', 1]])));
  const s = W.digestSummary(d, { 'CW8.PA': 0.01, SPY: 0.03, 'IWDA.AS': 0.005 }, { USDEUR: -0.01 });
  near(s.perf, 0.6 * 0.01 + 0.4 * ((1.03 * 0.99) - 1)); // dollar en baisse de 1 % face à l'euro
  near(s.bench, 0.005);
  assert.equal(s.best.n, 'SPDR S&P 500');
  assert.equal(W.digestText(s), "Portefeuille +1,4 % · MSCI World +0,5 %\nEn tête : SPDR S&P 500 +2,0 % · en retrait : Amundi MSCI World +1,0 %");
});

test('résumé de la semaine : vendredi soir (heure de Paris) au dimanche, une seule fois par semaine', async () => {
  assert.equal(W.digestWeek(new Date('2026-11-20T16:00:00Z')), null, 'vendredi 17 h à Paris : trop tôt');
  assert.equal(W.digestWeek(new Date('2026-11-20T18:00:00Z')), '2026-11-20');
  assert.equal(W.digestWeek(new Date('2026-11-22T10:00:00Z')), '2026-11-20', 'dimanche : la semaine du vendredi');
  assert.equal(W.digestWeek(new Date('2026-11-23T10:00:00Z')), null);
  // envoi : abonnement avec résumé, cours simulés, puis rien la seconde fois
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const store = new Map([['push:' + 'b'.repeat(32), JSON.stringify({ sub: { endpoint: 'https://push.example/y', keys: { p256dh: W.b64u(new Uint8Array(await subtle.exportKey('raw', ua.publicKey))), auth: W.b64u(new Uint8Array(16)) } },
    alerts: [], digest: { on: true, base: 'EUR', lines: [{ s: 'CW8.PA', w: 1, c: 'EUR', n: 'CW8' }] } })]]);
  const env = { VAPID_PUBLIC: W.b64u(await subtle.exportKey('raw', kp.publicKey)), VAPID_PRIVATE: (await subtle.exportKey('jwk', kp.privateKey)).d, SYNC: {
    get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => store.set(k, v), delete: async k => store.delete(k),
    list: async ({ prefix }) => ({ keys: Array.from(store.keys()).filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) } };
  const realFetch = globalThis.fetch;
  const pushes = [];
  globalThis.fetch = async (u, opts) => {
    const url = String(u);
    if (url.startsWith('https://push.example')) { pushes.push(opts); return new Response('', { status: 201 }); }
    const day = s => Math.floor(Date.parse(s) / 1000);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [day('2026-11-13'), day('2026-11-20')], indicators: { quote: [{ close: [100, 103] }] } }] } }));
  };
  try {
    assert.equal(await W.weeklyDigests(env, new Date('2026-11-20T19:00:00Z')), 1);
    assert.equal(pushes.length, 1);
    assert.equal(JSON.parse(store.get('push:' + 'b'.repeat(32))).digestSent, '2026-11-20');
    assert.equal(await W.weeklyDigests(env, new Date('2026-11-20T19:05:00Z')), 0, 'déjà envoyé cette semaine');
  } finally { globalThis.fetch = realFetch; }
});
