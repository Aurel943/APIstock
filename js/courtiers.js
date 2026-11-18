/*
 * Comparateur de courtiers (Portefeuille › Opérations) : tes vrais ordres passés, rejoués avec les barèmes d'autres
 * courtiers en ligne (ordres sur Euronext Paris), frais mensuels d'inactivité compris. Le plafond légal du PEA
 * (0,50 % du montant de l'ordre) s'applique sur un PEA.
 * Barèmes relevés le 18 novembre 2026 sur les sites des courtiers (voir `src`) : à vérifier avant de changer de
 * courtier, ils évoluent. Bourse Direct et Trade Republic n'y sont pas faute d'avoir pu lire leur grille officielle :
 * « Autre courtier » permet d'entrer n'importe quel barème (fixe + pourcentage, minimum).
 * Calculs purs (objet Brokers) testés dans tests/courtiers.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const BROKER_CUSTOM_STORE = 'apistock:brokerCustom';
const PEA_FEE_CAP = 0.005; // frais de transaction d'un PEA : 0,50 % du montant de l'ordre au plus

/* Barèmes : fee(montant en €, { firstOfMonth }) → frais de l'ordre ; monthly : frais d'un mois sans ordre */
const BROKER_TARIFFS = [
  { id: 'bourso-decouverte', name: 'BoursoBank · Découverte', pea: true, cto: true,
    rule: '1,99 € jusqu\'à 500 €, puis 0,60 % du montant', src: 'brochure tarifaire BoursoBank, tarifs au 5 octobre 2026',
    fee: a => (a <= 500 ? 1.99 : a * 0.006) },
  { id: 'bourso-classic', name: 'BoursoBank · Classic', pea: false, cto: true,
    rule: '5,50 € jusqu\'à 1 000 €, puis 0,48 % (8,95 € au moins) ; 5,95 € par mois sans ordre', src: 'brochure tarifaire BoursoBank, tarifs au 5 octobre 2026',
    fee: a => (a <= 1000 ? 5.5 : Math.max(8.95, a * 0.0048)), monthly: 5.95 },
  { id: 'fortuneo-starter', name: 'Fortuneo · Starter', pea: true, cto: true,
    rule: '1er ordre du mois jusqu\'à 500 € offert, sinon 0,35 %', src: 'fortuneo.fr/bourse, relevé le 18 novembre 2026',
    fee: (a, o) => (o.firstOfMonth && a <= 500 ? 0 : a * 0.0035) },
  { id: 'fortuneo-progress', name: 'Fortuneo · Progress', pea: true, cto: true,
    rule: '4,90 € jusqu\'à 3 000 €, plus 0,15 % au-delà', src: 'fortuneo.fr/bourse, relevé le 18 novembre 2026',
    fee: a => 4.9 + Math.max(0, a - 3000) * 0.0015 },
  { id: 'fortuneo-traderpro', name: 'Fortuneo · Trader Pro', pea: true, cto: true,
    rule: '9,50 € jusqu\'à 10 000 €, plus 0,10 % au-delà', src: 'fortuneo.fr/bourse, relevé le 18 novembre 2026',
    fee: a => 9.5 + Math.max(0, a - 10000) * 0.001 },
  { id: 'degiro', name: 'DEGIRO', pea: false, cto: true,
    rule: '2 € par ordre sur Euronext Paris (1 € de courtage + 1 € de frais de gestion) ; 0,25 % de change hors euro', src: 'degiro.fr/tarifs, mis à jour le 1er octobre 2025',
    fee: (a, o) => 2 + (o.foreign ? a * 0.0025 : 0) },
];

const Brokers = {
  /** Barème « Autre courtier » saisi : { name, fixed, pct, min } → objet barème (ou null s'il est vide) */
  custom(c) {
    if (!c) return null;
    const fixed = parseNum(c.fixed) || 0, pct = parseNum(c.pct) || 0, min = parseNum(c.min) || 0;
    if (!fixed && !pct && !min) return null;
    return { id: 'custom', name: (c.name || '').trim() || 'Autre courtier', pea: true, cto: true, custom: true,
      rule: [fixed ? fmtNum(fixed, 2) + ' €' : '', pct ? fmtNum(pct, 2) + ' %' : ''].filter(Boolean).join(' + ') + (min ? ` (${fmtNum(min, 2)} € au moins)` : ''),
      src: 'barème saisi', fee: a => Math.max(min, fixed + a * pct / 100) };
  },

  /** Mois « AAAA-MM » de `from` à `to` inclus */
  months(from, to) {
    const out = [];
    let [y, m] = from.split('-').map(Number);
    const [y2, m2] = to.split('-').map(Number);
    while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  },

  /**
   * Frais qu'aurait coûtés une suite d'ordres chez un courtier. `orders` : [{ date, amount (€), foreign }] ;
   * `pea` : plafond légal appliqué ; `until` : dernier mois compté pour les frais d'inactivité.
   * → { total, orders, inactivity, byYear: { année: frais } }
   */
  simulate(orders, broker, { pea = false, until = todayISO() } = {}) {
    const list = orders.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const byYear = {}, seen = new Set();
    let ordersFee = 0;
    for (const o of list) {
      const month = o.date.slice(0, 7);
      let f = broker.fee(o.amount, { firstOfMonth: !seen.has(month), foreign: !!o.foreign });
      seen.add(month);
      if (pea) f = Math.min(f, o.amount * PEA_FEE_CAP);
      f = Math.round(f * 100) / 100;
      ordersFee += f;
      byYear[o.date.slice(0, 4)] = (byYear[o.date.slice(0, 4)] || 0) + f;
    }
    let inactivity = 0;
    if (broker.monthly && list.length) {
      for (const m of this.months(list[0].date.slice(0, 7), until.slice(0, 7))) {
        if (!seen.has(m)) { inactivity += broker.monthly; byYear[m.slice(0, 4)] = (byYear[m.slice(0, 4)] || 0) + broker.monthly; }
      }
    }
    return { total: ordersFee + inactivity, orders: ordersFee, inactivity, byYear };
  },

  /** Comparaison de tous les barèmes disponibles pour ce type de compte, du moins cher au plus cher */
  compare(orders, { pea = false, custom = null, until } = {}) {
    const list = BROKER_TARIFFS.concat(custom ? [custom] : []);
    return list.map(b => {
      const ok = pea ? b.pea : b.cto;
      return Object.assign({ broker: b, available: ok }, ok ? this.simulate(orders, b, { pea, until }) : { total: NaN });
    }).sort((x, y) => (x.available === y.available ? (x.total || 0) - (y.total || 0) : x.available ? -1 : 1));
  },
};

Object.assign(App, {
  /** Ordres d'un compte (achats et ventes), montants en € au taux de leur date, et frais réellement payés */
  brokerOrders(accId) {
    const orders = [];
    let paid = 0;
    for (const t of Store.state.transactions) {
      if (t.account !== accId || (t.type !== 'buy' && t.type !== 'sell')) continue;
      const inst = Store.instrument(t.key) || {};
      const fx = Api.fxAt(inst.currency || this.base(), t.date);
      const r = isFinite(fx) && fx > 0 ? fx : 1;
      const amount = parseNum(t.qty) * parseNum(t.price) * r;
      if (!(amount > 0)) continue;
      orders.push({ date: t.date, amount, foreign: (Api.fxNorm(inst.currency || 'EUR')[0]) !== 'EUR' });
      paid += (parseNum(t.fees) || 0) * r;
    }
    return { orders, paid };
  },

  brokerCustom() {
    try { return JSON.parse(localStorage.getItem(BROKER_CUSTOM_STORE) || 'null'); } catch (e) { return null; }
  },

  renderBrokers() {
    const box = $('#brokerBody');
    if (!box) return;
    const accs = Store.state.accounts.filter(a => Store.state.transactions.some(t => t.account === a.id && (t.type === 'buy' || t.type === 'sell')));
    if (!accs.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Enregistre des achats ou des ventes pour comparer ce qu\'ils t\'auraient coûté chez d\'autres courtiers.')); return; }
    const filter = Store.state.accountFilter;
    if (!this._brokerAcc || !accs.some(a => a.id === this._brokerAcc)) this._brokerAcc = (accs.find(a => a.id === filter) || accs[0]).id;
    const acc = accs.find(a => a.id === this._brokerAcc);
    const pea = acc.type === 'pea';
    const cust = this.brokerCustom() || {};
    const { orders, paid } = this.brokerOrders(acc.id);
    const res = Brokers.compare(orders, { pea, custom: Brokers.custom(cust) });
    const first = orders.reduce((m, o) => (o.date < m ? o.date : m), todayISO());
    const years = Math.max(1 / 12, (Date.now() - Date.parse(first)) / (365.25 * 864e5));
    const m = x => fmtMoney(x, 'EUR', 2);
    const best = res.find(r => r.available);
    const saving = best ? paid - best.total : NaN;
    const input = (k, ph, w) => el('input', { type: k === 'name' ? 'text' : 'number', step: 'any', inputmode: k === 'name' ? 'text' : 'decimal', placeholder: ph, value: cust[k] ?? '', style: w ? `width:${w}` : null,
      'aria-label': ph, onchange: e => { const c = Object.assign({}, this.brokerCustom() || {}, { [k]: e.target.value }); try { localStorage.setItem(BROKER_CUSTOM_STORE, JSON.stringify(c)); } catch (err) { /* stockage indisponible */ } this.renderBrokers(); } });
    box.replaceChildren(
      el('div', { class: 'broker-head' },
        accs.length > 1 ? el('label', {}, 'Compte ', el('select', { id: 'brokerAcc', onchange: e => { this._brokerAcc = e.target.value; this.renderBrokers(); } },
          ...accs.map(a => el('option', { value: a.id, selected: a.id === acc.id || null }, a.name)))) : null,
        el('span', { class: 'muted small' }, `${orders.length} ordre${orders.length > 1 ? 's' : ''} depuis le ${fmtDate(first)} · ${m(orders.reduce((s, o) => s + o.amount, 0))} échangés`)),
      best ? el('p', { class: 'etfcmp-verdict broker-verdict ' + (saving > 1 ? 'up' : '') },
        paid > 0 ? `Tu as payé ${m(paid)} de frais sur ces ordres. ` : 'Tes opérations ne comportent aucun frais saisi. ',
        saving > 1 ? [`Chez `, el('b', {}, best.broker.name), `, ils t'auraient coûté ${m(best.total)} : `, el('b', {}, `${m(saving)} d'économie`), ` (≈ ${m(saving / years)} par an).`]
          : `Ton courtier est déjà parmi les moins chers pour ta façon d'investir (le moins cher ici : ${best.broker.name}, ${m(best.total)}).`) : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table broker-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Courtier'), el('th', { class: 'num' }, 'Frais sur ta période'), el('th', { class: 'num' }, 'Par an'), el('th', { class: 'num' }, 'Écart'), el('th', {}, 'Barème'))),
        el('tbody', {},
          el('tr', { class: 'broker-mine' }, el('td', {}, el('b', {}, 'Ce que tu as payé')), el('td', { class: 'num mono' }, m(paid)), el('td', { class: 'num mono' }, m(paid / years)), el('td', {}), el('td', { class: 'small muted' }, 'frais saisis dans tes opérations')),
          ...res.map(r => el('tr', { class: r.available ? '' : 'muted' },
            el('td', {}, r.broker.name, r === best ? el('span', { class: 'q-new broker-best' }, 'le moins cher') : null),
            el('td', { class: 'num mono' }, r.available ? m(r.total) : '—'),
            el('td', { class: 'num mono' }, r.available ? m(r.total / years) : ''),
            el('td', { class: 'num mono ' + (r.available ? trendClass(paid - r.total) : '') }, r.available ? fmtSignedMoney(paid - r.total, 'EUR') : (pea ? 'pas de PEA' : 'pas de compte-titres')),
            el('td', { class: 'small muted broker-rule' }, r.broker.rule + (r.inactivity ? ` (dont ${m(r.inactivity)} de mois sans ordre)` : ''))))))),
      el('div', { class: 'broker-custom small' }, el('span', {}, 'Autre courtier :'), input('name', 'nom', '9em'), input('fixed', '€ / ordre', '6.5em'), el('span', {}, '+'), input('pct', '% / ordre', '6.5em'), input('min', 'min. €', '6em')),
      noteTip('Chaque ordre est recalculé avec le barème de chaque courtier pour un ordre sur Euronext Paris (montant au taux de change de sa date)' + (pea ? ', plafonné à 0,50 % du montant comme la loi l\'impose sur un PEA' : '')
        + '. Les frais mensuels d\'un mois sans ordre sont comptés de ton premier ordre à aujourd\'hui. Sources : ' + BROKER_TARIFFS.map(b => `${b.name} — ${b.src}`).join(' ; ')
        + '. Bourse Direct et Trade Republic ne figurent pas : leur grille officielle n\'a pas pu être lue ; ajoute leur barème avec « Autre courtier ». Barèmes à vérifier avant de changer : ils évoluent, et les ordres sur d\'autres bourses sont souvent plus chers. Transférer un PEA garde son antériorité fiscale ; le courtier de départ peut facturer le transfert.', 'Sources et limites'));
  },
});

App.on('view:shown', function (page) { if (page === 'portfolio/operations') this.renderBrokers(); });
