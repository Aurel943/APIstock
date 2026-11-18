/*
 * Passer un ordre au bon moment (fiche d'une valeur) : créneau conseillé dans la journée, fourchette achat / vente
 * et coût de l'aller-retour, taille de l'ordre face au volume échangé.
 * - Créneau : séance de la bourse de cotation, sans le premier quart d'heure (les teneurs de marché fixent leurs prix,
 *   la fourchette est large) ni les dix dernières minutes ; pour un ETF, de préférence quand la bourse de ses titres
 *   sous-jacents est ouverte (après 15 h 30, heure de Paris, pour un ETF d'actions américaines coté en Europe).
 * - Fourchette : cours acheteur et vendeur publiés par Yahoo (bourses américaines surtout) ; sinon, ordre de grandeur
 *   d'après le montant échangé chaque jour. Yahoo ne publie pas la fourchette des places Euronext.
 * Calculs purs (objet OrderTiming) testés dans tests/ordre.test.mjs ; affichage en bas du fichier.
 */
'use strict';

/* Bourse des titres sous-jacents selon l'indice suivi (identifiant de EXCHANGES) */
const ORDER_UNDERLYING = { sp500: 'newyork', ndx: 'newyork', world: 'newyork', allworld: 'newyork', gold: 'newyork', japan: 'tokyo', em: 'hongkong' };
/* Suffixe Yahoo → code de place (MIC) quand l'instrument n'en a pas */
const ORDER_SUFFIX_MIC = { PA: 'XPAR', AS: 'XAMS', BR: 'XBRU', DE: 'XETR', F: 'XFRA', L: 'XLON', MI: 'XMIL', MC: 'XMAD', SW: 'XSWX', T: 'XTKS', HK: 'XHKG', TO: 'XTSE', AX: 'XASX' };
const ORDER_OPEN_SKIP = 15, ORDER_CLOSE_SKIP = 10; // minutes à éviter après l'ouverture et avant la clôture
const ORDER_STORE = 'apistock:orderAmount';

const OrderTiming = {
  /** Place de cotation d'un instrument (objet de EXCHANGES) ou null */
  exchangeOf(inst) {
    if (!inst) return null;
    if (inst.mic && Markets.forMic(inst.mic)) return Markets.forMic(inst.mic);
    const y = inst.ysymbol || '';
    const suf = y.includes('.') ? y.split('.').pop().toUpperCase() : '';
    if (!suf && /^[A-Z][A-Z0-9-]*$/.test(y) && !/-(EUR|USD)$/.test(y)) return Markets.forMic('XNYS');
    return ORDER_SUFFIX_MIC[suf] ? Markets.forMic(ORDER_SUFFIX_MIC[suf]) : null;
  },

  /** Intersection de deux listes d'intervalles [début, fin] (instants) */
  intersect(A, B) {
    const out = [];
    for (const [a1, a2] of A) for (const [b1, b2] of B) { const s = Math.max(a1, b1), e = Math.min(a2, b2); if (e > s) out.push([s, e]); }
    return out.sort((x, y) => x[0] - y[0]);
  },

  /**
   * Créneaux conseillés d'une journée de cotation `iso` (date locale de la place) : séance sans le début ni la fin ;
   * si `und` (bourse des titres sous-jacents) diffère, restreints à ses heures d'ouverture (sans son premier quart d'heure).
   * → { session: [[début, fin]], best: [[début, fin]], underlyingClosed }
   */
  windows(ex, und, iso) {
    const M = 60000;
    const session = Markets.sessionsOn(ex, iso).list;
    const calm = session.map(([a, b]) => [a + ORDER_OPEN_SKIP * M, b - ORDER_CLOSE_SKIP * M]).filter(([a, b]) => b > a);
    if (!und || und.id === ex.id || !calm.length) return { session, best: calm, underlyingClosed: false };
    const uSessions = [];
    for (const k of [-1, 0, 1]) for (const [a, b] of Markets.sessionsOn(und, Markets.shiftDate(iso, k)).list) uSessions.push([a + ORDER_OPEN_SKIP * M, b]);
    const best = this.intersect(calm, uSessions);
    if (best.length) return { session, best, underlyingClosed: false };
    // titres sous-jacents cotés pendant la nuit européenne (Japon, Asie) : la fourchette reste plus large toute la journée
    return { session, best: session.map(([a, b]) => [a + 2 * ORDER_OPEN_SKIP * M, b - ORDER_CLOSE_SKIP * M]), underlyingClosed: true };
  },

  /** État à l'instant `now` : good (créneau conseillé), meh (séance ouverte hors créneau), closed ; et prochain créneau */
  status(ex, und, now = Date.now()) {
    const today = Markets.parts(ex.tz, now).date;
    let state = 'closed', current = null, next = null, underlyingClosed = false;
    for (let k = 0; k < 10 && !next; k++) {
      const w = this.windows(ex, und, Markets.shiftDate(today, k));
      if (k === 0) {
        underlyingClosed = w.underlyingClosed;
        if (w.session.some(([a, b]) => now >= a && now < b)) state = 'meh';
        current = w.best.find(([a, b]) => now >= a && now < b) || null;
        if (current) state = 'good';
      }
      next = w.best.find(([a]) => a > now) || null;
      if (k > 0 && w.best.length) underlyingClosed = underlyingClosed || w.underlyingClosed;
    }
    return { state, current, next, underlyingClosed };
  },

  /** Séance en cours ou prochaine séance d'une place [début, fin] (instants), ou null */
  nextSession(ex, now = Date.now()) {
    const today = Markets.parts(ex.tz, now).date;
    for (let k = 0; k < 10; k++) {
      const s = Markets.sessionsOn(ex, Markets.shiftDate(today, k)).list;
      if (s.length && s[s.length - 1][1] > now) return [s[0][0], s[s.length - 1][1]];
    }
    return null;
  },

  /** Fourchette publiée : { pct (fraction), mid } ou null (cours absents, nuls ou incohérents) */
  spread(bid, ask) {
    if (!(bid > 0 && ask > 0 && ask > bid)) return null;
    const mid = (bid + ask) / 2, pct = (ask - bid) / mid;
    return pct < 0.05 ? { pct, mid } : null; // plus de 5 % : cours hors séance, pas une vraie fourchette
  },

  /** Appréciation d'une fourchette (fraction) */
  grade(pct) { return pct <= 0.001 ? 'excellente' : pct <= 0.003 ? 'correcte' : pct <= 0.01 ? 'large' : 'très large'; },

  /** Ordre de grandeur de la fourchette d'après le montant échangé chaque jour (devise de base) : [bas, haut] en fraction */
  typical(dailyValue) {
    if (!(dailyValue > 0)) return null;
    return dailyValue >= 20e6 ? [0.0002, 0.0005] : dailyValue >= 2e6 ? [0.0005, 0.0015] : dailyValue >= 2e5 ? [0.001, 0.003] : [0.003, 0.01];
  },
};

Object.assign(App, {
  /** Fourchette et volume : modules summaryDetail + price, gardés 2 minutes */
  async orderData(sym) {
    this._orderCache = this._orderCache || {};
    const c = this._orderCache[sym];
    if (c && Date.now() - c.ts < 120000) return c.data;
    const json = await Api.yahoo({ type: 'summary', symbols: sym, modules: 'summaryDetail,price' });
    const data = (json && json.results && json.results[sym]) || null;
    this._orderCache[sym] = { ts: Date.now(), data };
    return data;
  },

  async renderDetailOrder(key) {
    const box = $('#detailOrder');
    if (!box) return;
    const inst = key && Store.instrument(key);
    const ex = inst && !Manual.is(key) ? OrderTiming.exchangeOf(inst) : null;
    if (!ex || (inst.ysymbol || '').startsWith('^') || /=X$|-(EUR|USD)$/.test(inst.ysymbol || '')) { box.replaceChildren(); return; }
    const prof = Expo.of(key).profile;
    const undId = ORDER_UNDERLYING[prof];
    const und = undId && ex.region === 'Europe' ? EXCHANGES.find(e => e.id === undId) : null;
    let data = null;
    const sym = yahooSymbolFor(inst);
    if (Api.hasProxy() && sym && SYMBOL_OK.test(sym)) { try { data = await this.orderData(sym); } catch (e) { data = null; } }
    if (this.detailKey !== key) return;
    box.replaceChildren(this.orderPanel(key, inst, ex, und, data));
  },

  orderPanel(key, inst, ex, und, data) {
    const r = Fundamentals.raw;
    const sd = (data && data.summaryDetail) || {};
    const st = OrderTiming.status(ex, und);
    const hhmm = t => Markets.fmtLocal(t, true);
    const win = w => `${hhmm(w[0])} – ${Markets.fmtLocal(w[1])}`;
    const chip = { good: ['up', 'Bon moment pour passer un ordre'], meh: ['warn', 'Séance ouverte, mais mieux vaut attendre'], closed: ['', 'Bourse fermée'] }[st.state];
    const q = Api.cachedQuote(key);
    const price = (q && q.price) || r(sd.previousClose);
    const ccy = inst.currency || 'EUR';
    const fx = Api.fxCached(ccy);
    const sp = OrderTiming.spread(r(sd.bid), r(sd.ask));
    const avgVol = r(sd.averageVolume10days) || r(sd.averageVolume);
    const dailyValue = avgVol && price ? avgVol * price * (isFinite(fx) ? fx : 1) : null;
    const typical = OrderTiming.typical(dailyValue);
    let amount = 1000;
    try { amount = parseNum(localStorage.getItem(ORDER_STORE)) || 1000; } catch (e) { /* stockage indisponible */ }
    const base = this.base(), m = x => fmtMoney(x, base, x < 100 ? 2 : 0);
    const costBox = el('div', { class: 'order-cost small' });
    const drawCost = () => {
      const lo = sp ? sp.pct : typical ? typical[0] : null, hi = sp ? sp.pct : typical ? typical[1] : null;
      const parts = [];
      if (lo !== null) parts.push(`Coût de la fourchette : ${lo === hi ? m(amount * lo / 2) : m(amount * lo / 2) + ' à ' + m(amount * hi / 2)} à l'achat, autant à la revente.`);
      if (dailyValue) {
        const share = amount / dailyValue;
        parts.push(share > 0.05
          ? `⚠ Ton ordre représente ${fmtNum(share * 100, 1)} % du montant échangé un jour moyen (${fmtBigMoney(dailyValue, base)}) : découpe-le en plusieurs ordres à cours limité.`
          : `Montant échangé un jour moyen sur cette place : ${fmtBigMoney(dailyValue, base)}.`);
      }
      costBox.replaceChildren(...parts.map(t => el('p', {}, t)));
    };
    drawCost();
    const isEtf = (Fundamentals.kindOf(key) || {}).kind === 'etf';
    const tips = [
      'Passe un ordre à cours limité plutôt qu\'« au marché » : à l\'achat, limite au cours vendeur affiché (ou juste au-dessus) ; tu ne paieras jamais plus que prévu.',
      `Évite les ${ORDER_OPEN_SKIP} premières minutes après l'ouverture : les prix se forment et la fourchette est la plus large de la journée.`,
      und && !st.underlyingClosed ? `Cet ETF détient surtout des titres cotés à ${und.city} : sa fourchette se resserre quand cette bourse est ouverte` + (OrderTiming.nextSession(und) ? ` (prochaine séance : ${win(OrderTiming.nextSession(und))}, heures de ton appareil).` : '.') : null,
      st.underlyingClosed && und ? `Les titres de cet ETF se négocient à ${und.city}, bourse fermée pendant la séance européenne : les teneurs de marché prennent une marge de sécurité, la fourchette reste plus large toute la journée. Un ordre à cours limité est indispensable.` : null,
      isEtf ? 'Un ETF est aussi liquide que les titres qu\'il détient : un faible volume sur la bourse ne l\'empêche pas d\'acheter ou de vendre à un prix juste, à condition de passer un ordre à cours limité.' : null,
    ].filter(Boolean);
    return el('section', { class: 'fund-panel order-panel' },
      el('h3', {}, 'Passer un ordre', infoTip('Le meilleur moment de la journée pour acheter ou vendre cette valeur, ce que coûte la fourchette entre prix d\'achat et prix de vente, et comment passer l\'ordre.')),
      el('p', { class: 'etfcmp-verdict order-verdict ' + chip[0] }, el('b', {}, chip[1]),
        st.state === 'good' && st.current ? `, jusqu'à ${Markets.fmtLocal(st.current[1])}.` : st.next ? `. Prochain créneau conseillé : ${win(st.next)}.` : '.'),
      el('div', { class: 'stats fund-stats' },
        this.fundTile('Créneau conseillé', st.next || st.current ? win(st.current || st.next) : null,
          `Heures de ton appareil. Séance de ${ex.name} sans le premier quart d'heure ni les dix dernières minutes` + (und ? (st.underlyingClosed ? '.' : `, quand ${und.city} est aussi ouverte.`) : '.')),
        this.fundTile('Fourchette achat / vente', sp ? fmtNum(sp.pct * 100, 2) + ' % · ' + OrderTiming.grade(sp.pct) : typical ? `≈ ${fmtNum(typical[0] * 100, 2)} à ${fmtNum(typical[1] * 100, 2)} %` : null,
          sp ? `Cours acheteur ${fmtNum(r(sd.bid), 2)} / vendeur ${fmtNum(r(sd.ask), 2)} (${ccy}), publiés par Yahoo.` : 'Yahoo ne publie pas la fourchette de cette place : ordre de grandeur d\'après le montant échangé chaque jour.'),
        el('div', {}, el('span', {}, 'Montant de l\'ordre (' + base + ')'),
          el('input', { type: 'number', min: 0, step: 100, value: amount, inputmode: 'decimal', class: 'order-amount', 'aria-label': 'Montant de l\'ordre', oninput: e => {
            amount = parseNum(e.target.value) || 0;
            try { localStorage.setItem(ORDER_STORE, String(amount)); } catch (err) { /* stockage indisponible */ }
            drawCost();
          } }))),
      costBox,
      el('ul', { class: 'order-tips small' }, ...tips.map(t => el('li', {}, t))),
      noteTip('Horaires des bourses de l\'onglet Monde (jours fériés compris). Fourchette : cours acheteur et vendeur publiés par Yahoo quand ils existent (surtout pour les bourses américaines, pendant la séance) ; sinon, ordre de grandeur observé selon le montant échangé chaque jour. Le coût indiqué est la moitié de la fourchette, payée à l\'achat comme à la vente, en plus des frais de courtage.', 'Sources'));
  },
});

App.on('detail:selected', function (key) { this.renderDetailOrder(key); });
