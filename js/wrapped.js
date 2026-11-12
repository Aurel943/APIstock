/*
 * « Ton année en bourse » : récapitulatif animé de l'année, écran par écran (performance, argent investi,
 * ligne star, meilleur et pire mois, dividendes et frais, comparaison au marché mondial).
 */
'use strict';

const Wrapped = {
  /** Année proposée : l'année en cours à partir de décembre, l'année précédente en janvier */
  defaultYear(today = todayISO()) {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    return m === 1 ? y - 1 : y;
  },

  /**
   * Chiffres de l'année `year` (devise de base).
   * `points` : historique du portefeuille [{ date, invested, value }] ; `prices` : { clé: [[date, cours]] } ;
   * `bench` : [[date, cours]] du MSCI World. Renvoie null s'il n'y a rien sur l'année.
   */
  compute(year, { points = [], prices = {}, bench = [], txs = [], fxAt = () => 1, today = todayISO() } = {}) {
    const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
    const end = today < y1 ? today : y1;
    const inYear = points.filter(p => p.date >= y0 && p.date <= y1);
    if (!inYear.length) return null;
    const before = points.filter(p => p.date < y0).pop();
    const last = inYear[inYear.length - 1];
    const v0 = before ? before.value : 0, i0 = before ? before.invested : 0;
    const gain = (last.value - v0) - (last.invested - i0);

    // performance pondérée dans le temps et mois de l'année
    const twr = Portfolio.twr(points);
    const tStart = twr.filter(p => p[0] < y0).pop() || twr.find(p => p[0] >= y0);
    const tEnd = twr.filter(p => p[0] <= y1).pop();
    const perf = tStart && tEnd && tStart[1] > 0 ? (tEnd[1] / tStart[1] - 1) * 100 : NaN;
    const months = (Portfolio.monthlyReturns(twr)[String(year)] || { months: {} }).months;
    const mList = Object.entries(months).map(([m, v]) => ({ m: +m, v })).filter(x => isFinite(x.v));
    const best = mList.reduce((a, b) => (!a || b.v > a.v ? b : a), null);
    const worst = mList.reduce((a, b) => (!a || b.v < a.v ? b : a), null);

    // opérations de l'année
    let invested = 0, buys = 0, sells = 0, divs = 0, fees = 0;
    for (const t of txs) {
      if (t.date < y0 || t.date > y1) continue;
      const fx = fxAt(t);
      const amount = parseNum(t.qty) * parseNum(t.price) * fx, f = (parseNum(t.fees) || 0) * fx;
      if (t.type === 'buy') { buys++; invested += amount + f; fees += f; }
      else if (t.type === 'sell') { sells++; fees += f; }
      else if (t.type === 'div') divs += amount - f;
    }

    // ligne star : meilleure évolution du cours sur l'année (lignes détenues)
    const yearPerf = s => {
      const a = s.filter(v => v[0] < y0).pop() || s.find(v => v[0] >= y0);
      const b = s.filter(v => v[0] <= end).pop();
      return a && b && a[1] > 0 ? (b[1] / a[1] - 1) * 100 : NaN;
    };
    const lines = Object.entries(prices).map(([key, s]) => ({ key, perf: yearPerf(s) })).filter(l => isFinite(l.perf)).sort((a, b) => b.perf - a.perf);
    const benchPerf = bench.length ? yearPerf(bench) : NaN;

    return { year, partial: end < y1, end, value: last.value, gain, perf, best, worst, invested, buys, sells, divs, fees,
      star: lines[0] || null, flop: lines.length > 1 ? lines[lines.length - 1] : null, benchPerf };
  },
};

const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

Object.assign(App, {
  /** Prépare les données (historique, cours de l'année) puis ouvre le récapitulatif */
  async openWrapped(year = Wrapped.defaultYear()) {
    if (!Portfolio.txs('all').length) { toast('Ajoute d\'abord des opérations.'); return; }
    toast('Préparation de ton année…', 'info', 2500);
    if (!this.historyPoints) await this.loadHistory({ quiet: true });
    if (!this.historyPoints) { toast('Historique indisponible pour l\'instant (connexion ?).', 'error'); return; }
    const from = addDaysISO(`${year}-01-01`, -10);
    const prices = {};
    for (const r of Portfolio.snapshot('all').rows) {
      if (Manual.is(r.key)) continue;
      try { prices[r.key] = await Api.daily(r.key, from); } catch (e) { /* ligne ignorée */ }
    }
    let bench = [];
    try { bench = await Api.daily('Y:' + HIST_BENCH.ysym, from); } catch (e) { bench = []; }
    const data = Wrapped.compute(year, { points: this.historyPoints, prices, bench, txs: Portfolio.txs('all'),
      fxAt: t => { const inst = Store.instrument(t.key); return Api.fxAt(inst ? inst.currency : this.base(), t.date); } });
    if (!data) { toast(`Pas d'historique sur ${year}.`, 'error'); return; }
    this.showWrapped(data);
  },

  /** Écrans du récapitulatif */
  wrappedSlides(d) {
    const cur = this.base();
    const sign = v => (v > 0 ? '+' : '');
    const s = [];
    s.push({ cls: 'w-intro', big: String(d.year), title: 'Ton année en bourse', sub: d.partial ? `Du 1er janvier au ${fmtDate(d.end)}` : 'Douze mois, résumés en quelques écrans' });
    s.push({ cls: isFinite(d.perf) && d.perf < 0 ? 'w-down' : 'w-up', kicker: 'Ta performance', big: isFinite(d.perf) ? fmtPct(d.perf) : '—',
      title: `${sign(d.gain)}${fmtMoney(d.gain, cur, 0)} gagnés par tes placements`, sub: `Sans compter l'argent versé. Ton portefeuille vaut ${fmtMoney(d.value, cur, 0)}.` });
    if (d.buys) s.push({ cls: 'w-invest', kicker: 'Tu as investi', big: fmtMoney(d.invested, cur, 0), title: `en ${d.buys} achat${d.buys > 1 ? 's' : ''}`, sub: d.sells ? `et ${d.sells} vente${d.sells > 1 ? 's' : ''}` : 'Chaque versement compte : la régularité fait le travail.' });
    if (d.star) s.push({ cls: 'w-star', kicker: 'Ta ligne star', big: Store.label(d.star.key), title: `${fmtPct(d.star.perf)} sur l'année`,
      sub: d.flop && d.flop.key !== d.star.key ? `La plus discrète : ${Store.label(d.flop.key)} (${fmtPct(d.flop.perf)})` : '' });
    if (d.best && d.worst) s.push({ cls: 'w-months', kicker: 'Ton meilleur mois', big: MONTHS_LONG[d.best.m - 1], title: fmtPct(d.best.v),
      sub: `Le plus dur : ${MONTHS_LONG[d.worst.m - 1]} (${fmtPct(d.worst.v)}). Les marchés ne montent pas en ligne droite.` });
    if (d.divs > 0 || d.fees > 0) s.push({ cls: 'w-cash', kicker: d.divs > 0 ? 'Dividendes reçus' : 'Frais payés', big: fmtMoney(d.divs > 0 ? d.divs : d.fees, cur, 0),
      title: d.divs > 0 ? 'versés par tes placements' : 'en frais de courtage', sub: d.divs > 0 && d.fees > 0 ? `Frais de courtage : ${fmtMoney(d.fees, cur, 0)}` : '' });
    if (isFinite(d.benchPerf) && isFinite(d.perf)) {
      const gap = d.perf - d.benchPerf;
      const close = Math.abs(gap) < 1; // moins d'un point d'écart : au coude-à-coude
      s.push({ cls: close ? 'w-invest' : gap >= 0 ? 'w-up' : 'w-vs', kicker: 'Face au marché mondial', big: `${sign(gap)}${fmtNum(gap, 1)} pt`,
        title: close ? 'Au coude-à-coude avec le MSCI World' : gap >= 0 ? 'de mieux que le MSCI World' : 'de moins que le MSCI World',
        sub: `Toi : ${fmtPct(d.perf)} · MSCI World (IWDA, en €) : ${fmtPct(d.benchPerf)}` });
    }
    s.push({ cls: 'w-end', kicker: `${d.year} en un coup d'œil`, summary: [
      ['Performance', isFinite(d.perf) ? fmtPct(d.perf) : '—'], ['Gain', `${sign(d.gain)}${fmtMoney(d.gain, cur, 0)}`],
      ...(d.invested > 0 ? [['Investi', fmtMoney(d.invested, cur, 0)]] : []), ...(d.divs > 0 ? [['Dividendes', fmtMoney(d.divs, cur, 0)]] : []),
      ...(d.star ? [['Ligne star', Store.label(d.star.key)]] : []), ['Valeur', fmtMoney(d.value, cur, 0)]],
      sub: 'Les performances passées ne préjugent pas des performances futures.' });
    return s;
  },

  showWrapped(d) {
    const slides = this.wrappedSlides(d);
    let i = 0, timer = null;
    const bars = el('div', { class: 'w-bars' }, ...slides.map(() => el('span', {}, el('i'))));
    const stage = el('div', { class: 'w-stage' });
    const close = () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); wrap.remove(); document.body.classList.remove('w-open'); };
    const go = n => {
      i = Math.max(0, Math.min(slides.length - 1, n));
      const sl = slides[i];
      wrap.className = 'wrapped ' + sl.cls;
      [...bars.children].forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'now' : ''; });
      stage.replaceChildren(el('div', { class: 'w-slide' },
        sl.kicker ? el('p', { class: 'w-kicker' }, sl.kicker) : null,
        sl.big ? el('div', { class: 'w-big' }, sl.big) : null,
        sl.title ? el('p', { class: 'w-title' }, sl.title) : null,
        sl.summary ? el('dl', { class: 'w-summary' }, ...sl.summary.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null,
        sl.sub ? el('p', { class: 'w-sub' }, sl.sub) : null,
        i === slides.length - 1 ? el('div', { class: 'w-actions' },
          el('button', { type: 'button', class: 'btn', onclick: e => { e.stopPropagation(); go(0); } }, '↺ Revoir'),
          el('button', { type: 'button', class: 'btn primary', onclick: e => { e.stopPropagation(); close(); } }, 'Fermer')) : null));
      clearTimeout(timer);
      if (i < slides.length - 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setTimeout(() => go(i + 1), 6500);
    };
    const onKey = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === ' ') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); };
    const wrap = el('div', { class: 'wrapped', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Ton année ${d.year} en bourse`,
      onclick: e => { if (e.target.closest('button')) return; const r = wrap.getBoundingClientRect(); go(e.clientX < r.left + r.width / 3 ? i - 1 : i + 1); } },
      bars, el('button', { type: 'button', class: 'w-close', 'aria-label': 'Fermer', onclick: e => { e.stopPropagation(); close(); } }, '✕'), stage);
    document.body.append(wrap);
    document.body.classList.add('w-open');
    document.addEventListener('keydown', onKey);
    go(0);
  },

  /** Entrée dans « À faire » : en décembre (année en cours) et en janvier (année écoulée) */
  wrappedTodo(today = todayISO()) {
    const m = +today.slice(5, 7);
    if (m !== 12 && m !== 1) return null;
    const year = Wrapped.defaultYear(today);
    const id = 'wrapped:' + year;
    if ((Store.state.dismissed || {})[id] || !Portfolio.txs('all').some(t => t.date <= `${year}-12-31`)) return null;
    return { id, icon: '🎉', cls: 'wrapped-todo', title: `Ton année ${year} en bourse est prête`, sub: 'Performance, ligne star, meilleur mois… en quelques écrans.',
      actions: [{ label: 'Voir', primary: true, fn: () => this.openWrapped(year) }, { label: 'Plus tard', fn: () => this.dismiss(id) }] };
  },
});
