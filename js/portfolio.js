/* Calculs : positions (prix de revient moyen pondéré), plus-values, moteur d'historique */
'use strict';

const Portfolio = {
  /**
   * Frais de courtage d'un ordre selon le barème du compte { pct, min, fixed } (minimum et fixe en devise de base).
   * `amount` : montant brut de l'ordre en devise de l'instrument ; `fx` : taux de cette devise vers la devise de base.
   * Renvoie null si le compte n'a pas de barème.
   */
  brokerFee(acc, amount, fx = 1) {
    const f = acc && acc.fees;
    if (!f || !(amount > 0) || !(fx > 0)) return null;
    const pct = parseNum(f.pct) || 0, min = parseNum(f.min) || 0, fixed = parseNum(f.fixed) || 0;
    if (!pct && !min && !fixed) return null;
    const fee = Math.max(amount * pct / 100, min / fx) + fixed / fx;
    return Math.round(fee * 100) / 100;
  },

  /**
   * Portefeuille « témoin » : chaque variation du montant investi (achat, vente au prix de revient) est placée
   * dans l'indice de référence le même jour. Renvoie la valeur du témoin à chaque point (null avant le premier cours).
   * `bench` : [[date, cours]] trié ; `fx(date)` : taux de la devise de l'indice vers la devise de base.
   */
  benchmark(points, bench, fx = () => 1) {
    if (!bench || !bench.length) return points.map(() => null);
    let j = -1, units = 0, prevInv = 0;
    return points.map(p => {
      while (j + 1 < bench.length && bench[j + 1][0] <= p.date) j++;
      const px = j >= 0 ? bench[j][1] * fx(p.date) : (bench[0][1] * fx(bench[0][0]));
      if (!(px > 0)) return null;
      units += (p.invested - prevInv) / px;
      prevInv = p.invested;
      return Math.max(0, units * px);
    });
  },

  /** Opérations du compte sélectionné (ou de tous les comptes) */
  txs(account) {
    const acc = account === undefined ? Store.state.accountFilter || 'all' : account;
    return Store.state.transactions.filter(t => acc === 'all' || (t.account || Store.defaultAccount()) === acc);
  },

  /** Agrège les transactions en positions (méthode du PRU / coût moyen pondéré) */
  positions(account) {
    const byKey = {};
    const txs = this.txs(account).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of txs) {
      const p = byKey[t.key] = byKey[t.key] || { key: t.key, qty: 0, cost: 0, realized: 0, fees: 0, dividends: 0, firstDate: t.date, txCount: 0, totalBought: 0 };
      const qty = parseNum(t.qty), price = parseNum(t.price), fees = parseNum(t.fees) || 0;
      p.txCount++;
      if (t.type === 'div') { p.dividends += qty * price - fees; continue; }
      // division (ou regroupement) : le nombre de parts change, le prix de revient total reste le même
      if (t.type === 'split') { if (qty > 0 && p.qty > 0) p.qty *= qty; continue; }
      p.fees += fees;
      if (t.type === 'sell') {
        if (p.qty <= 0) continue;
        const q = Math.min(qty, p.qty);
        const costOut = p.cost * (q / p.qty);
        p.realized += q * price - fees - costOut;
        p.qty -= q;
        p.cost -= costOut;
        if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
      } else {
        p.qty += qty;
        p.cost += qty * price + fees;
        p.totalBought += qty * price + fees;
      }
    }
    return Object.values(byKey).map(p => Object.assign(p, {
      inst: Store.instrument(p.key),
      pru: p.qty > 0 ? p.cost / p.qty : NaN,
    }));
  },

  /*
   * Cache des instantanés : en rafraîchissement rapide, snapshot() est demandé par de nombreuses cartes à chaque cotation.
   * Le résultat est gardé par compte jusqu'au prochain changement de données (Store.save / Store.load), de cotation ou de
   * taux de change (Api), qui appelle invalidate().
   */
  _snap: new Map(),
  rev: 0,
  stats: { hits: 0, misses: 0 },
  invalidate() { this.rev++; this._snap.clear(); },

  /** Positions enrichies avec cotations + conversion dans la devise de base (copie du résultat en cache) */
  snapshot(account) {
    const acc = account === undefined ? Store.state.accountFilter || 'all' : account;
    let c = this._snap.get(acc);
    if (c) this.stats.hits++;
    else { this.stats.misses++; c = this.computeSnapshot(acc); this._snap.set(acc, c); }
    return { rows: c.rows.slice(), closed: c.closed.slice(), totals: Object.assign({}, c.totals) };
  },

  computeSnapshot(account) {
    const rows = this.positions(account);
    const totals = { value: 0, cost: 0, day: 0, realized: 0, dividends: 0, missing: 0 };
    for (const r of rows) {
      const q = Api.cachedQuote(r.key);
      const cur = (r.inst && r.inst.currency) || Store.state.settings.baseCurrency;
      const fx = Api.fxCached(cur);
      r.currency = cur;
      r.fx = fx;
      r.quote = q;
      r.price = q ? q.price : NaN;
      r.value = r.qty * r.price;
      r.pnl = r.value - r.cost;
      r.pnlPct = r.cost > 0 ? (r.pnl / r.cost) * 100 : NaN;
      r.dayChange = q ? r.qty * q.change : NaN;
      r.valueBase = r.value * fx;
      r.costBase = r.cost * fx;
      r.pnlBase = r.pnl * fx;
      r.dayBase = r.dayChange * fx;
      r.realizedBase = r.realized * fx;
      r.dividendsBase = r.dividends * fx;
      if (isFinite(r.dividendsBase)) totals.dividends += r.dividendsBase;
      if (r.qty > 0) {
        if (isFinite(r.valueBase)) { totals.value += r.valueBase; totals.cost += r.costBase; }
        else { totals.missing++; if (isFinite(r.costBase)) { totals.cost += r.costBase; totals.value += r.costBase; } }
        if (isFinite(r.dayBase)) totals.day += r.dayBase;
      }
      if (isFinite(r.realizedBase)) totals.realized += r.realizedBase;
    }
    const open = rows.filter(r => r.qty > 0);
    for (const r of open) {
      r.weightCost = totals.cost > 0 ? (r.costBase / totals.cost) * 100 : NaN;
      r.weightValue = totals.value > 0 && isFinite(r.valueBase) ? (r.valueBase / totals.value) * 100 : NaN;
    }
    totals.pnl = totals.value - totals.cost;
    totals.pnlPct = totals.cost > 0 ? (totals.pnl / totals.cost) * 100 : NaN;
    totals.totalGain = totals.pnl + totals.realized + totals.dividends;
    const prevValue = totals.value - totals.day;
    totals.dayPct = prevValue > 0 ? (totals.day / prevValue) * 100 : NaN;
    return { rows: open, closed: rows.filter(r => r.qty <= 0), totals };
  },

  /**
   * Rejoue une suite d'opérations sur des historiques de cours journaliers.
   * events: [{ date, key, type: 'buy'|'sell', qty?, amount?, price?, fees? }]
   *  - avec `amount` : achat d'un montant (devise de base) au cours de clôture du jour
   *  - avec `qty` + `price` : opération réelle
   * fxByKey[key] : taux fixe, ou fonction date → taux (taux de change du jour concerné).
   * Renvoie la courbe { date, invested, value } (devise de base) et les lignes finales.
   */
  replay(seriesByKey, fxByKey, events, opts = {}) {
    const fractional = opts.fractional !== false;
    const fxOn = (k, d) => { const f = fxByKey[k]; const r = typeof f === 'function' ? f(d) : f; return isFinite(r) && r > 0 ? r : 1; };
    const evs = events.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!evs.length) return { points: [], lines: {} };
    const first = evs[0].date;

    const dateSet = new Set();
    const maps = {};
    for (const [key, values] of Object.entries(seriesByKey)) {
      maps[key] = values;
      for (const [d] of values) if (d >= first) dateSet.add(d);
    }
    const dates = Array.from(dateSet).sort();
    const idx = {};
    const last = {};
    for (const k of Object.keys(maps)) { idx[k] = 0; last[k] = NaN; }

    const lines = {};
    const line = k => (lines[k] = lines[k] || { key: k, qty: 0, cost: 0, invested: 0, cash: 0, buys: 0 });
    let e = 0;
    const points = [];

    for (const d of dates) {
      for (const k of Object.keys(maps)) {
        const arr = maps[k];
        while (idx[k] < arr.length && arr[idx[k]][0] <= d) { last[k] = arr[idx[k]][1]; idx[k]++; }
      }
      while (e < evs.length && evs[e].date <= d) {
        const ev = evs[e++];
        if (ev.type === 'div' || ev.type === 'split') continue;
        const L = line(ev.key);
        const fx = fxOn(ev.key, d);
        const px = last[ev.key];
        if (ev.amount !== undefined) {
          if (!isFinite(px)) { L.cash += ev.amount; L.invested += ev.amount; continue; }
          const budget = ev.amount + L.cash;               // devise de base
          const unit = px * fx;
          const q = fractional ? budget / unit : Math.floor(budget / unit);
          L.qty += q;
          L.cost += q * unit;
          L.cash = budget - q * unit;
          L.invested += ev.amount;
          L.buys++;
        } else if (ev.type === 'sell') {
          if (L.qty <= 0) continue;
          const q = Math.min(ev.qty, L.qty);
          const out = L.cost * (q / L.qty);
          L.qty -= q; L.cost -= out; L.invested -= out;
        } else {
          const c = (ev.qty * ev.price + (ev.fees || 0)) * fx;
          L.qty += ev.qty; L.cost += c; L.invested += c; L.buys++;
        }
      }
      let invested = 0, value = 0;
      for (const L of Object.values(lines)) {
        const fx = fxOn(L.key, d);
        invested += L.invested;
        const px = last[L.key];
        value += (isFinite(px) ? L.qty * px * fx : L.cost) + L.cash;
      }
      points.push({ date: d, invested, value });
    }
    const lastDate = dates[dates.length - 1];
    for (const L of Object.values(lines)) {
      const fx = fxOn(L.key, lastDate);
      L.lastPrice = last[L.key];
      L.value = L.qty * L.lastPrice * fx + L.cash;
      L.pnl = L.value - L.invested;
      L.pnlPct = L.invested > 0 ? (L.pnl / L.invested) * 100 : NaN;
      L.pru = L.qty > 0 ? L.cost / L.qty : NaN;
    }
    return { points, lines };
  },

  /**
   * Opérations prêtes pour replay(), exprimées en parts « après division ».
   * Les historiques de cours (Yahoo, Twelve Data) sont ajustés des divisions : une opération passée
   * avant une division est donc convertie (quantité × parité, prix ÷ parité) pour rester cohérente.
   */
  historyEvents(txs) {
    const splits = txs.filter(t => t.type === 'split' && parseNum(t.qty) > 0);
    return txs.filter(t => t.type !== 'split').map(t => {
      let f = 1;
      for (const s of splits) if (s.key === t.key && s.date > t.date) f *= parseNum(s.qty);
      return { date: t.date, key: t.key, type: t.type, qty: parseNum(t.qty) * (t.type === 'div' ? 1 : f), price: parseNum(t.price) / (t.type === 'div' ? 1 : f), fees: parseNum(t.fees) || 0 };
    });
  },

  /* ------------------------------------------------------------------ */
  /* Liquidités                                                           */
  /* ------------------------------------------------------------------ */
  /** Un compte suit ses espèces dès qu'il a au moins un versement ou un retrait enregistré */
  cashTracked(accountId) { return (Store.state.cashMoves || []).some(m => (m.account || Store.defaultAccount()) === accountId); },

  /**
   * Solde d'espèces d'un compte (devise de base) : versements − retraits − achats + ventes + dividendes nets.
   * Les opérations en devises sont converties au taux de change du jour de chaque opération.
   */
  cashBalance(accountId, upTo) {
    let cash = 0, deposits = 0, withdrawals = 0;
    for (const m of Store.state.cashMoves || []) {
      if ((m.account || Store.defaultAccount()) !== accountId || (upTo && m.date > upTo)) continue;
      const a = parseNum(m.amount) || 0;
      if (m.type === 'withdraw') { cash -= a; withdrawals += a; } else { cash += a; deposits += a; }
    }
    for (const t of Store.state.transactions) {
      if ((t.account || Store.defaultAccount()) !== accountId || t.type === 'split' || (upTo && t.date > upTo)) continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt((inst && inst.currency) || Store.state.settings.baseCurrency, t.date);
      const gross = parseNum(t.qty) * parseNum(t.price), fees = parseNum(t.fees) || 0;
      if (!isFinite(fx) || !isFinite(gross)) continue;
      cash += (t.type === 'buy' ? -(gross + fees) : gross - fees) * fx;
    }
    return { cash, deposits, withdrawals };
  },

  /** Espèces des comptes suivis (selon le filtre de compte) */
  cashTotal(account) {
    const acc = account === undefined ? Store.state.accountFilter || 'all' : account;
    const ids = Store.state.accounts.map(a => a.id).filter(id => (acc === 'all' || id === acc) && this.cashTracked(id));
    return { tracked: ids.length > 0, cash: ids.reduce((s, id) => s + this.cashBalance(id).cash, 0), accounts: ids };
  },

  /* ------------------------------------------------------------------ */
  /* Versements programmés                                                */
  /* ------------------------------------------------------------------ */
  /** Date d'échéance d'un plan pour un mois donné ('AAAA-MM') : jour fixe, ramené au dernier jour du mois si besoin */
  planDate(plan, month) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return month + '-' + String(Math.min(Math.max(1, parseInt(plan.day, 10) || 1), last)).padStart(2, '0');
  },

  /** Échéances passées (ou du jour) pas encore enregistrées ni ignorées */
  planDue(plan, today = todayISO()) {
    if (plan.active === false || !plan.start) return [];
    const out = [];
    let month = plan.start.slice(0, 7);
    for (let guard = 0; guard < 600 && month <= today.slice(0, 7); guard++) {
      const date = this.planDate(plan, month);
      if (date >= plan.start && date <= today && !(plan.done && plan.done[month])) out.push({ plan, month, date });
      month = addMonthsISO(month + '-01', 1).slice(0, 7);
    }
    return out;
  },

  /** Prochaine échéance à venir d'un plan */
  planNext(plan, today = todayISO()) {
    if (plan.active === false || !plan.start) return null;
    let month = (plan.start > today ? plan.start : today).slice(0, 7);
    for (let i = 0; i < 24; i++) {
      const date = this.planDate(plan, month);
      if (date >= plan.start && date > today && !(plan.done && plan.done[month])) return date;
      month = addMonthsISO(month + '-01', 1).slice(0, 7);
    }
    return null;
  },

  /** Nombre de parts achetées pour un montant (devise de base) à un cours donné (devise de l'instrument) */
  planShares(amount, price, fx, fractional) {
    const unit = price * (fx || 1);
    if (!(unit > 0) || !(amount > 0)) return 0;
    const raw = amount / unit;
    return fractional ? Math.floor(raw * 10000) / 10000 : Math.floor(raw + 1e-9);
  },

  /* ------------------------------------------------------------------ */
  /* Risque                                                               */
  /* ------------------------------------------------------------------ */
  /** Statistiques de risque d'une série [[date, indice]] (volatilité, pire baisse, Sharpe…) */
  riskStats(series, riskFree = 0) {
    if (!series || series.length < 3) return null;
    const first = series[0], last = series[series.length - 1];
    const years = (Date.parse(last[0]) - Date.parse(first[0])) / (365.25 * 864e5);
    const rets = [];
    let peak = -Infinity, peakDate = first[0], mdd = 0, mddPeak = first[0], mddTrough = first[0];
    for (let i = 0; i < series.length; i++) {
      const v = series[i][1];
      if (v > peak) { peak = v; peakDate = series[i][0]; }
      const dd = v / peak - 1;
      if (dd < mdd) { mdd = dd; mddPeak = peakDate; mddTrough = series[i][0]; }
      if (i > 0 && series[i - 1][1] > 0) rets.push(v / series[i - 1][1] - 1);
    }
    const n = rets.length;
    const mean = rets.reduce((a, b) => a + b, 0) / (n || 1);
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    const ppy = years > 0.08 ? n / years : 252;
    const vol = sd * Math.sqrt(ppy);
    const perf = last[1] / first[1] - 1;
    const cagr = years >= 0.5 ? Math.pow(1 + perf, 1 / years) - 1 : NaN;
    const downs = rets.filter(r => r < 0);
    const dsd = Math.sqrt(downs.reduce((a, b) => a + b * b, 0) / Math.max(1, n - 1)) * Math.sqrt(ppy);
    const rf = riskFree / 100;
    return {
      years, perf, cagr, vol, mdd, mddPeak, mddTrough,
      sharpe: isFinite(cagr) && vol > 0 ? (cagr - rf) / vol : NaN,
      sortino: isFinite(cagr) && dsd > 0 ? (cagr - rf) / dsd : NaN,
      positiveDays: n ? rets.filter(r => r > 0).length / n : NaN,
    };
  },

  /** Corrélation et bêta des rendements quotidiens de a par rapport à b (dates communes) */
  beta(a, b) {
    const mb = new Map(b);
    const common = a.filter(v => mb.has(v[0]));
    const ra = [], rb = [];
    for (let i = 1; i < common.length; i++) {
      ra.push(common[i][1] / common[i - 1][1] - 1);
      rb.push(mb.get(common[i][0]) / mb.get(common[i - 1][0]) - 1);
    }
    const n = ra.length;
    if (n < 10) return { corr: NaN, beta: NaN, n };
    const ma = ra.reduce((x, y) => x + y, 0) / n, mbb = rb.reduce((x, y) => x + y, 0) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { cov += (ra[i] - ma) * (rb[i] - mbb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mbb) ** 2; }
    return { corr: cov / Math.sqrt(va * vb), beta: cov / vb, n };
  },

  /* ------------------------------------------------------------------ */
  /* Rééquilibrage sans vente                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Montant minimal à investir (sans rien vendre) pour qu'aucune ligne ne dépasse sa cible.
   * lines: [{ value, target (%) }]. Les lignes sans cible (0 %) ne peuvent pas être corrigées sans vente : ignorées.
   */
  rebalanceAmount(lines) {
    const V = lines.reduce((a, l) => a + (l.value || 0), 0);
    let need = 0;
    for (const l of lines) if (l.target > 0 && l.value > 0) need = Math.max(need, (l.value * 100) / l.target - V);
    return Math.max(0, need);
  },

  /** Plus grand écart (en points) entre poids actuel et poids cible */
  drift(lines) {
    const V = lines.reduce((a, l) => a + (l.value || 0), 0);
    if (!(V > 0)) return { max: 0, lines: [] };
    const out = lines.map(l => ({ key: l.key, weight: (l.value / V) * 100, target: l.target || 0, gap: (l.value / V) * 100 - (l.target || 0) }));
    return { max: out.reduce((m, l) => Math.max(m, Math.abs(l.gap)), 0), lines: out };
  },

  /* ------------------------------------------------------------------ */
  /* Monte-Carlo                                                          */
  /* ------------------------------------------------------------------ */
  /**
   * Projection aléatoire : rendements mensuels log-normaux (rendement médian `rate` − `fees`, volatilité annuelle `vol`).
   * Renvoie, pour chaque année, les percentiles 10 / 50 / 90 de la valeur et la probabilité d'atteindre `target`.
   * Générateur pseudo-aléatoire à graine fixe : mêmes hypothèses → mêmes résultats.
   */
  /** Tirages gaussiens reproductibles (générateur mulberry32 à graine fixe + Box-Muller) */
  gaussian(seed = 42) {
    let st = seed >>> 0;
    const rand = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  },

  monteCarlo({ initial, monthly, rate, fees, vol, years, target, paths = 2000, seed = 42 }) {
    const gauss = this.gaussian(seed);
    const months = Math.round(years * 12);
    const mu = Math.log(1 + (rate - (fees || 0)) / 100) / 12;
    const sigma = (vol || 0) / 100 / Math.sqrt(12);
    const byYear = Array.from({ length: Math.floor(months / 12) + 1 }, () => new Float64Array(paths));
    let reached = 0, losses = 0;
    const invested = initial + monthly * months;
    for (let p = 0; p < paths; p++) {
      let v = initial;
      byYear[0][p] = v;
      for (let m = 1; m <= months; m++) {
        v = v * Math.exp(mu + sigma * gauss()) + monthly;
        if (m % 12 === 0) byYear[m / 12][p] = v;
      }
      if (target > 0 && v >= target) reached++;
      if (v < invested) losses++;
    }
    const q = (arr, x) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(x * (arr.length - 1))))];
    const out = byYear.map((arr, y) => { const s = Array.from(arr).sort((a, b) => a - b); return { year: y, p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9), invested: initial + monthly * y * 12 }; });
    return { years: out, probTarget: target > 0 ? reached / paths : NaN, probLoss: losses / paths, invested };
  },

  /**
   * Phase de retraite : retraits mensuels (indexés chaque année sur l'inflation) sur un capital placé.
   * Mêmes hypothèses de marché que monteCarlo (rendements mensuels log-normaux, graine fixe).
   * Renvoie, par année, les percentiles 10 / 50 / 90 du capital restant, la probabilité que le capital tienne
   * toute la durée, et le mois d'épuisement dans les scénarios défavorable (10 %), médian et favorable (90 %)
   * (Infinity = pas épuisé avant la fin). withdrawn[y] = total retiré à la fin de l'année y (scénario sans épuisement).
   */
  retirement({ initial, withdraw, inflation = 0, rate, fees = 0, vol, years, paths = 2000, seed = 42 }) {
    const gauss = this.gaussian(seed);
    const months = Math.max(1, Math.round(years * 12));
    const mu = Math.log(1 + (rate - (fees || 0)) / 100) / 12;
    const sigma = (vol || 0) / 100 / Math.sqrt(12);
    const infl = 1 + (inflation || 0) / 100;
    const wYear = Array.from({ length: Math.ceil(months / 12) + 1 }, (_, y) => withdraw * Math.pow(infl, y));
    const byYear = Array.from({ length: Math.floor(months / 12) + 1 }, () => new Float64Array(paths));
    const depleted = new Float64Array(paths);
    let survived = 0;
    for (let p = 0; p < paths; p++) {
      let v = initial, out = Infinity;
      byYear[0][p] = v;
      for (let m = 1; m <= months; m++) {
        if (out === Infinity) {
          v = v * Math.exp(mu + sigma * gauss()) - wYear[Math.floor((m - 1) / 12)];
          if (v < -1e-9) { v = 0; out = m; } else if (v < 0) v = 0;
        }
        if (m % 12 === 0) byYear[m / 12][p] = v;
      }
      depleted[p] = out;
      if (out === Infinity) survived++;
    }
    const q = (arr, x) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(x * (arr.length - 1))))];
    const dep = Array.from(depleted).sort((a, b) => a - b);
    let paid = 0;
    const withdrawn = [0];
    for (let y = 1; y < byYear.length; y++) { paid += 12 * withdraw * Math.pow(infl, y - 1); withdrawn.push(paid); }
    return {
      years: byYear.map((arr, y) => { const s = Array.from(arr).sort((a, b) => a - b); return { year: y, p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) }; }),
      probSuccess: survived / paths, months,
      depletion: { p10: q(dep, 0.1), p50: q(dep, 0.5), p90: q(dep, 0.9) },
      withdrawn,
    };
  },

  /** Retrait mensuel maximal (première année, puis indexé) pour que le capital tienne `years` ans avec une probabilité `prob` */
  maxWithdrawal(params, prob = 0.9) {
    const ok = w => this.retirement(Object.assign({}, params, { withdraw: w, paths: params.paths || 600 })).probSuccess >= prob;
    if (!(params.initial > 0)) return 0;
    let lo = 0, hi = params.initial / Math.max(1, params.years * 12) * 3;
    while (ok(hi) && hi < params.initial) { lo = hi; hi *= 2; }
    // précision : 0,5 % du retrait ou 1 € (largement suffisant pour une hypothèse de marché)
    for (let i = 0; i < 25 && hi - lo > Math.max(1, hi * 0.005); i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  },

  /**
   * Taux de rendement interne annualisé (XIRR) d'une série de flux.
   * flows: [{ date: 'YYYY-MM-DD' | ms, amount }] — apports négatifs, valeur finale positive.
   */
  xirr(flows) {
    const f = flows.map(x => ({ t: typeof x.date === 'number' ? x.date : Date.parse(x.date + 'T12:00:00Z'), a: x.amount }))
      .filter(x => isFinite(x.t) && isFinite(x.a) && x.a !== 0);
    if (f.length < 2 || !f.some(x => x.a > 0) || !f.some(x => x.a < 0)) return NaN;
    const t0 = Math.min(...f.map(x => x.t));
    const span = (Math.max(...f.map(x => x.t)) - t0) / (365.25 * 864e5);
    if (span < 1 / 52) return NaN; // moins d'une semaine : non significatif
    const npv = r => f.reduce((s, x) => s + x.a / Math.pow(1 + r, (x.t - t0) / (365.25 * 864e5)), 0);
    let lo = -0.9999, hi = 10, vlo = npv(lo), vhi = npv(hi);
    if (vlo * vhi > 0) return NaN;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, v = npv(mid);
      if (Math.abs(v) < 1e-7) return mid * 100;
      if (v * vlo > 0) { lo = mid; vlo = v; } else { hi = mid; }
    }
    return ((lo + hi) / 2) * 100;
  },

  /** Rendement annualisé du portefeuille réel (chaque flux converti au taux de change de sa date, valeur finale au taux du jour) */
  portfolioXirr(totalValue) {
    const flows = [];
    for (const t of this.txs()) {
      if (t.type === 'split') continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt(inst ? inst.currency : Store.state.settings.baseCurrency, t.date);
      if (!isFinite(fx)) return NaN;
      const gross = parseNum(t.qty) * parseNum(t.price), fees = parseNum(t.fees) || 0;
      flows.push({ date: t.date, amount: (t.type === 'sell' || t.type === 'div' ? gross - fees : -(gross + fees)) * fx });
    }
    if (!(totalValue > 0)) return NaN;
    flows.push({ date: Date.now(), amount: totalValue });
    return this.xirr(flows);
  },

  /** Plus-value latente nette d'impôt estimée, compte par compte (chaque compte a son taux) */
  netPnl() {
    const filter = Store.state.accountFilter || 'all';
    const accounts = Store.state.accounts.filter(a => filter === 'all' || a.id === filter);
    let net = 0, taxed = false;
    for (const a of accounts) {
      const { totals } = this.snapshot(a.id);
      const rate = parseNum(a.taxRate) || 0;
      if (rate > 0) taxed = true;
      net += totals.pnl > 0 ? totals.pnl * (1 - rate / 100) : totals.pnl;
    }
    return { net, taxed };
  },

  /** Indice de performance pondérée dans le temps (TWR, base 100) à partir des points de replay() */
  twr(points) {
    const out = [];
    let idx = 100;
    for (let i = 0; i < points.length; i++) {
      if (i > 0 && points[i - 1].value > 0) {
        const flow = points[i].invested - points[i - 1].invested;
        idx *= (points[i].value - flow) / points[i - 1].value;
      }
      out.push([points[i].date, idx]);
    }
    return out;
  },

  /** Rendements mensuels et annuels (en %) d'une série [[date, indice]] */
  monthlyReturns(series) {
    const lastOfMonth = new Map();
    for (const [d, v] of series) lastOfMonth.set(d.slice(0, 7), v);
    const months = Array.from(lastOfMonth.keys()).sort();
    const res = {};
    let prev = series.length ? series[0][1] : NaN;
    for (const m of months) {
      const v = lastOfMonth.get(m);
      const [y, mm] = m.split('-');
      (res[y] = res[y] || { months: {}, start: prev }).months[+mm] = (v / prev - 1) * 100;
      res[y].end = v;
      prev = v;
    }
    for (const y of Object.keys(res)) res[y].year = (res[y].end / res[y].start - 1) * 100;
    return res;
  },

  /**
   * Plan d'investissement : répartit `amount` (devise de base) entre les lignes pour se rapprocher des cibles.
   * lines: [{ key, value (base), target (%), unitPrice (base) }]
   */
  plan(lines, amount, { allowSell = false, fractional = false } = {}) {
    const totalNow = lines.reduce((a, l) => a + (l.value || 0), 0);
    const totalAfter = totalNow + amount;
    const out = lines.map(l => Object.assign({}, l, { desired: totalAfter * (l.target || 0) / 100 }));
    if (allowSell) {
      for (const o of out) o.trade = o.desired - (o.value || 0);
    } else {
      for (const o of out) o.need = Math.max(0, o.desired - (o.value || 0));
      const needSum = out.reduce((a, o) => a + o.need, 0);
      for (const o of out) {
        o.trade = needSum > amount ? (needSum ? amount * o.need / needSum : 0) : o.need + (amount - needSum) * (o.target || 0) / 100;
      }
    }
    let cash = amount;
    const greedy = !fractional && !allowSell;
    for (const o of out) {
      o.shares = 0; o.cost = 0;
      if (!(o.unitPrice > 0) || greedy) continue;
      // fractionné : montant exact ; ventes autorisées : arrondi vers zéro puis reliquat
      const raw = o.trade / o.unitPrice;
      o.shares = fractional ? Math.round(raw * 10000) / 10000 : Math.trunc(raw + (raw < 0 ? -1e-9 : 1e-9));
      o.cost = o.shares * o.unitPrice;
      cash -= o.cost;
    }
    if (!fractional) {
      // parts entières : achat part par part, toujours sur la ligne la plus en retard sur sa cible
      for (let guard = 0; guard < 200000; guard++) {
        const cand = out.filter(o => o.target > 0 && o.unitPrice > 0 && o.unitPrice <= cash + 1e-9);
        if (!cand.length) break;
        cand.sort((a, b) => ((a.value || 0) + a.cost) / a.desired - ((b.value || 0) + b.cost) / b.desired);
        const o = cand[0];
        o.shares += 1; o.cost += o.unitPrice; cash -= o.unitPrice;
      }
    }
    const finalTotal = out.reduce((a, o) => a + (o.value || 0) + o.cost, 0);
    for (const o of out) {
      o.weightNow = totalNow > 0 ? ((o.value || 0) / totalNow) * 100 : 0;
      o.weightAfter = finalTotal > 0 ? (((o.value || 0) + o.cost) / finalTotal) * 100 : 0;
    }
    return { lines: out, cash, invested: amount - cash };
  },

  /** Projection à intérêts composés mensuels */
  project({ initial, monthly, rate, years, fees }) {
    const r = Math.pow(1 + (rate - (fees || 0)) / 100, 1 / 12) - 1;
    const pts = [{ month: 0, invested: initial, value: initial }];
    let value = initial, invested = initial;
    for (let m = 1; m <= Math.round(years * 12); m++) {
      value = value * (1 + r) + monthly;
      invested += monthly;
      pts.push({ month: m, invested, value });
    }
    return pts;
  },
};
