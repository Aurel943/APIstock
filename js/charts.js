/* Graphiques (Chart.js) */
'use strict';

const PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#3b82f6'];

const Charts = {
  instances: {},

  css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },

  destroy(id) {
    if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
  },

  baseOptions() {
    const grid = this.css('--chart-grid');
    const muted = this.css('--muted');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: muted, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: { padding: 10, cornerRadius: 8 },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 8, maxRotation: 0, autoSkip: true }, border: { display: false } },
        y: { grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 6 }, border: { display: false } },
      },
    };
  },

  doughnut(id, labels, values, colors, currency) {
    const old = this.instances[id];
    // même graphique, mêmes lignes : on met juste à jour les valeurs, sans recréer ni ré-animer
    if (old && old.$apistock && old.$apistock.currency === currency && old.$apistock.border === this.css('--surface')
      && old.data.labels.join('\u0001') === labels.join('\u0001')) {
      old.data.datasets[0].data = values;
      old.data.datasets[0].backgroundColor = colors;
      old.$apistock.total = values.reduce((a, b) => a + b, 0);
      old.update('none');
      return;
    }
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === 'undefined') return;
    const meta = { currency, border: this.css('--surface'), total: values.reduce((a, b) => a + b, 0) };
    this.instances[id] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: this.css('--surface'), borderWidth: 2, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '64%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.label} : ${fmtMoney(c.raw, currency)} (${fmtNum((c.raw / meta.total) * 100, 1)} %)` } },
        },
      },
    });
    this.instances[id].$apistock = meta;
  },

  line(id, labels, values, opts = {}) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === 'undefined') return;
    const up = values.length < 2 || values[values.length - 1] >= values[0];
    const color = up ? this.css('--up') : this.css('--down');
    const o = this.baseOptions();
    o.plugins.legend.display = false;
    o.plugins.tooltip.callbacks = { label: c => (c.dataset.label ? ` ${c.dataset.label} : ` : ' ') + fmtMoney(c.raw, opts.currency, 3) };
    o.plugins.tooltip.filter = c => c.raw !== null && c.raw !== undefined;
    o.scales.y.ticks.callback = v => fmtNum(v, v >= 1000 ? 0 : 2);
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    // repères facultatifs : achats (▲ vert), ventes (▼ rouge), prix de revient moyen (pointillés)
    const n = values.length;
    const marks = (type, color, style) => {
      const pts = (opts.marks || []).filter(m => m.type === type);
      if (!pts.length) return [];
      const data = new Array(n).fill(null);
      for (const m of pts) if (m.i >= 0 && m.i < n) data[m.i] = m.price;
      return [{ label: type === 'buy' ? 'Achat' : 'Vente', data, showLine: false, pointStyle: style, rotation: type === 'sell' ? 180 : 0,
        pointRadius: data.map(v => (v === null ? 0 : 6)), pointHoverRadius: 8, pointBackgroundColor: color, pointBorderColor: this.css('--surface'), borderWidth: 1 }];
    };
    const extra = [
      ...(isFinite(opts.pru) ? [{ label: 'Ton prix de revient', data: new Array(n).fill(opts.pru), borderColor: this.css('--muted'), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false }] : []),
      ...marks('buy', this.css('--up'), 'triangle'),
      ...marks('sell', this.css('--down'), 'triangle'),
    ];
    this.instances[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values, borderColor: color, borderWidth: 2, tension: 0.15, fill: true,
          backgroundColor: c => {
            const { chartArea, ctx: g } = c.chart;
            if (!chartArea) return 'transparent';
            const grad = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            grad.addColorStop(0, color + '40');
            grad.addColorStop(1, color + '00');
            return grad;
          },
        }, ...extra],
      },
      options: o,
    });
  },

  /** Courbe valeur vs montant investi */
  investedVsValue(id, labels, invested, value, currency, opts = {}) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === 'undefined') return;
    const o = this.baseOptions();
    o.plugins.tooltip.callbacks = {
      label: c => ` ${c.dataset.label} : ${fmtMoney(c.raw, currency, 0)}`,
      footer: items => {
        const v = items.find(i => i.datasetIndex === 0), inv = items.find(i => i.datasetIndex === 1);
        if (!v || !inv) return '';
        const d = v.raw - inv.raw;
        return `+/- latente : ${fmtSignedMoney(d, currency)} (${fmtPct(inv.raw ? (d / inv.raw) * 100 : NaN)})`;
      },
    };
    o.scales.y.ticks.callback = v => fmtMoney(v, currency, 0);
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    const accent = this.css('--accent');
    const muted = this.css('--muted');
    this.instances[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: opts.valueLabel || 'Valeur', data: value, borderColor: accent, backgroundColor: accent + '22', fill: '+1', borderWidth: 2, tension: 0.1 },
          { label: opts.investedLabel || 'Montant investi', data: invested, borderColor: muted, borderDash: [5, 4], borderWidth: 1.5, fill: false, stepped: opts.stepped ? 'before' : false },
          ...(opts.bench ? [{ label: opts.benchLabel || 'Indice de référence', data: opts.bench, borderColor: '#d97706', borderWidth: 1.5, fill: false, tension: 0.1, spanGaps: true }] : []),
        ],
      },
      options: o,
    });
  },

  /** Projection en éventail : zone 10-90 %, médiane, projection régulière et total versé */
  fan(id, labels, d, currency) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === 'undefined') return;
    const o = this.baseOptions();
    o.plugins.tooltip.callbacks = { label: c => (c.dataset.label ? ` ${c.dataset.label} : ${fmtMoney(c.raw, currency, 0)}` : null) };
    o.plugins.legend.labels.filter = item => !!item.text;
    o.scales.y.ticks.callback = v => fmtMoney(v, currency, 0);
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    const accent = this.css('--accent'), muted = this.css('--muted');
    this.instances[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Favorable (90 %)', data: d.p90, borderColor: accent + '66', borderWidth: 1, fill: '+1', backgroundColor: accent + '22', tension: 0.2 },
          { label: 'Défavorable (10 %)', data: d.p10, borderColor: accent + '66', borderWidth: 1, fill: false, tension: 0.2 },
          { label: 'Médiane', data: d.p50, borderColor: accent, borderWidth: 2.5, fill: false, tension: 0.2 },
          { label: (d.names && d.names.expected) || 'Rendement régulier', data: d.expected, borderColor: '#6366f1', borderDash: [2, 3], borderWidth: 1.5, fill: false, tension: 0.2 },
          { label: (d.names && d.names.invested) || 'Total versé', data: d.invested, borderColor: muted, borderDash: [5, 4], borderWidth: 1.5, fill: false },
        ],
      },
      options: o,
    });
  },

  refreshTheme() {
    for (const c of Object.values(this.instances)) {
      const muted = this.css('--muted'), grid = this.css('--chart-grid');
      if (c.options.scales && c.options.scales.x) {
        c.options.scales.x.ticks.color = muted;
        c.options.scales.y.ticks.color = muted;
        c.options.scales.y.grid.color = grid;
      }
      if (c.options.plugins.legend && c.options.plugins.legend.labels) c.options.plugins.legend.labels.color = muted;
      c.update('none');
    }
  },
};
