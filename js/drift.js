/*
 * Alerte de dérive d'allocation : prévient quand une ligne s'écarte de sa cible (Planifier › Investir) de plus du seuil
 * choisi dans « Rééquilibrage sans vente ».
 * - site ouvert : notification du navigateur (une fois par mois au plus, comme l'élément « À faire ») ;
 * - site fermé : seuils de cours transmis au relais avec les alertes de prix push. Pour chaque ligne, le cours à partir
 *   duquel elle dépasserait sa cible (ou passerait sous sa cible) de plus du seuil, les autres lignes restant à leur
 *   valeur du moment ; recalculés à chaque ouverture du site.
 */
'use strict';

const Drift = {
  /**
   * lines : [{ key, qty, unitPrice (devise de base), target (%), value (devise de base) }], h : seuil (points de %),
   * fx(key) : taux devise de cotation → devise de base.
   * → [{ key, dir: 'up'|'down', price (devise de cotation), weight (% visé au déclenchement) }]
   */
  bands(lines, h, fx = () => 1) {
    const V = lines.reduce((s, l) => s + (l.value || 0), 0);
    const out = [];
    if (!(V > 0) || !(h > 0)) return out;
    for (const l of lines) {
      if (!(l.target > 0) || !(l.qty > 0)) continue;
      const others = V - (l.value || 0);
      const rate = fx(l.key);
      if (!(others > 0) || !(rate > 0)) continue;
      for (const [dir, w] of [['up', (l.target + h) / 100], ['down', (l.target - h) / 100]]) {
        if (!(w > 0) || w >= 1) continue;
        const pBase = (w * others) / ((1 - w) * l.qty);
        out.push({ key: l.key, dir, price: pBase / rate, weight: w * 100 });
      }
    }
    return out;
  },

  month(today = todayISO()) { return today.slice(0, 7); },
};

Object.assign(App, {
  /** La dérive a déjà été signalée ce mois-ci (notification ou push) */
  driftNotified() {
    const r = this.rebalState();
    return r.notified === Drift.month();
  },

  markDriftNotified() {
    const r = this.rebalState();
    if (r.notified === Drift.month()) return;
    r.notified = Drift.month();
    Store.save();
    this._driftBands = null;
    if (this.schedulePushSync) this.schedulePushSync(); // seuils retirés du relais
  },

  /** Alertes de cours à transmettre au relais pour prévenir d'une dérive, site fermé */
  driftPushAlerts() {
    const r = this.rebalState();
    if (!r.notify || !(r.threshold > 0) || this.driftNotified()) return [];
    // seuils figés pour la journée : sinon chaque cotation les déplacerait et relancerait la synchronisation
    const sig = todayISO() + '|' + r.threshold + '|' + JSON.stringify(Store.state.targets || {});
    if (this._driftBands && this._driftBands.sig === sig) return this._driftBands.list;
    const info = this.rebalanceInfo();
    if (!info || info.lines.some(l => l.target > 0 && !(l.unitPrice > 0))) return []; // cours pas encore chargés
    if (info.drift.max >= r.threshold) return []; // déjà déséquilibrée : signalée site ouvert
    const out = [];
    for (const b of Drift.bands(info.lines, r.threshold, k => { const i = Store.instrument(k); return i ? Api.fxCached(i.currency) : NaN; })) {
      const inst = Store.instrument(b.key);
      const s = inst && yahooSymbolFor(inst);
      if (!s || !isFinite(b.price) || b.price <= 0) continue;
      const tgt = parseNum(Store.state.targets[b.key]) || 0;
      out.push({ id: ('drift:' + b.key).slice(0, 36) + (b.dir === 'up' ? ':u' : ':d'), s, k: b.dir === 'up' ? 'above' : 'below', v: Math.round(b.price * 1000) / 1000,
        t: `⚖️ Allocation : ${Store.label(b.key)} ${b.dir === 'up' ? 'au-dessus' : 'en dessous'} de sa cible de ${fmtNum(tgt, 0)} % de plus de ${fmtNum(r.threshold, 1)} pt` });
    }
    this._driftBands = { sig, list: out };
    return out;
  },

  /** Site ouvert : notification dès que la dérive dépasse le seuil (une fois par mois) */
  checkDriftNotify() {
    const r = this.rebalState();
    if (!r.notify || !(r.threshold > 0) || this.driftNotified()) return;
    const info = this.rebalanceInfo();
    if (!info || info.drift.max < r.threshold) return;
    if ((Store.state.dismissed || {})['rebal:' + Drift.month()]) return;
    const worst = info.drift.lines.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
    this.markDriftNotified();
    const body = `${Store.label(worst.key)} : ${fmtNum(worst.weight, 1)} % du portefeuille pour une cible de ${fmtNum(worst.target, 1)} %.`
      + (info.amount > 0.5 ? ` Revenir à la cible sans vendre : ≈ ${fmtMoney(info.amount, this.base(), 0)} à investir.` : '');
    this.notify('⚖️ Allocation déséquilibrée', body);
  },

  /** Case « Me prévenir » du rééquilibrage */
  driftToggle() {
    const r = this.rebalState();
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    return el('label', { class: 'check small drift-notify', title: 'Notification du navigateur dès que le seuil est dépassé (une fois par mois), et même site fermé si les alertes push sont activées (Agenda › Alertes).' },
      el('input', { type: 'checkbox', checked: !!r.notify, disabled: perm === 'unsupported' || null, onchange: async e => {
        r.notify = e.target.checked;
        if (r.notify && perm === 'default') { try { await Notification.requestPermission(); } catch (err) { /* refusé */ } }
        Store.save();
        if (this.schedulePushSync) this.schedulePushSync();
        this.checkDriftNotify();
        toast(r.notify ? 'Tu seras prévenu quand ton allocation s\'écarte de ta cible.' : 'Alerte de dérive désactivée.', 'success', 3500);
      } }), ' Me prévenir par notification');
  },
});

App.on('rendered:portfolio', function () { if (Api.ready()) this.checkDriftNotify(); });
// seuils disponibles une fois les cours chargés : transmis au relais si les alertes push sont actives
App.on('refreshed', function () { if (this.schedulePushSync && this.pushConf && this.pushConf()) this.schedulePushSync(); });
