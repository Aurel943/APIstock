/* Calculs : positions (prix de revient moyen pondéré), plus-values, moteur d'historique */
'use strict';

const Portfolio = {
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

  /** Positions enrichies avec cotations + conversion dans la devise de base */
  snapshot(account) {
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
   * Renvoie la courbe { date, invested, value } (devise de base) et les lignes finales.
   */
  replay(seriesByKey, fxByKey, events, opts = {}) {
    const fractional = opts.fractional !== false;
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
        if (ev.type === 'div') continue;
        const L = line(ev.key);
        const fx = fxByKey[ev.key] || 1;
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
        const fx = fxByKey[L.key] || 1;
        invested += L.invested;
        const px = last[L.key];
        value += (isFinite(px) ? L.qty * px * fx : L.cost) + L.cash;
      }
      points.push({ date: d, invested, value });
    }
    for (const L of Object.values(lines)) {
      const fx = fxByKey[L.key] || 1;
      L.lastPrice = last[L.key];
      L.value = L.qty * L.lastPrice * fx + L.cash;
      L.pnl = L.value - L.invested;
      L.pnlPct = L.invested > 0 ? (L.pnl / L.invested) * 100 : NaN;
      L.pru = L.qty > 0 ? L.cost / L.qty : NaN;
    }
    return { points, lines };
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

  /** Rendement annualisé du portefeuille réel (flux convertis au taux de change actuel) */
  portfolioXirr(totalValue) {
    const flows = [];
    for (const t of this.txs()) {
      const inst = Store.instrument(t.key);
      const fx = Api.fxCached(inst ? inst.currency : Store.state.settings.baseCurrency);
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
