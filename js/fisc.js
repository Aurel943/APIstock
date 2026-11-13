/*
 * Fiscalité active : le site ne se contente plus de calculer l'impôt, il cherche comment en payer moins.
 *
 * - Retrait malin : « j'ai besoin de 10 000 € » → quoi vendre, sur quel compte, pour payer le moins d'impôt et de frais.
 *   Compte-titres : moins-values d'abord, puis les lignes dont la part de gain est la plus faible ; les pertes de l'année
 *   et les moins-values reportées des 10 dernières années effacent les gains. PEA de plus de 5 ans : seule la part de gains
 *   du retrait est imposée (prélèvements sociaux). Assurance-vie : part de gains du rachat, abattement annuel après 8 ans.
 *   Liquidités d'abord. Résultat comparé au réflexe « vendre un peu de tout ».
 * - Radar fiscal : moins-values à constater pour effacer l'impôt de l'année, reports de moins-values qui expirent,
 *   purge des plus-values (compte-titres et assurance-vie) sans impôt, anniversaires PEA / assurance-vie à attendre,
 *   dividendes imposés chaque année.
 *
 * Les fonctions de calcul (objet Fisc) sont pures et testées (tests/fisc.test.mjs) : elles reçoivent un « contexte »
 * (comptes, lignes, reports, taux) construit par Fisc.context() à partir des données du site. L'affichage est en bas.
 * Estimations indicatives selon les règles françaises courantes, pas un conseil fiscal.
 */
'use strict';

const Fisc = {
  /* ------------------------------------------------------------------ */
  /* Contexte : photographie fiscale des comptes                          */
  /* ------------------------------------------------------------------ */

  /**
   * Moins-values reportables encore vivantes au début de l'année `year`, par année d'origine.
   * `grossByYear` : { année: solde des plus et moins-values de cession }. Même règle que Tax.yearly : une moins-value
   * s'impute sur les plus-values des 10 années suivantes, les plus anciennes d'abord.
   */
  carryAt(grossByYear, year) {
    const years = Object.keys(grossByYear).map(Number).filter(y => y < year).sort((a, b) => a - b);
    const carry = [];
    if (!years.length) return carry;
    for (let y = years[0]; y < year; y++) {
      while (carry.length && carry[0].year < y - 10) carry.shift();
      const g = grossByYear[y] || 0;
      if (g > 0) {
        let rest = g;
        for (const c of carry) { const u = Math.min(c.amount, rest); c.amount -= u; rest -= u; if (rest <= 0) break; }
        while (carry.length && carry[0].amount <= 0.005) carry.shift();
      } else if (g < 0) carry.push({ year: y, amount: -g });
    }
    return carry.filter(c => c.year >= year - 10 && c.amount > 0.005);
  },

  /** Frais de courtage d'une vente (barème du compte { pct, min, fixed }, montants en devise de base) */
  fee(fees, gross) {
    if (!fees || !(gross > 0)) return 0;
    const pct = parseNum(fees.pct) || 0, min = parseNum(fees.min) || 0, fixed = parseNum(fees.fixed) || 0;
    if (!pct && !min && !fixed) return 0;
    return Math.round((Math.max(gross * pct / 100, min) + fixed) * 100) / 100;
  },

  /** Contexte fiscal tiré des données du site (devise de base) */
  context(today = todayISO()) {
    const T = taxConf();
    const year = +today.slice(0, 4);
    const ctoAccs = Store.state.accounts.filter(a => a.type === 'cto');
    const grossByYear = {};
    let ytd = 0, divs12 = 0;
    const yearAgo = addDaysISO(today, -365);
    for (const a of ctoAccs) {
      const ev = Tax.events(a);
      for (const s of ev.sales) {
        const y = +s.date.slice(0, 4);
        if (!isFinite(s.gain)) continue;
        if (y === year) ytd += s.gain; else if (y < year) grossByYear[y] = (grossByYear[y] || 0) + s.gain;
      }
      for (const d of ev.divs) if (d.date > yearAgo && d.date <= today && isFinite(d.amount)) divs12 += d.amount;
    }
    const carry = this.carryAt(grossByYear, year);
    const accounts = Store.state.accounts.map(a => {
      const basis = Tax.events(a).pos;
      const lines = Portfolio.snapshot(a.id).rows.filter(r => r.qty > 0).map(r => {
        const b = basis[r.key];
        const fx = r.fx;
        const price = isFinite(r.price) && fx > 0 ? r.price * fx : NaN;
        // prix de revient fiscal : chaque achat au taux de change de sa date (repli : PRU au taux du jour)
        const pmp = b && b.qty > 0 && isFinite(b.costBase) ? b.costBase / b.qty : r.cost / r.qty * fx;
        return { key: r.key, label: Store.label(r.key), qty: r.qty, price, priceLocal: r.price, pmp };
      }).filter(l => isFinite(l.price) && l.price > 0 && isFinite(l.pmp));
      const missing = Portfolio.snapshot(a.id).rows.filter(r => r.qty > 0 && !(isFinite(r.price) && r.fx > 0)).map(r => Store.label(r.key));
      const cash = Portfolio.cashTracked(a.id) ? Math.max(0, Portfolio.cashBalance(a.id).cash) : 0;
      const value = lines.reduce((s, l) => s + l.qty * l.price, 0) + cash;
      const out = { id: a.id, name: a.name, type: a.type || 'autre', rate: parseNum(a.taxRate) || 0, fees: a.fees || null, cash, value, lines, missing, tracked: Portfolio.cashTracked(a.id) };
      if (a.type === 'pea') {
        const p = Tax.pea(a);
        out.pea = { deposits: p.deposits, five: p.five, ok: !!p.five && p.five <= today };
      }
      if (a.type === 'av') {
        const v = Tax.av(a, today);
        out.av = { ratio: Math.max(0, Math.min(1, v.ratio)), gains: Math.max(0, v.gains), left: v.left, allowance: v.allowance, eight: v.done, eightDate: v.eight };
      }
      return out;
    });
    return { today, year, pfu: T.pfu / 100, social: T.social / 100, socialAv: T.socialAv / 100, avIr8: T.avIr8 / 100, ir: T.ir / 100, ytd, carry, divs12, accounts };
  },

  /* ------------------------------------------------------------------ */
  /* Retrait malin                                                        */
  /* ------------------------------------------------------------------ */

  /** Part de gains d'un PEA (valeur − versements) / valeur */
  peaRatio(acc) { return acc.value > 0 ? Math.max(0, Math.min(1, (acc.value - acc.pea.deposits) / acc.value)) : 0; },

  /** Comptes d'où l'on peut retirer, et raisons d'exclusion des autres */
  eligible(ctx, exclude = []) {
    const ok = [], warnings = [];
    for (const a of ctx.accounts) {
      if (exclude.includes(a.id) || !(a.value > 0)) continue;
      if (a.type === 'per') { warnings.push(`${a.name} : un PER est bloqué jusqu'à la retraite (sauf cas de déblocage anticipé), il est laissé de côté.`); continue; }
      if (a.type === 'pea' && !a.pea.ok) { warnings.push(`${a.name} : un retrait avant les 5 ans du PEA${a.pea.five ? ' (' + fmtDate(a.pea.five) + ')' : ''} le clôturerait, il est laissé de côté.`); continue; }
      if (a.missing && a.missing.length) warnings.push(`${a.name} : sans cours pour ${a.missing.join(', ')}, ${a.missing.length > 1 ? 'ces lignes sont ignorées' : 'cette ligne est ignorée'}.`);
      ok.push(a);
    }
    return { accounts: ok, warnings };
  },

  /**
   * Coût fiscal exact d'une sélection, compte par compte.
   * `sel` : { [compte]: { cash: €, lines: { clé: parts }, withdraw: € (PEA / assurance-vie) } }.
   * Renvoie { accounts: [{ id, name, type, cash, sales: [{ key, label, qty, gross, fee, gain }], withdraw, gains, fees, tax, net }], gross, fees, tax, net }.
   */
  evaluate(ctx, sel) {
    const out = { accounts: [], fees: 0, tax: 0, net: 0, ctoGain: 0 };
    let P = 0;
    const ctoRows = [];
    for (const a of ctx.accounts) {
      const s = sel[a.id];
      if (!s) continue;
      const sales = [];
      for (const [key, qty] of Object.entries(s.lines || {})) {
        const l = a.lines.find(x => x.key === key);
        if (!l || !(qty > 0)) continue;
        const gross = qty * l.price, fee = this.fee(a.fees, gross);
        sales.push({ key, label: l.label, qty, gross, fee, gain: gross - fee - qty * l.pmp, priceLocal: l.priceLocal });
      }
      const cash = Math.max(0, s.cash || 0);
      const fees = sales.reduce((t, x) => t + x.fee, 0), gains = sales.reduce((t, x) => t + x.gain, 0);
      const row = { id: a.id, name: a.name, type: a.type, cash, sales, fees, gains, tax: 0, withdraw: 0, net: 0 };
      if (a.type === 'pea' || a.type === 'av') {
        row.withdraw = Math.max(0, s.withdraw || 0);
        if (a.type === 'pea') { row.gainPart = row.withdraw * this.peaRatio(a); row.tax = row.gainPart * ctx.social; }
        else {
          row.gainPart = row.withdraw * a.av.ratio;
          const ir = a.av.eight ? Math.max(0, row.gainPart - a.av.left) * ctx.avIr8 : row.gainPart * ctx.ir;
          row.tax = ir + row.gainPart * ctx.socialAv;
        }
        row.net = row.withdraw - row.tax;
      } else {
        row.withdraw = cash + sales.reduce((t, x) => t + x.gross - x.fee, 0);
        if (a.type === 'cto') { P += gains; ctoRows.push(row); } else row.tax = Math.max(0, gains) * a.rate / 100;
      }
      out.accounts.push(row);
    }
    // compte-titres : impôt de l'année avec la sélection − impôt déjà dû, reports de moins-values imputés
    const carry = ctx.carry.reduce((t, c) => t + c.amount, 0);
    const ctoTax = ctx.pfu * (Math.max(0, ctx.ytd + P - carry) - Math.max(0, ctx.ytd - carry));
    const weight = ctoRows.reduce((t, r) => t + Math.abs(r.gains), 0);
    for (const r of ctoRows) r.tax = weight > 0 ? ctoTax * Math.abs(r.gains) / weight : ctoTax / ctoRows.length;
    out.ctoGain = P;
    for (const r of out.accounts) {
      if (r.type !== 'pea' && r.type !== 'av') r.net = r.withdraw - r.tax;
      out.fees += r.fees; out.tax += r.tax; out.net += r.net;
    }
    out.withdraw = out.accounts.reduce((t, r) => t + r.withdraw, 0);
    out.cost = out.tax + out.fees;
    return out;
  },

  /** Ventes à l'intérieur d'un PEA ou d'une assurance-vie pour en sortir `amount` : espèces d'abord, puis les plus grosses lignes */
  wrapperSales(a, amount, whole) {
    const sel = { cash: Math.min(a.cash, amount), lines: {}, withdraw: amount };
    let rest = amount - sel.cash;
    for (const l of a.lines.slice().sort((x, y) => y.qty * y.price - x.qty * x.price)) {
      if (rest <= 0.005) break;
      let q = this.qtyFor(l, rest, whole);
      let got = q * l.price - this.fee(a.fees, q * l.price);
      while (got < rest - 0.005 && q < l.qty) { q = Math.min(l.qty, q + (whole ? 1 : 0.0001)); got = q * l.price - this.fee(a.fees, q * l.price); }
      sel.lines[l.key] = q; rest -= got;
    }
    return sel;
  },

  /** Parts à vendre pour obtenir `amount` (arrondi au-dessus, plafonné à la position) */
  qtyFor(l, amount, whole) {
    const raw = amount / l.price;
    const q = whole && Number.isInteger(Math.round(l.qty * 1e6) / 1e6) ? Math.ceil(raw - 1e-9) : Math.ceil(raw * 1e4 - 1e-6) / 1e4;
    return Math.min(l.qty, Math.max(0, q));
  },

  /**
   * Choix glouton par taux d'imposition marginal : à chaque pas, la source qui coûte le moins par euro retiré.
   * Les pertes du compte-titres effacent d'abord les gains déjà imposables de l'année, puis ouvrent une « réserve »
   * dans laquelle les gains suivants sortent sans impôt. Renvoie les montants bruts pris par source.
   */
  greedy(ctx, accounts, need) {
    const units = [];
    for (const a of accounts) {
      if (a.type === 'pea') units.push({ a, kind: 'wrap', cap: a.value, rate: () => this.peaRatio(a) * ctx.social });
      else if (a.type === 'av') {
        const r = a.av.ratio;
        const free = a.av.eight ? (r > 0 ? Math.min(a.value, a.av.left / r) : a.value) : 0;
        units.push({ a, kind: 'wrap', cap: a.value, free,
          rate: u => (a.av.eight ? (u.taken < u.free - 0.005 ? r * ctx.socialAv : r * (ctx.socialAv + ctx.avIr8)) : r * (ctx.ir + ctx.socialAv)),
          limit: u => (a.av.eight && u.taken < u.free - 0.005 ? u.free - u.taken : Infinity) });
      } else {
        if (a.cash > 0.005) units.push({ a, kind: 'cash', cap: a.cash, g: 0, rate: () => 0 });
        for (const l of a.lines) units.push({ a, kind: 'line', l, cap: l.qty * l.price, g: (l.price - l.pmp) / l.price });
      }
    }
    const carry = ctx.carry.reduce((t, c) => t + c.amount, 0);
    let D = Math.max(0, ctx.ytd - carry), R = Math.max(0, carry - ctx.ytd); // gains déjà imposables / réserve de pertes
    const marg = u => {
      if (u.kind !== 'line') return { rate: u.rate(u), limit: u.limit ? u.limit(u) : Infinity };
      if (u.a.type !== 'cto') return { rate: Math.max(0, u.g) * u.a.rate / 100, limit: Infinity };
      if (u.g < 0) return D > 0.005 ? { rate: ctx.pfu * u.g, limit: D / -u.g } : { rate: 0, limit: Infinity };
      if (u.g > 0) return R > 0.005 ? { rate: 0, limit: R / u.g } : { rate: ctx.pfu * u.g, limit: Infinity };
      return { rate: 0, limit: Infinity };
    };
    for (const u of units) u.taken = 0;
    let rem = need;
    for (let it = 0; it < 2000 && rem > 0.005; it++) {
      let best = null, bm = null;
      for (const u of units) {
        if (u.cap - u.taken <= 0.005) continue;
        const m = marg(u);
        if (!best || m.rate < bm.rate - 1e-12 || (Math.abs(m.rate - bm.rate) <= 1e-12 && this.tie(u, best) < 0)) { best = u; bm = m; }
      }
      if (!best) break;
      const x = Math.min(rem / (1 - bm.rate), best.cap - best.taken, bm.limit);
      if (!(x > 1e-9)) { best.taken = best.cap; continue; }
      best.taken += x;
      rem -= x * (1 - bm.rate);
      if (best.kind === 'line' && best.a.type === 'cto') {
        if (best.g < 0) { const loss = -x * best.g, use = Math.min(D, loss); D -= use; R += loss - use; }
        else if (best.g > 0) { const gain = x * best.g, use = Math.min(R, gain); R -= use; D += gain - use; }
      }
    }
    return { units, short: rem > 0.005 };
  },

  /** Départage à taux égal : espèces d'abord (ni vente ni frais), puis pertes (elles ouvrent la réserve), puis les gains les plus faibles, puis les grosses sources */
  tie(u, v) {
    const rank = x => (x.kind === 'cash' ? 0 : x.kind === 'line' && x.g < 0 ? 1 : x.kind === 'line' ? 2 : 3);
    if (rank(u) !== rank(v)) return rank(u) - rank(v);
    if (u.kind === 'line' && v.kind === 'line' && u.g !== v.g) return u.g - v.g;
    return (v.cap - v.taken) - (u.cap - u.taken);
  },

  /** Sélection (parts entières si demandé) à partir des montants bruts choisis */
  materialize(units, whole) {
    const sel = {};
    for (const u of units) {
      if (!(u.taken > 0.005)) continue;
      const s = sel[u.a.id] = sel[u.a.id] || { cash: 0, lines: {} };
      if (u.kind === 'cash') s.cash += u.taken;
      else if (u.kind === 'line') s.lines[u.l.key] = this.qtyFor(u.l, u.taken, whole);
      else sel[u.a.id] = this.wrapperSales(u.a, u.taken, whole);
    }
    return sel;
  },

  /**
   * Plan de retrait au moindre coût pour obtenir `need` € nets d'impôt (et de frais de courtage).
   * opts : { whole: parts entières (défaut oui), exclude: [comptes à ne pas toucher] }.
   * Renvoie { plan, naive, saving, warnings, short, max } ; `naive` = même retrait en vendant la même proportion de tout.
   */
  plan(ctx, need, opts = {}) {
    const whole = opts.whole !== false;
    const { accounts, warnings } = this.eligible(ctx, opts.exclude || []);
    const all = this.proportional(ctx, accounts, 1, whole);
    const max = this.evaluate(ctx, all).net;
    if (!(need > 0)) return { plan: null, naive: null, saving: 0, warnings, short: false, max };
    if (!accounts.length || max < need - 0.01) return { plan: null, naive: null, saving: 0, warnings, short: true, max };
    let target = need, plan = null;
    for (let i = 0; i < 12; i++) {
      const g = this.greedy(ctx, accounts, target);
      plan = this.evaluate(ctx, this.materialize(g.units, whole));
      if (plan.net >= need - 0.01 || g.short) break;
      target += (need - plan.net) + Math.max(1, need * 0.001);
    }
    if (plan.net < need - 0.01) plan = this.evaluate(ctx, all);
    const naive = this.naive(ctx, accounts, need, whole);
    // le plan glouton n'est pas toujours parfait (arrondis, frais) : on garde la meilleure des deux
    if (naive && naive.cost < plan.cost) plan = naive;
    return { plan, naive, saving: naive ? Math.max(0, naive.cost - plan.cost) : 0, warnings, short: false, max };
  },

  /** Sélection qui vend la proportion `f` de chaque compte */
  proportional(ctx, accounts, f, whole) {
    const sel = {};
    for (const a of accounts) {
      if (a.type === 'pea' || a.type === 'av') {
        const s = { cash: a.cash * f, lines: {} };
        let got = s.cash;
        for (const l of a.lines) {
          const q = this.qtyFor(l, l.qty * l.price * f, whole);
          if (q > 0) { s.lines[l.key] = q; got += q * l.price - this.fee(a.fees, q * l.price); }
        }
        s.withdraw = Math.min(a.value * f, got);
        sel[a.id] = s;
      } else {
        const s = { cash: a.cash * f, lines: {} };
        for (const l of a.lines) { const q = this.qtyFor(l, l.qty * l.price * f, whole); if (q > 0) s.lines[l.key] = q; }
        sel[a.id] = s;
      }
    }
    return sel;
  },

  /** Réflexe courant : vendre la même proportion de tout, jusqu'à obtenir `need` € nets */
  naive(ctx, accounts, need, whole) {
    let lo = 0, hi = 1;
    if (this.evaluate(ctx, this.proportional(ctx, accounts, 1, whole)).net < need - 0.01) return null;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.evaluate(ctx, this.proportional(ctx, accounts, mid, whole)).net >= need) hi = mid; else lo = mid;
    }
    return this.evaluate(ctx, this.proportional(ctx, accounts, hi, whole));
  },

  /* ------------------------------------------------------------------ */
  /* Radar fiscal                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Occasions d'optimisation, de la plus urgente à la moins rentable.
   * Chaque occasion : { id, title, text, save (€ estimés), per ('an' si récurrent), upTo (gain maximal), deadline?, urgent?, account?, lines? }.
   */
  opportunities(ctx, cur = 'EUR') {
    const out = [];
    const m = v => fmtMoney(v, cur, 0);
    const pct = v => fmtNum(v * 100, 1).replace(/,0$/, '') + ' %';
    const year = ctx.year, end = `${year}-12-31`;
    const carry = ctx.carry.reduce((t, c) => t + c.amount, 0);
    const base = ctx.ytd - carry;
    const ctoLines = ctx.accounts.filter(a => a.type === 'cto').flatMap(a => a.lines.map(l => Object.assign({ acc: a }, l, { latent: l.qty * (l.price - l.pmp) })));
    const losers = ctoLines.filter(l => l.latent < -1).sort((a, b) => a.latent - b.latent);
    const gainers = ctoLines.filter(l => l.latent > 1).sort((a, b) => b.latent - a.latent);
    const names = list => list.slice(0, 3).map(l => l.label).join(', ') + (list.length > 3 ? '…' : '');

    // 1. moins-values latentes face aux plus-values imposables de l'année
    const lossTotal = losers.reduce((t, l) => t - l.latent, 0);
    if (base > 1 && lossTotal > 1) {
      const h = Math.min(base, lossTotal);
      out.push({ id: 'harvest', urgent: true, deadline: end, save: h * ctx.pfu,
        title: `Efface jusqu'à ${m(h * ctx.pfu)} d'impôt sur tes plus-values ${year}`,
        text: `Tu as ${m(base)} de plus-values imposables cette année. Vendre ${names(losers)} (moins-value latente de ${m(lossTotal)}) avant le 31 décembre, puis racheter un ETF équivalent (même indice, autre émetteur), constate la perte et l'impute : ton exposition ne change pas, ton impôt baisse.`,
        lines: losers.map(l => l.key) });
    } else if (lossTotal >= 150) {
      out.push({ id: 'harvest-carry', save: lossTotal * ctx.pfu, upTo: true,
        title: `Mets ${m(lossTotal)} de moins-values en réserve pour 10 ans`,
        text: `${names(losers)} ${losers.length > 1 ? 'sont' : 'est'} en perte dans ton compte-titres. Vendre puis racheter un ETF équivalent transforme cette perte latente en moins-value reportable : elle effacera jusqu'à ${m(lossTotal * ctx.pfu)} d'impôt sur tes futures plus-values, pendant 10 ans.`,
        lines: losers.map(l => l.key) });
    }

    // 2. réserve de moins-values (reports + pertes de l'année) : réaliser des gains sans impôt pour remonter le prix de revient
    const room = Math.max(0, -base);
    const latentGain = gainers.reduce((t, l) => t + l.latent, 0);
    const expiring = ctx.carry.filter(c => c.year <= year - 10).reduce((t, c) => t + c.amount, 0);
    if (room > 20 && latentGain > 20) {
      const p = Math.min(room, latentGain);
      out.push({ id: 'purge-cto', urgent: expiring > 1, deadline: expiring > 1 ? end : null, save: p * ctx.pfu,
        title: expiring > 1 ? `${m(expiring)} de moins-values de ${year - 10} expirent le 31 décembre` : `Réalise ${m(p)} de plus-values sans impôt`,
        text: `Ta réserve de moins-values (${m(room)}) couvre des gains latents. Vendre puis racheter ${names(gainers)} pour réaliser ${m(p)} de plus-values : 0 € d'impôt aujourd'hui, un prix de revient relevé, et ${m(p * ctx.pfu)} d'impôt en moins le jour où tu revendras.` + (expiring > 1 ? ` Sinon, ${m(expiring)} de cette réserve sera perdue.` : ''),
        lines: gainers.map(l => l.key) });
    }

    // 3. assurance-vie de plus de 8 ans : purger les gains dans l'abattement annuel
    for (const a of ctx.accounts.filter(x => x.type === 'av' && x.av)) {
      const A = a.av;
      if (A.eight && A.left > 1 && A.ratio > 0 && A.gains > 1) {
        const g = Math.min(A.left, A.gains), w = Math.min(a.value, g / A.ratio);
        out.push({ id: 'purge-av-' + a.id, account: a.id, deadline: end, save: g * ctx.avIr8, urgent: false,
          title: `${a.name} : sors ${m(g)} de gains sans impôt sur le revenu`,
          text: `Ton contrat a plus de 8 ans et il te reste ${m(A.left)} d'abattement cette année (il ne se reporte pas). Un rachat de ${m(w)} réinvesti aussitôt (en versement libre) purge ${m(g)} de gains : seuls les prélèvements sociaux (${pct(ctx.socialAv)}, dus de toute façon) s'appliquent. Attention aux frais d'entrée sur le nouveau versement.` });
      } else if (!A.eight && A.eightDate && A.gains > 1) {
        const days = (Date.parse(A.eightDate) - Date.parse(ctx.today)) / 864e5;
        if (days > 0 && days <= 365) out.push({ id: 'wait-av-' + a.id, account: a.id, deadline: A.eightDate, save: Math.min(A.gains, A.allowance) * (ctx.ir), upTo: true,
          title: `${a.name} a 8 ans le ${fmtDate(A.eightDate)} : attends pour racheter`,
          text: `Avant cette date, les gains d'un rachat sont imposés à ${pct(ctx.ir)} (+ prélèvements sociaux). Après, ${m(A.allowance)} de gains par an sortent sans impôt sur le revenu, puis ${pct(ctx.avIr8)} au-delà.` });
      }
    }

    // 4. PEA bientôt à 5 ans
    for (const a of ctx.accounts.filter(x => x.type === 'pea' && x.pea && !x.pea.ok && x.pea.five)) {
      const days = (Date.parse(a.pea.five) - Date.parse(ctx.today)) / 864e5;
      const gains = Math.max(0, a.value - a.pea.deposits);
      if (days > 0 && days <= 365 && gains > 1) out.push({ id: 'wait-pea-' + a.id, account: a.id, deadline: a.pea.five, save: gains * (ctx.pfu - ctx.social), upTo: true,
        title: `${a.name} a 5 ans le ${fmtDate(a.pea.five)} : ne retire rien avant`,
        text: `Un retrait aujourd'hui clôturerait le plan et ses ${m(gains)} de gains seraient imposés à ${pct(ctx.pfu)}. Après le ${fmtDate(a.pea.five)}, retraits partiels possibles sans clôture, à ${pct(ctx.social)} sur la seule part de gains.` });
    }

    // 5. dividendes imposés chaque année dans le compte-titres
    if (ctx.divs12 > 20) out.push({ id: 'divs', save: ctx.divs12 * ctx.pfu, per: 'an',
      title: `${m(ctx.divs12 * ctx.pfu)} d'impôt par an sur tes dividendes`,
      text: `Ton compte-titres a reçu ${m(ctx.divs12)} de dividendes sur 12 mois, imposés à ${pct(ctx.pfu)} chaque année. La version capitalisante du même ETF réinvestit les dividendes sans impôt jusqu'à la revente, et dans un PEA de plus de 5 ans ils ne seraient taxés qu'à ${pct(ctx.social)}, à la sortie.` });

    return out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.save - a.save);
  },
};

/* ==================================================================== */
/* Affichage (onglet Investir)                                           */
/* ==================================================================== */
Object.assign(App, {
  bindFisc() {
    const run = () => this.runWithdraw();
    $('#wdRun').addEventListener('click', run);
    $('#wdAmount').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    $('#wdWhole').addEventListener('change', () => { if (this.wdResult) run(); });
    this.on('view:shown', v => { if (v === 'invest') this.renderRadar(); });
    this.on('rendered:all', () => { if (this.view === 'invest') this.renderRadar(); });
  },

  /** Ouvre le retrait malin avec un montant (utilisé par le copilote) */
  openWithdraw(amount) {
    this.show('invest');
    if (amount > 0) $('#wdAmount').value = String(Math.round(amount));
    requestAnimationFrame(() => {
      $('#wdCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (amount > 0) this.runWithdraw();
      else $('#wdAmount').focus();
    });
  },

  runWithdraw() {
    const box = $('#wdBody');
    const need = parseNum($('#wdAmount').value);
    if (!(need > 0)) { box.replaceChildren(el('p', { class: 'muted' }, 'Indique le montant net dont tu as besoin.')); return; }
    const ctx = Fisc.context();
    const res = Fisc.plan(ctx, need, { whole: $('#wdWhole').checked });
    this.wdResult = { ctx, res, need };
    this.renderWithdraw();
  },

  renderWithdraw() {
    const { res, need } = this.wdResult, box = $('#wdBody');
    const cur = this.base();
    const warn = res.warnings.length ? el('ul', { class: 'wd-warn small' }, ...res.warnings.map(w => el('li', {}, w))) : null;
    if (res.short || !res.plan) {
      box.replaceChildren(el('p', {}, `Impossible d'obtenir ${fmtMoney(need, cur, 0)} nets avec les comptes disponibles : au maximum ${fmtMoney(res.max, cur, 0)} après impôt.`), warn);
      return;
    }
    const P = res.plan, N = res.naive;
    const typeName = { cto: 'Compte-titres', pea: 'PEA', av: 'Assurance-vie', autre: 'Compte' };
    const rows = P.accounts.filter(r => r.withdraw > 0.5 || r.sales.length);
    box.replaceChildren(
      el('div', { class: 'wd-hero' },
        el('div', {}, el('span', { class: 'muted small' }, 'Impôt + frais avec ce plan'), el('b', { class: 'mono' }, fmtMoney(P.cost, cur, 0))),
        N ? el('div', {}, el('span', { class: 'muted small' }, 'En vendant un peu de tout'), el('b', { class: 'mono muted' }, fmtMoney(N.cost, cur, 0))) : null,
        res.saving > 0.5 ? el('div', { class: 'wd-save' }, el('span', { class: 'small' }, 'Économie'), el('b', { class: 'mono' }, fmtMoney(res.saving, cur, 0))) : null),
      el('p', { class: 'q-lead' }, `Pour disposer de ${fmtMoney(need, cur, 0)} nets, retire `, el('b', {}, fmtMoney(P.withdraw, cur, 0)), ' au total : ',
        P.tax < -0.5 ? el('span', {}, 'ce plan ', el('b', { class: 'up' }, `réduit même ton impôt de ${fmtMoney(-P.tax, cur, 0)}`), ' (moins-values imputées sur tes gains de l\'année).')
          : el('span', {}, `${fmtMoney(Math.max(0, P.tax), cur, 0)} d'impôt estimé et ${fmtMoney(P.fees, cur, 0)} de frais de courtage.`)),
      el('div', { class: 'wd-accounts' }, ...rows.map(r => el('div', { class: 'wd-acc' },
        el('div', { class: 'wd-acc-head' }, el('b', {}, r.name), el('span', { class: 'muted small' }, typeName[r.type] || ''),
          el('span', { class: 'mono wd-acc-amt' }, 'retirer ' + fmtMoney(r.withdraw, cur, 0))),
        el('ul', { class: 'wd-orders' },
          r.cash > 0.5 ? el('li', {}, el('span', {}, 'Liquidités du compte'), el('span', { class: 'mono' }, fmtMoney(r.cash, cur, 0)), el('span', { class: 'muted small' }, 'sans impôt')) : null,
          ...r.sales.map(s => el('li', {},
            el('span', {}, 'Vendre ', el('b', {}, fmtQty(s.qty)), ' ', Store.label(s.key)),
            el('span', { class: 'mono' }, fmtMoney(s.gross, cur, 0)),
            el('span', { class: 'small mono ' + trendClass(s.gain) }, (r.type === 'pea' || r.type === 'av' ? '' : (s.gain < 0 ? 'moins-value ' : 'plus-value ')) + (r.type === 'pea' || r.type === 'av' ? 'dans l\'enveloppe' : fmtSignedMoney(s.gain, cur)))))),
        el('p', { class: 'small muted' }, r.type === 'pea' ? `Part de gains du retrait : ${fmtMoney(r.gainPart, cur, 0)}, imposée aux seuls prélèvements sociaux → ${fmtMoney(r.tax, cur, 0)}.`
          : r.type === 'av' ? `Part de gains du rachat : ${fmtMoney(r.gainPart, cur, 0)} → ${fmtMoney(r.tax, cur, 0)} d'impôt estimé.`
            : r.type === 'cto' ? (r.tax < -0.5 ? `Les moins-values effacent ${fmtMoney(-r.tax, cur, 0)} d'impôt déjà dû cette année.` : `Impôt estimé : ${fmtMoney(Math.max(0, r.tax), cur, 0)} (flat tax, après imputation des moins-values).`)
              : `Impôt estimé : ${fmtMoney(r.tax, cur, 0)}.`)))),
      warn,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => this.recordWithdraw(P) }, 'Enregistrer ces ventes')),
      noteTip('Le plan choisit à chaque étape la source qui coûte le moins d\'impôt par euro retiré : liquidités, moins-values du compte-titres (qui effacent d\'abord les plus-values déjà réalisées cette année, puis ouvrent une réserve), gains couverts par tes reports de moins-values, PEA de plus de 5 ans (prélèvements sociaux sur la seule part de gains du retrait), assurance-vie (abattement annuel après 8 ans), et seulement ensuite les lignes les plus imposées. Les frais de courtage suivent le barème de chaque compte. Comparaison : vendre la même proportion de chaque ligne de chaque compte. Estimation au cours actuel, hors barème progressif et hors règles particulières (contrats d\'assurance-vie de plus de 150 000 € de primes, PEA avec retraits anciens…).', 'Méthode et limites'));
  },

  recordWithdraw(P) {
    const sales = P.accounts.flatMap(r => r.sales.map(s => ({ r, s })));
    if (!sales.length) { toast('Ce plan ne demande aucune vente : retire simplement les liquidités.', 'info'); return; }
    if (!confirm(`Ajouter ${sales.length} vente(s) datée(s) d'aujourd'hui, au cours actuel ?`)) return;
    for (const { r, s } of sales) Store.state.transactions.push({ id: uid(), key: s.key, type: 'sell', date: todayISO(), account: r.id, qty: s.qty, price: s.priceLocal, fees: Math.round(s.fee * 100) / 100, note: 'Retrait malin' });
    Store.save();
    this.wdResult = null;
    $('#wdBody').replaceChildren(el('p', { class: 'muted' }, 'Ventes enregistrées. Pense à noter le retrait des espèces dans « + Versement / retrait » si tu suis les liquidités.'));
    this.renderAll();
    toast('Ventes enregistrées', 'success');
  },

  renderRadar() {
    const box = $('#radarBody');
    if (!box) return;
    const cur = this.base();
    const ops = Fisc.opportunities(Fisc.context(), cur);
    $('#radarCard').classList.toggle('hidden', !Store.state.transactions.length);
    if (!ops.length) {
      box.replaceChildren(el('p', { class: 'muted' }, 'Rien à optimiser pour l\'instant : pas de moins-value à constater, pas d\'abattement inutilisé, pas d\'échéance proche. Le radar se met à jour à chaque opération.'));
      return;
    }
    const total = ops.filter(o => !o.upTo && !o.per).reduce((t, o) => t + o.save, 0);
    box.replaceChildren(
      total > 1 ? el('p', { class: 'q-lead' }, 'Jusqu\'à ', el('b', { class: 'up' }, fmtMoney(total, cur, 0)), ' d\'impôt à économiser avec les actions ci-dessous.') : null,
      el('div', { class: 'radar-list' }, ...ops.map(o => el('div', { class: 'radar-item' + (o.urgent ? ' urgent' : '') },
        el('div', { class: 'radar-gain' }, el('b', { class: 'mono' }, (o.upTo ? 'jusqu\'à ' : '') + fmtMoney(o.save, cur, 0)), el('span', { class: 'muted small' }, o.per ? 'par an' : 'd\'impôt en moins')),
        el('div', {},
          el('b', {}, o.title),
          el('p', { class: 'small' }, o.text),
          o.deadline ? el('span', { class: 'radar-deadline small' }, 'Avant le ' + fmtDate(o.deadline)) : null)))),
      noteTip('Estimations selon les règles françaises courantes (flat tax, imputation des moins-values sur 10 ans, abattement annuel de l\'assurance-vie après 8 ans, PEA après 5 ans) et les taux de Réglages → Fiscalité. La vente suivie d\'un rachat (d\'un ETF équivalent, de préférence) est en principe admise, mais une opération faite uniquement pour éluder l\'impôt peut être contestée. À vérifier avec ta situation.', 'Méthode et limites'));
  },
});
