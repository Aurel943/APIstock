/* Remplace Chart.js (CDN) pendant les tests de bout en bout : aucun appel réseau, mêmes méthodes utilisées par le site */
window.Chart = class Chart {
  constructor(ctx, config) { this.ctx = ctx; this.config = config; this.data = config.data; this.options = config.options || {}; (window.__charts = window.__charts || []).push(this); }
  destroy() {}
  resize() {}
  update() {}
};
