/*
 * Graphiques du terminal : chandeliers japonais, barres OHLC, Heikin-Ashi, ligne, aire, et comparaison en %.
 * Dessin direct sur <canvas> (aucune bibliothèque) : axe des prix à droite, étiquette du dernier cours, volume,
 * moyennes mobiles 20 / 50 / 200, bandes de Bollinger, RSI 14, MACD (12, 26, 9), échelle logarithmique,
 * réticule avec lecture O / H / B / C / volume, zoom à la molette ou au pincement, déplacement à la souris ou au doigt,
 * double-clic pour revenir à la vue d'origine.
 *
 * Calculs purs (objet TA) testés dans tests/termchart.test.mjs.
 */
'use strict';

const TA = {
  /** Moyenne mobile simple (null tant que l'historique est insuffisant) */
  sma(v, n) {
    const out = new Array(v.length).fill(null);
    let s = 0;
    for (let i = 0; i < v.length; i++) {
      s += v[i];
      if (i >= n) s -= v[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  },

  /** Moyenne mobile exponentielle, amorcée par la moyenne simple des n premiers points (valeurs null ignorées au début) */
  ema(v, n) {
    const out = new Array(v.length).fill(null);
    const k = 2 / (n + 1);
    let start = v.findIndex(x => x !== null && x !== undefined);
    if (start < 0 || v.length - start < n) return out;
    let e = 0;
    for (let j = start; j < start + n; j++) e += v[j];
    e /= n;
    out[start + n - 1] = e;
    for (let i = start + n; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
    return out;
  },

  /** Bandes de Bollinger : moyenne n et ± k écarts-types (population) */
  bollinger(v, n = 20, k = 2) {
    const mid = this.sma(v, n), up = [], lo = [];
    for (let i = 0; i < v.length; i++) {
      if (mid[i] === null) { up.push(null); lo.push(null); continue; }
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n);
      up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd);
    }
    return { mid, up, lo };
  },

  /** RSI de Wilder, série complète (null avant n + 1 points) */
  rsi(v, n = 14) {
    const out = new Array(v.length).fill(null);
    if (v.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    out[n] = val();
    for (let i = n + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (n - 1) + Math.max(0, d)) / n;
      l = (l * (n - 1) + Math.max(0, -d)) / n;
      out[i] = val();
    }
    return out;
  },

  /** MACD : écart des moyennes exponentielles rapide et lente, ligne de signal et histogramme */
  macd(v, fast = 12, slow = 26, sig = 9) {
    const ef = this.ema(v, fast), es = this.ema(v, slow);
    const macd = v.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
    const signal = this.ema(macd, sig);
    const hist = macd.map((m, i) => (m !== null && signal[i] !== null ? m - signal[i] : null));
    return { macd, signal, hist };
  },

  /** Regroupe des bougies journalières par semaine (« S », du lundi) ou par mois (« M ») */
  resample(bars, unit) {
    if (unit !== 'S' && unit !== 'M') return bars;
    const keyOf = b => {
      if (unit === 'M') return b.d.slice(0, 7);
      const d = new Date(b.d + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    const out = [];
    let cur = null, ck = null;
    for (const b of bars) {
      const k = keyOf(b);
      if (k !== ck) { if (cur) out.push(cur); cur = Object.assign({}, b); ck = k; continue; }
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v = (cur.v || 0) + (b.v || 0); cur.dEnd = b.d;
    }
    if (cur) out.push(cur);
    return out;
  },

  /** Bougies Heikin-Ashi (lissées : tendance plus lisible) */
  heikin(bars) {
    const out = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const c = (b.o + b.h + b.l + b.c) / 4;
      const o = i ? (out[i - 1].o + out[i - 1].c) / 2 : (b.o + b.c) / 2;
      out.push(Object.assign({}, b, { o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c) }));
    }
    return out;
  },

  /** Pas « rond » (1, 2, 2,5, 5 × 10^k) pour environ `ticks` graduations sur `range` */
  niceStep(range, ticks = 5) {
    if (!(range > 0)) return 1;
    const raw = range / Math.max(1, ticks), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  },
};

/** « 2026-10-05 » → « 05/10/2026 » (les heures intraday restent telles quelles) */
function tcDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : d || ''; }

const TC_COL = { up: '#2fe37f', down: '#ff4d4d', amber: '#ff9f1c', grid: 'rgba(255,159,28,.10)', axis: '#ff9f1c', text: '#e8e8e8', dim: '#8a7a60',
  ma20: '#4fc3f7', ma50: '#ffd23f', ma200: '#e040fb', bb: '#8fa8ff', rsi: '#ffb74d', macd: '#4fc3f7', signal: '#ff9f1c', cross: 'rgba(255,255,255,.45)' };
const TC_SERIES = ['#ff9f1c', '#4fc3f7', '#2fe37f', '#e040fb', '#ffd23f', '#ff4d4d', '#8fa8ff', '#ffffff'];

class TermChart {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;
    this.view = null;
    this.mouse = null;
    this._raf = 0;
    const H = (t, f, o) => { canvas.addEventListener(t, f, o); };
    H('mousemove', e => { this.mouse = this.pos(e); if (this.drag) this.pan(e.clientX); this.redraw(); });
    H('mouseleave', () => { this.mouse = null; this.drag = null; this.redraw(); });
    H('mousedown', e => { this.drag = { x: e.clientX, view: Object.assign({}, this.view) }; });
    H('mouseup', () => { this.drag = null; });
    H('dblclick', () => { this.reset(); });
    H('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, this.pos(e).x); }, { passive: false });
    H('touchstart', e => {
      if (e.touches.length === 1) this.drag = { x: e.touches[0].clientX, view: Object.assign({}, this.view) };
      if (e.touches.length === 2) this.pinch = { d: Math.abs(e.touches[0].clientX - e.touches[1].clientX), view: Object.assign({}, this.view) };
    }, { passive: true });
    H('touchmove', e => {
      if (e.touches.length === 2 && this.pinch) {
        e.preventDefault();
        const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1;
        this.view = Object.assign({}, this.pinch.view);
        this.zoom(this.pinch.d / d, (e.touches[0].clientX + e.touches[1].clientX) / 2 - this.cv.getBoundingClientRect().left);
      } else if (e.touches.length === 1 && this.drag) { e.preventDefault(); this.pan(e.touches[0].clientX); this.redraw(); }
    }, { passive: false });
    H('touchend', () => { this.drag = null; this.pinch = null; });
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.redraw()); this.ro.observe(canvas.parentNode || canvas); }
  }

  pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /**
   * data : { bars: [{ d, o, h, l, c, v }], style: 'candle'|'ohlc'|'heikin'|'line'|'area', studies: { ma, bb, vol, rsi, macd },
   *          log, digits, intraday, from (index de départ de la vue), lines: [{ label, data }] (mode comparaison en %) }
   */
  set(data) {
    this.data = data;
    const n = (data.bars || []).length || ((data.lines || [])[0] || { data: [] }).data.length;
    this.n = n;
    this.home = { from: Math.max(0, Math.min(n - 2, data.from || 0)), to: n - 1 };
    this.view = Object.assign({}, this.home);
    this.prep();
    this.redraw();
  }

  /** Indicateurs calculés sur toute la série (la vue ne fait que zoomer) */
  prep() {
    const D = this.data, st = D.studies || {};
    if (!D.bars) return;
    const bars = D.style === 'heikin' ? TA.heikin(D.bars) : D.bars;
    this.bars = bars;
    const c = D.bars.map(b => b.c);
    this.ind = {
      ma20: st.ma ? TA.sma(c, 20) : null, ma50: st.ma ? TA.sma(c, 50) : null, ma200: st.ma ? TA.sma(c, 200) : null,
      bb: st.bb ? TA.bollinger(c, 20, 2) : null, rsi: st.rsi ? TA.rsi(c, 14) : null, macd: st.macd ? TA.macd(c) : null,
    };
  }

  reset() { if (this.home) { this.view = Object.assign({}, this.home); this.redraw(); } }

  zoom(f, x) {
    if (!this.view || this.n < 3) return;
    const L = this.layout(), n = this.view.to - this.view.from + 1;
    const ratio = Math.max(0, Math.min(1, (x - L.x0) / L.w));
    const nn = Math.max(10, Math.min(this.n, Math.round(n * f)));
    const anchor = this.view.from + ratio * (n - 1);
    let from = Math.round(anchor - ratio * (nn - 1));
    from = Math.max(0, Math.min(this.n - nn, from));
    this.view = { from, to: from + nn - 1 };
    this.redraw();
  }

  pan(clientX) {
    const L = this.layout(), n = this.drag.view.to - this.drag.view.from + 1;
    const shift = Math.round(-(clientX - this.drag.x) / (L.w / n));
    const from = Math.max(0, Math.min(this.n - n, this.drag.view.from + shift));
    this.view = { from, to: from + n - 1 };
  }

  redraw() { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.draw()); }

  destroy() { if (this.ro) this.ro.disconnect(); cancelAnimationFrame(this._raf); this.data = null; }

  /** Découpage : panneau principal (+ volume en bas), puis RSI et MACD */
  layout() {
    const W = this.cv.clientWidth || 300, H = this.cv.clientHeight || 200;
    const st = (this.data && this.data.studies) || {};
    const subs = [st.rsi && this.data.bars ? 'rsi' : null, st.macd && this.data.bars ? 'macd' : null].filter(Boolean);
    const top = 30, bottom = 18, axisW = 66;
    const subH = subs.length ? Math.max(48, Math.round((H - top - bottom) * 0.2)) : 0;
    const mainH = H - top - bottom - subs.length * (subH + 6);
    const panels = subs.map((s, k) => ({ kind: s, y: top + mainH + 6 + k * (subH + 6), h: subH }));
    return { W, H, x0: 4, w: W - axisW - 8, top, mainH, panels, axisX: W - axisW };
  }

  draw() {
    const D = this.data, cv = this.cv, ctx = this.ctx;
    if (!D || !cv.isConnected) return;
    const dpr = window.devicePixelRatio || 1, L = this.layout();
    if (cv.width !== Math.round(L.W * dpr) || cv.height !== Math.round(L.H * dpr)) { cv.width = Math.round(L.W * dpr); cv.height = Math.round(L.H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    if (!this.n) return;
    const { from, to } = this.view, n = to - from + 1, slot = L.w / n;
    const X = i => L.x0 + (i - from + 0.5) * slot;
    const pct = !D.bars;
    // bornes de prix sur la vue
    let lo = Infinity, hi = -Infinity;
    const take = v => { if (v !== null && v !== undefined && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    let base = [];
    if (pct) {
      base = D.lines.map(s => { for (let i = from; i <= to; i++) if (s.data[i] > 0) return s.data[i]; return NaN; });
      D.lines.forEach((s, k) => { for (let i = from; i <= to; i++) if (s.data[i] > 0) take((s.data[i] / base[k] - 1) * 100); });
      take(0);
    } else {
      const lineOnly = D.style === 'line' || D.style === 'area';
      for (let i = from; i <= to; i++) { const b = this.bars[i]; if (lineOnly) take(b.c); else { take(b.h); take(b.l); } }
      for (const k of ['ma20', 'ma50', 'ma200']) if (this.ind[k]) for (let i = from; i <= to; i++) take(this.ind[k][i]);
      if (this.ind.bb) for (let i = from; i <= to; i++) { take(this.ind.bb.up[i]); take(this.ind.bb.lo[i]); }
    }
    if (!isFinite(lo)) return;
    if (hi === lo) { hi += Math.abs(hi) * 0.01 || 1; lo -= Math.abs(lo) * 0.01 || 1; }
    const log = !!D.log && !pct && lo > 0;
    const tf = v => (log ? Math.log(v) : v);
    const pad = (tf(hi) - tf(lo)) * 0.06;
    const ymin = tf(lo) - pad, ymax = tf(hi) + pad;
    const Y = v => L.top + (1 - (tf(v) - ymin) / (ymax - ymin)) * L.mainH;
    const invY = y => { const t = ymin + (1 - (y - L.top) / L.mainH) * (ymax - ymin); return log ? Math.exp(t) : t; };
    const dig = D.digits ?? (Math.abs(hi) < 10 ? 4 : 2);
    const fmt = v => (pct ? (v > 0 ? '+' : '') + fmtNum(v, 1) + '%' : fmtNum(v, dig));

    // grille et axe des prix
    ctx.strokeStyle = TC_COL.grid; ctx.lineWidth = 1; ctx.fillStyle = TC_COL.axis; ctx.textAlign = 'left';
    const ticks = [];
    if (log) { const s = TA.niceStep(hi - lo, 5); for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) ticks.push(v); }
    else { const s = TA.niceStep(hi - lo, Math.max(3, Math.floor(L.mainH / 45))); for (let v = Math.ceil(invY(L.top + L.mainH) / s) * s; v <= invY(L.top); v += s) ticks.push(v); }
    for (const v of ticks) { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(L.x0, y); ctx.lineTo(L.axisX, y); ctx.stroke(); ctx.fillText(fmt(v), L.axisX + 6, y); }
    // axe du temps
    const labs = D.labels || (D.bars || []).map(b => b.d);
    const every = Math.max(1, Math.ceil(80 / slot));
    ctx.textAlign = 'center'; ctx.fillStyle = TC_COL.dim;
    const lab = d => {
      if (!d) return '';
      if (D.intraday) return d.length > 5 ? d.slice(-5) : d;
      const span = n * (D.unit === 'M' ? 30 : D.unit === 'S' ? 7 : 1.4);
      return span < 330 ? d.slice(8, 10) + '/' + d.slice(5, 7) : d.slice(5, 7) + '/' + d.slice(2, 4);
    };
    for (let i = from + Math.floor(every / 2); i <= to; i += every) {
      const x = Math.round(X(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.top + L.mainH); ctx.stroke();
      ctx.fillText(lab(labs[i]), x, L.H - 9);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(L.x0, L.top, L.w, L.mainH); ctx.clip();

    if (pct) {
      // comparaison : performances rebasées au début de la vue
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(L.x0, Y(0)); ctx.lineTo(L.axisX, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      D.lines.forEach((s, k) => {
        ctx.strokeStyle = s.color || TC_SERIES[k % TC_SERIES.length]; ctx.lineWidth = 1.5; ctx.beginPath();
        let started = false;
        for (let i = from; i <= to; i++) { const v = s.data[i]; if (!(v > 0)) continue; const y = Y((v / base[k] - 1) * 100); if (started) ctx.lineTo(X(i), y); else { ctx.moveTo(X(i), y); started = true; } }
        ctx.stroke();
      });
    } else {
      const st = D.studies || {};
      // volume en bas du panneau principal
      if (st.vol) {
        let vmax = 0;
        for (let i = from; i <= to; i++) vmax = Math.max(vmax, this.bars[i].v || 0);
        if (vmax > 0) {
          const vh = L.mainH * 0.2;
          for (let i = from; i <= to; i++) {
            const b = this.bars[i], h = (b.v || 0) / vmax * vh;
            ctx.fillStyle = b.c >= b.o ? 'rgba(47,227,127,.28)' : 'rgba(255,77,77,.28)';
            ctx.fillRect(X(i) - Math.max(0.5, slot * 0.35), L.top + L.mainH - h, Math.max(1, slot * 0.7), h);
          }
        }
      }
      // Bollinger
      if (this.ind.bb) {
        const bb = this.ind.bb;
        ctx.fillStyle = 'rgba(143,168,255,.07)'; ctx.beginPath();
        let first = true;
        for (let i = from; i <= to; i++) if (bb.up[i] !== null) { if (first) { ctx.moveTo(X(i), Y(bb.up[i])); first = false; } else ctx.lineTo(X(i), Y(bb.up[i])); }
        for (let i = to; i >= from; i--) if (bb.lo[i] !== null) ctx.lineTo(X(i), Y(bb.lo[i]));
        ctx.closePath(); ctx.fill();
        for (const arr of [bb.up, bb.lo, bb.mid]) this.path(arr, from, to, X, Y, TC_COL.bb, arr === bb.mid ? [2, 3] : [], 1);
      }
      // cours
      const bars = this.bars;
      if (D.style === 'line' || D.style === 'area') {
        const up = bars[to].c >= bars[from].c, col = up ? TC_COL.up : TC_COL.down;
        if (D.style === 'area') {
          const g = ctx.createLinearGradient(0, L.top, 0, L.top + L.mainH);
          g.addColorStop(0, up ? 'rgba(47,227,127,.30)' : 'rgba(255,77,77,.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(X(from), L.top + L.mainH);
          for (let i = from; i <= to; i++) ctx.lineTo(X(i), Y(bars[i].c));
          ctx.lineTo(X(to), L.top + L.mainH); ctx.closePath(); ctx.fill();
        }
        this.path(bars.map(b => b.c), from, to, X, Y, col, [], 1.5);
      } else {
        const bw = Math.max(1, Math.min(14, slot * 0.68));
        for (let i = from; i <= to; i++) {
          const b = bars[i], x = Math.round(X(i)) + 0.5, up = b.c >= b.o, col = up ? TC_COL.up : TC_COL.down;
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
          if (D.style === 'ohlc') {
            ctx.beginPath(); ctx.moveTo(x - bw / 2, Y(b.o)); ctx.lineTo(x, Y(b.o)); ctx.moveTo(x, Y(b.c)); ctx.lineTo(x + bw / 2, Y(b.c)); ctx.stroke();
          } else {
            const yo = Y(b.o), yc = Y(b.c), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
            if (up && bw > 3) { ctx.fillStyle = '#000'; ctx.fillRect(x - bw / 2, top, bw, h); ctx.strokeRect(x - bw / 2 + 0.5, top + 0.5, bw - 1, Math.max(0, h - 1)); }
            else ctx.fillRect(x - bw / 2, top, bw, h);
          }
        }
      }
      // moyennes mobiles
      if (this.ind.ma20) { this.path(this.ind.ma20, from, to, X, Y, TC_COL.ma20, [], 1); this.path(this.ind.ma50, from, to, X, Y, TC_COL.ma50, [], 1); this.path(this.ind.ma200, from, to, X, Y, TC_COL.ma200, [], 1.2); }
    }
    ctx.restore();

    // dernier cours : ligne pointillée et étiquette sur l'axe
    if (!pct) {
      const last = this.bars[this.bars.length - 1], prev = this.bars[this.bars.length - 2] || last;
      const y = Y(last.c);
      if (y >= L.top && y <= L.top + L.mainH) {
        const col = last.c >= prev.c ? TC_COL.up : TC_COL.down;
        ctx.strokeStyle = col; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L.x0, y); ctx.lineTo(L.axisX, y); ctx.stroke(); ctx.setLineDash([]);
        this.tag(L.axisX + 1, y, fmt(last.c), col, '#000');
      }
    } else {
      const tags = [];
      D.lines.forEach((s, k) => {
        let i = to; while (i > from && !(s.data[i] > 0)) i--;
        if (s.data[i] > 0) { const v = (s.data[i] / base[k] - 1) * 100; tags.push({ y: Y(v), txt: fmt(v), col: s.color || TC_SERIES[k % TC_SERIES.length] }); }
      });
      tags.sort((a, b) => a.y - b.y);
      for (let k = 1; k < tags.length; k++) tags[k].y = Math.max(tags[k].y, tags[k - 1].y + 16);
      const over = tags.length ? tags[tags.length - 1].y - (L.top + L.mainH - 8) : 0;
      if (over > 0) for (const t of tags) t.y -= over;
      for (const t of tags) this.tag(L.axisX + 1, t.y, t.txt, t.col, '#000');
    }

    // panneaux RSI / MACD
    for (const P of L.panels) {
      ctx.strokeStyle = '#333'; ctx.strokeRect(L.x0 + 0.5, P.y + 0.5, L.w, P.h);
      ctx.save(); ctx.beginPath(); ctx.rect(L.x0, P.y, L.w, P.h); ctx.clip();
      if (P.kind === 'rsi') {
        const YR = v => P.y + (1 - v / 100) * P.h;
        ctx.fillStyle = 'rgba(255,159,28,.06)'; ctx.fillRect(L.x0, YR(70), L.w, YR(30) - YR(70));
        ctx.strokeStyle = 'rgba(255,159,28,.35)'; ctx.setLineDash([3, 3]);
        for (const v of [70, 30]) { ctx.beginPath(); ctx.moveTo(L.x0, YR(v)); ctx.lineTo(L.axisX, YR(v)); ctx.stroke(); }
        ctx.setLineDash([]);
        this.path(this.ind.rsi, from, to, X, YR, TC_COL.rsi, [], 1.2);
        ctx.restore();
        ctx.fillStyle = TC_COL.dim; ctx.textAlign = 'left';
        for (const v of [70, 30]) ctx.fillText(String(v), L.axisX + 6, YR(v));
      } else {
        const M = this.ind.macd;
        let m = 0;
        for (let i = from; i <= to; i++) for (const a of [M.macd[i], M.signal[i], M.hist[i]]) if (a !== null) m = Math.max(m, Math.abs(a));
        m = m || 1;
        const YM = v => P.y + P.h / 2 - v / m * (P.h / 2 - 3);
        for (let i = from; i <= to; i++) if (M.hist[i] !== null) {
          ctx.fillStyle = M.hist[i] >= 0 ? 'rgba(47,227,127,.55)' : 'rgba(255,77,77,.55)';
          const y0 = YM(0), y1 = YM(M.hist[i]);
          ctx.fillRect(X(i) - Math.max(0.5, slot * 0.3), Math.min(y0, y1), Math.max(1, slot * 0.6), Math.abs(y1 - y0));
        }
        this.path(M.macd, from, to, X, YM, TC_COL.macd, [], 1.2);
        this.path(M.signal, from, to, X, YM, TC_COL.signal, [], 1);
        ctx.restore();
        ctx.fillStyle = TC_COL.dim; ctx.textAlign = 'left'; ctx.fillText('0', L.axisX + 6, YM(0));
      }
    }

    // réticule
    let hi2 = to;
    if (this.mouse && this.mouse.x >= L.x0 && this.mouse.x <= L.axisX) {
      hi2 = Math.max(from, Math.min(to, from + Math.floor((this.mouse.x - L.x0) / slot)));
      const x = Math.round(X(hi2)) + 0.5;
      ctx.strokeStyle = TC_COL.cross; ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.H - 18); ctx.stroke();
      if (this.mouse.y >= L.top && this.mouse.y <= L.top + L.mainH) {
        ctx.beginPath(); ctx.moveTo(L.x0, this.mouse.y); ctx.lineTo(L.axisX, this.mouse.y); ctx.stroke();
        ctx.setLineDash([]);
        this.tag(L.axisX + 1, this.mouse.y, fmt(invY(this.mouse.y)), '#ddd', '#000');
      }
      ctx.setLineDash([]);
      const t = tcDate(labs[hi2]);
      ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(t).width + 10;
      ctx.fillStyle = '#ddd'; ctx.fillRect(Math.min(L.axisX - tw, Math.max(L.x0, x - tw / 2)), L.H - 17, tw, 15);
      ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.fillText(t, Math.min(L.axisX - tw / 2, Math.max(L.x0 + tw / 2, x)), L.H - 9.5);
    }
    this.hover = hi2;
    this.legend(hi2, L, pct, base, fmt);
  }

  /** Lecture en haut à gauche : O / H / B / C / volume / variation, puis indicateurs */
  legend(i, L, pct, base, fmt) {
    const ctx = this.ctx, D = this.data;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    let x = L.x0 + 2;
    const put = (txt, col, y = 9) => { ctx.fillStyle = col; ctx.fillText(txt, x, y); x += ctx.measureText(txt).width + 8; };
    const labs = D.labels || D.bars.map(b => b.d);
    put(tcDate(labs[i]), '#fff');
    if (pct) {
      D.lines.forEach((s, k) => { const v = s.data[i]; put(`${s.label} ${v > 0 && base[k] > 0 ? fmt((v / base[k] - 1) * 100) : '—'}`, s.color || TC_SERIES[k % TC_SERIES.length]); });
      return;
    }
    const b = this.bars[i], src = D.bars[i], prev = D.bars[i - 1];
    const dig = D.digits ?? (Math.abs(src.c) < 10 ? 4 : 2), f = v => fmtNum(v, dig);
    put('O', TC_COL.dim); x -= 6; put(f(src.o), TC_COL.text);
    put('H', TC_COL.dim); x -= 6; put(f(src.h), TC_COL.text);
    put('B', TC_COL.dim); x -= 6; put(f(src.l), TC_COL.text);
    put('C', TC_COL.dim); x -= 6; put(f(src.c), b.c >= b.o ? TC_COL.up : TC_COL.down);
    if (prev) { const ch = (src.c / prev.c - 1) * 100; put((ch > 0 ? '+' : '') + fmtNum(ch, 2) + '%', ch >= 0 ? TC_COL.up : TC_COL.down); }
    if (src.v) { put('V', TC_COL.dim); x -= 6; put(src.v >= 1e6 ? fmtNum(src.v / 1e6, 2) + 'M' : src.v >= 1e3 ? fmtNum(src.v / 1e3, 1) + 'k' : fmtNum(src.v, 0), TC_COL.text); }
    x = L.x0 + 2;
    const y2 = 22, I = this.ind;
    ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
    if (I.ma20) { put('MM20 ' + f(I.ma20[i]), TC_COL.ma20, y2); put('MM50 ' + f(I.ma50[i]), TC_COL.ma50, y2); put('MM200 ' + f(I.ma200[i]), TC_COL.ma200, y2); }
    if (I.bb && I.bb.up[i] !== null) put(`BB ${f(I.bb.lo[i])} – ${f(I.bb.up[i])}`, TC_COL.bb, y2);
    if (I.rsi && I.rsi[i] !== null) put('RSI ' + fmtNum(I.rsi[i], 1), TC_COL.rsi, y2);
    if (I.macd && I.macd.macd[i] !== null) put(`MACD ${fmtNum(I.macd.macd[i], dig)} / ${fmtNum(I.macd.signal[i], dig)}`, TC_COL.macd, y2);
  }

  path(arr, from, to, X, Y, col, dash, w) {
    if (!arr) return;
    const ctx = this.ctx;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath();
    let started = false;
    for (let i = from; i <= to; i++) {
      const v = arr[i];
      if (v === null || v === undefined || !isFinite(v)) { started = false; continue; }
      if (started) ctx.lineTo(X(i), Y(v)); else { ctx.moveTo(X(i), Y(v)); started = true; }
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  tag(x, y, txt, bg, fg) {
    const ctx = this.ctx;
    ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
    const w = ctx.measureText(txt).width + 8;
    ctx.fillStyle = bg; ctx.fillRect(x, y - 8, w, 16);
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(txt, x + 4, y);
  }
}
