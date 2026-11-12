/*
 * Placements sans cotation : produit structuré, support d'assurance-vie, fonds non coté…
 * Leur valeur est saisie à la main (relevé, avis de valorisation) et reste constante entre deux saisies.
 * Ils se comportent ensuite comme une ligne ordinaire : positions, répartition, performances, historique.
 */
'use strict';

const Manual = {
  is(key) { const i = Store.instrument(key); return !!(i && i.provider === 'manual'); },

  /** Valeurs saisies, triées par date : [[date ISO, valeur d'une part], …] */
  values(key) {
    const i = Store.instrument(key);
    return ((i && i.values) || []).filter(v => v && v[0] && isFinite(v[1])).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
  },

  last(key) { const v = this.values(key); return v.length ? v[v.length - 1] : null; },

  /** Crée l'instrument et renvoie sa clé */
  create({ name, currency, price, date }) {
    const symbol = 'PERSO-' + uid().slice(0, 6).toUpperCase();
    const key = Store.upsertInstrument({ symbol, mic: '', name, currency, type: 'Valeur saisie', provider: 'manual' });
    Store.instrument(key).values = [[date, price]];
    Store.save();
    return key;
  },

  /** Ajoute (ou remplace) la valeur d'une date */
  setValue(key, date, price) {
    const i = Store.instrument(key);
    if (!i) return;
    i.values = (i.values || []).filter(v => v[0] !== date).concat([[date, price]]);
    Store.save();
    Api.quote(key);
  },

  removeValue(key, date) {
    const i = Store.instrument(key);
    if (!i || (i.values || []).length <= 1) return false; // on garde au moins une valeur
    i.values = i.values.filter(v => v[0] !== date);
    Store.save();
    Api.quote(key);
    return true;
  },

  /** Cotation au format de l'API : dernière valeur saisie, sans variation « du jour » */
  quote(key) {
    const i = Store.instrument(key);
    const v = this.values(key);
    if (!v.length) throw new ApiError('aucune valeur saisie pour ' + (i ? i.name : key), 404);
    const [date, price] = v[v.length - 1];
    return {
      price, previousClose: price, change: 0, percentChange: 0, open: NaN, high: NaN, low: NaN, volume: NaN,
      isOpen: false, datetime: date, currency: i.currency, name: i.name, exchange: 'Valeur saisie',
      low52: NaN, high52: NaN, manual: true,
    };
  },

  /** Série journalière (jours ouvrés) : la dernière valeur connue est reportée jusqu'à la suivante */
  daily(key, startDate) {
    const v = this.values(key);
    if (!v.length) return [];
    const out = [];
    const end = todayISO();
    let d = startDate < v[0][0] ? startDate : v[0][0];
    let j = 0, cur = v[0][1];
    for (let n = 0; d <= end && n < 20000; n++, d = addDaysISO(d, 1)) {
      while (j < v.length && v[j][0] <= d) cur = v[j++][1];
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      if (wd !== 0 && wd !== 6 && d >= startDate) out.push([d, cur]);
    }
    return out;
  },
};

Object.assign(App, {
  /** Fenêtre « Placement sans cotation » : crée l'instrument puis le transmet à `onDone(key)` */
  openManualCreate(onDone) {
    const dlg = $('#manualDialog');
    $('#manualName').value = '';
    $('#manualCurrency').value = this.base();
    $('#manualPrice').value = '';
    $('#manualDate').value = todayISO();
    $('#manualDate').max = todayISO();
    this._manualDone = onDone;
    dlg.showModal();
    setTimeout(() => $('#manualName').focus(), 50);
  },

  bindManual() {
    const dlg = $('#manualDialog');
    if (!dlg) return;
    $('#manualCancel').addEventListener('click', () => dlg.close());
    $('#manualForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#manualName').value.trim();
      const price = parseNum($('#manualPrice').value);
      if (!name || !(price > 0)) { toast('Indique un nom et une valeur positive', 'error'); return; }
      const key = Manual.create({ name, currency: $('#manualCurrency').value, price, date: $('#manualDate').value || todayISO() });
      Api.quote(key);
      dlg.close();
      toast('Placement créé : saisis maintenant ton achat', 'success', 3000);
      if (this._manualDone) this._manualDone(key);
    });
  },

  /** Panneau de la fiche détaillée : valeurs saisies et formulaire de mise à jour */
  renderManualPanel(key) {
    const box = $('#detailManual');
    if (!box) return;
    if (!key || !Manual.is(key)) { box.replaceChildren(); return; }
    const inst = Store.instrument(key);
    const vals = Manual.values(key).reverse();
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO(), required: true });
    const price = el('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', placeholder: 'Valeur d\'une part', required: true });
    const form = el('form', { class: 'manual-form' }, date, price,
      el('button', { type: 'submit', class: 'btn primary' }, 'Mettre à jour'));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const p = parseNum(price.value);
      if (!(p > 0)) { toast('Valeur invalide', 'error'); return; }
      Manual.setValue(key, date.value || todayISO(), p);
      this.renderAll();
      toast('Valeur enregistrée', 'success', 2000);
    });
    box.replaceChildren(
      el('h3', {}, 'Valeur saisie à la main', infoTip('Ce placement n\'a pas de cours automatique. Saisis sa valeur à chaque relevé (valeur d\'une part, ou valeur totale si tu as enregistré 1 part) : elle reste constante jusqu\'à la saisie suivante.')),
      form,
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', { class: 'num' }, 'Valeur d\'une part'), el('th'))),
        el('tbody', {}, ...vals.map(([d, v]) => el('tr', {},
          el('td', {}, fmtDate(d)),
          el('td', { class: 'num' }, fmtMoney(v, inst.currency, 2, true)),
          el('td', { class: 'num' }, vals.length > 1 ? el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
            if (Manual.removeValue(key, d)) this.renderAll();
          } }, '🗑') : null)))))));
  },
});
