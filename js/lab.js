/*
 * Laboratoire de stratégies : le même argent investi de quatre façons, rejoué sur l'historique réel des ETF.
 * - Versements mensuels (DCA) : chaque mois, le versement est réparti selon la cible.
 * - Tout au début : la somme totale des versements est investie dès le premier jour.
 * - Mensuel + rééquilibrage : comme le DCA, et chaque année le portefeuille est remis à la cible.
 * - Attendre les baisses : l'argent s'accumule et n'est investi que quand le marché est à 10 % sous son plus
 *   haut d'un an (ou au bout de 12 mois d'attente).
 * Frais et impôts ignorés : c'est une comparaison de méthodes, pas une promesse de résultat.
 */
'use strict';

const LAB_STRATS = {
  dca: { name: 'Versements mensuels', color: '#10b981' },
  lump: { name: 'Tout au début', color: '#6366f1' },
  rebal: { name: 'Mensuel + rééquilibrage annuel', color: '#f59e0b' },
  dip: { name: 'Attendre les baisses', color: '#ec4899' },
};

/* Indice suivi par zone (symbole Yahoo, devise, nom) : historique plus long que celui de l'ETF */
const LAB_PROXY = {
  world: ['^990100-USD-STRD', 'USD', 'MSCI World'],
  allworld: ['ACWI', 'USD', 'MSCI ACWI (ETF iShares)'],
  sp500: ['^GSPC', 'USD', 'S&P 500'],
  ndx: ['^NDX', 'USD', 'Nasdaq-100'],
  em: ['EEM', 'USD', 'MSCI Emerging Markets (ETF iShares)'],
  europe: ['^STOXX', 'EUR', 'Stoxx Europe 600'],
  es50: ['^STOXX50E', 'EUR', 'Euro Stoxx 50'],
  cac: ['^FCHI', 'EUR', 'CAC 40'],
  japan: ['EWJ', 'USD', 'MSCI Japan (ETF iShares)'],
  gold: ['GC=F', 'USD', 'Or (contrat à terme)'],
};

const Lab = {
  /**
   * Prolonge la série d'un ETF avant son lancement avec celle de son indice : les points antérieurs de
   * l'indice sont recalés pour coïncider avec le premier cours de l'ETF. Séries triées, même devise.
   */
  extend(series, proxy) {
    if (!series.length || !proxy.length || proxy[0][0] >= series[0][0]) return series;
    const at = this.priceAt(proxy, series[0][0]);
    if (!(at > 0)) return series;
    const ratio = series[0][1] / at;
    return proxy.filter(p => p[0] < series[0][0]).map(([d, v]) => [d, v * ratio]).concat(series);
  },

  /** Cours à une date (dernier connu à cette date ou avant) ; `s` trié par date */
  priceAt(s, d) {
    let lo = 0, hi = s.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid][0] <= d) { best = s[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  },

  /** Premier jour de cotation (commun) de chaque mois entre `start` et la fin des séries */
  months(prices, start) {
    const keys = Object.keys(prices);
    const first = Math.max(...keys.map(k => Date.parse(prices[k][0][0])));
    const from = new Date(Math.max(first, Date.parse(start))).toISOString().slice(0, 10);
    const ref = prices[keys[0]];
    const out = [];
    let lastMonth = '';
    for (const [d] of ref) {
      if (d < from) continue;
      const m = d.slice(0, 7);
      if (m !== lastMonth && keys.every(k => this.priceAt(prices[k], d) !== null)) { out.push(d); lastMonth = m; }
    }
    return out;
  },

  /**
   * Rejoue les quatre stratégies. `weights` : { clé: poids } (somme 1) ; `monthly`, `initial` en devise de base.
   * Renvoie { dates, invested: [...], strategies: { id: { values, final, gain, maxDrawdown } } }.
   */
  run(prices, weights, { monthly = 300, initial = 0, start } = {}) {
    const keys = Object.keys(weights).filter(k => prices[k] && prices[k].length && weights[k] > 0);
    const dates = this.months(prices, start || prices[keys[0]][0][0]);
    if (dates.length < 2) return null;
    const total = initial + monthly * dates.length;
    const px = d => Object.fromEntries(keys.map(k => [k, this.priceAt(prices[k], d)]));
    const value = (u, p, cash = 0) => keys.reduce((s, k) => s + u[k] * p[k], cash);
    const buy = (u, amount, p) => { for (const k of keys) u[k] += amount * weights[k] / p[k]; };
    const toTarget = (u, p) => { const v = value(u, p); for (const k of keys) u[k] = v * weights[k] / p[k]; };
    // indice pondéré des cours, pour repérer les baisses (plus haut glissant sur un an)
    const idx = d => { const p = px(d); return keys.reduce((s, k) => s + weights[k] * p[k] / prices[k][0][1], 0); };
    const st = { dca: { u: {}, cash: 0 }, lump: { u: {}, cash: 0 }, rebal: { u: {}, cash: 0 }, dip: { u: {}, cash: 0, wait: 0 } };
    for (const s of Object.values(st)) for (const k of keys) s.u[k] = 0;
    const values = { dca: [], lump: [], rebal: [], dip: [] };
    const invested = [];
    const highs = [];
    dates.forEach((d, i) => {
      const p = px(d);
      const add = (i === 0 ? initial : 0) + monthly;
      if (i === 0) buy(st.lump.u, total, p);
      buy(st.dca.u, add, p);
      buy(st.rebal.u, add, p);
      if (i > 0 && d.slice(5, 7) === dates[0].slice(5, 7)) toTarget(st.rebal.u, p); // une fois par an
      // attendre une baisse de 10 % sous le plus haut des 12 derniers mois (au plus 12 mois d'attente)
      const ix = idx(d);
      highs.push(ix);
      const high = Math.max(...highs.slice(-12));
      st.dip.cash += add; st.dip.wait++;
      if (ix <= high * 0.9 || st.dip.wait >= 12 || i === dates.length - 1) { buy(st.dip.u, st.dip.cash, p); st.dip.cash = 0; st.dip.wait = 0; }
      for (const id of Object.keys(values)) values[id].push(value(st[id].u, p, st[id].cash));
      invested.push(initial + monthly * (i + 1));
    });
    const strategies = {};
    for (const [id, v] of Object.entries(values)) {
      let peak = 0, mdd = 0;
      for (const x of v) { peak = Math.max(peak, x); if (peak > 0) mdd = Math.min(mdd, x / peak - 1); }
      const final = v[v.length - 1];
      strategies[id] = { values: v, final, gain: final - total, maxDrawdown: mdd * 100 };
    }
    return { dates, invested, total, strategies };
  },
};

Object.assign(App, {
  /** Lignes et poids du laboratoire : la cible si elle fait 100 %, sinon le portefeuille actuel */
  labLines() {
    const tgt = Object.entries(Store.state.targets || {}).filter(([k, v]) => parseNum(v) > 0 && Store.instrument(k) && !Manual.is(k));
    const tsum = tgt.reduce((s, [, v]) => s + parseNum(v), 0);
    if (tgt.length && Math.abs(tsum - 100) < 0.5) return { source: 'ta répartition cible', w: Object.fromEntries(tgt.map(([k, v]) => [k, parseNum(v) / tsum])) };
    const rows = Portfolio.snapshot('all').rows.filter(r => !Manual.is(r.key) && isFinite(r.valueBase) && r.valueBase > 0);
    const t = rows.reduce((s, r) => s + r.valueBase, 0);
    return t > 0 ? { source: 'ton portefeuille actuel', w: Object.fromEntries(rows.map(r => [r.key, r.valueBase / t])) } : null;
  },

  bindLab() {
    if (!$('#labRun')) return;
    const plans = (Store.state.plans || []).filter(p => p.active !== false).reduce((s, p) => s + (parseNum(p.amount) || 0), 0);
    $('#labMonthly').value = plans || 300;
    $('#labRun').addEventListener('click', () => this.runLab());
  },

  async runLab() {
    const box = $('#labBody'), btn = $('#labRun');
    const lines = this.labLines();
    if (!lines) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des lignes ou une allocation cible pour lancer la comparaison.')); return; }
    const years = parseNum($('#labYears').value) || 5;
    const monthly = Math.max(0, parseNum($('#labMonthly').value) || 0);
    if (!(monthly > 0)) { toast('Indique un versement mensuel', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Calcul…';
    try {
      const start = addMonthsISO(todayISO(), -12 * years);
      const extend = $('#labExtend') ? $('#labExtend').checked : true;
      const prices = {}, extended = [], firsts = {};
      const inBase = async (series, ccy) => { const fx = await Api.fxSeries(ccy, start); return series.map(([d, v]) => [d, v * (fx(d) || 1)]); };
      for (const k of Object.keys(lines.w)) {
        const inst = Store.instrument(k);
        let s = await inBase(await Api.daily(k, start), inst.currency); // au taux de change de chaque jour
        firsts[k] = s.length ? s[0][0] : todayISO();
        // ETF lancé après le début de la période : avant son lancement, on suit l'indice qu'il réplique
        const proxy = LAB_PROXY[Expo.of(k).profile];
        if (extend && proxy && s.length && s[0][0] > addDaysISO(start, 40)) {
          try {
            const p = await inBase(await Api.daily('Y:' + proxy[0], start), proxy[1]);
            const longer = Lab.extend(s, p);
            if (longer.length > s.length) { extended.push({ key: k, since: s[0][0], index: proxy[2] }); s = longer; }
          } catch (e) { /* indice indisponible : la période sera raccourcie */ }
        }
        prices[k] = s;
      }
      const res = Lab.run(prices, lines.w, { monthly, start });
      if (!res || res.dates.length < 12) throw new Error('Pas assez d\'historique commun pour ces lignes (au moins un an).');
      // période raccourcie malgré tout : quelle ligne la limite ?
      let limit = null;
      if (res.dates[0] > addDaysISO(start, 45)) {
        const k = Object.keys(prices).reduce((a, b) => (prices[b][0][0] > prices[a][0][0] ? b : a));
        limit = { key: k, since: prices[k][0][0] };
      }
      this.labResult = Object.assign(res, { source: lines.source, keys: Object.keys(lines.w), monthly, years, extended, limit });
      this.renderLab();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted' }, e.message));
    } finally {
      btn.disabled = false; btn.textContent = 'Comparer';
    }
  },

  renderLab() {
    const r = this.labResult, box = $('#labBody');
    if (!r || !box) return;
    const cur = this.base();
    const ranked = Object.entries(r.strategies).sort((a, b) => b[1].final - a[1].final);
    const best = ranked[0][0];
    const s = r.strategies;
    const lessons = [
      s.lump.final > s.dca.final
        ? `Investir tout au début a rapporté ${fmtMoney(s.lump.final - s.dca.final, cur, 0)} de plus que les versements mensuels : sur un marché qui monte, l'argent placé tôt travaille plus longtemps. En échange, la pire baisse a été plus brutale (${fmtPct(s.lump.maxDrawdown, 0)}).`
        : `Les versements mensuels ont fait mieux que tout investir au début (+${fmtMoney(s.dca.final - s.lump.final, cur, 0)}) : la période a connu une baisse après le départ, et étaler les achats a permis d'acheter moins cher.`,
      s.dip.final < s.dca.final
        ? `Attendre les baisses a rapporté ${fmtMoney(s.dca.final - s.dip.final, cur, 0)} de moins que d'investir chaque mois : l'argent qui attend ne rapporte rien, et les baisses attendues arrivent rarement au bon moment.`
        : `Attendre les baisses a fonctionné ici (+${fmtMoney(s.dip.final - s.dca.final, cur, 0)}) : la période a offert des replis nets au bon moment. C'est rarement reproductible.`,
      r.keys.length < 2 ? null : Math.abs(s.rebal.final - s.dca.final) < r.total * 0.005
        ? 'Le rééquilibrage annuel n\'a presque rien changé ici : tes lignes ont évolué de façon proche. Il sert surtout quand l\'une d\'elles s\'envole ou chute, pour garder le niveau de risque choisi.'
        : `Le rééquilibrage annuel a ${s.rebal.final >= s.dca.final ? 'ajouté' : 'coûté'} ${fmtMoney(Math.abs(s.rebal.final - s.dca.final), cur, 0)} : son intérêt est surtout de garder le niveau de risque choisi (pire baisse ${fmtPct(s.rebal.maxDrawdown, 0)} contre ${fmtPct(s.dca.maxDrawdown, 0)}).`,
    ].filter(Boolean);
    box.replaceChildren(...[
      el('p', { class: 'muted small lab-src' }, `${fmtMoney(r.total, cur, 0)} investis au total (${fmtMoney(r.monthly, cur, 0)}/mois) sur ${r.dates.length} mois, du ${fmtDate(r.dates[0])} au ${fmtDate(r.dates[r.dates.length - 1])}, avec ${r.source}. « Tout au début » place ces ${fmtMoney(r.total, cur, 0)} dès le premier jour.`),
      r.limit ? el('p', { class: 'lab-warn small' }, `⚠ Période limitée à ${fmtSpan(r.dates[0], r.dates[r.dates.length - 1])} au lieu de ${r.years} ans : ${Store.label(r.limit.key)} n'a pas de cours avant le ${fmtDate(r.limit.since)}` + (r.extended.length || !$('#labExtend') || $('#labExtend').checked ? '.' : '. Coche « Prolonger avec l\'indice suivi » pour remonter plus loin.')) : null,
      r.extended.length ? el('p', { class: 'muted small' }, 'Historique prolongé avec l\'indice suivi : ' + r.extended.map(x => `${Store.label(x.key)} avant le ${fmtDate(x.since)} (${x.index})`).join(' · ') + '.',
        infoTip('Avant le lancement d\'un ETF, on suit l\'indice qu\'il réplique, recalé sur son premier cours et converti en euros au taux de chaque jour. Les indices de prix ne comptent pas les dividendes : cette partie est un peu sous-estimée, et ne tient pas compte des frais de l\'ETF.')) : null,
      el('div', { class: 'chart-box lab-chart' }, el('canvas', { id: 'labChart' })),
      el('ol', { class: 'lab-rank' }, ...ranked.map(([id, x], i) => el('li', { class: id === best ? 'best' : '' },
        el('span', { class: 'lab-dot', style: 'background:' + LAB_STRATS[id].color }),
        el('b', {}, LAB_STRATS[id].name),
        el('span', { class: 'mono' }, fmtMoney(x.final, cur, 0)),
        el('span', { class: 'mono small ' + trendClass(x.gain) }, fmtSignedMoney(x.gain, cur)),
        el('span', { class: 'muted small' }, 'pire baisse ' + fmtPct(x.maxDrawdown, 0)),
        i === 0 ? el('span', { class: 'chip up' }, 'gagnante') : null))),
      el('ul', { class: 'lab-lessons' }, ...lessons.map(t => el('li', {}, t))),
      noteTip('Cours de clôture réels du premier jour de cotation de chaque mois, convertis au taux de change de chaque jour. Frais, impôts et dividendes non réinvestis ignorés. « Attendre les baisses » : l\'argent s\'accumule et n\'est investi que quand l\'indice pondéré est à 10 % sous son plus haut des 12 derniers mois, ou après 12 mois d\'attente. Les résultats dépendent beaucoup de la période : un éclairage, pas une prédiction.', 'Méthode et limites')].filter(Boolean));
    if (typeof Chart === 'undefined') return;
    Charts.destroy('labChart');
    const o = Charts.baseOptions();
    o.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label} : ${fmtMoney(c.raw, cur, 0)}` };
    o.scales.y.ticks.callback = v => fmtMoney(v, cur, 0);
    o.elements = { point: { radius: 0, hoverRadius: 4 } };
    Charts.instances.labChart = new Chart(document.getElementById('labChart'), {
      type: 'line',
      data: {
        labels: r.dates.map(d => fmtDate(d)),
        datasets: [
          ...Object.entries(r.strategies).map(([id, x]) => ({ label: LAB_STRATS[id].name, data: x.values, borderColor: LAB_STRATS[id].color, borderWidth: id === best ? 2.5 : 1.5, tension: 0.15, fill: false })),
          { label: 'Argent versé', data: r.invested, borderColor: Charts.css('--muted'), borderDash: [5, 4], borderWidth: 1.2, fill: false, stepped: 'before' },
        ],
      },
      options: o,
    });
  },
});
