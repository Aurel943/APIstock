/*
 * Courbe « Évolution du portefeuille » (Portefeuille › Vue d'ensemble) : période (1 mois → tout), affichage en euros
 * (valeur et montant investi) ou en % (performance hors versements, face au MSCI World), et opérations placées
 * sur la courbe (achats ▲, ventes ▼, dividendes ●).
 */
'use strict';

const HIST_PERIODS = ['1M', '6M', 'YTD', '1A', '3A', 'MAX'];

const Evolution = {
  /** Date de début d'une période (ISO), au plus tôt la première date de l'historique */
  start(period, first, today = todayISO()) {
    const back = { '1M': -1, '6M': -6, '1A': -12, '3A': -36 }[period];
    let d = period === 'YTD' ? today.slice(0, 4) + '-01-01' : back ? addMonthsISO(today, back) : first;
    if (!d || d < first) d = first;
    return d;
  },

  /** Indice du point de départ : dernier point au plus tard à la date de début (la base de la période) */
  startIndex(points, startISO) {
    let i0 = 0;
    for (let i = 0; i < points.length; i++) { if (points[i].date <= startISO) i0 = i; else break; }
    return i0;
  },

  /**
   * Performance hors versements (%) depuis le premier point : chaînage des rendements quotidiens,
   * chaque versement retiré de la variation du jour (même calcul que Portfolio.twr).
   */
  perf(points) {
    const idx = Portfolio.twr(points);
    return idx.map(([, v]) => (v / 100 - 1) * 100);
  },

  /** Performance (%) d'un indice [[date, cours]] aux dates des points, depuis le premier point */
  benchPerf(points, raw) {
    if (!raw || !raw.length) return null;
    let j = -1, base = NaN;
    return points.map(p => {
      while (j + 1 < raw.length && raw[j + 1][0] <= p.date) j++;
      const px = j >= 0 ? raw[j][1] : NaN;
      if (!(px > 0)) return null;
      if (!(base > 0)) base = px;
      return (px / base - 1) * 100;
    });
  },

  /** Opérations de la période, rattachées au premier point à leur date ou après : [{ i, kind, text }] */
  markers(points, txs, labelOf = k => k, amountOf = t => parseNum(t.qty) * parseNum(t.price)) {
    if (!points.length) return [];
    const first = points[0].date, last = points[points.length - 1].date;
    const out = [];
    for (const t of txs) {
      if (!['buy', 'sell', 'div'].includes(t.type) || t.date < first || t.date > last) continue;
      let i = points.findIndex(p => p.date >= t.date);
      if (i < 0) i = points.length - 1;
      const verb = { buy: 'Achat', sell: 'Vente', div: 'Dividende' }[t.type];
      const amt = amountOf(t);
      out.push({ i, kind: t.type, date: t.date, text: ` ${verb} · ${labelOf(t.key)}` + (t.type !== 'div' ? ` · ${fmtQty(parseNum(t.qty))} part(s)` : '') + (isFinite(amt) ? ` · ${fmtMoney(amt, Store.state.settings.baseCurrency, 0)}` : '') });
    }
    return out;
  },

  /** Résumé de la période : gain, performance, versements nets */
  summary(points) {
    if (points.length < 2) return null;
    const a = points[0], b = points[points.length - 1];
    const flows = b.invested - a.invested;
    const perf = this.perf(points);
    return { gain: b.value - a.value - flows, flows, perf: perf[perf.length - 1], from: a.date };
  },
};

Object.assign(App, {
  histPeriod() {
    let p = null;
    try { p = localStorage.getItem('apistock:histPeriod'); } catch (e) { p = null; }
    return HIST_PERIODS.includes(p) ? p : 'MAX';
  },
  histMode() {
    let m = null;
    try { m = localStorage.getItem('apistock:histMode'); } catch (e) { m = null; }
    return m === 'pct' ? 'pct' : 'eur';
  },

  bindEvolution() {
    const set = (key, val) => { try { localStorage.setItem(key, val); } catch (e) { /* stockage indisponible */ } };
    $$('#histPeriod button').forEach(b => b.addEventListener('click', () => { set('apistock:histPeriod', b.dataset.p); this.drawHistory(); }));
    $$('#histMode button').forEach(b => b.addEventListener('click', () => { set('apistock:histMode', b.dataset.m); this.drawHistory(); }));
    this.syncEvolutionControls();
  },

  syncEvolutionControls() {
    const p = this.histPeriod(), m = this.histMode();
    $$('#histPeriod button').forEach(b => b.classList.toggle('active', b.dataset.p === p));
    $$('#histMode button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
  },

  /** Dessine la courbe d'évolution pour la période et l'affichage choisis */
  drawHistory() {
    this.syncEvolutionControls();
    const all = this.historyPoints;
    if (!all || !all.length) return;
    const period = this.histPeriod(), mode = this.histMode();
    const cur = this.base();
    const startISO = Evolution.start(period, all[0].date);
    const i0 = Evolution.startIndex(all, startISO);
    const pts = all.slice(i0);
    const dates = pts.map(p => p.date);
    const inst = k => Store.instrument(k);
    const amountOf = t => {
      const i = inst(t.key);
      const fx = i ? Api.fxAt(i.currency, t.date) : 1;
      return (parseNum(t.qty) * parseNum(t.price) + (t.type === 'buy' ? 1 : t.type === 'sell' ? -1 : 0) * (parseNum(t.fees) || 0)) * fx;
    };
    const markers = Evolution.markers(pts, Portfolio.txs(), k => Store.label(k), amountOf);
    const benchLabel = mode === 'pct' ? HIST_BENCH.name : 'Mêmes versements dans le ' + HIST_BENCH.name;
    let series;
    if (mode === 'pct') {
      series = { perf: Evolution.perf(pts), bench: this.historyBenchRaw ? Evolution.benchPerf(pts, this.historyBenchRaw) : null };
    } else {
      series = { value: pts.map(p => p.value), invested: pts.map(p => p.invested), bench: this.historyBench ? this.historyBench.slice(i0) : null };
    }
    Charts.history('historyChart', dates, mode, series, cur, { benchLabel, markers, fromZero: period === 'MAX', valueLabel: mode === 'pct' ? 'Ton portefeuille (hors versements)' : 'Valeur' });
    // résumé de la période
    const s = Evolution.summary(pts);
    const parts = [period === 'MAX' ? `Depuis le ${fmtDate(all[0].date)}` : `Depuis le ${fmtDate(pts[0].date)}`];
    if (s) {
      parts.push(`${fmtSignedMoney(s.gain, cur)} (${fmtPct(s.perf)} hors versements)`);
      if (Math.abs(s.flows) >= 1) parts.push(`versements nets ${fmtMoney(s.flows, cur, 0)}`);
    }
    if (mode === 'pct' && series.bench) {
      const b = series.bench[series.bench.length - 1];
      if (isFinite(b) && s) parts.push(`${HIST_BENCH.name} ${fmtPct(b)}`);
    } else if (this.historyBench) {
      const lastB = this.historyBench[this.historyBench.length - 1], lastP = all[all.length - 1];
      if (period === 'MAX' && isFinite(lastB) && lastB > 0) parts.push(`vs ${HIST_BENCH.name} : ${fmtSignedMoney(lastP.value - lastB, cur)}`);
    }
    $('#historyInfo').textContent = parts.join(' · ');
  },
});

document.addEventListener('DOMContentLoaded', () => { try { App.bindEvolution(); } catch (e) { App.reportError(e); } });
