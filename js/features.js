/* Fonctionnalités complémentaires : temps réel (flash, mini-graphiques, variations du jour),
 * fiscalité (PEA, compte-titres), exposition réelle des ETF et frais, synchronisation entre appareils. */
'use strict';

/* Assurance-vie : abattement annuel sur les gains rachetés après 8 ans (personne seule / couple soumis à imposition commune) */
const AV_ALLOWANCE = { single: 4600, couple: 9200 };

Object.assign(App, {
  /* ================================================================== */
  /* TEMPS RÉEL                                                           */
  /* ================================================================== */

  /**
   * Attributs pour un prix qui « flashe » en vert ou rouge quand il change.
   * L'état est mémorisé par emplacement (id) : si la ligne est reconstruite pendant l'animation,
   * celle-ci reprend où elle en était (animation-delay négatif) au lieu de recommencer.
   */
  flashAttrs(id, price, base = '') {
    const m = this._flash || (this._flash = {});
    const now = Date.now();
    const s = m[id];
    if (!s) m[id] = { price, at: 0, dir: '' };
    else {
      if (isFinite(price) && isFinite(s.price) && price !== s.price) { s.dir = price > s.price ? 'up' : 'down'; s.at = now; }
      s.price = price;
    }
    const st = m[id], age = now - st.at;
    if (st.dir && age < 1200) return { class: (base + ' flash flash-' + st.dir).trim(), style: `animation-delay:-${age}ms` };
    return base ? { class: base } : {};
  },

  /** Mini-graphique de la séance (cotations Yahoo), le dernier point suit le cours en direct */
  daySpark(q, w, h) {
    if (!q || !Array.isArray(q.spark) || q.spark.length < 2) return null;
    const pts = q.spark.slice();
    if (isFinite(q.price) && pts[pts.length - 1] !== q.price) pts.push(q.price);
    const svg = sparkline(pts, { w, h, ref: q.previousClose });
    svg.setAttribute('class', svg.getAttribute('class') + ' day-spark');
    svg.style.width = w + 'px'; svg.style.height = h + 'px';
    return svg;
  },

  renderMovers(rows) {
    const card = $('#moversCard');
    if (!card) return;
    const cur = this.base();
    const withQ = rows.filter(r => r.quote && isFinite(r.quote.percentChange));
    card.classList.toggle('hidden', withQ.length < 2);
    if (withQ.length < 2) return;
    const sorted = withQ.slice().sort((a, b) => b.quote.percentChange - a.quote.percentChange);
    const n = Math.min(3, Math.ceil(sorted.length / 2));
    const up = sorted.filter(r => r.quote.percentChange > 0).slice(0, n);
    const down = sorted.filter(r => r.quote.percentChange < 0).reverse().slice(0, n);
    const item = r => el('li', { onclick: () => { this.show('markets'); this.selectDetail(r.key); } },
      el('span', { class: 'sym' }, Store.label(r.key)),
      this.daySpark(r.quote, 70, 20) || el('span'),
      el('span', { class: 'chip ' + trendClass(r.quote.percentChange) }, fmtPct(r.quote.percentChange)),
      el('b', { class: 'mono ' + trendClass(r.dayBase) }, fmtSignedMoney(r.dayBase, cur)));
    const empty = txt => el('li', { class: 'muted small' }, txt);
    $('#moversUp').replaceChildren(...(up.length ? up.map(item) : [empty('Aucune position en hausse')]));
    $('#moversDown').replaceChildren(...(down.length ? down.map(item) : [empty('Aucune position en baisse')]));
    const best = sorted[0], worst = sorted[sorted.length - 1];
    $('#moversInfo').textContent = `Écart du jour : ${fmtNum(best.quote.percentChange - worst.quote.percentChange, 2)} pts entre ${Store.label(best.key)} et ${Store.label(worst.key)}`;
  },
});

// les variations du jour suivent chaque rendu du portefeuille
App.on('rendered:portfolio', function () { this.renderMovers(Portfolio.snapshot().rows); });

/* ==================================================================== */
/* FISCALITÉ                                                              */
/* ==================================================================== */

function addYearsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y + n, m - 1, d);
  if (dt.getMonth() !== m - 1) dt.setDate(0); // 29 février → 28 février
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

/** « 1 an et 3 mois », « 4 mois », « 12 jours » */
function fmtSpan(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00'), b = new Date(toISO + 'T00:00:00');
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  if (months < 1) { const days = Math.round((b - a) / 86400000); return days + ' jour' + (days > 1 ? 's' : ''); }
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? y + ' an' + (y > 1 ? 's' : '') : '', m ? m + ' mois' : ''].filter(Boolean).join(' et ');
}

const Tax = {
  sortedTxs(accountId) {
    return Store.state.transactions.filter(t => (t.account || Store.defaultAccount()) === accountId)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },
  /** Taux de change de l'instrument à la date de l'opération (règle fiscale : chaque montant au taux du jour où il est réalisé) */
  fxOf(key, date) { const i = Store.instrument(key); return Api.fxAt((i && i.currency) || Store.state.settings.baseCurrency, date); },

  /**
   * Assurance-vie : passage des 8 ans, abattement annuel sur les gains des rachats (4 600 € seul, 9 200 € en couple)
   * et montant qu'on peut racheter cette année sans impôt sur le revenu (les prélèvements sociaux restent dus).
   * Un rachat contient une part de gains proportionnelle : gains du contrat / valeur du contrat.
   */
  av(acc, today = todayISO()) {
    const txs = this.sortedTxs(acc.id);
    const firstMove = Store.state.cashMoves.filter(m => (m.account || Store.defaultAccount()) === acc.id).reduce((m, x) => (!m || x.date < m ? x.date : m), '');
    const open = acc.openDate || [firstMove, txs[0] && txs[0].date].filter(Boolean).sort()[0] || '';
    const eight = open ? addYearsISO(open, 8) : '';
    const allowance = acc.couple ? AV_ALLOWANCE.couple : AV_ALLOWANCE.single;
    const year = today.slice(0, 4);
    const used = Math.max(0, this.events(acc).sales.filter(s => s.date.slice(0, 4) === year).reduce((a, s) => a + s.gain, 0));
    const { totals } = Portfolio.snapshot(acc.id);
    const value = totals.value, gains = totals.value - totals.cost;
    const ratio = value > 0 ? Math.max(0, gains / value) : 0;
    const left = Math.max(0, allowance - used);
    return { open, eight, done: !!eight && eight <= today, allowance, used, left, value, gains, ratio,
      // rachat brut dont la part de gains épuise l'abattement restant (tout le contrat si le compte est en perte)
      taxFree: ratio > 0 ? Math.min(value, left / ratio) : value };
  },

  /** Mois où le plafond du PEA serait atteint avec les versements programmés actifs de ce compte (null sans versement) */
  peaCapDate(acc, deposits, cap, today = todayISO()) {
    if (!acc || acc.type !== 'pea') return null;
    const monthly = (Store.state.plans || []).filter(p => p.account === acc.id && p.active !== false).reduce((s, p) => s + (parseNum(p.amount) || 0), 0);
    if (!(monthly > 0) || deposits >= cap) return null;
    const months = Math.ceil((cap - deposits) / monthly);
    const date = addMonthsISO(today, months);
    const label = new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { monthly, months, date, label };
  },

  /**
   * PEA : versements estimés. On suppose que les ventes et dividendes restent dans le PEA
   * et financent les achats suivants : seul ce qui dépasse ce solde est un nouveau versement.
   */
  pea(acc) {
    const txs = this.sortedTxs(acc.id);
    let cash = 0, deposits = 0;
    for (const t of txs) {
      if (t.type === 'split') continue;
      const fx = this.fxOf(t.key, t.date);
      const qty = parseNum(t.qty), price = parseNum(t.price), fees = parseNum(t.fees) || 0;
      if (!isFinite(fx) || !isFinite(qty) || !isFinite(price)) continue;
      if (t.type === 'buy') { const cost = (qty * price + fees) * fx; const use = Math.min(cash, cost); cash -= use; deposits += cost - use; }
      else cash += (qty * price - fees) * fx;
    }
    const manual = parseNum(acc.peaDeposits);
    // versements réellement enregistrés (liquidités suivies) : plus fiables que l'estimation
    const tracked = Portfolio.cashTracked(acc.id);
    const real = tracked ? Portfolio.cashBalance(acc.id) : null;
    const realDeposits = real ? Math.max(0, real.deposits - real.withdrawals) : NaN;
    const firstMove = tracked ? Store.state.cashMoves.filter(m => (m.account || Store.defaultAccount()) === acc.id).reduce((m, x) => (!m || x.date < m ? x.date : m), '') : '';
    const open2 = acc.openDate || [firstMove, txs[0] && txs[0].date].filter(Boolean).sort()[0] || '';
    const isManual = isFinite(manual) && manual > 0;
    return { open: open2, five: open2 ? addYearsISO(open2, 5) : '', estimated: tracked ? realDeposits : deposits, deposits: isManual ? manual : tracked ? realDeposits : deposits,
      manual: isManual, tracked: tracked && !isManual, cash: tracked ? real.cash : cash };
  },

  /**
   * Cessions (prix moyen pondéré d'acquisition, frais inclus) et dividendes d'un compte.
   * Montants en devise de base : le prix de revient de chaque achat au taux de change de sa date,
   * le prix de cession au taux du jour de la vente (la plus-value inclut donc l'effet de change).
   */
  events(acc) {
    const pos = {}, sales = [], divs = [];
    for (const t of this.sortedTxs(acc.id)) {
      const p = pos[t.key] = pos[t.key] || { qty: 0, cost: 0, costBase: 0 };
      const qty = parseNum(t.qty), price = parseNum(t.price), fees = parseNum(t.fees) || 0, fx = this.fxOf(t.key, t.date);
      if (t.type === 'div') { divs.push({ date: t.date, key: t.key, amount: (qty * price) * fx, fx, acc }); continue; }
      if (t.type === 'split') { if (qty > 0) p.qty *= qty; continue; }
      if (t.type === 'sell') {
        if (p.qty <= 0) continue;
        const q = Math.min(qty, p.qty), share = q / p.qty, costOut = p.cost * share, costOutBase = p.costBase * share;
        const proceeds = (q * price - fees) * fx;
        sales.push({ date: t.date, key: t.key, qty: q, proceeds, cost: costOutBase, gain: proceeds - costOutBase, pmp: p.cost / p.qty, price, fx, acc });
        p.qty -= q; p.cost -= costOut; p.costBase -= costOutBase;
        if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; p.costBase = 0; }
      } else { p.qty += qty; p.cost += qty * price + fees; p.costBase += (qty * price + fees) * fx; }
    }
    return { sales, divs };
  },

  /** Plus-values par année avec imputation des moins-values des 10 années précédentes */
  yearly(accounts) {
    const sales = [], divs = [];
    for (const a of accounts) { const e = this.events(a); sales.push(...e.sales); divs.push(...e.divs); }
    const years = Array.from(new Set([...sales, ...divs].map(e => +e.date.slice(0, 4)))).sort();
    const carry = []; // { year, amount } moins-values reportables
    const out = {};
    if (!years.length) return { years, out, sales, divs };
    for (let y = years[0]; y <= Math.max(years[years.length - 1], new Date().getFullYear()); y++) {
      while (carry.length && carry[0].year < y - 10) carry.shift(); // expirées après 10 ans
      const ys = sales.filter(s => +s.date.slice(0, 4) === y);
      const gross = ys.reduce((s, x) => s + x.gain, 0);
      let used = 0;
      if (gross > 0) {
        let rest = gross;
        for (const c of carry) { const u = Math.min(c.amount, rest); c.amount -= u; rest -= u; used += u; if (!rest) break; }
        while (carry.length && carry[0].amount <= 0.005) carry.shift();
      } else if (gross < 0) carry.push({ year: y, amount: -gross });
      const yd = divs.filter(d => +d.date.slice(0, 4) === y);
      out[y] = { sales: ys, divs: yd, gross, used, taxable: Math.max(0, gross - used), loss: gross < 0 ? -gross : 0,
        dividends: yd.reduce((s, d) => s + d.amount, 0), carryLeft: carry.reduce((s, c) => s + c.amount, 0) };
    }
    return { years: Object.keys(out).map(Number), out, sales, divs };
  },
};

Object.assign(App, {
  renderTax() {
    const card = $('#taxCard');
    if (!card) return;
    const accs = Store.state.accounts;
    const peas = accs.filter(a => a.type === 'pea' && Tax.sortedTxs(a.id).length);
    const ctos = accs.filter(a => (a.type === 'cto' || a.type === 'autre') && Tax.sortedTxs(a.id).length);
    const avs = accs.filter(a => a.type === 'av' && Tax.sortedTxs(a.id).length);
    card.classList.toggle('hidden', !peas.length && !ctos.length && !avs.length);
    if (!peas.length && !ctos.length && !avs.length) return;
    const cur = this.base();
    const today = todayISO();
    const parts = [];

    const T = taxConf();
    const PEA_CAP = T.peaCap;
    for (const a of peas) {
      const p = Tax.pea(a);
      const pct = Math.min(100, (p.deposits / PEA_CAP) * 100);
      const done = p.five && p.five <= today;
      const save = patch => { Object.assign(a, patch); Store.save(); this.renderTax(); };
      parts.push(el('div', { class: 'tax-block' },
        el('h3', {}, a.name, /pea/i.test(a.name) ? null : el('span', { class: 'muted small' }, ' · PEA')),
        el('div', { class: 'tax-grid' },
          el('div', { class: 'tax-stat' },
            el('span', { class: 'muted small' }, 'Versements ' + (p.manual ? '(saisis)' : p.tracked ? '(liquidités suivies)' : '(estimés)')),
            el('b', { class: 'mono' }, fmtMoney(p.deposits, cur, 0) + ' / ' + fmtMoney(PEA_CAP, cur, 0)),
            el('div', { class: 'bar' }, el('span', { class: pct >= 90 ? 'warn' : '', style: `width:${pct}%` })),
            el('span', { class: 'muted small' }, p.deposits >= PEA_CAP ? 'Plafond atteint : plus de versement possible.' : 'Encore ' + fmtMoney(PEA_CAP - p.deposits, cur, 0) + ' de versements possibles.'),
            (() => {
              const capAt = Tax.peaCapDate(a, p.deposits, PEA_CAP, today);
              return capAt ? el('span', { class: 'muted small' }, `Au rythme de tes versements programmés (${fmtMoney(capAt.monthly, cur, 0)}/mois), plafond atteint vers ${capAt.label}.`) : null;
            })()),
          el('div', { class: 'tax-stat' },
            el('span', { class: 'muted small' }, 'Cap des 5 ans'),
            el('b', { class: done ? 'up' : '' }, p.five ? (done ? '✔ Atteint depuis le ' + fmtDate(p.five) : fmtDate(p.five)) : '—'),
            el('span', { class: 'muted small' }, p.five ? (done
              ? `Retraits possibles sans clôture, gains exonérés d'impôt sur le revenu (seuls les prélèvements sociaux de ${fmtNum(T.social, 1)} % s'appliquent).`
              : 'Dans ' + fmtSpan(today, p.five) + `. Avant, un retrait clôture le PEA et les gains sont imposés à ${fmtNum(T.pfu, 1)} % (prélèvement forfaitaire unique).`) : '')),
          el('div', { class: 'tax-stat tax-edit' },
            el('label', {}, el('span', { class: 'muted small' }, 'Date d\'ouverture'),
              el('input', { type: 'date', value: p.open, max: today, onchange: e => save({ openDate: e.target.value }) })),
            el('label', {}, el('span', { class: 'muted small' }, 'Versements réels (optionnel)'),
              el('input', { type: 'number', min: 0, step: 1, inputmode: 'decimal', placeholder: fmtNum(p.estimated, 0), value: p.manual ? a.peaDeposits : '',
                onchange: e => save({ peaDeposits: e.target.value }) })))),
        noteTip('Estimation : achats moins ce que les ventes et dividendes ont rapporté dans le PEA. Saisis le montant exact (relevé de ton courtier) pour plus de précision ; par défaut, la date d\'ouverture est celle de ta première opération.')));
    }

    for (const a of avs) {
      const v = Tax.av(a, today);
      const save = patch => { Object.assign(a, patch); Store.save(); this.renderTax(); };
      const pctUsed = Math.min(100, (v.used / v.allowance) * 100);
      parts.push(el('div', { class: 'tax-block' },
        el('h3', {}, a.name, /assurance|vie/i.test(a.name) ? null : el('span', { class: 'muted small' }, ' · Assurance-vie')),
        el('div', { class: 'tax-grid' },
          el('div', { class: 'tax-stat' },
            el('span', { class: 'muted small' }, 'Passage des 8 ans'),
            el('b', { class: v.done ? 'up' : '' }, v.eight ? (v.done ? '✔ Depuis le ' + fmtDate(v.eight) : fmtDate(v.eight)) : '—'),
            el('span', { class: 'muted small' }, v.eight ? (v.done
              ? `Gains rachetés : ${fmtNum(T.avIr8, 1)} % d'impôt au-delà de l'abattement, plus ${fmtNum(T.socialAv, 1)} % de prélèvements sociaux.`
              : 'Dans ' + fmtSpan(today, v.eight) + `. Avant, les gains rachetés sont imposés à ${fmtNum(T.pfu, 1)} % (prélèvement forfaitaire unique), sans abattement.`) : '')),
          el('div', { class: 'tax-stat' },
            el('span', { class: 'muted small' }, `Abattement ${today.slice(0, 4)} restant`),
            el('b', { class: 'mono' }, fmtMoney(v.left, cur, 0) + ' / ' + fmtMoney(v.allowance, cur, 0)),
            el('div', { class: 'bar' }, el('span', { class: pctUsed >= 90 ? 'warn' : '', style: `width:${pctUsed}%` })),
            el('span', { class: 'muted small' }, v.done
              ? (v.used > 0 ? `${fmtMoney(v.used, cur, 0)} de gains déjà rachetés cette année.` : 'Aucun gain racheté cette année.')
              : 'Utilisable après les 8 ans.')),
          el('div', { class: 'tax-stat' },
            el('span', { class: 'muted small' }, 'Rachat sans impôt sur le revenu', infoTip('Montant que tu peux retirer cette année sans impôt sur le revenu : un rachat contient une part de gains égale à gains ÷ valeur du contrat, et cette part doit rester sous l\'abattement. Les prélèvements sociaux restent dus sur les gains (souvent déjà prélevés chaque année sur le fonds euros). Versements avant le 27 septembre 2017 : règles différentes.')),
            el('b', { class: v.done ? 'up mono' : 'mono' }, v.done ? '≈ ' + fmtMoney(v.taxFree, cur, 0) : '—'),
            el('span', { class: 'muted small' }, v.value > 0 ? `Gains du contrat : ${fmtSignedMoney(v.gains, cur)} (${fmtPct(v.ratio * 100, 1, false)} de sa valeur)` : '')),
          el('div', { class: 'tax-stat tax-edit' },
            el('label', {}, el('span', { class: 'muted small' }, 'Date d\'ouverture du contrat'),
              el('input', { type: 'date', value: v.open, max: today, onchange: e => save({ openDate: e.target.value }) })),
            el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!a.couple, onchange: e => save({ couple: e.target.checked }) }),
              'En couple (9 200 €)', infoTip('Couple marié ou pacsé soumis à imposition commune : l\'abattement annuel passe de 4 600 € à 9 200 €.')))),
        noteTip('Estimation sur les lignes suivies ici. Par défaut, la date d\'ouverture est celle de ta première opération : saisis la vraie date (elle figure sur tes relevés), c\'est elle qui compte pour les 8 ans. Ajoute tes supports avec « Placement à valeur saisie » s\'ils n\'ont pas de cours en ligne.')));
    }

    if (ctos.length) {
      const { years, out } = Tax.yearly(ctos);
      const withEvents = years.filter(y => out[y].sales.length || out[y].divs.length);
      if (!withEvents.length) {
        parts.push(el('div', { class: 'tax-block' }, el('h3', {}, 'Compte-titres'), el('p', { class: 'muted small' }, 'Aucune vente ni aucun dividende enregistré : rien à déclarer pour l\'instant.')));
      } else {
        if (!this.taxYear || !out[this.taxYear]) this.taxYear = withEvents[withEvents.length - 1];
        const Y = out[this.taxYear];
        const names = ctos.map(a => a.name).join(', ');
        const select = el('select', { onchange: e => { this.taxYear = +e.target.value; this.renderTax(); } },
          ...withEvents.slice().reverse().map(y => el('option', { value: y, selected: y === this.taxYear }, 'Année ' + y)));
        const flat = (Y.taxable + Y.dividends) * T.pfu / 100;
        parts.push(el('div', { class: 'tax-block' },
          el('div', { class: 'tax-head' }, el('h3', {}, 'Plus-values et dividendes', el('span', { class: 'muted small' }, ' · ' + names)), select),
          Y.sales.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Valeur'), el('th', { class: 'num' }, 'Qté'),
              el('th', { class: 'num' }, 'Prix de cession net'), el('th', { class: 'num' }, 'Prix de revient (PMP)'), el('th', { class: 'num' }, '+/- value'))),
            el('tbody', {}, ...Y.sales.map(s => el('tr', {},
              el('td', {}, fmtDate(s.date)), el('td', {}, el('span', { class: 'sym' }, Store.label(s.key))), el('td', { class: 'num' }, fmtQty(s.qty)),
              el('td', { class: 'num' }, fmtMoney(s.proceeds, cur)), el('td', { class: 'num' }, fmtMoney(s.cost, cur)),
              el('td', { class: 'num ' + trendClass(s.gain) }, fmtSignedMoney(s.gain, cur))))))) : el('p', { class: 'muted small' }, 'Aucune vente en ' + this.taxYear + '.'),
          el('div', { class: 'tax-grid' },
            this.kpi('Plus-values de l\'année', fmtSignedMoney(Y.gross, cur), Y.sales.length + ' cession(s)', trendClass(Y.gross)),
            Y.used > 0.005 ? this.kpi('Moins-values antérieures imputées', '−' + fmtMoney(Y.used, cur), 'Reportées des 10 années précédentes') : null,
            this.kpi(Y.loss ? 'Moins-value à déclarer' : 'Plus-value imposable', fmtMoney(Y.loss || Y.taxable, cur), Y.loss ? 'Case 3VH de la 2042 C' : 'Case 3VG de la 2042 C (formulaire 2074 si besoin)', Y.loss ? 'down' : ''),
            this.kpi('Dividendes bruts', fmtMoney(Y.dividends, cur), 'Case 2DC (actions) ou 2TR (distributions d\'ETF), souvent déjà pré-remplis'),
            this.kpi(`Impôt estimé (flat tax ${fmtNum(T.pfu, 1)} %)`, fmtMoney(flat, cur), `${fmtNum(T.ir, 1)} % d'impôt + ${fmtNum(T.social, 1)} % de prélèvements sociaux, hors acomptes déjà prélevés`),
            Y.carryLeft > 0.005 ? this.kpi('Moins-values reportables', fmtMoney(Y.carryLeft, cur), 'Utilisables jusqu\'à 10 ans') : null),
          noteTip('Méthode du prix moyen pondéré d\'acquisition (frais inclus), calculée par compte. Les montants en devises sont convertis au taux de change du jour de chaque opération (clôture de la veille pour un week-end ; taux actuel si l\'historique n\'a pas pu être chargé).')));
      }
    }
    parts.push(noteTip(T.custom ? 'Taux fiscaux personnalisés (Réglages → Fiscalité).'
      : `Taux des revenus ${T.year} : ${T.source}. Modifiables dans Réglages → Fiscalité.`, 'Taux utilisés'));
    $('#taxBody').replaceChildren(...parts);
  },
});

// cartes « lentes » (fiscalité, exposition) : recalculées avec le reste de l'écran, pas à chaque cotation
App.on('rendered:all', function () {
  this.renderTax();
  if (this.renderExposure) this.renderExposure();
});

/* ==================================================================== */
/* EXPOSITION RÉELLE & FRAIS                                              */
/* ==================================================================== */
/* Répartitions approximatives (ordre de grandeur 2025-2026) des grands indices. Elles évoluent :
 * elles servent à repérer les concentrations, pas à remplacer la fiche de l'ETF. */
const SECT = { tech: 'Technologie', fin: 'Finance', ind: 'Industrie', health: 'Santé', cyc: 'Conso. cyclique', comm: 'Communication',
  stap: 'Conso. de base', energy: 'Énergie', mat: 'Matériaux', util: 'Services publics', re: 'Immobilier' };
const COUNTRY_FR = { US: '🇺🇸 États-Unis', JP: '🇯🇵 Japon', GB: '🇬🇧 Royaume-Uni', CA: '🇨🇦 Canada', FR: '🇫🇷 France', CH: '🇨🇭 Suisse',
  DE: '🇩🇪 Allemagne', AU: '🇦🇺 Australie', NL: '🇳🇱 Pays-Bas', CN: '🇨🇳 Chine', TW: '🇹🇼 Taïwan', IN: '🇮🇳 Inde', KR: '🇰🇷 Corée du Sud',
  BR: '🇧🇷 Brésil', SA: '🇸🇦 Arabie saoudite', ZA: '🇿🇦 Afrique du Sud', MX: '🇲🇽 Mexique', SE: '🇸🇪 Suède', DK: '🇩🇰 Danemark',
  IT: '🇮🇹 Italie', ES: '🇪🇸 Espagne', BE: '🇧🇪 Belgique', FI: '🇫🇮 Finlande', HK: '🇭🇰 Hong Kong', other: 'Autres pays' };
const MIC_COUNTRY = { XPAR: 'FR', XAMS: 'NL', XETR: 'DE', XFRA: 'DE', XLON: 'GB', XMIL: 'IT', XMAD: 'ES', XSWX: 'CH', XBRU: 'BE', XHEL: 'FI',
  XSTO: 'SE', XCSE: 'DK', XNYS: 'US', XNAS: 'US', XNGS: 'US', ARCX: 'US', BATS: 'US', XASE: 'US', XTSE: 'CA', XTKS: 'JP', XHKG: 'HK', XASX: 'AU' };

const EXPO_PROFILES = {
  world: { label: 'MSCI World (pays développés)',
    country: { US: 72, JP: 5.5, GB: 3.6, CA: 3, FR: 2.6, CH: 2.5, DE: 2.2, AU: 1.7, NL: 1.2, other: 5.7 },
    sector: { tech: 26, fin: 16.5, ind: 11, health: 10, cyc: 10, comm: 8.5, stap: 5.8, energy: 3.6, mat: 3.2, util: 2.6, re: 2.2 },
    ccy: { USD: 73, EUR: 8.5, JPY: 5.5, GBP: 3.6, CAD: 3, CHF: 2.5, AUD: 1.7, other: 2.2 } },
  allworld: { label: 'Monde entier (FTSE All-World / MSCI ACWI)',
    country: { US: 63, JP: 5.5, GB: 3.4, CN: 2.8, CA: 2.7, TW: 2.2, FR: 2.2, CH: 2.1, IN: 2.1, DE: 2, AU: 1.6, other: 12.4 },
    sector: { tech: 26, fin: 17, ind: 10.5, cyc: 10.5, health: 9.5, comm: 8.5, stap: 5.6, energy: 3.8, mat: 3.6, util: 2.7, re: 2.2 },
    ccy: { USD: 64, EUR: 8, JPY: 5.5, GBP: 3.4, 'HKD/CNY': 3, CAD: 2.7, TWD: 2.2, CHF: 2.1, INR: 2.1, other: 7 } },
  sp500: { label: 'S&P 500 (États-Unis)',
    country: { US: 100 },
    sector: { tech: 33, fin: 13.5, cyc: 10.5, comm: 10, health: 9.5, ind: 8.5, stap: 5.3, energy: 3, util: 2.4, re: 2, mat: 1.8 },
    ccy: { USD: 100 } },
  ndx: { label: 'Nasdaq-100',
    country: { US: 97, NL: 1.5, GB: 1, other: 0.5 },
    sector: { tech: 52, cyc: 17, comm: 16, health: 5.5, stap: 5, ind: 3.5, util: 1 },
    ccy: { USD: 100 } },
  em: { label: 'Marchés émergents (MSCI EM)',
    country: { CN: 27, TW: 19, IN: 18, KR: 10, BR: 4.3, SA: 3.5, ZA: 3.2, MX: 1.9, other: 13.1 },
    sector: { tech: 25, fin: 23, cyc: 13, comm: 9.5, ind: 7, mat: 6, energy: 4.5, stap: 4.5, health: 3.5, util: 2.6, re: 1.4 },
    ccy: { 'HKD/CNY': 27, TWD: 19, INR: 18, KRW: 10, BRL: 4.3, SAR: 3.5, ZAR: 3.2, other: 15 } },
  europe: { label: 'Europe (Stoxx 600 / MSCI Europe)',
    country: { GB: 22, FR: 16, CH: 14.5, DE: 14, NL: 7, SE: 5.5, DK: 4.5, IT: 4.5, ES: 4.5, other: 7.5 },
    sector: { fin: 22, ind: 17, health: 14, stap: 9, cyc: 8, tech: 7, mat: 5.5, energy: 5, util: 4.5, comm: 4, re: 1 },
    ccy: { EUR: 50, GBP: 22, CHF: 14.5, SEK: 5.5, DKK: 4.5, other: 3.5 } },
  es50: { label: 'Euro Stoxx 50 (zone euro)',
    country: { FR: 36, DE: 31, NL: 16, ES: 8, IT: 7, BE: 1.5, FI: 0.5 },
    sector: { fin: 18, tech: 17, cyc: 15, ind: 15, stap: 8, health: 7, energy: 5, util: 5, comm: 5, mat: 4, re: 1 },
    ccy: { EUR: 100 } },
  cac: { label: 'CAC 40 (France)',
    country: { FR: 100 },
    sector: { cyc: 24, ind: 21, stap: 11, health: 10, fin: 10, energy: 7, mat: 6, tech: 5, comm: 3, util: 2.5, re: 0.5 },
    ccy: { EUR: 100 } },
  japan: { label: 'Japon (MSCI Japan / Topix)',
    country: { JP: 100 },
    sector: { ind: 23, cyc: 17, fin: 15, tech: 13, comm: 8, health: 7, stap: 6, mat: 6, re: 2.5, util: 1.3, energy: 1.2 },
    ccy: { JPY: 100 } },
  gold: { label: 'Or', special: 'Or (matière première)', ccy: { USD: 100 } },
  crypto: { label: 'Crypto-monnaie', special: 'Crypto-monnaies', ccy: { Crypto: 100 } },
  stock: { label: 'Action individuelle' },
  none: { label: 'Non renseigné' },
};

/* ETF courants : profil + TER (frais annuels, en %), à vérifier dans le DIC de l'ETF */
const ETF_DB = {
  CW8: ['world', 0.38], EWLD: ['world', 0.45], DCAM: ['world', 0.20], WPEA: ['world', 0.25], MWRD: ['world', 0.12], IWDA: ['world', 0.20],
  EUNL: ['world', 0.20], SWDA: ['world', 0.20], XDWD: ['world', 0.19], URTH: ['world', 0.24],
  VWCE: ['allworld', 0.19], VWRL: ['allworld', 0.19], VWRA: ['allworld', 0.19], IUSQ: ['allworld', 0.20], SSAC: ['allworld', 0.20], ACWI: ['allworld', 0.32], SPYI: ['allworld', 0.17],
  ESE: ['sp500', 0.15], PSP5: ['sp500', 0.15], '500': ['sp500', 0.15], CSPX: ['sp500', 0.07], SXR8: ['sp500', 0.07], VUSA: ['sp500', 0.07], VUAA: ['sp500', 0.07],
  SPY: ['sp500', 0.09], VOO: ['sp500', 0.03], IVV: ['sp500', 0.03], SPXS: ['sp500', 0.05], SPY5: ['sp500', 0.03],
  PANX: ['ndx', 0.23], PUST: ['ndx', 0.30], UST: ['ndx', 0.22], CNDX: ['ndx', 0.33], EQQQ: ['ndx', 0.30], SXRV: ['ndx', 0.33], QQQ: ['ndx', 0.20], QQQM: ['ndx', 0.15],
  PAEEM: ['em', 0.30], AEEM: ['em', 0.20], EMIM: ['em', 0.18], IS3N: ['em', 0.18], VFEM: ['em', 0.22], EIMI: ['em', 0.18],
  MEUD: ['europe', 0.07], ETZ: ['europe', 0.20], PCEU: ['europe', 0.15], CEU: ['europe', 0.15], IMEU: ['europe', 0.12], VEUR: ['europe', 0.10], EXSA: ['europe', 0.20],
  C50: ['es50', 0.07], MSE: ['es50', 0.20], EXW1: ['es50', 0.10],
  C40: ['cac', 0.25], CAC: ['cac', 0.25],
  PTPXE: ['japan', 0.20], IJPN: ['japan', 0.12],
  GOLD: ['gold', 0.12], IGLN: ['gold', 0.12], SGLD: ['gold', 0.12], GLD: ['gold', 0.40],
};

/* ETF éligibles au PEA parmi ETF_DB (liste indicative, à vérifier sur la fiche de l'ETF) */
const PEA_ELIGIBLE = new Set(['CW8', 'EWLD', 'DCAM', 'WPEA', 'ESE', 'PSP5', 'PANX', 'PUST', 'PAEEM', 'PCEU', 'PTPXE', 'C50', 'C40', 'CAC', 'MEUD']);
/* Fonds cotés aux États-Unis : en général non proposés aux particuliers européens (pas de document d'informations clés) */
const US_FUNDS = new Set(['SPY', 'VOO', 'IVV', 'QQQ', 'QQQM', 'ACWI', 'URTH', 'GLD']);

/* Recoupement approximatif des titres (en poids) entre deux indices */
const OVERLAP = { 'sp500|world': 68, 'ndx|world': 30, 'ndx|sp500': 45, 'allworld|world': 87, 'allworld|sp500': 60, 'allworld|ndx': 27,
  'allworld|em': 10, 'europe|world': 15, 'allworld|europe': 14, 'es50|europe': 45, 'cac|europe': 20, 'cac|es50': 35, 'japan|world': 5.5, 'allworld|japan': 5.5 };

const Expo = {
  guess(inst) {
    if (!inst) return { profile: 'none', ter: NaN, auto: true };
    const sym = (inst.symbol || '').toUpperCase(), ysym = (inst.ysymbol || '').toUpperCase().split('.')[0];
    const hit = ETF_DB[sym] || ETF_DB[ysym];
    if (hit) return { profile: hit[0], ter: hit[1], auto: true };
    const n = (inst.name || '') + ' ' + (inst.short || '');
    const byName = [[/nasdaq.?100/i, 'ndx'], [/s&p.?500/i, 'sp500'], [/all.?world|acwi|monde entier/i, 'allworld'], [/msci world|pea monde|\bworld\b/i, 'world'],
      [/emerg|émerg/i, 'em'], [/euro ?stoxx ?50/i, 'es50'], [/stoxx ?(europe )?600|msci europe|\beurope\b/i, 'europe'], [/cac ?40/i, 'cac'],
      [/japan|japon|topix|nikkei/i, 'japan'], [/\bgold\b|\bor physique\b/i, 'gold'], [/bitcoin|ethereum|crypto/i, 'crypto']];
    for (const [re, p] of byName) if (re.test(n)) return { profile: p, ter: p === 'crypto' ? 0 : NaN, auto: true };
    if (/-(EUR|USD)$/.test(inst.ysymbol || '') || /crypto/i.test(inst.type || '')) return { profile: 'crypto', ter: 0, auto: true }; // pas de frais de gestion
    if (/action|equity|stock|common/i.test(inst.type || '') && !/etf|fund/i.test(inst.type || '')) return { profile: 'stock', ter: 0, auto: true };
    // coté en bourse, sans « ETF / UCITS / fonds » dans le nom : très probablement une action
    if (inst.mic && MIC_COUNTRY[inst.mic] && inst.name && !/etf|ucits|fund|fonds|tracker|index|indice|trust|ishares|vanguard|amundi|lyxor|xtrackers|spdr|invesco/i.test(inst.name)) return { profile: 'stock', ter: 0, auto: true };
    return { profile: 'none', ter: NaN, auto: true };
  },
  of(key) {
    const inst = Store.instrument(key);
    const g = this.guess(inst);
    const ter = inst && inst.ter !== undefined && inst.ter !== '' && isFinite(parseNum(inst.ter)) ? parseNum(inst.ter) : g.ter;
    return { profile: (inst && inst.expo) || g.profile, ter, terAuto: !(inst && inst.ter !== undefined && inst.ter !== ''), guess: g, inst };
  },
  /** Symbole d'un instrument tel qu'il figure dans ETF_DB */
  dbSymbol(inst) {
    if (!inst) return '';
    const sym = (inst.symbol || '').toUpperCase(), ysym = (inst.ysymbol || '').toUpperCase().split('.')[0];
    return ETF_DB[sym] ? sym : ETF_DB[ysym] ? ysym : sym;
  },

  /**
   * Coût des frais courants (TER) sur `years` ans, intérêts composés perdus compris :
   * valeur sans frais − valeur avec frais, pour un rendement brut supposé `rate` (%).
   */
  feeDrag(value, ter, rate, years) {
    if (!(value > 0) || !isFinite(ter)) return NaN;
    const r = rate / 100;
    return value * Math.pow(1 + r, years) - value * Math.pow((1 + r) * (1 - ter / 100), years);
  },

  /** Frais de courtage déjà payés (devise de base, au taux de chaque opération) et leur coût en ajoutant les intérêts composés perdus jusqu'à l'horizon */
  brokerage(txs, rate, years, today = todayISO()) {
    let paid = 0, cost = 0;
    for (const t of txs) {
      const f = parseNum(t.fees) || 0;
      if (!(f > 0) || t.type === 'div' || t.type === 'split') continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt((inst && inst.currency) || Store.state.settings.baseCurrency, t.date);
      if (!isFinite(fx)) continue;
      const since = Math.max(0, (Date.parse(today) - Date.parse(t.date)) / (365.25 * 864e5));
      paid += f * fx;
      cost += f * fx * Math.pow(1 + rate / 100, since + years);
    }
    return { paid, cost };
  },

  /**
   * ETF de ETF_DB au même profil d'exposition et au TER plus bas (au plus 3, du moins cher au plus cher).
   * `pea` : seulement les ETF éligibles au PEA. Les fonds américains sont exclus.
   */
  cheaper(key, { pea = false } = {}) {
    const e = this.of(key);
    const own = this.dbSymbol(e.inst);
    if (!isFinite(e.ter) || !EXPO_PROFILES[e.profile] || !EXPO_PROFILES[e.profile].country && !EXPO_PROFILES[e.profile].special) return [];
    return Object.entries(ETF_DB)
      .filter(([s, [p, ter]]) => p === e.profile && s !== own && ter < e.ter - 0.005 && !US_FUNDS.has(s) && (!pea || PEA_ELIGIBLE.has(s)))
      .map(([s, [p, ter]]) => ({ symbol: s, ter, pea: PEA_ELIGIBLE.has(s) }))
      .sort((a, b) => a.ter - b.ter || a.symbol.localeCompare(b.symbol)).slice(0, 3);
  },

  /** Répartition d'un instrument : { country, sector, ccy } en % */
  split(key) {
    const { profile, inst } = this.of(key);
    const P = EXPO_PROFILES[profile] || EXPO_PROFILES.none;
    if (P.country) return P;
    if (P.special) return { country: { [P.special]: 100 }, sector: { [P.special]: 100 }, ccy: P.ccy };
    if (profile === 'stock') {
      const c = MIC_COUNTRY[inst && inst.mic] || 'other';
      return { country: { [c]: 100 }, sector: { 'Actions individuelles': 100 }, ccy: { [(inst && inst.currency) || '?']: 100 } };
    }
    return { country: { 'Non renseigné': 100 }, sector: { 'Non renseigné': 100 }, ccy: { [(inst && inst.currency) || '?']: 100 } };
  },
};

Object.assign(App, {
  renderExposure() {
    const card = $('#exposureCard');
    if (!card) return;
    const cur = this.base();
    const { rows } = Portfolio.snapshot();
    const items = rows.map(r => ({ r, w: isFinite(r.valueBase) ? r.valueBase : r.costBase })).filter(x => x.w > 0);
    card.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    const total = items.reduce((s, x) => s + x.w, 0);

    const agg = { country: {}, sector: {}, ccy: {} };
    for (const { r, w } of items) {
      const sp = Expo.split(r.key);
      for (const dim of ['country', 'sector', 'ccy']) {
        const d = sp[dim] || {}, sum = Object.values(d).reduce((a, b) => a + b, 0) || 1;
        for (const [k, v] of Object.entries(d)) agg[dim][k] = (agg[dim][k] || 0) + (w / total) * (v / sum) * 100;
      }
    }
    const label = { country: k => COUNTRY_FR[k] || k, sector: k => SECT[k] || k, ccy: k => (k === 'other' ? 'Autres devises' : k) };
    const bars = (dim, title, top) => {
      const entries = Object.entries(agg[dim]).sort((a, b) => b[1] - a[1]);
      const keep = entries.filter(([k]) => k !== 'other').slice(0, top);
      const rest = 100 - keep.reduce((s, [, v]) => s + v, 0);
      if (rest > 0.05) keep.push(['__rest', rest]);
      return el('div', { class: 'expo-col' }, el('h3', {}, title),
        el('ul', { class: 'expo-bars' }, ...keep.map(([k, v]) => el('li', {},
          el('span', { class: 'expo-name' }, k === '__rest' ? (dim === 'country' ? 'Autres pays' : 'Autres') : label[dim](k)),
          el('span', { class: 'expo-bar' }, el('span', { style: `width:${Math.min(100, v)}%` })),
          el('b', { class: 'mono' }, fmtNum(v, 1) + ' %')))));
    };

    // frais
    let fees = 0, feeBase = 0, unknownFee = 0;
    const rowsUi = items.map(({ r, w }) => {
      const e = Expo.of(r.key);
      const cost = isFinite(e.ter) ? w * e.ter / 100 : NaN;
      if (isFinite(cost)) { fees += cost; feeBase += w; } else unknownFee += w;
      const save = patch => { Object.assign(Store.instrument(r.key), patch); Store.save(); this.renderExposure(); };
      return el('tr', {},
        el('td', {}, el('span', { class: 'sym' }, Store.label(r.key)), el('span', { class: 'name', title: r.inst ? r.inst.name : '' }, Store.code(r.key)),
          el('select', { class: 'expo-select', 'aria-label': 'Exposition de ' + Store.label(r.key), onchange: ev => save({ expo: ev.target.value === e.guess.profile ? '' : ev.target.value }) },
          ...Object.entries(EXPO_PROFILES).map(([id, P]) => el('option', { value: id, selected: id === e.profile }, P.label + (id === e.guess.profile && e.guess.profile !== 'none' ? ' (auto)' : ''))))),
        el('td', { class: 'num' }, el('input', { type: 'number', class: 'ter-input', min: 0, max: 5, step: 0.01, inputmode: 'decimal',
          placeholder: isFinite(e.guess.ter) ? fmtNum(e.guess.ter, 2) : '?', value: e.terAuto ? '' : e.ter,
          title: 'Frais courants annuels (TER) en %, indiqués dans le DIC de l\'ETF. Vide = valeur par défaut.',
          onchange: ev => save({ ter: ev.target.value }) })),
        el('td', { class: 'num' }, fmtNum(w / total * 100, 1) + ' %'),
        el('td', { class: 'num' }, isFinite(cost) ? fmtMoney(cost, cur) : el('span', { class: 'muted' }, '?')));
    });
    const avgTer = feeBase > 0 ? fees / feeBase * 100 : NaN;

    // alertes : concentration et doublons
    const notes = [];
    const us = agg.country.US || 0;
    if (us >= 60) notes.push(`🇺🇸 ${fmtNum(us, 0)} % de ton portefeuille dépend des actions américaines.`);
    const topSector = Object.entries(agg.sector).sort((a, b) => b[1] - a[1])[0];
    if (topSector && topSector[1] >= 30 && SECT[topSector[0]]) notes.push(`${SECT[topSector[0]]} : ${fmtNum(topSector[1], 0)} % du portefeuille, un secteur très représenté.`);
    const partial = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = Expo.of(items[i].r.key).profile, b = Expo.of(items[j].r.key).profile;
      if (!EXPO_PROFILES[a].country || !EXPO_PROFILES[b].country) continue;
      const ov = a === b ? 100 : OVERLAP[[a, b].sort().join('|')];
      if (a === b) notes.push(`Doublon : ${Store.label(items[i].r.key)} et ${Store.label(items[j].r.key)} suivent le même indice.`);
      else if (ov >= 25) partial.push(`${Store.label(items[i].r.key)} et ${Store.label(items[j].r.key)} : ~${fmtNum(ov, 0)} % de titres en commun (${EXPO_PROFILES[a].label} / ${EXPO_PROFILES[b].label}).`);
    }
    if (partial.length) notes.push(el('span', {}, `${partial.length} paire(s) d'ETF se recoupent en partie`, infoTip(partial.join('\n'))));
    const wasOpen = !!$('#expoDetail') && $('#expoDetail').open;

    $('#exposureBody').replaceChildren(
      notes.length ? el('ul', { class: 'expo-notes' }, ...notes.map(n => el('li', {}, n))) : null,
      el('div', { class: 'expo-grid' }, bars('country', 'Pays', 5), bars('sector', 'Secteurs', 5), bars('ccy', 'Devises', 4)),
      el('div', { class: 'expo-fees' },
        this.kpi('Frais annuels des ETF', isFinite(avgTer) ? fmtMoney(fees, cur) + ' / an' : '—',
          isFinite(avgTer) ? `TER moyen ${fmtNum(avgTer, 2)} %` : 'TER à renseigner dans le détail', '',
          isFinite(avgTer) ? `Frais courants (TER) pondérés par le poids de chaque ligne. À valeur constante, ≈ ${fmtMoney(fees * 10, cur, 0)} sur 10 ans.` : ''),
        unknownFee > 0 ? el('p', { class: 'muted small' }, `TER inconnu pour ${fmtNum(unknownFee / total * 100, 0)} % du portefeuille : à saisir dans le détail (il figure dans le DIC de l'ETF).`) : null),
      el('details', { class: 'advanced expo-detail', id: 'expoDetail', open: wasOpen },
        el('summary', {}, 'Détail par ligne, frais sur 10-20 ans et ETF moins chers'),
        el('div', { class: 'stack' },
          el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Ligne · exposition'), el('th', { class: 'num' }, 'TER %'), el('th', { class: 'num' }, 'Poids'), el('th', { class: 'num' }, 'Frais / an'))),
            el('tbody', {}, ...rowsUi))),
          this.feesLongTerm(items))),
      noteTip('Répartitions approximatives des indices (ordre de grandeur 2025-2026) et TER indicatifs : vérifie-les sur la fiche de chaque ETF. Le recoupement est estimé à partir du poids des titres communs aux deux indices.', 'Sources et limites'));
  },
});

Object.assign(App, {
  /** Coût des frais sur 10 et 20 ans (TER et courtage, intérêts composés perdus compris) et ETF équivalents moins chers */
  feesLongTerm(items) {
    const cur = this.base();
    const rate = isFinite(parseNum(Store.state.feeReturn)) ? parseNum(Store.state.feeReturn) : 6;
    const input = el('input', { type: 'number', class: 'pct-input', min: -10, max: 20, step: 0.5, value: rate, 'aria-label': 'Rendement annuel supposé' });
    input.addEventListener('change', () => { Store.state.feeReturn = parseNum(input.value); Store.save(); this.renderExposure(); });
    const ter10 = items.reduce((s, { r, w }) => s + (Expo.feeDrag(w, Expo.of(r.key).ter, rate, 10) || 0), 0);
    const ter20 = items.reduce((s, { r, w }) => s + (Expo.feeDrag(w, Expo.of(r.key).ter, rate, 20) || 0), 0);
    const txs = Portfolio.txs();
    const b10 = Expo.brokerage(txs, rate, 10), b20 = Expo.brokerage(txs, rate, 20);
    const accType = id => Store.account(id || Store.defaultAccount()).type;
    const swaps = [];
    for (const { r, w } of items) {
      const pea = txs.some(t => t.key === r.key && accType(t.account) === 'pea');
      const alts = Expo.cheaper(r.key, { pea });
      if (!alts.length) continue;
      const ter = Expo.of(r.key).ter, best = alts[0];
      const gain = n => Expo.feeDrag(w, ter, rate, n) - Expo.feeDrag(w, best.ter, rate, n);
      swaps.push(el('tr', {},
        el('td', {}, el('span', { class: 'sym' }, Store.label(r.key)), el('span', { class: 'name' }, 'TER ' + fmtNum(ter, 2) + ' %' + (pea ? ' · dans un PEA' : ''))),
        el('td', {}, ...alts.map((a, i) => el('div', { class: i ? 'small muted' : '' }, el('b', {}, a.symbol), ` · ${fmtNum(a.ter, 2)} %` + (a.pea && !pea ? ' · éligible PEA' : '')))),
        el('td', { class: 'num up' }, fmtMoney(gain(10), cur, 0)),
        el('td', { class: 'num up' }, fmtMoney(gain(20), cur, 0))));
    }
    return el('div', { class: 'fees-long' },
      el('div', { class: 'rebal-head' }, el('h3', {}, 'Coût des frais sur le long terme'),
        el('label', { class: 'inline small' }, 'Rendement annuel supposé', input, '%')),
      el('div', { class: 'kpis' },
        this.kpi('Frais des ETF sur 10 ans', fmtMoney(ter10, cur, 0), 'TER + intérêts composés perdus, à valeur actuelle'),
        this.kpi('Frais des ETF sur 20 ans', fmtMoney(ter20, cur, 0), 'même hypothèse, sans nouveaux versements'),
        this.kpi('Courtage déjà payé', fmtMoney(b10.paid, cur), b10.paid > 0 ? `≈ ${fmtMoney(b10.cost, cur, 0)} dans 10 ans, ${fmtMoney(b20.cost, cur, 0)} dans 20 ans s'il avait été investi` : 'aucun frais de courtage saisi')),
      swaps.length ? el('div', {},
        el('p', { class: 'small' }, 'ETF connus qui suivent le même type d\'indice avec des frais courants plus bas :'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Ta ligne'), el('th', {}, 'Équivalents moins chers (TER)'), el('th', { class: 'num' }, 'Écart sur 10 ans'), el('th', { class: 'num' }, 'Écart sur 20 ans'))),
          el('tbody', {}, ...swaps)))) : el('p', { class: 'muted small' }, 'Aucun équivalent moins cher parmi les ETF connus du site pour tes lignes.'),
      noteTip('Information, pas un conseil d\'investissement : deux ETF d\'une même catégorie peuvent suivre des indices différents (méthode de réplication, distribution, devise, encours). L\'écart ne compte ni les frais de courtage ni l\'impôt d\'une vente sur un compte-titres, et suppose des TER inchangés : vérifie-les dans le DIC.', 'À savoir'));
  },
});

// après un rafraîchissement des cours : mise à jour des cartes « lentes » (poids, taux de change),
// au plus toutes les 30 s et jamais pendant une saisie dans l'une d'elles
App.on('refreshed', function (manual) {
  const busy = ['#exposureCard', '#taxCard'].some(s => { const c = $(s); return c && c.contains(document.activeElement) && document.activeElement !== document.body; });
  if (!busy && (manual || Date.now() - (this._slowAt || 0) > 30000)) {
    this._slowAt = Date.now();
    this.renderExposure();
    this.renderTax();
  }
});

/* ==================================================================== */
/* SYNCHRONISATION ENTRE APPAREILS (chiffrée de bout en bout)             */
/* ==================================================================== */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hexOf = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

const Sync = {
  LS: 'apistock:sync',
  conf() { try { return JSON.parse(localStorage.getItem(this.LS) || 'null'); } catch (e) { return null; } },
  setConf(c) { try { if (c) localStorage.setItem(this.LS, JSON.stringify(c)); else localStorage.removeItem(this.LS); } catch (e) { /* ignore */ } },
  device() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
    return (os + ' ' + br).trim();
  },
  generate() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // sans caractères ambigus (l, 1, o, 0, i)
    const r = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(r, x => abc[x % abc.length]).join('').match(/.{5}/g).join('-');
  },
  /** id public (empreinte du code) + clé AES dérivée du code : le code lui-même n'est jamais envoyé */
  async derive(code) {
    const enc = new TextEncoder();
    const id = hexOf(await crypto.subtle.digest('SHA-256', enc.encode('apistock-sync-id:' + code)));
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('apistock-sync-key:' + id), iterations: 200000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { id, key };
  },
  /** Ce qui est synchronisé : tout, sauf les préférences propres à l'appareil */
  payload(state = Store.state) {
    const s = structuredClone(state);
    delete s.accountFilter;
    if (s.settings) delete s.settings.refreshSec;
    return s;
  },
  async hash(obj) { return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(obj)))); },
  async encrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { data: b64(ct), iv: b64(iv) };
  },
  async decrypt(key, rec) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.data));
    return JSON.parse(new TextDecoder().decode(pt));
  },
  url(id) {
    const base = Api.proxyUrl();
    if (!base) throw new Error('aucun relais configuré');
    const u = new URL(base, location.href);
    u.searchParams.set('type', 'sync'); u.searchParams.set('id', id);
    return u.toString();
  },
  async get(id) {
    Api.countRequest('yahoo');
    const res = await fetch(this.url(id), { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (j.unsupported || j.configured === false) throw new Error('le relais n\'a pas de stockage de synchronisation (voir le README : espace KV « SYNC »)');
    if (j.error) throw new Error(/invalide/.test(j.error) && !res.ok ? 'le worker en ligne ne gère pas encore la synchronisation : redéploie-le (voir le README)' : j.error);
    return j;
  },
  async put(id, body) {
    Api.countRequest('yahoo');
    // text/plain : pas de requête préalable CORS
    const res = await fetch(this.url(id), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) return { conflict: true };
    if (!res.ok || j.error) throw new Error(j.error || 'erreur ' + res.status);
    return j;
  },
  /** Listes fusionnées par identifiant (et filtrées des éléments supprimés) */
  LISTS: ['transactions', 'alerts', 'accounts', 'cashMoves', 'plans', 'assets'],

  /**
   * Suppressions des deux appareils : pour chaque identifiant, la date la plus récente l'emporte entre
   * suppression (`deleted`) et annulation (`restored`). Les entrées de plus de 180 jours sont oubliées.
   */
  mergeTombstones(remote, local, now = Date.now()) {
    const limit = now - Store.TOMBSTONE_DAYS * 864e5;
    const pick = k => { const o = {}; for (const src of [remote[k], local[k]]) for (const [id, ts] of Object.entries(src || {})) if (ts > limit && !(o[id] >= ts)) o[id] = ts; return o; };
    const deleted = pick('deleted'), restored = pick('restored');
    for (const id of Object.keys(deleted)) { if (restored[id] >= deleted[id]) delete deleted[id]; else delete restored[id]; }
    return { deleted, restored };
  },

  /** Fusion sans perte quand les deux appareils ont changé : on additionne les listes, l'appareil courant l'emporte en cas de doublon ; une suppression faite sur l'un des deux est conservée */
  merge(remote, local) {
    const byId = (a = [], b = []) => { const m = new Map(); for (const x of [...a, ...b]) m.set(x.id, x); return Array.from(m.values()); };
    const out = Object.assign({}, remote, local);
    Object.assign(out, this.mergeTombstones(remote, local));
    out.settings = Object.assign({}, remote.settings || {}, local.settings || {});
    out.instruments = Object.assign({}, remote.instruments || {}, local.instruments || {});
    for (const k of this.LISTS) out[k] = byId(remote[k], local[k]).filter(x => !(x && out.deleted[x.id]));
    if (!out.accounts.length) out.accounts = (local.accounts || remote.accounts || []).slice(0, 1);
    // éléments rattachés à un compte supprimé sur l'autre appareil : déplacés vers le premier compte restant
    const accIds = new Set(out.accounts.map(a => a.id)), first = out.accounts[0] && out.accounts[0].id;
    if (first) for (const k of ['transactions', 'cashMoves', 'plans']) out[k] = out[k].map(x => (x.account && !accIds.has(x.account) ? Object.assign({}, x, { account: first }) : x));
    out.watchlist = Array.from(new Set([...(remote.watchlist || []), ...(local.watchlist || [])]));
    out.targets = Object.assign({}, remote.targets || {}, local.targets || {});
    out.wealthHistory = Object.assign({}, remote.wealthHistory || {}, local.wealthHistory || {});
    return out;
  },
};

Object.assign(App, {
  syncSetState(text, cls = '') {
    const pill = $('#syncState');
    if (!pill) return;
    pill.textContent = text;
    pill.className = 'pill ' + cls;
  },

  renderSync() {
    const c = Sync.conf();
    $('#syncOff').classList.toggle('hidden', !!c);
    $('#syncOnBox').classList.toggle('hidden', !c);
    if (!c) { this.syncSetState('Désactivée'); return; }
    const shown = this._syncReveal;
    $('#syncCodeShow').textContent = shown ? c.code : c.code.replace(/[^-]/g, '•');
    $('#syncReveal').textContent = shown ? 'Masquer' : 'Afficher';
    $('#syncInfo').textContent = c.updatedAt
      ? `Dernière version : ${new Date(c.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}${c.lastDevice ? ' (' + c.lastDevice + ')' : ''}. Cet appareil : ${Sync.device()}.`
      : 'Pas encore synchronisé.';
    if (!this._syncErr) this.syncSetState('Activée ✔', 'open');
  },

  bindSync() {
    if (!$('#syncCard')) return;
    if (!(window.crypto && crypto.subtle)) {
      $('#syncOff').replaceChildren(el('p', { class: 'muted small' }, 'Synchronisation indisponible : le site doit être ouvert en https.'));
      return;
    }
    $('#syncGen').addEventListener('click', () => { $('#syncCode').value = Sync.generate(); });
    $('#syncOn').addEventListener('click', () => this.syncEnable($('#syncCode').value.trim()));
    $('#syncNow').addEventListener('click', () => this.syncRun({ manual: true }));
    $('#syncReveal').addEventListener('click', () => { this._syncReveal = !this._syncReveal; this.renderSync(); });
    $('#syncOffBtn').addEventListener('click', () => {
      if (!confirm('Désactiver la synchronisation sur cet appareil ? Tes données restent ici et sur tes autres appareils.')) return;
      Sync.setConf(null); this._syncKeys = null; this._syncErr = null; this.renderSync();
    });
    // chaque enregistrement local déclenche un envoi (regroupé, et seulement si quelque chose a changé)
    this.on('data:saved', () => { if (!this._syncApplying && Sync.conf()) { clearTimeout(this._syncT); this._syncT = setTimeout(() => this.syncRun(), 3000); } });
    // récupération des changements des autres appareils : au retour sur l'onglet et toutes les 2 min
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (this._syncAt || 0) > 20000) this.syncRun(); });
    setInterval(() => { if (!document.hidden) this.syncRun(); }, 120000);
    this.renderSync();
    if (Sync.conf()) this.syncRun();
  },

  async syncEnable(code) {
    if (code.length < 12) { toast('Le code doit faire au moins 12 caractères (clique sur « Générer »).', 'error'); return; }
    const btn = $('#syncOn'); btn.disabled = true; btn.textContent = 'Activation…';
    try {
      this._syncKeys = { code, ...(await Sync.derive(code)) };
      Sync.setConf({ code });
      await this.syncRun({ first: true, manual: true });
    } catch (e) {
      Sync.setConf(null); this._syncKeys = null;
      toast('Synchronisation impossible : ' + e.message, 'error', 8000);
    } finally { btn.disabled = false; btn.textContent = 'Activer la synchronisation'; this.renderSync(); }
  },

  /** Une passe de synchronisation : récupère la version distante, fusionne si besoin, puis envoie la version locale */
  syncRun(opts = {}) {
    const p = (this._syncQ || Promise.resolve()).then(() => this._syncOnce(opts));
    this._syncQ = p.catch(() => {}); // la file continue même après une erreur
    return opts.first ? p : this._syncQ; // à l'activation, l'appelant doit connaître l'erreur
  },

  async _syncOnce({ first = false, manual = false, retry = 0 } = {}) {
    let c = Sync.conf();
    if (!c) return;
    this._syncAt = Date.now();
    try {
      if (!this._syncKeys || this._syncKeys.code !== c.code) this._syncKeys = { code: c.code, ...(await Sync.derive(c.code)) };
      const { id, key } = this._syncKeys;
      this.syncSetState('Synchronisation…');
      const localPayload = Sync.payload();
      const localHash = await Sync.hash(localPayload);
      const localChanged = localHash !== c.hash;
      const remote = await Sync.get(id);

      if (!remote.empty && remote.updatedAt !== c.updatedAt) {
        // une autre version existe : on la récupère
        const remoteState = await Sync.decrypt(key, remote);
        const localEmpty = !Store.state.transactions.length && !Object.keys(Store.state.instruments).length;
        const next = !localChanged || localEmpty ? remoteState : Sync.merge(remoteState, localPayload);
        this.syncApply(next);
        c = Object.assign(Sync.conf() || {}, { code: c.code, updatedAt: remote.updatedAt, lastDevice: remote.device, hash: await Sync.hash(Sync.payload()) });
        Sync.setConf(c);
        if (next === remoteState) { if (!first) toast('Données mises à jour depuis ' + (remote.device || 'un autre appareil'), 'success', 3000); }
        else c.hash = ''; // fusion : il faut renvoyer le résultat
      }

      const nowPayload = Sync.payload();
      const nowHash = await Sync.hash(nowPayload);
      if (nowHash !== c.hash || remote.empty) {
        const enc = await Sync.encrypt(key, nowPayload);
        const res = await Sync.put(id, Object.assign(enc, { updatedAt: Date.now(), base: remote.empty ? null : c.updatedAt, device: Sync.device() }));
        if (res.conflict) { // un autre appareil vient d'écrire : on recommence (fusion), quelques fois au plus
          if (retry >= 3) throw new Error('trop de modifications simultanées, réessaie dans un instant');
          return this._syncOnce({ first, manual, retry: retry + 1 });
        }
        Sync.setConf(Object.assign(c, { updatedAt: res.updatedAt, hash: nowHash, lastDevice: Sync.device() }));
      }
      this._syncErr = null;
      if (first) toast(remote.empty ? 'Synchronisation activée : tes données sont sauvegardées. Saisis le même code sur tes autres appareils.' : 'Synchronisation activée : données récupérées ✔', 'success', 6000);
      else if (manual) toast('Synchronisé ✔', 'success', 2000);
    } catch (e) {
      this._syncErr = e;
      this.syncSetState('Erreur', 'warn');
      if (first) throw e;
      if (manual || this._syncErrMsg !== e.message) toast('Synchronisation : ' + e.message, 'error', 6000);
      this._syncErrMsg = e.message;
    } finally { this.renderSync(); }
  },

  /** Remplace les données locales (en gardant les préférences propres à cet appareil) */
  syncApply(state) {
    const keep = { refreshSec: Store.state.settings.refreshSec, accountFilter: Store.state.accountFilter };
    const next = structuredClone(state);
    next.settings = Object.assign({}, next.settings, { refreshSec: keep.refreshSec });
    next.accountFilter = keep.accountFilter;
    this._syncApplying = true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      Store.load(); // mêmes migrations qu'au démarrage
      Store.save();
    } finally { this._syncApplying = false; }
    $('#setApiKey').value = Store.state.settings.apiKey || '';
    $('#setProxy').value = Store.state.settings.yahooProxy || '';
    this.bindSettingsValues();
    if (this.renderAccountsSettings) this.renderAccountsSettings();
    this.renderAll();
    this.refresh();
  },
});

document.addEventListener('DOMContentLoaded', () => App.bindSync());
