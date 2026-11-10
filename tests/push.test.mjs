/* Chiffrement Web Push du worker : déchiffrement de contrôle selon la RFC 8291, et vérification de la signature VAPID */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './harness.mjs';

const src = readFileSync(join(root, 'proxy/cloudflare-worker.js'), 'utf8').replace('export default {', 'const __worker = {')
  + '\nexport { encryptPayload, vapidAuth, b64u, unb64u, parseRss, __worker };';
const W = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { subtle } = globalThis.crypto;

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
