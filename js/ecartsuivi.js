/*
 * Écart de suivi réel d'un ETF (fiche d'un ETF, comparateur d'ETF) : ce que l'ETF a vraiment rapporté, dividendes
 * réinvestis, face à l'indice qu'il suit, année par année. Un ETF à 0,38 % de frais peut faire mieux que son indice
 * (prêt de titres, swap, fiscalité des dividendes) ou moins bien que ses frais ne le laissent croire.
 * Indice de référence : S&P 500 dividendes réinvestis (^SP500TR) quand il existe chez Yahoo ; sinon l'ETF américain
 * de référence du même indice (URTH, QQQ, EEM…), dividendes réinvestis et frais rajoutés, ce qui reconstitue l'indice.
 * Tout est converti dans ta devise de référence au taux de change de chaque jour (le change s'annule dans l'écart).
 * Nom du fichier choisi pour ne pas être bloqué par les listes anti-pisteurs (« tracking.js »).
 * Calculs purs (objet TrackDiff) testés dans tests/ecartsuivi.test.mjs ; affichage en bas du fichier.
 */
'use strict';

/*
 * Référence par profil d'indice : symbole Yahoo, devise, dividendes à réinvestir, et ajustement annuel (en points)
 * pour approcher l'indice « dividendes nets » que suivent les ETF européens :
 * - ETF américain : + ses frais, − l'avantage fiscal d'un fonds américain sur les dividendes des sociétés américaines
 *   (l'indice net retient 30 % de retenue à la source ; ≈ 0,3 % du rendement du dividende × part des États-Unis) ;
 * - indice brut (^SP500TR) : − la retenue de 30 % sur un dividende d'environ 1,2 %.
 */
const TD_REF = {
  sp500: { sym: '^SP500TR', ccy: 'USD', divs: false, adj: -0.35, label: 'S&P 500 dividendes nets réinvestis, estimé d\'après l\'indice brut (^SP500TR)' },
  world: { sym: 'URTH', ccy: 'USD', divs: true, adj: 0, label: 'MSCI World dividendes nets, reconstitué d\'après l\'ETF américain URTH (frais 0,24 % rajoutés, avantage fiscal américain retranché)' },
  allworld: { sym: 'ACWI', ccy: 'USD', divs: true, adj: 0.1, label: 'MSCI ACWI dividendes nets, reconstitué d\'après l\'ETF américain ACWI (frais 0,32 % rajoutés, avantage fiscal américain retranché)' },
  ndx: { sym: 'QQQ', ccy: 'USD', divs: true, adj: 0, label: 'Nasdaq-100 dividendes nets, reconstitué d\'après l\'ETF américain QQQ (frais 0,20 % rajoutés, avantage fiscal américain retranché)' },
  em: { sym: 'EEM', ccy: 'USD', divs: true, adj: 0.7, label: 'MSCI Emerging Markets, reconstitué d\'après l\'ETF américain EEM (frais 0,70 % rajoutés)' },
  europe: { sym: 'IMAE.AS', ccy: 'EUR', divs: false, adj: 0.12, label: 'MSCI Europe dividendes nets, reconstitué d\'après l\'ETF iShares IMAE (frais 0,12 % rajoutés)' },
  es50: { sym: 'FEZ', ccy: 'USD', divs: true, adj: 0.29, label: 'Euro Stoxx 50, reconstitué d\'après l\'ETF américain FEZ (frais 0,29 % rajoutés)' },
  japan: { sym: 'EWJ', ccy: 'USD', divs: true, adj: 0.5, label: 'MSCI Japan, reconstitué d\'après l\'ETF américain EWJ (frais 0,50 % rajoutés)' },
};
const TD_STORE = 'apistock:tdiff';

const TrackDiff = {
  /** Indice de performance dividendes réinvestis : chaque dividende est réinvesti au cours de clôture de sa date de détachement */
  totalReturn(prices, divs = []) {
    if (!prices.length) return [];
    const byDate = new Map();
    for (const d of divs) byDate.set(d.date, (byDate.get(d.date) || 0) + d.amount);
    const dates = Array.from(byDate.keys()).sort();
    const out = [[prices[0][0], 100]];
    let j = 0;
    while (j < dates.length && dates[j] <= prices[0][0]) j++;
    for (let i = 1; i < prices.length; i++) {
      const [d, p] = prices[i], prev = prices[i - 1][1];
      let div = 0;
      while (j < dates.length && dates[j] <= d) div += byDate.get(dates[j++]);
      out.push([d, out[i - 1][1] * (p + div) / prev]);
    }
    return out;
  },

  /** Ajoute (ou retire) un rendement annuel en points, au jour le jour : reconstitue l'indice à partir d'un ETF qui le suit */
  grossUp(series, ter) {
    if (!ter || !series.length) return series;
    const t0 = Date.parse(series[0][0]);
    return series.map(([d, v]) => [d, v * Math.pow(1 + ter / 100, (Date.parse(d) - t0) / (365.25 * 864e5))]);
  },

  /** Conversion dans la devise de base : fx(date) → taux */
  convert(series, fx) { return fx ? series.map(([d, v]) => [d, v * (fx(d) || 1)]) : series; },

  /**
   * Pente annualisée (fraction par an) du logarithme du rapport a/b sur une liste de points [date, a, b], par
   * moindres carrés, et son erreur type. Plus robuste que « fin contre début » : les cotations européennes et
   * américaines ne ferment pas à la même heure, ce qui fausse chaque point pris isolément.
   */
  slope(points) {
    const n = points.length;
    if (n < 20) return { rate: NaN, se: NaN };
    const t0 = Date.parse(points[0][0]);
    const xs = points.map(p => (Date.parse(p[0]) - t0) / (365.25 * 864e5)), ys = points.map(p => Math.log(p[1] / p[2]));
    const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    if (!(sxx > 0)) return { rate: NaN, se: NaN };
    const b = sxy / sxx;
    let ssr = 0;
    for (let i = 0; i < n; i++) ssr += (ys[i] - my - b * (xs[i] - mx)) ** 2;
    return { rate: Math.exp(b) - 1, se: Math.sqrt(ssr / (n - 2) / sxx) };
  },

  /** Dates communes aux deux séries : [[date, a, b]] */
  common(a, b) {
    const mb = new Map(b);
    return a.filter(([d, v]) => mb.has(d) && v > 0 && mb.get(d) > 0).map(([d, v]) => [d, v, mb.get(d)]);
  },

  /**
   * Année par année : performance de chaque série (de la dernière clôture commune de l'année précédente à la
   * dernière de l'année) et écart lissé (pente du rapport a/b sur l'année, annualisée). Une année est complète si elle
   * démarre d'une clôture de l'année précédente (ou au plus tard le 7 janvier) et finit après le 20 décembre.
   */
  yearly(a, b) {
    const common = this.common(a, b);
    if (common.length < 2) return [];
    const years = Array.from(new Set(common.map(p => p[0].slice(0, 4)))).sort();
    const out = [];
    for (const y of years) {
      const before = common.filter(p => p[0] < y + '-01-01').pop();
      const inY = common.filter(p => p[0].startsWith(y));
      const pts = before ? [before, ...inY] : inY;
      const s = pts[0], e = pts[pts.length - 1];
      if (!s || !e || s[0] >= e[0]) continue;
      const ra = e[1] / s[1] - 1, rb = e[2] / s[2] - 1;
      out.push({ year: y, a: ra, b: rb, diff: this.slope(pts).rate, from: s[0], to: e[0], full: (!!before || s[0].slice(5) <= '01-07') && e[0].slice(5) >= '12-20' });
    }
    return out.filter(y => isFinite(y.diff));
  },

  /**
   * Synthèse : écart moyen sur les années complètes, écart lissé sur toute la période commune (avec sa marge
   * d'incertitude, deux erreurs types) et dates couvertes.
   */
  summary(a, b) {
    const years = this.yearly(a, b);
    const full = years.filter(y => y.full);
    const common = this.common(a, b);
    const all = this.slope(common);
    return { years, avg: full.length ? full.reduce((s, y) => s + y.diff, 0) / full.length : NaN, fullYears: full.length,
      ann: all.rate, margin: 2 * all.se, from: common.length ? common[0][0] : null, to: common.length ? common[common.length - 1][0] : null };
  },

  /** Verdict face aux frais affichés (TER, en %) : l'écart attendu est −TER */
  verdict(avg, ter) {
    if (!isFinite(avg)) return null;
    if (!isFinite(ter)) return { tone: '', key: 'unknown' };
    const hidden = avg * 100 + ter; // > 0 : fait mieux que ses frais
    return hidden >= 0.1 ? { tone: 'up', key: 'better', hidden } : hidden <= -0.15 ? { tone: 'down', key: 'worse', hidden } : { tone: '', key: 'inline', hidden };
  },
};

Object.assign(App, {
  /** Dividendes d'un symbole Yahoo brut (référence), gardés 12 h */
  async tdRefDivs(sym, start) {
    const ck = 'apistock:events:Y:' + sym;
    let c = null;
    try { c = JSON.parse(localStorage.getItem(ck) || 'null'); } catch (e) { c = null; }
    if (c && Date.now() - c.ts < 12 * 3600000 && c.from <= start) return c.divs;
    const json = await Api.yahoo({ type: 'chart', symbol: sym, interval: '1mo', events: 'div,split',
      period1: Math.floor(Date.parse(start + 'T00:00:00Z') / 1000), period2: Math.floor(Date.now() / 1000) + 86400 });
    const r = json.chart && json.chart.result && json.chart.result[0];
    const off = ((r && r.meta && r.meta.gmtoffset) || 0) * 1000;
    const divs = Object.values((r && r.events && r.events.dividends) || {}).map(d => ({ date: new Date(d.date * 1000 + off).toISOString().slice(0, 10), amount: d.amount }))
      .filter(d => d.amount > 0).sort((x, y) => (x.date < y.date ? -1 : 1));
    try { localStorage.setItem(ck, JSON.stringify({ ts: Date.now(), from: start, divs })); } catch (e) { /* stockage plein */ }
    return divs;
  },

  /** Écart de suivi d'un ETF (clé d'instrument) : { ref, ter, S } ou { reason } ; gardé 24 h */
  async trackingFor(key) {
    const k = Fundamentals.kindOf(key);
    if (!k || k.kind !== 'etf') return { reason: 'Écart de suivi mesuré pour les ETF seulement.' };
    const exp = Expo.of(key);
    const ref = TD_REF[exp.profile];
    if (!ref) return { reason: 'Pas d\'indice de référence connu pour cet ETF (indice suivi : ' + ((EXPO_PROFILES[exp.profile] || {}).label || 'non renseigné') + ').' };
    const inst = Store.instrument(key);
    if (yahooSymbolFor(inst) === ref.sym) return { reason: 'Cet ETF sert lui-même de référence pour son indice.' };
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(TD_STORE) || '{}') || {}; } catch (e) { cache = {}; }
    const ck = key + '|' + this.base();
    if (cache[ck] && Date.now() - cache[ck].ts < 24 * 3600000) return cache[ck].data;
    const start = (new Date().getUTCFullYear() - 6) + '-12-20';
    const [px, ev, fx, refPx, refFx] = await Promise.all([
      Api.daily(key, start), Api.events(key, start), Api.fxSeries(inst.currency || this.base(), start),
      Api.daily('Y:' + ref.sym, start), Api.fxSeries(ref.ccy, start)]);
    const refDivs = ref.divs ? await this.tdRefDivs(ref.sym, start) : [];
    const a = TrackDiff.convert(TrackDiff.totalReturn(px, ev.divs), fx);
    const b = TrackDiff.convert(TrackDiff.grossUp(TrackDiff.totalReturn(refPx, refDivs), ref.adj), refFx);
    const S = TrackDiff.summary(a, b);
    if (!S.years.length) return { reason: 'Pas assez d\'historique commun avec l\'indice de référence.' };
    const data = { ref: { sym: ref.sym, label: ref.label }, ter: exp.ter, S };
    cache[ck] = { ts: Date.now(), data };
    for (const [x, v] of Object.entries(cache)) if (Date.now() - v.ts > 7 * 864e5) delete cache[x];
    try { localStorage.setItem(TD_STORE, JSON.stringify(cache)); } catch (e) { /* stockage plein */ }
    return data;
  },

  /** Section « Écart de suivi » de la fiche d'un ETF (bouton, puis résultats) */
  renderDetailTracking(key) {
    const box = $('#detailTrack');
    if (!box) return;
    const k = key && Fundamentals.kindOf(key);
    if (!k || k.kind !== 'etf' || !TD_REF[Expo.of(key).profile] || !Api.hasProxy()) { box.replaceChildren(); return; }
    box.replaceChildren(el('section', { class: 'fund-panel td-panel' },
      el('h3', {}, 'Écart de suivi', infoTip('Ce que l\'ETF a vraiment rapporté, dividendes réinvestis, face à l\'indice qu\'il suit, année par année. L\'écart attendu est égal à ses frais ; mieux, l\'ETF gagne de l\'argent ailleurs (prêt de titres, swap, fiscalité des dividendes) ; moins bien, il coûte plus que ses frais affichés.')),
      el('div', { id: 'detailTrackBody' }, el('button', { class: 'btn small', type: 'button', id: 'tdRun', onclick: () => this.runDetailTracking(key) }, 'Mesurer l\'écart de suivi'))));
  },

  async runDetailTracking(key) {
    const body = $('#detailTrackBody');
    if (!body) return;
    body.replaceChildren(el('p', { class: 'muted small' }, 'Chargement de 6 ans de cours et de dividendes…'));
    let r;
    try { r = await this.trackingFor(key); } catch (e) { r = { reason: 'Données indisponibles pour l\'instant (' + (e.message || e) + ').' }; }
    if (this.detailKey !== key || !$('#detailTrackBody')) return;
    $('#detailTrackBody').replaceChildren(this.trackingPanel(key, r));
  },

  trackingPanel(key, r) {
    if (!r || r.reason) return el('p', { class: 'muted small' }, (r && r.reason) || 'Indisponible.');
    const S = r.S, pts = x => (isFinite(x) ? (x >= 0 ? '+' : '−') + fmtNum(Math.abs(x * 100), 2) + ' pt' : '—');
    const pct = x => (isFinite(x) ? fmtPct(x * 100, 1) : '—');
    const v = TrackDiff.verdict(S.avg, r.ter);
    const label = Store.label(key);
    const text = !v ? 'Pas encore d\'année complète en commun avec l\'indice : écart sur la période ci-dessous.'
      : v.key === 'better' ? `${label} fait mieux que ses frais : ${pts(S.avg)} par an face à l'indice pour ${fmtNum(r.ter, 2)} % de frais, soit environ ${fmtNum(v.hidden, 2)} point gagné ailleurs chaque année (prêt de titres, swap, fiscalité des dividendes).`
        : v.key === 'worse' ? `${label} coûte plus que ses frais affichés : ${pts(S.avg)} par an face à l'indice pour ${fmtNum(r.ter, 2)} % de frais, soit environ ${fmtNum(-v.hidden, 2)} point de coût caché par an.`
          : v.key === 'inline' ? `${label} suit son indice comme prévu : ${pts(S.avg)} par an, en ligne avec ses ${fmtNum(r.ter, 2)} % de frais.`
            : `Écart moyen : ${pts(S.avg)} par an face à l'indice (frais de l'ETF inconnus).`;
    return el('div', {},
      el('p', { class: 'etfcmp-verdict td-verdict ' + (v ? v.tone : '') }, text),
      el('div', { class: 'stats fund-stats' },
        this.fundTile('Écart moyen par an', isFinite(S.avg) ? pts(S.avg) : null, `Moyenne sur ${S.fullYears} année${S.fullYears > 1 ? 's' : ''} complète${S.fullYears > 1 ? 's' : ''} : performance de l'ETF moins celle de l'indice, dividendes réinvestis.`, trendClass(S.avg)),
        this.fundTile('Frais affichés', isFinite(r.ter) ? fmtNum(r.ter, 2) + ' %' : null, 'Frais courants (TER) : l\'écart attendu si l\'ETF suivait parfaitement son indice.'),
        this.fundTile('Écart annualisé', isFinite(S.ann) ? pts(S.ann) : null, `Sur toute la période commune, du ${fmtDate(S.from)} au ${fmtDate(S.to)}.`, trendClass(S.ann)),
        this.fundTile('Précision', isFinite(S.margin) ? '± ' + fmtNum(S.margin * 100, 2) + ' pt' : null, 'Marge d\'incertitude de l\'écart annualisé (deux erreurs types) : les cotations de l\'ETF et de l\'indice ne ferment pas à la même heure, ce qui ajoute du bruit au jour le jour.')),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table td-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Année'), el('th', { class: 'num' }, label), el('th', { class: 'num' }, 'Indice'), el('th', { class: 'num' }, el('span', {}, 'Écart', infoTip('Écart lissé : pente du rapport entre l\'ETF et l\'indice sur l\'année, par moindres carrés. Moins sensible aux heures de clôture différentes qu\'une simple différence des deux performances.'))))),
        el('tbody', {}, ...S.years.slice().reverse().map(y => el('tr', {},
          el('td', {}, y.year, y.full ? null : el('small', { class: 'muted' }, ' (partielle)')),
          el('td', { class: 'num mono ' + trendClass(y.a) }, pct(y.a)),
          el('td', { class: 'num mono ' + trendClass(y.b) }, pct(y.b)),
          el('td', { class: 'num mono ' + trendClass(y.diff) }, el('b', {}, pts(y.diff)))))))),
      noteTip(`Référence : ${r.ref.label}. Les deux séries sont converties en ${this.base()} au taux de chaque jour, dividendes réinvestis à leur date de détachement.`
        + ' Ordre de grandeur à ±0,2 point près : la reconstitution de l\'indice est approchée, et certains ETF suivent la version « brute » de l\'indice plutôt que la version nette. Un ETF couvert contre le change s\'écarte aussi du fait de la couverture.', 'Méthode et limites'));
  },
});

App.on('detail:selected', function (key) { this.renderDetailTracking(key); });
