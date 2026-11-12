/* Module « Comparer » : performance relative, risque et corrélation de plusieurs valeurs */
'use strict';

const CMP_PRESETS = {
  'Indices': [
    { y: '^GSPC', name: 'S&P 500' }, { y: '^IXIC', name: 'Nasdaq Composite' }, { y: '^NDX', name: 'Nasdaq 100' },
    { y: '^DJI', name: 'Dow Jones' }, { y: '^RUT', name: 'Russell 2000' }, { y: '^FCHI', name: 'CAC 40' },
    { y: '^GDAXI', name: 'DAX' }, { y: '^STOXX50E', name: 'Euro Stoxx 50' }, { y: '^FTSE', name: 'FTSE 100' },
    { y: '^N225', name: 'Nikkei 225' }, { y: '^HSI', name: 'Hang Seng' },
    { y: 'URTH', name: 'MSCI World (ETF URTH)' }, { y: 'EEM', name: 'MSCI Emergents (ETF EEM)' },
  ],
  'Matières premières, devises & crypto': [
    { y: 'GC=F', name: 'Or' }, { y: 'SI=F', name: 'Argent' }, { y: 'BZ=F', name: 'Pétrole Brent' },
    { y: 'BTC-USD', name: 'Bitcoin' }, { y: 'ETH-USD', name: 'Ethereum' }, { y: 'EURUSD=X', name: 'EUR / USD' },
  ],
};

const CMP_PAIRS = [
  { label: 'Nasdaq vs S&P 500', series: ['^IXIC', '^GSPC'] },
  { label: 'Nasdaq 100 vs S&P 500', series: ['^NDX', '^GSPC'] },
  { label: 'CAC 40 vs DAX', series: ['^FCHI', '^GDAXI'] },
  { label: 'S&P 500 vs Euro Stoxx 50', series: ['^GSPC', '^STOXX50E'] },
  { label: 'USA vs Europe vs Japon', series: ['^GSPC', '^STOXX50E', '^N225'] },
  { label: 'Or vs Bitcoin', series: ['GC=F', 'BTC-USD'] },
];

const CMP_RANGES = { '1M': 31, '6M': 183, 'YTD': 0, '1A': 366, '3A': 1096, '5A': 1827, '10A': 3653, '20A': 7305 };

function cmpPresetName(y) {
  for (const list of Object.values(CMP_PRESETS)) { const p = list.find(x => x.y === y); if (p) return p.name; }
  return y;
}

Object.assign(App, {
  cmpToken: 0,
  cmpData: null,

  cmpState() {
    if (!Store.state.compare) {
      Store.state.compare = { series: [{ kind: 'y', ref: '^IXIC', name: 'Nasdaq Composite' }, { kind: 'y', ref: '^GSPC', name: 'S&P 500' }], range: '5A', start: '', mode: 'perf' };
    }
    return Store.state.compare;
  },

  bindCompare() {
    const c = this.cmpState();
    $('#cmpPairs').replaceChildren(...CMP_PAIRS.map(p => el('button', { class: 'btn small', onclick: () => {
      c.series = p.series.map(y => ({ kind: 'y', ref: y, name: cmpPresetName(y) }));
      Store.save(); this.renderCompareControls(); this.loadCompare();
    } }, p.label)),
    el('button', { class: 'btn small', id: 'cmpPfPair', onclick: () => {
      if (!Store.state.transactions.length) { toast('Ajoute d\'abord des opérations à ton portefeuille.'); return; }
      c.series = [{ kind: 'pf', ref: 'pf', name: 'Mon portefeuille' }, { kind: 'y', ref: 'URTH', name: 'MSCI World (ETF URTH)' }];
      const first = Store.state.transactions.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
      c.range = 'custom'; c.start = first;
      Store.save(); this.renderCompareControls(); this.loadCompare();
    } }, 'Mon portefeuille vs MSCI World'));

    $('#cmpAddBtn').addEventListener('click', () => {
      const v = $('#cmpAdd').value;
      if (!v) return;
      const [kind, ref] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
      const name = kind === 'y' ? cmpPresetName(ref) : kind === 'pf' ? 'Mon portefeuille' : Store.label(ref);
      this.cmpAddSeries({ kind, ref, name });
    });
    this.picker($('#cmpPicker'), {
      placeholder: 'Rechercher un ETF ou une action…', showKnown: false,
      onPick: key => this.cmpAddSeries({ kind: 'inst', ref: key, name: Store.label(key) }),
    });
    $$('#cmpRange button').forEach(b => b.addEventListener('click', () => {
      c.range = b.dataset.range; Store.save(); this.renderCompareControls(); this.loadCompare();
    }));
    $('#cmpStart').max = todayISO();
    $('#cmpStart').addEventListener('change', () => {
      if (!$('#cmpStart').value) return;
      c.range = 'custom'; c.start = $('#cmpStart').value; Store.save(); this.renderCompareControls(); this.loadCompare();
    });
    $$('#cmpMode button').forEach(b => b.addEventListener('click', () => {
      c.mode = b.dataset.mode; Store.save(); this.renderCompareControls(); this.drawCompare();
    }));
  },

  cmpAddSeries(s) {
    const c = this.cmpState();
    if (c.series.some(x => x.kind === s.kind && x.ref === s.ref)) { toast('Déjà dans la comparaison'); return; }
    if (c.series.length >= 5) { toast('5 valeurs maximum', 'error'); return; }
    c.series.push(s);
    Store.save();
    this.renderCompareControls();
    this.loadCompare();
  },

  cmpStartDate() {
    const c = this.cmpState();
    if (c.range === 'custom' && c.start) return c.start;
    if (c.range === 'YTD') return todayISO().slice(0, 4) + '-01-01';
    return addDaysISO(todayISO(), -(CMP_RANGES[c.range] || 1827));
  },

  renderCompareControls() {
    const c = this.cmpState();
    $('#cmpChips').replaceChildren(...c.series.map((s, i) => el('span', { class: 'cmp-chip', style: '--c:' + PALETTE[i % PALETTE.length] },
      el('span', { class: 'dot' }), s.name,
      i === 0 && c.series.length > 1 ? el('span', { class: 'muted small' }, ' (référence)') : null,
      el('button', { class: 'iconbtn', title: 'Retirer', onclick: () => { c.series.splice(i, 1); Store.save(); this.renderCompareControls(); this.loadCompare(); } }, '✕'),
      i > 0 ? el('button', { class: 'iconbtn', title: 'Utiliser comme référence', onclick: () => { c.series.unshift(c.series.splice(i, 1)[0]); Store.save(); this.renderCompareControls(); this.drawCompare(); } }, '⇤') : null)));

    const sel = $('#cmpAdd');
    const groups = Object.entries(CMP_PRESETS).map(([g, list]) => el('optgroup', { label: g }, ...list.map(p => el('option', { value: 'y:' + p.y }, p.name))));
    const mine = Object.keys(Store.state.instruments);
    if (mine.length) groups.push(el('optgroup', { label: 'Mes ETF' }, ...mine.map(k => el('option', { value: 'inst:' + k }, Store.label(k) + ' — ' + Store.code(k)))));
    if (Store.state.transactions.length) groups.push(el('optgroup', { label: 'Portefeuille' }, el('option', { value: 'pf:pf' }, 'Mon portefeuille (performance pondérée dans le temps)')));
    sel.replaceChildren(el('option', { value: '' }, 'Ajouter une valeur…'), ...groups);

    $$('#cmpRange button').forEach(b => b.classList.toggle('active', b.dataset.range === c.range));
    $('#cmpStart').value = c.range === 'custom' ? c.start : this.cmpStartDate();
    $$('#cmpMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === c.mode));
  },

  /** Série de performance du portefeuille réel (TWR : neutralise l'effet des versements) */
  async cmpPortfolioSeries(start) {
    const txs = Portfolio.txs();
    const first = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
    const keys = Array.from(new Set(txs.map(t => t.key)));
    const series = {}, fx = {};
    for (const k of keys) {
      series[k] = await Api.daily(k, first);
      fx[k] = await Api.fxSeries((Store.instrument(k) || {}).currency, first);
    }
    const { points } = Portfolio.replay(series, fx, Portfolio.historyEvents(txs));
    const out = Portfolio.twr(points);
    return out.filter(v => v[0] >= start);
  },

  async loadCompare() {
    const c = this.cmpState();
    const token = ++this.cmpToken;
    const start = this.cmpStartDate();
    if (c.series.length === 0) { this.cmpData = null; this.drawCompare(); return; }
    $('#cmpStatus').textContent = 'Chargement…';
    const loaded = [];
    const errors = [];
    for (const s of c.series) {
      try {
        let values;
        if (s.kind === 'y') {
          if (!Api.hasProxy()) throw new Error('relais Yahoo requis pour les indices (Réglages)');
          values = await Api.daily('Y:' + s.ref, start);
        } else if (s.kind === 'pf') values = await this.cmpPortfolioSeries(start);
        else values = await Api.daily(s.ref, start);
        if (values.length < 2) throw new Error('pas assez de données');
        loaded.push({ s, values });
      } catch (e) { errors.push(s.name + ' : ' + e.message); }
      if (token !== this.cmpToken) return;
    }
    this.cmpData = { loaded, start, errors };
    $('#cmpStatus').textContent = '';
    if (errors.length) toast(errors.join(' · '), 'error', 8000);
    this.drawCompare();
  },

  /** Statistiques d'une série [[date, valeur], …] */
  cmpStats(values) {
    const first = values[0], last = values[values.length - 1];
    const perf = last[1] / first[1] - 1;
    const years = (Date.parse(last[0]) - Date.parse(first[0])) / (365.25 * 864e5);
    const rets = [];
    let best = { r: -Infinity }, worst = { r: Infinity }, peak = -Infinity, mdd = 0;
    for (let i = 0; i < values.length; i++) {
      peak = Math.max(peak, values[i][1]);
      mdd = Math.min(mdd, values[i][1] / peak - 1);
      if (i === 0) continue;
      const r = values[i][1] / values[i - 1][1] - 1;
      rets.push(r);
      if (r > best.r) best = { r, d: values[i][0] };
      if (r < worst.r) worst = { r, d: values[i][0] };
    }
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    const ppy = years > 0.08 ? rets.length / years : 252;
    const cagr = years >= 0.95 ? Math.pow(1 + perf, 1 / years) - 1 : NaN;
    const vol = sd * Math.sqrt(ppy);
    return { first, last, perf, years, cagr, vol, mdd, best, worst, ratio: isFinite(cagr) && vol > 0 ? cagr / vol : NaN };
  },

  /** Corrélation et bêta des rendements quotidiens, sur les dates communes */
  cmpCorr(a, b) {
    const mb = new Map(b);
    const common = a.filter(v => mb.has(v[0]));
    const ra = [], rb = [];
    for (let i = 1; i < common.length; i++) {
      ra.push(common[i][1] / common[i - 1][1] - 1);
      rb.push(mb.get(common[i][0]) / mb.get(common[i - 1][0]) - 1);
    }
    const n = ra.length;
    if (n < 10) return { corr: NaN, beta: NaN };
    const ma = ra.reduce((x, y) => x + y, 0) / n, mbb = rb.reduce((x, y) => x + y, 0) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { cov += (ra[i] - ma) * (rb[i] - mbb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mbb) ** 2; }
    return { corr: cov / Math.sqrt(va * vb), beta: cov / vb };
  },

  drawCompare() {
    const c = this.cmpState();
    const d = this.cmpData;
    const tbl = $('#cmpStats');
    if (!d || !d.loaded.length) {
      Charts.destroy('cmpChart'); Charts.destroy('cmpRelChart');
      tbl.replaceChildren(el('p', { class: 'empty' }, 'Ajoute au moins une valeur à comparer.'));
      $('#cmpCorr').replaceChildren(); $('#cmpNote').textContent = '';
      return;
    }
    // ordre de c.series (la référence peut avoir changé)
    const order = c.series.map(s => d.loaded.find(l => l.s.kind === s.kind && l.s.ref === s.ref)).filter(Boolean);
    const commonStart = order.reduce((m, l) => (l.values[0][0] > m ? l.values[0][0] : m), d.start);
    const late = order.filter(l => l.values[0][0] > addDaysISO(d.start, 7));
    const series = order.map(l => ({ s: l.s, values: l.values.filter(v => v[0] >= commonStart) })).filter(l => l.values.length > 1);
    if (!series.length) return;

    // alignement sur l'union des dates, avec report de la dernière valeur connue
    const dates = Array.from(new Set(series.flatMap(l => l.values.map(v => v[0])))).sort();
    const aligned = series.map(l => {
      const m = new Map(l.values);
      let lastV = l.values[0][1];
      return dates.map(dt => (m.has(dt) ? (lastV = m.get(dt)) : lastV));
    });
    const bases = aligned.map(a => a[0]);
    const mode = c.mode;
    const datasets = aligned.map((a, i) => {
      let peak = -Infinity;
      const data = a.map(v => {
        if (mode === 'base100') return (v / bases[i]) * 100;
        if (mode === 'dd') { peak = Math.max(peak, v); return (v / peak - 1) * 100; }
        return (v / bases[i] - 1) * 100;
      });
      return { label: series[i].s.name, data, color: PALETTE[c.series.findIndex(s => s.kind === series[i].s.kind && s.ref === series[i].s.ref) % PALETTE.length] };
    });
    const labels = dates.map(fmtDate);
    const yFmt = mode === 'base100' ? v => fmtNum(v, 0) : v => fmtNum(v, 0) + ' %';
    const tipFmt = mode === 'base100' ? v => fmtNum(v, 2) : v => fmtPct(v);
    this.cmpLineChart('cmpChart', labels, datasets, yFmt, tipFmt, mode === 'base100' ? 100 : 0);

    // surperformance relative à la référence
    const relBox = $('#cmpRelBox');
    if (series.length > 1) {
      relBox.classList.remove('hidden');
      const ref = aligned[0];
      const rel = aligned.slice(1).map((a, j) => ({
        label: `${series[j + 1].s.name} vs ${series[0].s.name}`,
        data: a.map((v, k) => ((v / bases[j + 1]) / (ref[k] / bases[0]) - 1) * 100),
        color: datasets[j + 1].color,
      }));
      $('#cmpRelTitle').textContent = `Écart de performance par rapport à ${series[0].s.name}`;
      this.cmpLineChart('cmpRelChart', labels, rel, v => fmtNum(v, 0) + ' %', v => fmtPct(v), 0, true);
    } else { relBox.classList.add('hidden'); Charts.destroy('cmpRelChart'); }

    // statistiques
    const stats = series.map(l => Object.assign({ s: l.s }, this.cmpStats(l.values)));
    const ref = series[0];
    const head = ['Valeur', 'Dernier', 'Performance', 'Annualisée', 'Volatilité', 'Pire baisse', 'Meilleur jour', 'Pire jour', '1 000 deviennent', 'Rendement / risque', 'Bêta vs réf.'];
    tbl.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ...head.map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
      el('tbody', {}, ...stats.map((st, i) => {
        const cr = i > 0 ? this.cmpCorr(series[i].values, ref.values) : null;
        return el('tr', {},
          el('td', {}, el('span', { class: 'dot', style: `display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:${datasets[i].color}` }), el('span', { class: 'sym' }, st.s.name)),
          el('td', { class: 'num' }, st.s.kind === 'pf' ? '—' : fmtNum(st.last[1], 2)),
          el('td', { class: 'num ' + trendClass(st.perf) }, fmtPct(st.perf * 100)),
          el('td', { class: 'num ' + trendClass(st.cagr) }, isFinite(st.cagr) ? fmtPct(st.cagr * 100) + '/an' : '—'),
          el('td', { class: 'num' }, fmtPct(st.vol * 100, 1, false)),
          el('td', { class: 'num down' }, fmtPct(st.mdd * 100, 1)),
          el('td', { class: 'num up', title: fmtDate(st.best.d) }, fmtPct(st.best.r * 100), el('div', { class: 'muted small' }, fmtDate(st.best.d))),
          el('td', { class: 'num down', title: fmtDate(st.worst.d) }, fmtPct(st.worst.r * 100), el('div', { class: 'muted small' }, fmtDate(st.worst.d))),
          el('td', { class: 'num' }, fmtNum(1000 * (1 + st.perf), 0)),
          el('td', { class: 'num' }, fmtNum(st.ratio, 2)),
          el('td', { class: 'num' }, cr ? fmtNum(cr.beta, 2) : el('span', { class: 'muted' }, 'réf.')));
      })))));

    // matrice de corrélation
    if (series.length > 1) {
      $('#cmpCorr').replaceChildren(el('h3', {}, 'Corrélation des variations quotidiennes'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data corr' },
          el('thead', {}, el('tr', {}, el('th'), ...series.map(l => el('th', { class: 'num' }, l.s.name)))),
          el('tbody', {}, ...series.map((a, i) => el('tr', {}, el('td', { class: 'sym' }, a.s.name), ...series.map((b, j) => {
            const v = i === j ? 1 : this.cmpCorr(a.values, b.values).corr;
            return el('td', { class: 'num corr-cell', style: `--a:${isFinite(v) ? Math.abs(v) : 0}` }, fmtNum(v, 2));
          })))))),
        noteTip('1 = évoluent exactement ensemble · 0 = aucun lien · négatif = évoluent en sens inverse. Une faible corrélation améliore la diversification.', 'Comment lire ce tableau'));
    } else $('#cmpCorr').replaceChildren();

    const notes = [];
    if (late.length) notes.push(`Comparaison à partir du ${fmtDate(commonStart)} : ${late.map(l => l.s.name).join(', ')} n'a pas de données avant.`);
    notes.push('Indices cotés en points, sans dividendes (sauf ETF et portefeuille) et chacun dans sa devise : l\'effet de change n\'est pas pris en compte.');
    if (series.some(l => l.s.kind === 'pf')) notes.push('« Mon portefeuille » est mesuré en performance pondérée dans le temps (TWR) : tes versements ne gonflent pas la courbe.');
    $('#cmpNote').innerHTML = notes.map(n => '• ' + n.replace(/</g, '&lt;')).join('<br>');
  },

  cmpLineChart(id, labels, datasets, yFmt, tipFmt, refLine, fillRel) {
    Charts.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx || typeof Chart === 'undefined') return;
    const o = Charts.baseOptions();
    o.plugins.tooltip.callbacks = { label: x => ` ${x.dataset.label} : ${tipFmt(x.raw)}` };
    o.plugins.legend.display = datasets.length > 1;
    o.scales.y.ticks.callback = yFmt;
    o.scales.y.grid.color = c => (c.tick && Math.abs(c.tick.value - refLine) < 1e-9 ? Charts.css('--muted') : Charts.css('--chart-grid'));
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    Charts.instances[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map(dset => ({
          label: dset.label, data: dset.data, borderColor: dset.color, backgroundColor: dset.color + '22',
          borderWidth: 2, tension: 0.1, fill: fillRel ? { target: { value: 0 } } : false,
        })),
      },
      options: o,
    });
  },

  showCompare() {
    this.renderCompareControls();
    if (!this.cmpData) this.loadCompare(); else this.drawCompare();
  },
});
