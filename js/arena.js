/*
 * Arène : le côté ludique (et un peu fou) de la bourse, toujours sur de vraies données.
 *
 * - Univers parallèles : chacun de tes vrais versements, à sa vraie date, rejoué dans d'autres univers (sous le
 *   matelas, Livret A, MSCI World, S&P 500, Nasdaq-100, CAC 40, or, Bitcoin) et course animée jusqu'à aujourd'hui.
 * - Défi à l'aveugle : un vrai graphique historique tiré au hasard, nom et dates cachés ; semaine après semaine tu
 *   choisis d'être investi ou en liquidités, puis révélation et score face à « acheter et conserver ».
 * - Écoute ton portefeuille : briefing lu à voix haute (synthèse vocale du navigateur) et parcours transformé en musique.
 *
 * Les calculs (objet Arena) sont purs et testés (tests/arena.test.mjs) ; l'affichage est en bas du fichier.
 */
'use strict';

/* Univers : `sym` = symbole Yahoo (indice ou ETF), cours de prix hors dividendes, convertis dans ta devise */
const ARENA_UNIVERSES = [
  { id: 'real', name: 'Ton vrai portefeuille', emoji: '🫵', color: '#10b981' },
  { id: 'mattress', name: 'Sous le matelas', emoji: '🛏️', color: '#94a3b8', kind: 'cash' },
  { id: 'livretA', name: 'Livret A', emoji: '🏦', color: '#64748b', kind: 'livret' },
  { id: 'world', name: 'MSCI World', emoji: '🌍', color: '#6366f1', sym: 'IWDA.AS', ccy: 'EUR' },
  { id: 'sp500', name: 'S&P 500', emoji: '🇺🇸', color: '#0ea5e9', sym: 'SPY', ccy: 'USD' },
  { id: 'ndx', name: 'Nasdaq-100', emoji: '💻', color: '#8b5cf6', sym: 'QQQ', ccy: 'USD' },
  { id: 'cac', name: 'CAC 40', emoji: '🇫🇷', color: '#ec4899', sym: '^FCHI', ccy: 'EUR' },
  { id: 'gold', name: 'Or', emoji: '🥇', color: '#f59e0b', sym: 'GC=F', ccy: 'USD' },
  { id: 'btc', name: 'Bitcoin', emoji: '₿', color: '#f97316', sym: 'BTC-EUR', ccy: 'EUR' },
];

/*
 * Taux du Livret A (date d'effet, % par an). Dernier taux connu prolongé ensuite : à compléter à chaque révision
 * (1er février et 1er août). Source : Banque de France / arrêtés ministériels.
 */
const LIVRET_A_RATES = [['2009-08-01', 1.25], ['2011-02-01', 2], ['2011-08-01', 2.25], ['2013-02-01', 1.75], ['2013-08-01', 1.25], ['2014-08-01', 1],
  ['2015-08-01', 0.75], ['2020-02-01', 0.5], ['2022-02-01', 1], ['2022-08-01', 2], ['2023-02-01', 3], ['2025-02-01', 2.4], ['2025-08-01', 1.7]];

/* Défi à l'aveugle : marchés possibles (les plus longs historiques d'abord), titres selon le score */
const ARENA_GAME_MARKETS = [
  { sym: '^GSPC', name: 'S&P 500' }, { sym: '^NDX', name: 'Nasdaq-100' }, { sym: '^FCHI', name: 'CAC 40' }, { sym: '^GDAXI', name: 'DAX' },
  { sym: '^N225', name: 'Nikkei 225' }, { sym: 'GC=F', name: 'Or' }, { sym: 'BTC-USD', name: 'Bitcoin' }, { sym: 'IWDA.AS', name: 'MSCI World' }, { sym: 'SPY', name: 'S&P 500 (ETF SPY)' },
];
const ARENA_TITLES = [[15, '🐺 Loup de Wall Street', 'Tu as écrasé le marché. Soit tu es un génie, soit tu as eu beaucoup de chance (souvent les deux).'],
  [3, '🎯 Market timer d\'élite', 'Mieux que le marché : rare, même chez les professionnels.'],
  [-3, '🧘 Investisseur zen', 'À peu près le marché : la plupart des gérants professionnels n\'en font pas autant.'],
  [-15, '🧳 Touriste de la bourse', 'Les allers-retours t\'ont coûté : le marché récompense surtout la patience.'],
  [-Infinity, '😱 Vendeur paniqué', 'Vendre dans la peur, racheter dans l\'euphorie : le piège classique. Acheter et conserver aurait fait bien mieux.']];

const Arena = {
  /* ------------------------------------------------------------------ */
  /* Univers parallèles                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Flux de trésorerie réels (devise de base) : achats = argent investi (frais compris), ventes = argent retiré (net de frais).
   * `fxAt(clé, date)` : taux de la devise de l'instrument vers la devise de base. Dividendes et divisions ignorés.
   */
  flows(txs, fxAt = () => 1) {
    const out = [];
    for (const t of txs) {
      if (t.type !== 'buy' && t.type !== 'sell') continue;
      const q = parseNum(t.qty), p = parseNum(t.price), f = parseNum(t.fees) || 0, fx = fxAt(t.key, t.date);
      if (!isFinite(q) || !isFinite(p) || !(fx > 0)) continue;
      out.push({ date: t.date, amount: t.type === 'buy' ? (q * p + f) * fx : -(q * p - f) * fx });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },

  /**
   * Valeur, à chaque date de `dates`, de l'argent placé dans un actif (`series` : [[date, cours en devise de base]]) :
   * chaque flux achète (ou revend pour le même montant) au dernier cours connu ce jour-là. null si l'historique de
   * l'actif commence plus d'une semaine après le premier flux.
   */
  universe(flows, series, dates) {
    if (!series || series.length < 2 || !flows.length) return null;
    if (series[0][0] > addDaysISO(flows[0].date, 7)) return null;
    let units = 0, fi = 0, si = 0, px = series[0][1];
    return dates.map(d => {
      while (si < series.length && series[si][0] <= d) px = series[si++][1];
      while (fi < flows.length && flows[fi].date <= d) {
        const a = flows[fi++].amount;
        if (px > 0) units = a >= 0 ? units + a / px : Math.max(0, units + a / px);
      }
      return units * px;
    });
  },

  /** Placement à taux (Livret A, ou matelas avec `rates` vide) : intérêts au jour le jour, retraits plafonnés au solde */
  savings(flows, dates, rates = []) {
    let bal = 0, fi = 0, last = null;
    const rateAt = d => { let r = 0; for (const [from, v] of rates) if (from <= d) r = v; return r / 100; };
    return dates.map(d => {
      if (last && bal > 0) bal *= Math.pow(1 + rateAt(last), (Date.parse(d) - Date.parse(last)) / (365 * 864e5));
      while (fi < flows.length && flows[fi].date <= d) bal = Math.max(0, bal + flows[fi++].amount);
      last = d;
      return bal;
    });
  },

  /** Dates hebdomadaires (vendredis) entre deux dates, plus la date de fin */
  weeks(from, to) {
    const out = [];
    let d = from;
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    d = addDaysISO(d, (5 - dow + 7) % 7);
    for (; d < to; d = addDaysISO(d, 7)) out.push(d);
    out.push(to);
    return out;
  },

  /** Classement final : [{ id, value, rank }] trié du plus riche au plus pauvre, avec regret / fierté face à ton portefeuille */
  ranking(paths) {
    const list = Object.entries(paths).filter(([, v]) => v && v.length).map(([id, v]) => ({ id, value: v[v.length - 1] }))
      .sort((a, b) => b.value - a.value).map((x, i) => Object.assign(x, { rank: i + 1 }));
    const real = list.find(x => x.id === 'real');
    return { list, real, regret: real ? list[0].value - real.value : NaN, pride: real ? real.value - list[list.length - 1].value : NaN };
  },

  /* ------------------------------------------------------------------ */
  /* Défi à l'aveugle                                                     */
  /* ------------------------------------------------------------------ */

  /** Dernière clôture de chaque semaine : [[date, cours]] */
  weekly(series) {
    const out = [];
    let key = '';
    for (const [d, p] of series) {
      if (!(p > 0)) continue;
      const t = Date.parse(d + 'T12:00:00Z'), monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      if (monday === key) out[out.length - 1] = [d, p]; else { out.push([d, p]); key = monday; }
    }
    return out;
  },

  /** Nouvelle partie : fenêtre tirée au hasard (`rnd` ∈ [0,1[) ; `context` semaines visibles au départ, `length` à jouer */
  newGame(weekly, rnd, { context = 52, length = 104, capital = 10000 } = {}) {
    const span = context + length + 1;
    if (!weekly || weekly.length < span) return null;
    const start = Math.floor(rnd * (weekly.length - span + 1));
    return { w: weekly.slice(start, start + span), context, length, t: 0, invested: true, capital, equity: capital, hold: capital, trades: 0, cost: 0.001, log: [] };
  },

  /** Avance d'une semaine : `invest` = position pour la semaine qui vient (changer coûte 0,1 %) */
  step(g, invest) {
    if (!g || g.t >= g.length) return g;
    if (invest !== g.invested) { g.equity *= 1 - g.cost; g.trades++; g.invested = invest; }
    const i = g.context + g.t, r = g.w[i + 1][1] / g.w[i][1] - 1;
    if (g.invested) g.equity *= 1 + r;
    g.hold *= 1 + r;
    g.log.push(g.invested ? 1 : 0);
    g.t++;
    return g;
  },

  /** Bilan d'une partie terminée */
  result(g) {
    const vs = (g.equity / g.hold - 1) * 100;
    const [, title, text] = ARENA_TITLES.find(([min]) => vs >= min);
    const seg = g.w.slice(g.context, g.context + g.length + 1);
    const mkt = (seg[seg.length - 1][1] / seg[0][1] - 1) * 100;
    let peak = -Infinity, mdd = 0;
    for (const [, p] of seg) { peak = Math.max(peak, p); mdd = Math.min(mdd, p / peak - 1); }
    return { you: (g.equity / g.capital - 1) * 100, market: mkt, vs, title, text, trades: g.trades, invested: g.log.length ? g.log.reduce((a, b) => a + b, 0) / g.log.length : 1,
      from: seg[0][0], to: seg[seg.length - 1][0], mdd: mdd * 100 };
  },

  /* ------------------------------------------------------------------ */
  /* Écoute ton portefeuille                                              */
  /* ------------------------------------------------------------------ */

  /** Montant lisible à voix haute : « 12 345 euros » (sans centimes au-delà de 100) */
  spoken(v, cur = 'EUR') {
    const unit = { EUR: 'euros', USD: 'dollars', GBP: 'livres', CHF: 'francs suisses' }[cur] || cur;
    const a = Math.abs(v);
    const n = a >= 100 ? String(Math.round(a)) : a.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
    return (v < 0 ? 'moins ' : '') + n + ' ' + unit;
  },

  /** Texte du briefing (données du portefeuille déjà calculées) */
  briefingText({ value, day, dayPct, best, worst, total, totalPct, alerts = 0, hour = 9, cur = 'EUR', name = '' }) {
    const pct = v => `${Math.abs(v).toFixed(1).replace('.', ',')} pour cent`;
    const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';
    const out = [`${hello}${name ? ' ' + name : ''}. Voici ton point marché.`];
    if (!(value > 0)) return out.concat('Ton portefeuille est vide pour l\'instant. Ajoute une première opération et je te ferai un vrai briefing.').join(' ');
    out.push(`Ton portefeuille vaut ${this.spoken(value, cur)}.`);
    if (isFinite(day) && Math.abs(day) >= 0.5) out.push(`Aujourd'hui, il ${day >= 0 ? 'gagne' : 'perd'} ${this.spoken(Math.abs(day), cur)}, soit ${pct(dayPct)}.`);
    else out.push('Il ne bouge presque pas aujourd\'hui.');
    if (best && worst && best.name !== worst.name) out.push(`En tête, ${best.name}, ${best.pct >= 0 ? 'en hausse' : 'en baisse'} de ${pct(best.pct)}. En queue, ${worst.name}, ${worst.pct >= 0 ? 'en hausse' : 'en baisse'} de ${pct(worst.pct)}.`);
    if (isFinite(total)) out.push(`Depuis le début, tu ${total >= 0 ? 'as gagné' : 'as perdu'} ${this.spoken(Math.abs(total), cur)}${isFinite(totalPct) ? `, soit ${pct(totalPct)}` : ''}.`);
    if (alerts > 0) out.push(`Attention : ${alerts} alerte${alerts > 1 ? 's se sont déclenchées' : ' s\'est déclenchée'}.`);
    out.push(total >= 0 ? 'Garde le cap, et bonne journée.' : 'Patience : le temps est ton meilleur allié. Bonne journée.');
    return out.join(' ');
  },

  /**
   * Partition : une note par point de la courbe. Hausse → note aiguë, baisse → note grave, sur une gamme pentatonique
   * (toujours harmonieuse). Renvoie [{ freq, gain }] ; `values` : valeurs successives.
   */
  score(values) {
    const SCALE = [0, 2, 4, 7, 9]; // pentatonique majeure
    const rets = [];
    for (let i = 1; i < values.length; i++) if (values[i - 1] > 0 && isFinite(values[i])) rets.push(values[i] / values[i - 1] - 1);
    const max = Math.max(1e-9, ...rets.map(Math.abs));
    return rets.map(r => {
      const step = Math.round((r / max) * 7); // −7 … +7 degrés autour de la tonique
      const deg = ((step % 5) + 5) % 5, oct = Math.floor(step / 5);
      const semis = SCALE[deg] + 12 * oct;
      return { freq: 440 * Math.pow(2, (semis - 9) / 12), gain: 0.08 + 0.17 * Math.min(1, Math.abs(r) / max), up: r >= 0 };
    });
  },
};

/* ==================== Affichage : onglet « Arène » ==================== */

Object.assign(App, {
  bindArena() {
    if (!$('#view-arena')) return;
    $('#arMvRun').addEventListener('click', () => this.runMultiverse());
    $('#arGameNew').addEventListener('click', () => this.newArenaGame());
    $('#arBrief').addEventListener('click', () => this.speakBriefing());
    $('#arPlay').addEventListener('click', () => this.playPortfolio());
    document.addEventListener('keydown', e => {
      if (this.view !== 'arena' || !this.game || e.metaKey || e.ctrlKey || (e.target instanceof Element && e.target.closest('input, textarea, select, button, [contenteditable="true"]'))) return;
      if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); this.gameStep(this.game.g.invested, 1); }
      else if (e.key === 'b' || e.key === 'B') this.gameStep(true, 1);
      else if (e.key === 'v' || e.key === 'V') this.gameStep(false, 1);
    });
    this.on('view:shown', v => { if (v === 'arena' && !this.mv && !this._mvBusy) this.runMultiverse(); });
  },

  /* ---------- univers parallèles ---------- */

  async runMultiverse() {
    const box = $('#arMvBody');
    const txs = Portfolio.txs();
    const fxAt = (k, d) => Api.fxAt((Store.instrument(k) || {}).currency || this.base(), d);
    // taux de change historiques des opérations (sinon le taux du jour sert de repli)
    for (const c of new Set(txs.map(t => (Store.instrument(t.key) || {}).currency).filter(Boolean))) {
      if (c !== this.base()) { try { await Api.fxSeries(c, txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO())); } catch (e) { /* repli */ } }
    }
    const flows = Arena.flows(txs, fxAt);
    if (!flows.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Enregistre tes achats pour voir ce que serait devenu ton argent dans d\'autres univers.')); return; }
    this._mvBusy = true;
    $('#arMvRun').disabled = true;
    box.classList.add('dk-loading');
    try {
      const from = flows[0].date, today = todayISO();
      const dates = Arena.weeks(from, today);
      const paths = {}, missing = [];
      // ton vrai portefeuille : rejeu de tes opérations sur les cours réels
      const keys = Array.from(new Set(txs.map(t => t.key))).filter(k => Store.instrument(k));
      const series = {}, fxs = {};
      for (const k of keys) {
        try { series[k] = await Api.daily(k, addDaysISO(from, -10)); fxs[k] = await Api.fxSeries((Store.instrument(k) || {}).currency || this.base(), from); } catch (e) { /* ligne ignorée */ }
      }
      const ev = Portfolio.historyEvents(txs.filter(t => series[t.key]));
      const rep = Portfolio.replay(series, fxs, ev);
      if (rep.points.length) {
        let pi = 0, v = 0;
        paths.real = dates.map(d => { while (pi < rep.points.length && rep.points[pi].date <= d) v = rep.points[pi++].value; return v; });
      }
      paths.mattress = Arena.savings(flows, dates, []);
      paths.livretA = Arena.savings(flows, dates, LIVRET_A_RATES);
      for (const u of ARENA_UNIVERSES.filter(x => x.sym)) {
        try {
          const s = await this.quantSeries('Y:' + u.sym, addDaysISO(from, -10), u.ccy);
          const p = Arena.universe(flows, s, dates);
          if (p) paths[u.id] = p; else missing.push(u.name + ' (historique trop court)');
        } catch (e) { missing.push(u.name); }
      }
      this.mv = { dates, paths, missing, flows, invested: flows.reduce((s, f) => s + f.amount, 0) };
      this.renderMultiverse();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally { this._mvBusy = false; $('#arMvRun').disabled = false; box.classList.remove('dk-loading'); }
  },

  renderMultiverse() {
    const M = this.mv, box = $('#arMvBody');
    if (!M || !box) return;
    const cur = this.base();
    const U = id => ARENA_UNIVERSES.find(u => u.id === id);
    const R = Arena.ranking(M.paths);
    const n = R.list.length;
    const race = el('div', { class: 'ar-race', role: 'img', 'aria-label': 'Course des univers' });
    const dateEl = el('div', { class: 'ar-race-date mono' });
    const rows = {};
    for (const id of Object.keys(M.paths)) {
      const u = U(id);
      rows[id] = el('div', { class: 'ar-row' + (id === 'real' ? ' you' : '') },
        el('span', { class: 'ar-name' }, u.emoji + ' ' + u.name),
        el('div', { class: 'ar-track' }, el('span', { class: 'ar-bar', style: `background:${u.color}` })),
        el('span', { class: 'ar-val mono' }));
      race.append(rows[id]);
    }
    race.style.height = `${n * 34}px`;
    const frame = i => {
      const d = M.dates[i];
      const vals = Object.entries(M.paths).map(([id, p]) => ({ id, v: p[i] || 0 })).sort((a, b) => b.v - a.v);
      const max = Math.max(1, vals[0].v);
      vals.forEach(({ id, v }, rank) => {
        const r = rows[id];
        r.style.transform = `translateY(${rank * 34}px)`;
        r.querySelector('.ar-bar').style.width = `${Math.max(0.5, v / max * 100)}%`;
        r.querySelector('.ar-val').textContent = fmtMoney(v, cur, 0);
      });
      dateEl.textContent = new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    };
    const btn = el('button', { type: 'button', class: 'btn small' }, '▶ Rejouer la course');
    let timer = null;
    const play = () => {
      clearInterval(timer);
      const total = M.dates.length, stepMs = Math.max(25, Math.min(120, 9000 / total));
      let i = 0;
      frame(0);
      timer = setInterval(() => { i++; if (i >= total) { clearInterval(timer); return; } frame(i); }, stepMs);
      this._mvTimer = timer;
    };
    btn.addEventListener('click', play);
    const real = R.real, best = R.list[0], worst = R.list[n - 1];
    const medal = r => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r + 'e');
    box.replaceChildren(...[
      real ? el('p', { class: 'q-lead' }, 'Tu as investi ', el('b', {}, fmtMoney(M.invested, cur, 0)), ' depuis le ', fmtDate(M.dates[0]), '. Dans cette réalité, ',
        el('b', {}, real.rank === 1 ? 'ton portefeuille gagne la course 🏆' : `ton portefeuille finit ${medal(real.rank)} sur ${n}`), '.',
        real.rank > 1 ? [' Dans l\'univers ', el('b', {}, '« ' + U(best.id).emoji + ' ' + U(best.id).name + ' »'), ', tu aurais ', el('b', { class: 'up' }, fmtMoney(R.regret, cur, 0)), ' de plus.'] : null,
        real.rank < n ? [real.rank > 1 ? ' Et dans l\'univers ' : ' Dans l\'univers ', el('b', {}, '« ' + U(worst.id).emoji + ' ' + U(worst.id).name + ' »'), ', tu aurais ', el('b', { class: 'down' }, fmtMoney(R.pride, cur, 0)), ' de moins.'] : null) : null,
      el('div', { class: 'ar-race-head' }, dateEl, btn),
      race,
      el('ol', { class: 'ar-podium' }, ...R.list.map(x => el('li', { class: x.id === 'real' ? 'you' : '' },
        el('span', {}, medal(x.rank)), el('span', {}, U(x.id).emoji + ' ' + U(x.id).name),
        el('b', { class: 'mono' }, fmtMoney(x.value, cur, 0)),
        el('span', { class: 'mono small ' + trendClass(x.value - M.invested) }, M.invested > 0 ? fmtPct((x.value / M.invested - 1) * 100, 0) : '')))),
      M.missing.length ? el('p', { class: 'small lab-warn' }, 'Univers indisponibles : ' + M.missing.join(', ')) : null,
      noteTip(`Chaque achat que tu as réellement fait (montant frais compris, en ${cur} au taux de change du jour) est placé le même jour dans chaque univers ; chaque vente en retire le même montant. Indices et ETF : cours de prix (hors dividendes), convertis en ${cur} au taux de chaque jour ; or : contrat à terme ; Livret A : taux officiels successifs, intérêts calculés au jour le jour (le dernier taux connu, ${fmtNum(LIVRET_A_RATES[LIVRET_A_RATES.length - 1][1], 1)} % depuis le ${fmtDate(LIVRET_A_RATES[LIVRET_A_RATES.length - 1][0])}, est prolongé). Ton vrai portefeuille : valeur de tes lignes, hors dividendes encaissés. Pour le plaisir, pas pour regretter.`, 'Règles du jeu')].filter(Boolean));
    frame(M.dates.length - 1);
    if (!this._mvPlayed) { this._mvPlayed = true; play(); }
    $('#arPlay').disabled = !M.paths.real;
  },

  /* ---------- défi à l'aveugle ---------- */

  async newArenaGame() {
    const box = $('#arGameBody'), btn = $('#arGameNew');
    btn.disabled = true;
    box.classList.add('dk-loading');
    try {
      const order = ARENA_GAME_MARKETS.slice().sort(() => Math.random() - 0.5);
      let g = null, m = null;
      for (const cand of order) {
        try {
          const s = await Api.daily('Y:' + cand.sym, '1985-01-01');
          g = Arena.newGame(Arena.weekly(s), Math.random());
          if (g) { m = cand; break; }
        } catch (e) { /* marché suivant */ }
      }
      if (!g) throw new Error('Pas d\'historique de marché disponible pour l\'instant. Réessaie plus tard.');
      this.game = { g, m };
      this.renderGame();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally { btn.disabled = false; btn.textContent = '🎲 Nouvelle partie'; box.classList.remove('dk-loading'); }
  },

  gameStep(invest, n) {
    const G = this.game;
    if (!G || G.g.t >= G.g.length) return;
    for (let k = 0; k < n && G.g.t < G.g.length; k++) Arena.step(G.g, invest);
    this.renderGame();
  },

  renderGame() {
    const G = this.game, box = $('#arGameBody');
    if (!G || !box) return;
    const g = G.g, done = g.t >= g.length;
    const shown = g.w.slice(0, g.context + g.t + 1);
    const base = g.w[0][1];
    const head = el('div', { class: 'ar-game-head' },
      el('div', {}, el('span', { class: 'muted small' }, 'Ton capital'), el('b', { class: 'mono ' + trendClass(g.equity - g.capital) }, fmtMoney(g.equity, 'EUR', 0, true))),
      el('div', {}, el('span', { class: 'muted small' }, 'Semaine'), el('b', { class: 'mono' }, `${g.t} / ${g.length}`)),
      el('div', {}, el('span', { class: 'muted small' }, 'Position'), el('b', { class: g.invested ? 'up' : 'muted' }, g.invested ? '📈 investi' : '💤 liquidités')));
    const controls = done ? null : el('div', { class: 'ar-game-ctrl' },
      el('button', { type: 'button', class: 'btn ' + (g.invested ? 'primary' : ''), onclick: () => this.gameStep(true, 1) }, '📈 Investi (B)'),
      el('button', { type: 'button', class: 'btn ' + (!g.invested ? 'primary' : ''), onclick: () => this.gameStep(false, 1) }, '💤 Liquidités (V)'),
      el('button', { type: 'button', class: 'btn', onclick: () => this.gameStep(g.invested, 1) }, 'Semaine suivante ▶'),
      el('button', { type: 'button', class: 'btn', onclick: () => this.gameStep(g.invested, 4) }, '+4 ▶▶'));
    let reveal = null;
    if (done) {
      const r = Arena.result(g);
      const best = (() => { try { return JSON.parse(localStorage.getItem('apistock:arena:best') || 'null'); } catch (e) { return null; } })();
      const record = !best || r.vs > best.vs;
      if (record) { try { localStorage.setItem('apistock:arena:best', JSON.stringify({ vs: r.vs, title: r.title, market: G.m.name, date: todayISO() })); } catch (e) { /* stockage indisponible */ } }
      reveal = el('div', { class: 'ar-reveal ' + (r.vs >= 0 ? 'win' : 'lose') },
        el('div', { class: 'ar-title' }, r.title),
        el('p', {}, 'C\'était ', el('b', {}, G.m.name), ` du ${fmtDate(r.from)} au ${fmtDate(r.to)}.`),
        el('div', { class: 'q-kpis' },
          ...[['Toi', fmtPct(r.you, 1), trendClass(r.you)], ['Acheter et conserver', fmtPct(r.market, 1), trendClass(r.market)], ['Écart', fmtPct(r.vs, 1), trendClass(r.vs)],
            ['Allers-retours', String(r.trades), ''], ['Temps investi', fmtNum(r.invested * 100, 0) + ' %', ''], ['Pire baisse du marché', fmtPct(r.mdd, 0), 'down']]
            .map(([l, v, c]) => el('div', { class: 'q-kpi' }, el('span', { class: 'muted small' }, l), el('b', { class: 'mono ' + c }, v)))),
        el('p', { class: 'small' }, r.text),
        el('p', { class: 'small muted' }, record ? '🏅 Nouveau record personnel !' : `Ton record : ${fmtPct(best.vs, 1)} face au marché (${best.title}).`));
    }
    box.replaceChildren(...[head, el('div', { class: 'chart-box ar-game-chart' }, el('canvas', { id: 'arGameChart' })), controls, reveal,
      done ? null : el('p', { class: 'small muted' }, `Les ${g.context} premières semaines sont déjà tracées. Nom, dates et échelle sont cachés. Changer de position coûte 0,1 %. Clavier : B = investi, V = liquidités, espace = semaine suivante.`)].filter(Boolean));
    if (typeof Chart !== 'undefined') {
      Charts.destroy('arGameChart');
      const o = Charts.baseOptions();
      o.plugins.legend.display = false;
      o.plugins.tooltip.enabled = false;
      o.scales.x.ticks.display = false;
      o.scales.y.ticks.callback = v => fmtNum(v, 0);
      o.animation = false;
      o.elements = { point: { radius: 0 } };
      const labels = g.w.slice(0, done ? g.w.length : shown.length).map((_, i) => i);
      const data = (done ? g.w : shown).map(([, p]) => p / base * 100);
      const seg = c => (c.p1DataIndex > g.context && g.log[c.p1DataIndex - g.context - 1] === 0 ? Charts.css('--muted') : Charts.css('--accent'));
      Charts.instances.arGameChart = new Chart($('#arGameChart'), { type: 'line', options: o,
        data: { labels: done ? labels : labels.concat(new Array(g.length - g.t).fill('')), datasets: [{ data, borderColor: Charts.css('--accent'), borderWidth: 2, segment: { borderColor: seg, borderDash: c => (c.p1DataIndex <= g.context ? [4, 3] : undefined) }, fill: false, tension: 0.1 }] } });
    }
  },

  /* ---------- écoute ton portefeuille ---------- */

  briefingData() {
    const { rows, totals } = Portfolio.snapshot();
    const mv = rows.filter(r => r.quote && isFinite(r.quote.percentChange)).sort((a, b) => b.quote.percentChange - a.quote.percentChange);
    const pick = r => (r ? { name: Store.label(r.key), pct: r.quote.percentChange } : null);
    return { value: totals.value, day: totals.day, dayPct: totals.dayPct, best: pick(mv[0]), worst: pick(mv[mv.length - 1]), total: totals.totalGain,
      totalPct: totals.cost > 0 ? totals.totalGain / totals.cost * 100 : NaN, alerts: (Store.state.alerts || []).filter(a => a.triggeredAt && Date.now() - a.triggeredAt < 864e5).length,
      hour: new Date().getHours(), cur: this.base() };
  },

  speakBriefing() {
    const text = Arena.briefingText(this.briefingData());
    $('#arBriefText').textContent = text;
    $('#arBriefText').classList.remove('hidden');
    if (!('speechSynthesis' in window)) { toast('La synthèse vocale n\'est pas disponible dans ce navigateur : voici le texte.', 'info'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = 1.02;
    const voice = speechSynthesis.getVoices().find(v => /^fr/i.test(v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  },

  /** Ton parcours en musique : une note par semaine de la courbe de ton vrai portefeuille (univers parallèles) */
  playPortfolio() {
    const p = this.mv && this.mv.paths.real;
    if (!p) { toast('Lance d\'abord les univers parallèles : ta courbe sert de partition.', 'info'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast('Le son n\'est pas disponible dans ce navigateur.', 'error'); return; }
    // les semaines où tu as versé de l'argent fausseraient la mélodie : on joue la performance, pas les versements
    const perf = [];
    let idx = 100;
    for (let i = 0; i < p.length; i++) {
      if (i > 0 && p[i - 1] > 0) {
        const flow = this.mv.flows.filter(f => f.date > this.mv.dates[i - 1] && f.date <= this.mv.dates[i]).reduce((s, f) => s + f.amount, 0);
        idx *= (p[i] - flow) / p[i - 1];
      }
      perf.push(idx);
    }
    const notes = Arena.score(perf.slice(-240));
    if (this._audio) { try { this._audio.close(); } catch (e) { /* déjà fermé */ } }
    const ctx = this._audio = new AC();
    const dur = Math.max(0.05, Math.min(0.18, 14 / notes.length));
    notes.forEach((n, i) => {
      const t = ctx.currentTime + 0.05 + i * dur;
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = n.up ? 'triangle' : 'sine';
      o.frequency.value = n.freq;
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(n.gain, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
      o.connect(gn).connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    });
    toast(`🎵 ${notes.length} semaines de ton parcours en ${Math.round(notes.length * dur)} secondes : aigu = hausse, grave = baisse.`, 'info', 5000);
  },
});
