/*
 * Diversification dans le temps (Analyse › Risque) : tes lignes bougent-elles ensemble ? Corrélation moyenne entre
 * tes lignes (pondérée par leur poids actuel) et nombre de paris réellement indépendants, sur 52 semaines glissantes
 * depuis 5 ans. Une alerte quand la corrélation actuelle dépasse son niveau habituel : la diversification protège
 * alors moins (les corrélations montent souvent dans les baisses de marché).
 * Calculs purs (objet Diversif) testés dans tests/diversif.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const DIV_WINDOW = 52, DIV_STEP = 2; // fenêtre (semaines) et pas du calcul glissant

const Diversif = {
  /**
   * Mesures d'une fenêtre de rendements [[r1, r2…], …] pour des poids `w` (somme 1) :
   * corrélation moyenne pondérée des paires, ratio de diversification (Σ wσ ÷ σ du portefeuille)
   * et nombre de paris indépendants (carré de ce ratio, Choueifaty).
   */
  window(rows, w) {
    const { cov } = Quant.covariance(rows);
    const k = w.length, sd = cov.map((r, i) => Math.sqrt(Math.max(0, r[i])));
    let num = 0, den = 0, vp = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      vp += w[i] * w[j] * cov[i][j];
      if (j > i && sd[i] > 0 && sd[j] > 0) { num += w[i] * w[j] * cov[i][j] / (sd[i] * sd[j]); den += w[i] * w[j]; }
    }
    const dr = vp > 0 ? w.reduce((s, x, i) => s + x * sd[i], 0) / Math.sqrt(vp) : NaN;
    return { corr: den > 0 ? num / den : NaN, dr, bets: dr * dr };
  },

  /** Mesures glissantes : [{ date, corr, bets }] tous les `step` semaines, fenêtres de `size` semaines */
  rolling(weekly, w, size = DIV_WINDOW, step = DIV_STEP) {
    const out = [];
    for (let end = weekly.returns.length; end >= size; end -= step) {
      const r = this.window(weekly.returns.slice(end - size, end), w);
      if (isFinite(r.corr)) out.unshift({ date: weekly.weeks[end - 1], corr: r.corr, bets: r.bets });
    }
    return out;
  },

  /** Quantile (0 à 1) d'une liste de nombres */
  quantile(xs, q) {
    const s = xs.filter(isFinite).slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const pos = (s.length - 1) * q, i = Math.floor(pos);
    return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
  },

  /** Situation actuelle face à l'historique : { now, median, high (75e centile), level: haute | normale | basse } */
  status(series) {
    const xs = series.map(p => p.corr);
    const now = xs[xs.length - 1], median = this.quantile(xs, 0.5), high = this.quantile(xs, 0.75), low = this.quantile(xs, 0.25);
    return { now, median, high, low, level: now > high ? 'haute' : now < low ? 'basse' : 'normale', bets: series[series.length - 1].bets };
  },
};

Object.assign(App, {
  async runDiversif() {
    const box = $('#divtBody'), btn = $('#divtRun');
    if (!box) return;
    const lines = this.quantLines();
    if (lines.length < 2) { this.quantEmpty(box, 'Il faut au moins deux lignes cotées pour mesurer leur diversification.'); return; }
    this.quantBusy(btn, true);
    try {
      const start = addDaysISO(todayISO(), -5 * 365 - 7);
      const series = {};
      for (const l of lines) { try { series[l.key] = await this.quantSeries(l.key, start); } catch (e) { /* ligne sans historique */ } }
      const weekly = Quant.weeklyReturns(series);
      if (weekly.keys.length < 2 || weekly.returns.length < DIV_WINDOW + DIV_STEP) throw new Error('Pas assez d\'historique commun entre tes lignes (au moins un an).');
      const total = weekly.keys.reduce((s, k) => s + lines.find(l => l.key === k).value, 0);
      const w = weekly.keys.map(k => lines.find(l => l.key === k).value / total);
      const roll = Diversif.rolling(weekly, w);
      this._divResult = { roll, status: Diversif.status(roll), keys: weekly.keys, n: weekly.keys.length, from: weekly.weeks[0] };
      this.renderDiversif();
    } catch (e) {
      this.quantEmpty(box, e.message);
    } finally { this.quantBusy(btn, false, 'Recalculer'); }
  },

  renderDiversif() {
    const R = this._divResult, box = $('#divtBody');
    if (!R || !box) return;
    const S = R.status, f = x => fmtNum(x, 2);
    const tone = S.level === 'haute' ? 'warn' : S.level === 'basse' ? 'up' : '';
    const text = S.level === 'haute'
      ? `Tes lignes bougent plus ensemble que d'habitude : corrélation moyenne de ${f(S.now)}, contre ${f(S.median)} en temps normal. La diversification te protège moins en ce moment.`
      : S.level === 'basse'
        ? `Tes lignes sont moins liées que d'habitude : corrélation moyenne de ${f(S.now)}, contre ${f(S.median)} en temps normal. Ta diversification fonctionne bien.`
        : `Corrélation moyenne entre tes lignes : ${f(S.now)}, dans sa fourchette habituelle (médiane ${f(S.median)}).`;
    box.replaceChildren(
      el('p', { class: 'etfcmp-verdict div-verdict ' + tone }, text,
        ` Cela équivaut à ${fmtNum(S.bets, 1)} pari${S.bets >= 2 ? 's' : ''} indépendant${S.bets >= 2 ? 's' : ''} pour tes ${R.n} lignes.`),
      el('div', { class: 'chart-box div-chart' }, el('canvas', { id: 'divtChart', role: 'img', 'aria-label': 'Corrélation moyenne entre tes lignes, sur 52 semaines glissantes' })),
      el('div', { class: 'kpis' },
        this.kpi('Corrélation actuelle', f(S.now), '52 dernières semaines', tone === 'warn' ? 'down' : '', 'Moyenne des corrélations entre tes lignes, deux à deux, pondérée par leur poids : 1 = elles bougent exactement ensemble, 0 = indépendantes.'),
        this.kpi('En temps normal', f(S.median), `médiane depuis ${new Date(R.roll[0].date).getFullYear()} · ${f(S.low)} à ${f(S.high)} la moitié du temps`),
        this.kpi('Paris indépendants', fmtNum(S.bets, 1), 'carré du ratio de diversification', '', 'Ratio de diversification : somme des risques de tes lignes divisée par le risque du portefeuille. Son carré se lit comme un nombre de placements vraiment indépendants (Choueifaty).')),
      noteTip(`Rendements hebdomadaires de tes ${R.n} lignes en ${this.base()} depuis le ${fmtDate(R.from)}, fenêtres de ${DIV_WINDOW} semaines recalculées toutes les ${DIV_STEP} semaines, poids actuels. « Plus que d'habitude » : au-dessus du 75e centile de son historique. Les corrélations passées ne garantissent pas les corrélations futures : elles montent souvent quand les marchés chutent.`, 'Méthode'));
    this.drawDiversifChart();
  },

  drawDiversifChart() {
    const R = this._divResult;
    if (!R || typeof Chart === 'undefined') return;
    Charts.destroy('divtChart');
    const ctx = document.getElementById('divtChart');
    if (!ctx) return;
    const o = Charts.baseOptions();
    o.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label} : ${fmtNum(c.raw, 2)}` };
    o.scales.y.min = Math.max(-1, Math.floor((Math.min(...R.roll.map(p => p.corr), R.status.median) - 0.05) * 10) / 10);
    o.scales.y.max = 1;
    o.scales.y.ticks.callback = v => fmtNum(v, 1);
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    Charts.instances.divtChart = new Chart(ctx, {
      type: 'line',
      data: { labels: R.roll.map(p => fmtDate(p.date)), datasets: [
        { label: 'Corrélation moyenne (52 semaines)', data: R.roll.map(p => p.corr), borderColor: Charts.css('--accent'), backgroundColor: Charts.css('--accent'), borderWidth: 2, tension: 0.2, fill: false },
        { label: 'En temps normal (médiane)', data: R.roll.map(() => R.status.median), borderColor: Charts.css('--muted'), backgroundColor: Charts.css('--muted'), borderDash: [6, 4], borderWidth: 1.5, pointHoverRadius: 0, fill: false },
      ] },
      options: o,
    });
  },
});

App.on('view:shown', function (page) {
  if (page !== 'analysis/risque' || this._divtBound || !$('#divtRun')) return;
  this._divtBound = true;
  $('#divtRun').addEventListener('click', () => this.runDiversif());
});
