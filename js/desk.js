/*
 * Salle des marchés : les outils d'un desk de gestion, appliqués à ton portefeuille.
 *
 * - P&L explain : d'où vient chaque euro gagné ou perdu sur une période. Effet prix (cours dans leur devise), effet de
 *   change (par devise), exécution (prix obtenu face à la clôture du jour), dividendes, frais ; part expliquée par le
 *   marché (bêta × MSCI World) et part qui vient de tes choix (alpha). Calendrier des P&L quotidiens et statistiques de
 *   trader (jours gagnants, gain moyen / perte moyenne, profit factor, pire baisse).
 * - Signaux & stratégies tactiques : tendance (cours au-dessus de sa moyenne 10 mois), momentum 12-1, volatilité cible ;
 *   chaque règle rejouée mois par mois sur ton portefeuille depuis 2000 (indice suivi quand l'ETF est trop récent),
 *   comparée à « conserver », avec le signal d'aujourd'hui.
 * - Journal de trades : thèse, objectif, stop, rapport gain / risque, taille de position au risque fixé, alertes.
 *
 * Les calculs (objet Desk) sont purs et testés (tests/desk.test.mjs) ; l'affichage est en bas du fichier.
 * Un éclairage sur le passé, pas un conseil : une règle qui a marché peut cesser de marcher.
 */
'use strict';

const DESK_RULES = {
  hold: { name: 'Conserver', hint: 'tes poids actuels, rééquilibrés chaque mois', color: '#94a3b8' },
  trend: { name: 'Tendance 10 mois', hint: 'une ligne sous sa moyenne 10 mois passe en liquidités', color: '#10b981' },
  momentum: { name: 'Momentum 12-1', hint: 'une ligne en baisse sur 12 mois (hors dernier mois) passe en liquidités', color: '#6366f1' },
  voltarget: { name: 'Tendance + volatilité cible', hint: 'lignes en tendance, pondérées par l\'inverse de leur volatilité, exposition réduite quand le risque dépasse la cible', color: '#f59e0b' },
};
const DESK_PERIODS = [['mtd', 'Mois en cours'], ['1m', '1 mois'], ['3m', '3 mois'], ['ytd', 'Depuis janvier'], ['1y', '1 an'], ['all', 'Depuis le début']];

const Desk = {
  /* ------------------------------------------------------------------ */
  /* P&L explain                                                          */
  /* ------------------------------------------------------------------ */

  /** Date de début d'une période (la valeur de départ est celle de la clôture de ce jour) */
  periodStart(period, today = todayISO(), first = today) {
    const y = today.slice(0, 4), m = today.slice(0, 7);
    const d = { mtd: addDaysISO(m + '-01', -1), '1m': addMonthsISO(today, -1), '3m': addMonthsISO(today, -3), ytd: `${+y - 1}-12-31`, '1y': addMonthsISO(today, -12) }[period];
    return d && d > first ? d : addDaysISO(first, -1);
  },

  /**
   * Explication du P&L entre `start` (clôture) et `end`.
   * `txs` : opérations en parts « après division » (Portfolio.historyEvents) ; `prices` : { clé: [[date, cours]] } dans la
   * devise de l'instrument ; `fx` : { clé: date → taux vers la devise de base } ; `bench` : [[date, cours]] en devise de base.
   * Pour chaque jour : effet prix = q·(p − p₋₁)·fx₋₁, effet change = q·p·(fx − fx₋₁), exécution = écart entre le prix de
   * l'opération et la clôture du jour. Identité : valeur finale − valeur initiale − achats + ventes + dividendes = P&L total.
   */
  explain({ txs, prices, fx = {}, start, end = todayISO(), bench = null }) {
    const fxOf = (k, d) => { const f = fx[k]; const r = typeof f === 'function' ? f(d) : f; return isFinite(r) && r > 0 ? r : 1; };
    const evs = txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const keys = Array.from(new Set([...Object.keys(prices), ...evs.map(t => t.key)]));
    const pos = {}, last = {}, idx = {};
    const line = k => (pos[k] = pos[k] || { key: k, qty: 0, price: 0, fx: 0, exec: 0, div: 0, fees: 0, buys: 0, sells: 0 });
    for (const k of keys) { idx[k] = 0; last[k] = { p: NaN, fx: NaN }; }
    const advance = (k, d) => { // dernier cours connu à la date d
      const s = prices[k] || [];
      while (idx[k] < s.length && s[idx[k]][0] <= d) { last[k] = { p: s[idx[k]][1], fx: fxOf(k, s[idx[k]][0]) }; idx[k]++; }
    };
    // positions et cours à la date de départ
    let e = 0;
    for (const k of keys) advance(k, start);
    while (e < evs.length && evs[e].date <= start) {
      const t = evs[e++];
      if (t.type === 'buy') line(t.key).qty += t.qty;
      else if (t.type === 'sell') line(t.key).qty = Math.max(0, line(t.key).qty - t.qty);
    }
    const valueNow = () => keys.reduce((s, k) => s + (pos[k] && pos[k].qty > 0 && isFinite(last[k].p) ? pos[k].qty * last[k].p * last[k].fx : 0), 0);
    const startValue = valueNow();
    const dates = Array.from(new Set(keys.flatMap(k => (prices[k] || []).map(v => v[0])).filter(d => d > start && d <= end))).sort();
    const days = [];
    let inflow = 0, outflow = 0, prevValue = startValue;
    for (const d of dates) {
      let pnl = 0, buyFlow = 0;
      const before = {};
      for (const k of keys) before[k] = last[k];
      for (const k of keys) advance(k, d);
      // détention de la veille : effets prix et change
      for (const k of keys) {
        const L = pos[k], b = before[k], a = last[k];
        if (!L || !(L.qty > 0) || !isFinite(b.p) || !isFinite(a.p)) continue;
        const dp = L.qty * (a.p - b.p) * b.fx, dfx = L.qty * a.p * (a.fx - b.fx);
        L.price += dp; L.fx += dfx; pnl += dp + dfx;
      }
      // opérations du jour (ou depuis la séance précédente : week-end, jour férié)
      while (e < evs.length && evs[e].date <= d) {
        const t = evs[e++], L = line(t.key), a = last[t.key];
        const f = isFinite(a.fx) ? a.fx : fxOf(t.key, d);
        const close = isFinite(a.p) ? a.p : t.price;
        const fee = (t.fees || 0) * f;
        if (t.type === 'buy') {
          const x = t.qty * (close - t.price) * f;
          L.exec += x; L.fees += fee; L.qty += t.qty; L.buys += t.qty * t.price * f;
          inflow += t.qty * t.price * f + fee; buyFlow += t.qty * t.price * f;
          pnl += x - fee;
        } else if (t.type === 'sell') {
          const q = Math.min(t.qty, L.qty);
          const x = q * (t.price - close) * f;
          L.exec += x; L.fees += fee; L.qty -= q; L.sells += q * t.price * f;
          outflow += q * t.price * f - fee;
          pnl += x - fee;
        } else if (t.type === 'div') {
          const v = (t.qty * t.price - (t.fees || 0)) * f;
          L.div += v; outflow += v; pnl += v;
        }
      }
      const value = valueNow();
      const base = prevValue + buyFlow;
      days.push({ date: d, pnl, value, ret: base > 0 ? pnl / base : 0 });
      prevValue = value;
    }
    const lines = Object.values(pos).map(L => Object.assign(L, { total: L.price + L.fx + L.exec + L.div - L.fees }))
      .filter(L => Math.abs(L.total) > 0.005 || L.qty > 0);
    const sum = f => lines.reduce((s, L) => s + L[f], 0);
    const out = { start, end, startValue, endValue: valueNow(), inflow, outflow, days, lines,
      price: sum('price'), fx: sum('fx'), exec: sum('exec'), div: sum('div'), fees: sum('fees') };
    out.total = out.price + out.fx + out.exec + out.div - out.fees;
    out.twr = days.reduce((g, x) => g * (1 + x.ret), 1) - 1;
    out.stats = this.dayStats(days);
    if (bench && bench.length > 1) out.market = this.marketPart(days, bench, start);
    return out;
  },

  /**
   * Calendrier des séances, une entrée par année (la plus récente d'abord) : semaines (lundi → vendredi) avec le mois
   * affiché au-dessus de la première semaine de chaque mois, total et part de séances gagnantes.
   * `scale` : rendement quotidien qui donne la couleur la plus intense (95e centile des écarts, pour qu'un krach isolé
   * n'efface pas toutes les autres journées). Couleur selon le rendement en %, comparable d'une année à l'autre.
   */
  calendar(days) {
    const list = days.filter(d => d && d.date && isFinite(d.ret));
    if (list.length < 5) return null;
    const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const abs = list.map(d => Math.abs(d.ret)).filter(x => x > 0).sort((a, b) => a - b);
    const scale = abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : 0;
    const byYear = new Map();
    for (const d of list) {
      const dow = (new Date(d.date + 'T12:00:00Z').getUTCDay() + 6) % 7;
      if (dow > 4) continue;
      const y = +d.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, { year: y, weeks: [], total: 0, sessions: 0, wins: 0 });
      const Y = byYear.get(y), monday = addDaysISO(d.date, -dow);
      let w = Y.weeks[Y.weeks.length - 1];
      if (!w || w.monday !== monday) {
        // nom du mois au-dessus de la première semaine dont le lundi tombe dans ce mois (ou de la première semaine de l'année)
        const prev = Y.weeks[Y.weeks.length - 1], month = (monday < y + '-01-01' ? d.date : monday).slice(5, 7);
        Y.weeks.push(w = { monday, days: new Array(5).fill(null), month: !prev || prev.mk !== month ? MOIS[+month - 1] : '', mk: month });
      }
      w.days[dow] = d;
      Y.total += d.pnl;
      if (Math.abs(d.pnl) > 0.005) { Y.sessions++; if (d.pnl > 0) Y.wins++; }
    }
    const years = Array.from(byYear.values()).sort((a, b) => b.year - a.year);
    for (const Y of years) { Y.hit = Y.sessions ? Y.wins / Y.sessions : NaN; for (const w of Y.weeks) delete w.mk; }
    return { years, scale };
  },

  /** Intensité de couleur (0 à 4) d'un rendement quotidien face à l'échelle du calendrier */
  heatLevel(ret, scale) {
    if (!(scale > 0) || !isFinite(ret)) return 0;
    const a = Math.min(1, Math.abs(ret) / scale);
    return a < 0.08 ? 0 : Math.ceil(a * 4);
  },

  /** Effet de change regroupé par devise : { USD: −340, … } (`ccyOf` : clé → devise) */
  fxByCurrency(lines, ccyOf) {
    const o = {};
    for (const L of lines) { const c = ccyOf(L.key); if (Math.abs(L.fx) > 0.005) o[c] = (o[c] || 0) + L.fx; }
    return o;
  },

  /** Statistiques de trader sur les P&L quotidiens */
  dayStats(days) {
    const act = days.filter(d => Math.abs(d.pnl) > 0.005);
    const wins = act.filter(d => d.pnl > 0), losses = act.filter(d => d.pnl < 0);
    const gw = wins.reduce((s, d) => s + d.pnl, 0), gl = -losses.reduce((s, d) => s + d.pnl, 0);
    let peak = 1, idx = 1, mdd = 0;
    for (const d of days) { idx *= 1 + d.ret; peak = Math.max(peak, idx); mdd = Math.min(mdd, idx / peak - 1); }
    const best = act.reduce((a, d) => (!a || d.pnl > a.pnl ? d : a), null), worst = act.reduce((a, d) => (!a || d.pnl < a.pnl ? d : a), null);
    return { days: act.length, hit: act.length ? wins.length / act.length : NaN, avgWin: wins.length ? gw / wins.length : NaN, avgLoss: losses.length ? -gl / losses.length : NaN,
      profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : NaN), best, worst, maxDrawdown: mdd };
  },

  /**
   * Part du marché : bêta du portefeuille face à l'indice (rendements quotidiens de la période), P&L « marché »
   * = Σ β · rendement de l'indice · valeur de la veille, le reste étant l'alpha (tes choix de lignes et de moments).
   */
  marketPart(days, bench, start) {
    let bi = 0, bv = NaN;
    const at = d => { while (bi < bench.length && bench[bi][0] <= d) bv = bench[bi++][1]; return bv; }; // dates croissantes
    let prev = at(start);
    const rb = [], rp = [], vals = [];
    let prevValue = days.length ? days[0].value - days[0].pnl : 0;
    for (const d of days) {
      const b = at(d.date);
      const r = isFinite(prev) && isFinite(b) && prev > 0 ? b / prev - 1 : NaN;
      if (isFinite(r)) { rb.push(r); rp.push(d.ret); vals.push(prevValue); }
      prev = b; prevValue = d.value;
    }
    if (rb.length < 5) return null;
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const mb = mean(rb), mp = mean(rp);
    let cov = 0, vb = 0;
    for (let i = 0; i < rb.length; i++) { cov += (rb[i] - mb) * (rp[i] - mp); vb += (rb[i] - mb) ** 2; }
    const beta = vb > 0 ? cov / vb : NaN;
    const market = rb.reduce((s, r, i) => s + beta * r * vals[i], 0);
    const benchRet = rb.reduce((g, r) => g * (1 + r), 1) - 1;
    return { beta, market, benchRet, n: rb.length };
  },

  /* ------------------------------------------------------------------ */
  /* Signaux & stratégies tactiques                                       */
  /* ------------------------------------------------------------------ */

  /** Dernière clôture de chaque mois : [[date, cours]] (le mois en cours compte avec son dernier cours) */
  monthEnds(series) {
    const out = [];
    for (const [d, p] of series) {
      if (!(p > 0)) continue;
      if (out.length && out[out.length - 1][0].slice(0, 7) === d.slice(0, 7)) out[out.length - 1] = [d, p];
      else out.push([d, p]);
    }
    return out;
  },

  /** Tableau mensuel aligné : mois communs à toutes les séries → { keys, months, px: [[cours par clé] par mois] } */
  panel(seriesByKey) {
    const keys = Object.keys(seriesByKey).filter(k => (seriesByKey[k] || []).length > 1);
    if (!keys.length) return { keys, months: [], px: [] };
    const maps = keys.map(k => new Map(this.monthEnds(seriesByKey[k]).map(([d, p]) => [d.slice(0, 7), p])));
    const months = Array.from(maps[0].keys()).filter(m => maps.every(x => x.has(m))).sort();
    return { keys, months, px: months.map(m => maps.map(x => x.get(m))) };
  },

  /** Signaux d'une ligne au mois i : tendance (cours / moyenne 10 mois), momentum 12-1 et 6 mois, volatilité annuelle (12 mois) */
  signals(px, i, j) {
    const p = r => (px[r] ? px[r][j] : NaN);
    const sma = i >= 9 ? Array.from({ length: 10 }, (_, k) => p(i - k)).reduce((s, x) => s + x, 0) / 10 : NaN;
    const rets = [];
    for (let r = Math.max(1, i - 11); r <= i; r++) rets.push(p(r) / p(r - 1) - 1);
    const m = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : NaN;
    const vol = rets.length >= 6 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1) * 12) : NaN;
    return { price: p(i), sma, trend: isFinite(sma) ? p(i) / sma - 1 : NaN, mom: i >= 12 ? p(i - 1) / p(i - 12) - 1 : NaN, mom6: i >= 6 ? p(i) / p(i - 6) - 1 : NaN, vol };
  },

  /**
   * Poids décidés à la fin du mois i selon la règle (le reste en liquidités).
   * `w` : poids de référence (somme 1) ; `opts.volTarget` : volatilité annuelle visée (règle « voltarget »).
   */
  weights(rule, px, i, w, opts = {}) {
    const n = w.length, sig = w.map((_, j) => this.signals(px, i, j));
    if (rule === 'hold') return w.slice();
    if (rule === 'trend') return w.map((x, j) => (sig[j].trend > 0 ? x : 0));
    if (rule === 'momentum') return w.map((x, j) => (sig[j].mom > (opts.cash || 0) ? x : 0));
    if (rule === 'voltarget') {
      const inv = w.map((x, j) => (x > 0 && sig[j].trend > 0 && sig[j].vol > 0 ? x / sig[j].vol : 0));
      const s = inv.reduce((a, b) => a + b, 0);
      if (!(s > 0)) return new Array(n).fill(0);
      const raw = inv.map(x => x / s);
      // volatilité du panier sur 12 mois (covariance des rendements mensuels)
      const rows = [];
      for (let r = Math.max(1, i - 11); r <= i; r++) rows.push(raw.reduce((acc, x, j) => acc + x * (px[r][j] / px[r - 1][j] - 1), 0));
      const m = rows.reduce((a, b) => a + b, 0) / rows.length;
      const vol = rows.length > 2 ? Math.sqrt(rows.reduce((a, x) => a + (x - m) ** 2, 0) / (rows.length - 1) * 12) : NaN;
      const scale = vol > 0 ? Math.min(1, (opts.volTarget || 0.1) / vol) : 1;
      return raw.map(x => x * scale);
    }
    return w.slice();
  },

  /**
   * Rejoue une règle mois par mois : décision à la clôture du mois i, rendement du mois i+1, liquidités rémunérées
   * à `cash` par an, coût de `cost` (fraction) sur chaque euro échangé. Renvoie { dates, equity, rets, exposure }.
   */
  backtest(P, w, rule, opts = {}) {
    const cash = opts.cash || 0, cost = opts.cost === undefined ? 0.001 : opts.cost;
    const from = Math.max(12, opts.from || 0);
    const dates = [], equity = [1], rets = [], exposure = [];
    let cur = null;
    for (let i = from; i < P.px.length - 1; i++) {
      const target = this.weights(rule, P.px, i, w, { cash, volTarget: opts.volTarget });
      const turnover = cur ? target.reduce((s, x, j) => s + Math.abs(x - cur[j]), 0) : target.reduce((s, x) => s + x, 0);
      const inv = target.reduce((s, x) => s + x, 0);
      const r = target.reduce((s, x, j) => s + x * (P.px[i + 1][j] / P.px[i][j] - 1), 0) + (1 - inv) * (Math.pow(1 + cash, 1 / 12) - 1) - turnover * cost;
      rets.push(r); exposure.push(inv);
      equity.push(equity[equity.length - 1] * (1 + r));
      if (!dates.length) dates.push(P.months[i]);
      dates.push(P.months[i + 1]);
      // poids qui dérivent avec les cours jusqu'à la prochaine décision
      const grown = target.map((x, j) => x * P.px[i + 1][j] / P.px[i][j]);
      const tot = grown.reduce((s, x) => s + x, 0) + (1 - inv);
      cur = grown.map(x => (tot > 0 ? x / tot : 0));
    }
    return { dates, equity, rets, exposure, metrics: this.metrics(rets, exposure, cash) };
  },

  /** Indicateurs d'une série de rendements mensuels */
  metrics(rets, exposure = [], cash = 0) {
    const n = rets.length;
    if (!n) return null;
    const g = rets.reduce((a, r) => a * (1 + r), 1);
    const cagr = Math.pow(g, 12 / n) - 1;
    const m = rets.reduce((a, b) => a + b, 0) / n;
    const vol = n > 1 ? Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1) * 12) : NaN;
    let peak = 1, eq = 1, mdd = 0;
    for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
    return { cagr, vol, mdd, sharpe: vol > 0 ? (cagr - cash) / vol : NaN, calmar: mdd < 0 ? cagr / -mdd : NaN, worst: Math.min(...rets), total: g - 1,
      years: n / 12, invested: exposure.length ? exposure.reduce((a, b) => a + b, 0) / exposure.length : 1 };
  },

  /* ------------------------------------------------------------------ */
  /* Journal de trades                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * État d'une thèse au cours `price` : rapport gain / risque restant, progression entre stop (0) et objectif (1), statut.
   * Thèse : { entry, target, stop } (même devise que le cours).
   */
  thesisState(t, price) {
    const target = parseNum(t.target), stop = parseNum(t.stop), entry = parseNum(t.entry);
    const long = !(isFinite(target) && isFinite(stop)) || target >= stop;
    const reward = isFinite(target) ? (long ? target - price : price - target) : NaN;
    const risk = isFinite(stop) ? (long ? price - stop : stop - price) : NaN;
    const status = isFinite(target) && (long ? price >= target : price <= target) ? 'target'
      : isFinite(stop) && (long ? price <= stop : price >= stop) ? 'stop' : 'open';
    const span = isFinite(target) && isFinite(stop) ? target - stop : NaN;
    const initialRisk = isFinite(entry) && isFinite(stop) ? Math.abs(entry - stop) : NaN;
    return { status, rr: risk > 0 && isFinite(reward) ? reward / risk : NaN, progress: isFinite(span) && span !== 0 ? Math.max(0, Math.min(1, (price - stop) / span)) : NaN,
      rMultiple: initialRisk > 0 && isFinite(entry) ? (long ? price - entry : entry - price) / initialRisk : NaN };
  },

  /**
   * Taille de position au risque fixé : nombre de parts pour que toucher le stop coûte `riskPct` % du capital.
   * Montants dans la même devise (prix et stop convertis au préalable). Plafonné à `cash` si fourni.
   */
  positionSize({ capital, riskPct, price, stop, cash = Infinity }) {
    const perShare = Math.abs(price - stop);
    if (!(capital > 0) || !(riskPct > 0) || !(perShare > 0) || !(price > 0)) return null;
    const budget = capital * riskPct / 100;
    let qty = Math.floor(budget / perShare);
    if (isFinite(cash)) qty = Math.min(qty, Math.floor(cash / price));
    return { qty: Math.max(0, qty), risk: Math.max(0, qty) * perShare, budget, amount: Math.max(0, qty) * price, weight: capital > 0 ? Math.max(0, qty) * price / capital : NaN };
  },
};

/* ==================== Affichage : onglet « Salle des marchés » ==================== */

Object.assign(App, {
  deskPeriod: 'mtd',

  bindDesk() {
    if (!$('#view-desk')) return;
    $('#dkPeriods').replaceChildren(...DESK_PERIODS.map(([id, name]) => el('button', { type: 'button', dataset: { p: id }, class: id === this.deskPeriod ? 'active' : '', onclick: () => {
      this.deskPeriod = id;
      $$('#dkPeriods button').forEach(b => b.classList.toggle('active', b.dataset.p === id));
      this.runExplain();
    } }, name)));
    $('#dkSigRun').addEventListener('click', () => this.runSignals());
    $('#dkVol').addEventListener('change', () => { if (this.sigResult) this.runSignals(); });
    this.bindJournal();
    this.on('view:shown', v => { if (v === 'desk') { this.renderJournal(); if (!this.explainResult && !this._explaining) this.runExplain(); } });
    this.on('rendered:portfolio', () => { if (this.view === 'desk') this.renderJournal(); });
  },

  deskBusy(id, busy, label) { const b = $(id); if (b) { b.disabled = busy; if (label) b.textContent = busy ? 'Calcul…' : label; } },

  /* ---------- P&L explain ---------- */

  async runExplain() {
    const box = $('#dkPnlBody');
    const raw = Portfolio.txs();
    if (!raw.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des opérations pour voir d\'où vient ton P&L.')); return; }
    const token = this._explainToken = {};
    this._explaining = true;
    box.classList.add('dk-loading');
    try {
      const today = todayISO();
      const first = raw.reduce((m, t) => (t.date < m ? t.date : m), today);
      const start = Desk.periodStart(this.deskPeriod, today, first);
      const from = addDaysISO(start, -10);
      const txs = Portfolio.historyEvents(raw);
      const keys = Array.from(new Set(txs.map(t => t.key))).filter(k => Store.instrument(k));
      const prices = {}, fx = {}, missing = [];
      for (const k of keys) {
        try {
          prices[k] = await Api.daily(k, from);
          const q = Api.cachedQuote(k);
          // cours du jour : la dernière clôture connue est remplacée par le cours en direct
          if (q && q.price > 0 && prices[k].length && prices[k][prices[k].length - 1][0] <= today) prices[k] = prices[k].filter(v => v[0] < today).concat([[today, q.price]]);
          fx[k] = await Api.fxSeries((Store.instrument(k) || {}).currency || this.base(), from);
        } catch (e) { missing.push(Store.label(k)); }
      }
      let bench = null;
      try { bench = await this.quantSeries('Y:' + HIST_BENCH.ysym, from, HIST_BENCH.ccy); } catch (e) { bench = null; }
      if (token !== this._explainToken) return;
      const ok = txs.filter(t => prices[t.key]);
      this.explainResult = Object.assign(Desk.explain({ txs: ok, prices, fx, start, end: today, bench }), { missing, period: this.deskPeriod });
      this.renderExplain();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally {
      if (token === this._explainToken) { this._explaining = false; box.classList.remove('dk-loading'); }
    }
  },

  renderExplain() {
    const R = this.explainResult, box = $('#dkPnlBody');
    if (!R || !box) return;
    const cur = this.base();
    const m = (v, d = 0) => fmtMoney(v, cur, d);
    const sm = v => fmtSignedMoney(v, cur);
    const net = R.inflow - R.outflow + R.div; // achats − ventes (les dividendes, encaissés, sont dans le P&L)
    const steps = [['Valeur au départ', R.startValue, 'base'], ['Achats − ventes', net, 'flow'], ['Effet prix', R.price], ['Effet de change', R.fx],
      ['Exécution', R.exec], ['Dividendes', R.div], ['Frais', R.fees > 0.005 ? -R.fees : 0], [R.div > 0.5 ? 'Valeur aujourd\'hui + dividendes encaissés' : 'Valeur aujourd\'hui', R.endValue + R.div, 'base']];
    const maxAbs = Math.max(1, ...steps.map(s => Math.abs(s[1])));
    const ccyOf = k => (Store.instrument(k) || {}).currency || cur;
    const byCcy = Object.entries(Desk.fxByCurrency(R.lines, ccyOf)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const ccyName = { USD: 'Le dollar', GBP: 'La livre', GBp: 'La livre', CHF: 'Le franc suisse', JPY: 'Le yen', EUR: 'L\'euro' };
    const S = R.stats, M = R.market;
    const alpha = M ? R.total - M.market : NaN;
    const kpi = (label, value, sub, cls = '') => el('div', { class: 'q-kpi' }, el('span', { class: 'muted small' }, label), el('b', { class: 'mono ' + cls }, value), sub ? el('small', { class: 'muted' }, sub) : null);
    const lines = R.lines.slice().sort((a, b) => b.total - a.total);
    box.replaceChildren(...[
      el('div', { class: 'dk-hero' },
        el('div', {}, el('span', { class: 'muted small' }, 'P&L de la période'), el('b', { class: 'mono ' + trendClass(R.total) }, sm(R.total)),
          el('small', { class: 'muted' }, `${fmtPct(R.twr * 100, 2)} · du ${fmtDate(addDaysISO(R.start, 1))} au ${fmtDate(R.end)}`)),
        M ? el('div', {}, el('span', { class: 'muted small' }, 'Expliqué par le marché'), el('b', { class: 'mono ' + trendClass(M.market) }, sm(M.market)),
          el('small', { class: 'muted' }, `bêta ${fmtNum(M.beta, 2)} · ${HIST_BENCH.name} ${fmtPct(M.benchRet * 100, 1)}`)) : null,
        M ? el('div', { class: alpha >= 0 ? 'dk-alpha up' : 'dk-alpha down' }, el('span', { class: 'small' }, 'Tes choix (alpha)'), el('b', { class: 'mono' }, sm(alpha)),
          el('small', {}, alpha >= 0 ? 'mieux que ton exposition au marché' : 'moins bien que ton exposition au marché')) : null),
      el('div', { class: 'dk-bridge', role: 'list' }, ...steps.map(([label, v, kind]) => el('div', { class: 'dk-bridge-row' + (kind === 'base' ? ' base' : ''), role: 'listitem' },
        el('span', {}, label),
        el('div', { class: 'dk-bar' }, el('span', { class: kind === 'base' ? 'neutral' : v >= 0 ? 'pos' : 'neg', style: `width:${Math.max(1, Math.abs(v) / maxAbs * 100)}%` })),
        el('b', { class: 'mono ' + (kind === 'base' ? '' : trendClass(v)) }, kind === 'base' ? m(v) : sm(v))))),
      byCcy.length ? el('p', { class: 'q-lead' }, ...byCcy.slice(0, 3).flatMap(([c, v], i) => [i ? ' ' : '', el('b', {}, ccyName[c] || c), ` t'a ${v >= 0 ? 'rapporté' : 'coûté'} `, el('b', { class: v >= 0 ? 'up' : 'down' }, m(Math.abs(v))), '.']),
        ' C\'est l\'effet de change pur : ce que tu aurais gagné ou perdu même si les cours n\'avaient pas bougé.') : null,
      el('div', { class: 'q-kpis' },
        kpi('Jours gagnants', isFinite(S.hit) ? fmtNum(S.hit * 100, 0) + ' %' : '—', `${S.days} séances`),
        kpi('Gain moyen / perte moyenne', isFinite(S.avgWin) && isFinite(S.avgLoss) ? `${m(S.avgWin)} / ${m(-S.avgLoss)}` : '—', isFinite(S.avgWin) && isFinite(S.avgLoss) && S.avgLoss < 0 ? `ratio ${fmtNum(S.avgWin / -S.avgLoss, 2)}` : ''),
        kpi('Profit factor', isFinite(S.profitFactor) ? fmtNum(S.profitFactor, 2) : S.profitFactor === Infinity ? '∞' : '—', 'gains ÷ pertes'),
        kpi('Meilleure séance', S.best ? sm(S.best.pnl) : '—', S.best ? fmtDate(S.best.date) : '', 'up'),
        kpi('Pire séance', S.worst ? sm(S.worst.pnl) : '—', S.worst ? fmtDate(S.worst.date) : '', 'down'),
        kpi('Pire baisse', fmtPct(S.maxDrawdown * 100, 1), 'du plus haut au plus bas', 'down')),
      this.deskHeatmap(R.days),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table dk-table' },
        el('thead', {}, el('tr', {}, ...['Ligne', 'Prix', 'Change', 'Exécution', 'Dividendes', 'Frais', 'Total'].map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
        el('tbody', {}, ...lines.map(L => el('tr', {},
          el('td', {}, Store.label(L.key), L.qty > 0 ? null : el('span', { class: 'muted small' }, ' · soldée')),
          ...[L.price, L.fx, L.exec, L.div, L.fees > 0.005 ? -L.fees : 0, L.total].map((v, i) => el('td', { class: 'num mono ' + (Math.abs(v) < 0.5 ? 'muted' : trendClass(v)) + (i === 5 ? ' dk-total' : '') }, Math.abs(v) < 0.5 ? '—' : sm(v)))))))),
      R.missing.length ? el('p', { class: 'small lab-warn' }, 'Sans historique, ignorées : ' + R.missing.join(', ')) : null,
      noteTip(`Chaque jour, la position de la veille est valorisée : effet prix = parts × variation du cours dans sa devise × taux de change de la veille ; effet de change = parts × cours × variation du taux. Exécution : écart entre ton prix d'achat ou de vente et la clôture du jour (positif = tu as fait mieux que la clôture). Part du marché : bêta de tes rendements quotidiens face au ${HIST_BENCH.name} sur la période × rendement de l'indice ; l'alpha est le reste. Cours de clôture (cours en direct pour aujourd'hui).`, 'Méthode')].filter(Boolean));
  },

  /** Calendrier des P&L quotidiens de toute la période, une ligne par année (la plus récente en haut) */
  deskHeatmap(days) {
    const cal = Desk.calendar(days);
    if (!cal) return null;
    const cur = this.base();
    const detail = el('p', { class: 'dk-heat-detail small muted', 'aria-live': 'polite' }, 'Survole ou touche une séance pour son détail.');
    const show = d => detail.replaceChildren(el('b', {}, fmtDate(d.date)), ' : ', el('b', { class: 'mono ' + trendClass(d.pnl) }, fmtSignedMoney(d.pnl, cur)), ` (${fmtPct(d.ret * 100, 2)})`);
    const cell = d => {
      if (!d) return el('span', { class: 'dk-cell empty' });
      const lvl = Desk.heatLevel(d.ret, cal.scale);
      const label = `${fmtDate(d.date)} : ${fmtSignedMoney(d.pnl, cur)} (${fmtPct(d.ret * 100, 2)})`;
      return el('span', { class: `dk-cell ${d.ret >= 0 ? 'pos' : 'neg'} l${lvl}`, title: label, onmouseenter: () => show(d), onclick: () => show(d) });
    };
    const rows = cal.years.map(Y => {
      const strip = el('div', { class: 'dk-heat' },
        el('div', { class: 'dk-heat-days muted' }, el('span', {}), ...['L', 'M', 'M', 'J', 'V'].map(x => el('span', {}, x))),
        ...Y.weeks.map(w => el('div', { class: 'dk-week' }, el('span', { class: 'dk-month muted' }, w.month || ''), ...w.days.map(cell))));
      return el('div', { class: 'dk-year' },
        el('div', { class: 'dk-year-head small' }, el('b', {}, String(Y.year)), el('span', { class: 'mono ' + trendClass(Y.total) }, fmtSignedMoney(Y.total, cur)),
          el('span', { class: 'muted' }, `${Y.sessions} séances · ${fmtNum(Y.hit * 100, 0)} % gagnantes`)),
        strip);
    });
    // écran étroit : l'année en cours s'ouvre sur les dernières séances, les années passées sur janvier
    requestAnimationFrame(() => { const s = rows[0] && rows[0].querySelector('.dk-heat'); if (s) s.scrollLeft = s.scrollWidth; });
    return el('div', { class: 'dk-heat-wrap' },
      el('div', { class: 'dk-heat-head' }, el('b', { class: 'small' }, 'P&L séance par séance'),
        el('span', { class: 'dk-legend muted small' }, 'baisse', ...[4, 2, 0].map(l => el('span', { class: 'dk-cell neg l' + l })), ...[2, 4].map(l => el('span', { class: 'dk-cell pos l' + l })), 'hausse')),
      ...rows, detail);
  },

  /* ---------- signaux & stratégies tactiques ---------- */

  async runSignals() {
    const box = $('#dkSigBody');
    const lines = this.quantLines();
    if (!lines.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des positions cotées pour tester les stratégies.')); return; }
    this.deskBusy('#dkSigRun', true, 'Tester');
    try {
      const start = '1999-06-01';
      const series = {}, sources = [], missing = [];
      for (const l of lines) {
        let own = null;
        try { own = await this.quantSeries(l.key, start); } catch (e) { own = null; }
        const p = LAB_PROXY[Expo.of(l.key).profile];
        let proxy = null;
        if (p) { try { proxy = await this.quantSeries('Y:' + p[0], start, p[1]); } catch (e) { proxy = null; } }
        const s = own && own.length ? (proxy && proxy.length ? Lab.extend(own, proxy) : own) : proxy;
        if (s && s.length > 30) { series[l.key] = s; if (proxy && own && proxy[0][0] < own[0][0]) sources.push(`${Store.label(l.key)} avant ${own[0][0].slice(0, 4)} → ${p[2]}`); }
        else missing.push(Store.label(l.key));
      }
      const P = Desk.panel(series);
      if (P.months.length < 26) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins deux ans) pour tester une stratégie.');
      const total = P.keys.reduce((s, k) => s + lines.find(l => l.key === k).value, 0);
      const w = P.keys.map(k => lines.find(l => l.key === k).value / total);
      const cash = (Store.state.settings.riskFree ?? 2) / 100, volTarget = (parseNum($('#dkVol').value) || 10) / 100;
      const results = Object.keys(DESK_RULES).map(rule => ({ rule, bt: Desk.backtest(P, w, rule, { cash, volTarget }) }));
      const last = P.px.length - 1;
      this.sigResult = { P, w, results, cash, volTarget, sources, missing, now: Object.fromEntries(Object.keys(DESK_RULES).map(r => [r, Desk.weights(r, P.px, last, w, { cash, volTarget })])),
        signals: P.keys.map((k, j) => Object.assign({ key: k }, Desk.signals(P.px, last, j))) };
      this.renderSignals();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally { this.deskBusy('#dkSigRun', false, 'Retester'); }
  },

  renderSignals() {
    const S = this.sigResult, box = $('#dkSigBody');
    if (!S || !box) return;
    const pct = (v, d = 1) => (isFinite(v) ? fmtPct(v * 100, d) : '—');
    const ok = S.results.filter(x => x.bt.metrics);
    const hold = ok.find(x => x.rule === 'hold');
    const best = ok.reduce((a, b) => (!a || b.bt.metrics.calmar > a.bt.metrics.calmar ? b : a), null);
    const span = `${S.P.months[12]} → ${S.P.months[S.P.months.length - 1]}`;
    const inCount = S.signals.filter(s => s.trend > 0).length;
    box.replaceChildren(...[
      el('p', { class: 'q-lead' }, `Aujourd'hui, `, el('b', {}, `${inCount} ligne${inCount > 1 ? 's' : ''} sur ${S.signals.length}`), ` ${inCount > 1 ? 'sont' : 'est'} en tendance haussière. `,
        best && hold && best.rule !== 'hold' ? [`Sur ${fmtNum(hold.bt.metrics.years, 0)} ans, la règle `, el('b', {}, DESK_RULES[best.rule].name), ` aurait limité la pire baisse à `, el('b', { class: 'down' }, pct(best.bt.metrics.mdd, 0)),
          ` contre ${pct(hold.bt.metrics.mdd, 0)} en conservant, pour ${pct(best.bt.metrics.cagr)} par an au lieu de ${pct(hold.bt.metrics.cagr)}.`] : 'Sur cette période, aucune règle ne fait mieux que conserver, à risque comparable.'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, el('span', {}, 'vs moyenne 10 mois', infoTip('Écart entre le cours et la moyenne des 10 dernières clôtures mensuelles : au-dessus = tendance haussière (règle de Faber, 2007).'))),
          el('th', { class: 'num' }, el('span', {}, 'Momentum 12-1', infoTip('Performance des 12 derniers mois hors dernier mois : le signal de momentum le plus étudié (Jegadeesh-Titman, Moskowitz).'))), el('th', { class: 'num' }, '6 mois'), el('th', { class: 'num' }, 'Volatilité'), el('th', {}, 'Signal'))),
        el('tbody', {}, ...S.signals.map(s => el('tr', {},
          el('td', {}, Store.label(s.key)),
          el('td', { class: 'num mono ' + trendClass(s.trend) }, pct(s.trend)),
          el('td', { class: 'num mono ' + trendClass(s.mom) }, pct(s.mom)),
          el('td', { class: 'num mono ' + trendClass(s.mom6) }, pct(s.mom6)),
          el('td', { class: 'num mono' }, isFinite(s.vol) ? fmtPct(s.vol * 100, 0, false) : '—'),
          el('td', {}, el('span', { class: 'dk-sig ' + (s.trend > 0 && s.mom > 0 ? 'on' : s.trend > 0 || s.mom > 0 ? 'mixed' : 'off') }, s.trend > 0 && s.mom > 0 ? '▲ haussier' : s.trend > 0 || s.mom > 0 ? '◆ mitigé' : '▼ baissier'))))))),
      el('div', { class: 'chart-box dk-chart' }, el('canvas', { id: 'dkSigChart' })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table' },
        el('thead', {}, el('tr', {}, ...['Règle', 'Par an', 'Volatilité', 'Pire baisse', 'Sharpe', 'Calmar', 'Investi', 'Ce mois-ci'].map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
        el('tbody', {}, ...ok.map(({ rule, bt }) => {
          const x = bt.metrics, now = S.now[rule].reduce((a, b) => a + b, 0);
          return el('tr', { class: best && rule === best.rule ? 'dk-best' : '' },
            el('td', {}, el('span', { class: 'dk-dot', style: `background:${DESK_RULES[rule].color}` }), DESK_RULES[rule].name, infoTip(DESK_RULES[rule].hint)),
            el('td', { class: 'num mono ' + trendClass(x.cagr) }, pct(x.cagr)),
            el('td', { class: 'num mono' }, fmtPct(x.vol * 100, 1, false)),
            el('td', { class: 'num mono down' }, pct(x.mdd, 0)),
            el('td', { class: 'num mono' }, fmtNum(x.sharpe, 2)),
            el('td', { class: 'num mono' }, fmtNum(x.calmar, 2)),
            el('td', { class: 'num mono' }, fmtNum(x.invested * 100, 0) + ' %'),
            el('td', { class: 'num mono' }, fmtNum(now * 100, 0) + ' % investi'));
        })))),
      el('p', { class: 'small muted' }, 'Ce mois-ci : part du portefeuille que chaque règle garderait investie aujourd\'hui (le reste en liquidités). ' +
        (S.now.voltarget ? 'Volatilité cible : ' + S.P.keys.map((k, j) => `${Store.label(k)} ${fmtNum(S.now.voltarget[j] * 100, 0)} %`).join(' · ') + '.' : '')),
      S.sources.length ? el('p', { class: 'small muted' }, 'Historique prolongé par l\'indice suivi : ' + S.sources.join(' · ')) : null,
      S.missing.length ? el('p', { class: 'small lab-warn' }, 'Sans historique, ignorées : ' + S.missing.join(', ')) : null,
      noteTip(`Rejeu mensuel ${span}, en ${this.base()} (taux de change de chaque jour), avec tes poids actuels. Décision à la clôture de chaque mois, appliquée le mois suivant ; liquidités rémunérées au taux sans risque (${fmtNum(S.cash * 100, 1)} %, Réglages) ; 0,1 % de frais sur chaque euro échangé. Indices de prix, hors dividendes et hors impôts (chaque vente en compte-titres serait imposée). Sharpe : rendement au-delà du taux sans risque par unité de volatilité. Calmar : rendement annuel ÷ pire baisse. Les règles de tendance réduisent surtout les grosses baisses ; elles coûtent un peu de rendement quand le marché zigzague.`, 'Méthode et limites')].filter(Boolean));
    if (typeof Chart !== 'undefined') {
      Charts.destroy('dkSigChart');
      const o = Charts.baseOptions();
      o.scales.y.type = 'logarithmic';
      o.scales.y.ticks.callback = v => fmtNum(v * 100, 0);
      o.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label} : ${fmtNum(c.raw * 100, 0)} (base 100)` };
      o.elements = { point: { radius: 0, hoverRadius: 3 } };
      const ref = ok[0].bt;
      Charts.instances.dkSigChart = new Chart($('#dkSigChart'), { type: 'line', options: o,
        data: { labels: ref.dates, datasets: ok.map(({ rule, bt }) => ({ label: DESK_RULES[rule].name, data: bt.equity, borderColor: DESK_RULES[rule].color, borderWidth: rule === 'hold' ? 2.5 : 1.8, fill: false, tension: 0.1 })) } });
    }
  },

  /* ---------- journal de trades ---------- */

  bindJournal() {
    const form = $('#dkJForm');
    const keys = () => Array.from(new Set([...Portfolio.snapshot('all').rows.map(r => r.key), ...Store.state.watchlist])).filter(k => Store.instrument(k));
    const fill = () => {
      const sel = $('#dkJKey'), was = sel.value;
      sel.replaceChildren(...keys().map(k => el('option', { value: k }, Store.label(k))));
      if (was && keys().includes(was)) sel.value = was;
      this.renderSizing();
    };
    this.on('view:shown', v => { if (v === 'desk') fill(); });
    ['#dkJKey', '#dkJStop', '#dkJTarget', '#dkJRisk'].forEach(s => $(s).addEventListener('input', () => this.renderSizing()));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const key = $('#dkJKey').value, q = Api.cachedQuote(key);
      const target = parseNum($('#dkJTarget').value), stop = parseNum($('#dkJStop').value);
      if (!key || (!isFinite(target) && !isFinite(stop))) { toast('Indique au moins un objectif ou un stop.', 'error'); return; }
      Store.state.theses = Store.state.theses || [];
      Store.state.theses.push({ id: uid(), key, thesis: $('#dkJText').value.trim().slice(0, 400), entry: q ? q.price : NaN, target: isFinite(target) ? target : '', stop: isFinite(stop) ? stop : '',
        review: $('#dkJReview').value || '', created: todayISO() });
      Store.save();
      form.reset(); $('#dkJRisk').value = 1; fill();
      this.renderJournal();
      toast('Trade ajouté au journal', 'success', 2000);
    });
  },

  /** Taille de position au risque fixé, d'après le cours actuel et le stop saisi */
  renderSizing() {
    const box = $('#dkJSize');
    if (!box) return;
    const key = $('#dkJKey').value, q = key && Api.cachedQuote(key), stop = parseNum($('#dkJStop').value), riskPct = parseNum($('#dkJRisk').value);
    const inst = Store.instrument(key) || {}, fx = Api.fxCached(inst.currency || this.base());
    if (!q || !isFinite(stop) || !(fx > 0)) { box.textContent = q ? `Cours actuel : ${fmtMoney(q.price, inst.currency, 2, true)}. Saisis un stop pour calculer la taille de position.` : ''; return; }
    const capital = Portfolio.snapshot('all').totals.value + (Portfolio.cashTotal('all').cash || 0);
    const z = Desk.positionSize({ capital, riskPct, price: q.price * fx, stop: stop * fx });
    const target = parseNum($('#dkJTarget').value);
    const rr = isFinite(target) ? Desk.thesisState({ target, stop }, q.price).rr : NaN;
    box.replaceChildren(z ? el('span', {}, `Pour ne risquer que ${fmtNum(riskPct, 1)} % de ton patrimoine boursier (${fmtMoney(z.budget, this.base(), 0)}) : `, el('b', {}, `${z.qty} part${z.qty > 1 ? 's' : ''} au maximum`),
      ` (${fmtMoney(z.amount, this.base(), 0)}, ${fmtNum(z.weight * 100, 1)} % du portefeuille).`, isFinite(rr) && rr <= 0 ? ' L\'objectif est déjà dépassé par le cours actuel.' : isFinite(rr) ? [' Rapport gain / risque : ', el('b', { class: rr >= 2 ? 'up' : rr < 1 ? 'down' : '' }, fmtNum(rr, 1) + ' pour 1'), rr < 2 ? ' (les pros visent 2 pour 1 ou plus).' : '.'] : null)
      : 'Le stop doit être différent du cours actuel.');
  },

  renderJournal() {
    const box = $('#dkJList');
    if (!box) return;
    const list = (Store.state.theses || []).filter(t => Store.instrument(t.key));
    if (!list.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Aucun trade suivi. Note ta thèse, ton objectif et ton stop avant d\'acheter : c\'est la discipline qui sépare un trader d\'un parieur.')); return; }
    const today = todayISO();
    box.replaceChildren(...list.map(t => {
      const inst = Store.instrument(t.key), q = Api.cachedQuote(t.key), ccy = inst.currency;
      const s = q ? Desk.thesisState(t, q.price) : null;
      const alertsExist = (Store.state.alerts || []).some(a => a.key === t.key && a.thesis === t.id);
      const remove = () => {
        const idx = Store.state.theses.indexOf(t);
        Store.state.theses.splice(idx, 1); Store.markDeleted(t.id); Store.save(); this.renderJournal();
        undoToast('Trade retiré du journal', () => { Store.state.theses.splice(idx, 0, t); Store.unmarkDeleted(t.id); Store.save(); this.renderJournal(); });
      };
      const addAlerts = () => {
        if (isFinite(parseNum(t.target))) Store.state.alerts.push({ id: uid(), key: t.key, kind: parseNum(t.target) >= parseNum(t.stop || -Infinity) ? 'above' : 'below', value: parseNum(t.target), active: true, createdAt: Date.now(), thesis: t.id });
        if (isFinite(parseNum(t.stop))) Store.state.alerts.push({ id: uid(), key: t.key, kind: parseNum(t.stop) <= parseNum(t.target || Infinity) ? 'below' : 'above', value: parseNum(t.stop), active: true, createdAt: Date.now(), thesis: t.id });
        Store.save(); this.renderJournal();
        toast('Alertes créées sur l\'objectif et le stop (onglet Investir)', 'success', 3000);
      };
      const late = t.review && t.review < today;
      return el('div', { class: 'dk-trade ' + (s ? s.status : '') },
        el('div', { class: 'dk-trade-head' },
          el('b', {}, Store.label(t.key)),
          s ? el('span', { class: 'dk-badge ' + s.status }, { open: 'en cours', target: '🎯 objectif atteint', stop: '⛔ stop touché' }[s.status]) : null,
          late ? el('span', { class: 'dk-badge late' }, 'à revoir depuis le ' + fmtDate(t.review)) : t.review ? el('span', { class: 'muted small' }, 'revoir le ' + fmtDate(t.review)) : null,
          el('span', { class: 'dk-trade-actions' },
            alertsExist ? el('span', { class: 'muted small' }, '🔔 alertes actives') : el('button', { type: 'button', class: 'btn small', onclick: addAlerts }, '🔔 Alertes'),
            el('button', { type: 'button', class: 'iconbtn', title: 'Retirer du journal', 'aria-label': 'Retirer du journal', onclick: remove }, '✕'))),
        t.thesis ? el('p', { class: 'small dk-thesis' }, '« ' + t.thesis + ' »') : null,
        el('div', { class: 'dk-trade-nums small mono' },
          el('span', {}, 'cours ', el('b', {}, q ? fmtMoney(q.price, ccy, 2, true) : '—')),
          isFinite(parseNum(t.entry)) ? el('span', {}, 'entrée ' + fmtMoney(parseNum(t.entry), ccy, 2, true)) : null,
          isFinite(parseNum(t.stop)) ? el('span', { class: 'down' }, 'stop ' + fmtMoney(parseNum(t.stop), ccy, 2, true)) : null,
          isFinite(parseNum(t.target)) ? el('span', { class: 'up' }, 'objectif ' + fmtMoney(parseNum(t.target), ccy, 2, true)) : null,
          s && s.status === 'open' && isFinite(s.rr) ? el('span', {}, 'gain/risque restant ', el('b', {}, fmtNum(s.rr, 1))) : null,
          s && isFinite(s.rMultiple) ? el('span', { class: trendClass(s.rMultiple) }, fmtNum(s.rMultiple, 1) + ' R') : null),
        s && isFinite(s.progress) ? el('div', { class: 'dk-range', title: 'Position du cours entre le stop et l\'objectif' }, el('span', { class: 'dk-range-dot', style: `left:${s.progress * 100}%` })) : null);
    }));
  },
});
