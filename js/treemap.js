/*
 * Carte du portefeuille : chaque ligne est un rectangle proportionnel à son poids (algorithme « squarified »
 * de Bruls, Huizing et van Wijk, qui garde les rectangles aussi carrés que possible), coloré par la variation
 * du jour ou par la plus-value.
 */
'use strict';

const Treemap = {
  /**
   * Découpe le rectangle (x, y, w, h) en tuiles d'aires proportionnelles aux valeurs (triées décroissantes).
   * Renvoie [{ i, x, y, w, h }] où i est l'indice dans `values`.
   */
  layout(values, x = 0, y = 0, w = 100, h = 100) {
    const total = values.reduce((s, v) => s + Math.max(0, v), 0);
    if (!(total > 0) || !(w > 0) || !(h > 0)) return [];
    const items = values.map((v, i) => ({ i, a: Math.max(0, v) / total * w * h })).filter(t => t.a > 0).sort((p, q) => q.a - p.a);
    const out = [];
    const worst = (row, side) => {
      const s = row.reduce((t, r) => t + r.a, 0);
      let max = 0;
      for (const r of row) max = Math.max(max, (side * side * r.a) / (s * s), (s * s) / (side * side * r.a));
      return max;
    };
    let rest = items.slice();
    while (rest.length) {
      const side = Math.min(w, h);
      const row = [rest[0]];
      let k = 1;
      while (k < rest.length && worst(row.concat(rest[k]), side) <= worst(row, side)) { row.push(rest[k]); k++; }
      rest = rest.slice(k);
      const s = row.reduce((t, r) => t + r.a, 0);
      if (w >= h) { // colonne à gauche
        const cw = s / h;
        let cy = y;
        for (const r of row) { const rh = r.a / cw; out.push({ i: r.i, x, y: cy, w: cw, h: rh }); cy += rh; }
        x += cw; w -= cw;
      } else { // rangée en haut
        const rh = s / w;
        let cx = x;
        for (const r of row) { const rw = r.a / rh; out.push({ i: r.i, x: cx, y, w: rw, h: rh }); cx += rw; }
        y += rh; h -= rh;
      }
    }
    return out;
  },

  /** Couleur d'une variation : vert ou rouge, d'autant plus intense que l'écart approche `scale` % */
  color(pct, scale) {
    if (!isFinite(pct)) return 'var(--surface-2)';
    const t = Math.min(1, Math.abs(pct) / scale);
    const base = pct >= 0 ? 'var(--up)' : 'var(--down)';
    return `color-mix(in srgb, ${base} ${Math.round(18 + t * 70)}%, var(--surface))`;
  },
};

Object.assign(App, {
  treemapMode: 'day',

  renderTreemap() {
    const card = $('#mapCard');
    if (!card) return;
    const { rows } = Portfolio.snapshot();
    const items = rows.filter(r => (isFinite(r.valueBase) ? r.valueBase : r.costBase) > 0);
    card.classList.toggle('hidden', items.length < 2);
    if (items.length < 2) return;
    const box = $('#mapBox');
    const W = box.clientWidth || (window.innerWidth < 640 ? 340 : 1000);
    const H = window.innerWidth < 640 ? 300 : 340;
    const vals = items.map(r => (isFinite(r.valueBase) ? r.valueBase : r.costBase));
    const total = vals.reduce((a, b) => a + b, 0);
    const day = this.treemapMode === 'day';
    const cur = this.base();
    box.style.height = H + 'px';
    box.replaceChildren(...Treemap.layout(vals, 0, 0, W, H).map(t => {
      const r = items[t.i];
      const pct = day ? (r.quote ? r.quote.percentChange : NaN) : r.pnlPct;
      const big = t.w > 90 && t.h > 54, mid = t.w > 60 && t.h > 34;
      return el('button', { type: 'button', class: 'map-tile' + (big ? ' big' : mid ? '' : ' tiny'),
        style: `left:${t.x / W * 100}%;top:${t.y / H * 100}%;width:${t.w / W * 100}%;height:${t.h / H * 100}%;background:${Treemap.color(pct, day ? 2.5 : 40)}`,
        title: `${Store.label(r.key)} : ${fmtPct(vals[t.i] / total * 100, 1, false)} du portefeuille · ${day ? 'aujourd\'hui' : 'plus-value'} ${fmtPct(pct)}`,
        onclick: () => { this.show('markets'); this.selectDetail(r.key); } },
        mid ? el('span', { class: 'map-name' }, Store.label(r.key)) : null,
        mid ? el('b', { class: 'map-pct' }, fmtPct(pct)) : null,
        big ? el('span', { class: 'map-val' }, fmtMoney(vals[t.i], cur, 0) + ' · ' + fmtPct(vals[t.i] / total * 100, 0, false)) : null);
    }));
  },
});
