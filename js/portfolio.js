/* Calculs : positions (prix de revient moyen pondéré), plus-values, moteur d'historique */
'use strict';

const Portfolio = {
  /** Agrège les transactions en positions (méthode du PRU / coût moyen pondéré) */
  positions() {
    const byKey = {};
    const txs = Store.state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of txs) {
      const p = byKey[t.key] = byKey[t.key] || { key: t.key, qty: 0, cost: 0, realized: 0, fees: 0, firstDate: t.date, txCount: 0, totalBought: 0 };
      const qty = parseNum(t.qty), price = parseNum(t.price), fees = parseNum(t.fees) || 0;
      p.txCount++;
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
  snapshot() {
    const rows = this.positions();
    const totals = { value: 0, cost: 0, day: 0, realized: 0, missing: 0 };
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
