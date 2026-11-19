/*
 * Tes jalons (Portefeuille › Vue d'ensemble) : les grandes étapes de ton parcours d'investisseur, calculées sur
 * l'évolution réelle du portefeuille (cours de clôture) et tes opérations — premier achat, paliers de valeur et de
 * gains, plus haut historique, premier dividende, cap des 5 ans du PEA et des 8 ans de l'assurance-vie — et la
 * prochaine étape. Un nouveau palier atteint est salué une fois.
 */
'use strict';

const MILESTONE_STEPS = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const GAIN_STEPS = [100, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

const Milestones = {
  /**
   * points : évolution [{ date, value, invested }] ; txs : opérations ; accounts : comptes ; today
   * → { done: [{ id, date, icon, title, sub }], next: [{ id, icon, title, sub, progress? }] }
   */
  compute({ points = [], txs = [], accounts = [], today = todayISO(), cur = 'EUR', label = k => k, envelope = () => null }) {
    const done = [], next = [];
    const m = x => fmtMoney(x, cur, 0);
    const sorted = txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const firstBuy = sorted.find(t => t.type === 'buy');
    if (firstBuy) done.push({ id: 'first-buy', date: firstBuy.date, icon: '🌱', title: 'Premier achat', sub: label(firstBuy.key) });
    const firstDiv = sorted.find(t => t.type === 'div');
    if (firstDiv) done.push({ id: 'first-div', date: firstDiv.date, icon: '💶', title: 'Premier dividende reçu', sub: label(firstDiv.key) });
    const buys = sorted.filter(t => t.type === 'buy');
    if (buys.length >= 12) done.push({ id: 'buys-12', date: buys[11].date, icon: '🔁', title: '12 achats', sub: 'La régularité paie : investir chaque mois lisse les points d\'entrée.' });

    // paliers de valeur et de gains, sur la courbe réelle
    const last = points[points.length - 1];
    const firstAt = (pred) => { const p = points.find(pred); return p ? p.date : null; };
    for (const s of MILESTONE_STEPS) {
      const d = firstAt(p => p.value >= s);
      if (d) done.push({ id: 'value-' + s, date: d, icon: '🏁', title: `${m(s)} de portefeuille`, sub: 'Valeur atteinte à la clôture' });
    }
    for (const s of GAIN_STEPS) {
      const d = firstAt(p => p.value - p.invested >= s);
      if (d) done.push({ id: 'gain-' + s, date: d, icon: '📈', title: `${m(s)} de gains`, sub: 'Plus-value latente (valeur − montant investi)' });
    }
    if (last) {
      const nextV = MILESTONE_STEPS.find(s => last.value < s);
      if (nextV) {
        const prev = MILESTONE_STEPS[MILESTONE_STEPS.indexOf(nextV) - 1] || 0;
        next.push({ id: 'next-value', icon: '🏁', title: `${m(nextV)} de portefeuille`, sub: `Encore ${m(nextV - last.value)}`, progress: Math.max(0, Math.min(1, (last.value - prev) / (nextV - prev))) });
      }
      // plus haut historique
      let ath = points[0];
      for (const p of points) if (p.value - p.invested >= ath.value - ath.invested) ath = p;
      const athGain = ath.value - ath.invested;
      if (points.length > 20 && athGain > 0) {
        const recent = Date.parse(today) - Date.parse(ath.date) <= 7 * 864e5;
        done.push({ id: 'ath-' + ath.date.slice(0, 7), date: ath.date, icon: '⭐', title: recent ? 'Nouveau record de gains' : 'Record de gains', sub: `${m(athGain)} de plus-value latente` + (recent ? ' : bravo !' : ''), recent });
        const dd = last.value - last.invested - athGain;
        if (!recent && dd < 0 && last.value > 0) next.push({ id: 'back-ath', icon: '⭐', title: 'Retrouver ton record de gains', sub: `${m(-dd)} sous le record du ${fmtDate(ath.date)}` });
      }
    }

    // caps fiscaux
    for (const a of accounts) {
      const e = envelope(a);
      if (!e || !e.date) continue;
      const item = { id: e.id + '-' + a.id, icon: '🗓', title: `${a.name} : ${e.what}`, sub: e.sub };
      if (e.date <= today) done.push(Object.assign(item, { date: e.date }));
      else next.push(Object.assign(item, { date: e.date, sub: `Le ${fmtDate(e.date)} (dans ${fmtSpan(today, e.date)}) · ${e.sub}` }));
    }
    done.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    next.sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
    return { done, next };
  },
};

Object.assign(App, {
  milestoneEnvelope(a) {
    if (typeof Tax === 'undefined') return null;
    if (a.type === 'pea') { const p = Tax.pea(a); return p.five ? { id: 'pea5', date: p.five, what: 'cap des 5 ans', sub: 'gains exonérés d\'impôt sur le revenu' } : null; }
    if (a.type === 'av') { const v = Tax.av(a); return v.eight ? { id: 'av8', date: v.eight, what: 'cap des 8 ans', sub: 'abattement annuel sur les gains' } : null; }
    return null;
  },

  renderMilestones() {
    const card = $('#milestoneCard'), box = $('#milestoneBody');
    if (!card || !box) return;
    const txs = Portfolio.txs('all');
    card.classList.toggle('hidden', !txs.length);
    if (!txs.length) return;
    const R = Milestones.compute({ points: this.historyPoints || [], txs, accounts: Store.state.accounts || [], cur: this.base(),
      label: k => Store.label(k), envelope: a => this.milestoneEnvelope(a) });
    const open = this._msAll;
    const shown = open ? R.done : R.done.slice(0, 5);
    box.replaceChildren(...[
      R.next.length ? el('div', { class: 'ms-next' }, el('h4', { class: 'sub-title' }, 'Prochaines étapes'),
        el('ul', { class: 'ms-list' }, ...R.next.slice(0, 3).map(x => el('li', { class: 'ms-item next' },
          el('span', { class: 'ms-icon', 'aria-hidden': 'true' }, x.icon),
          el('div', {}, el('b', {}, x.title), el('div', { class: 'muted small' }, x.sub),
            x.progress !== undefined ? el('div', { class: 'ab-track ms-bar' }, el('span', { class: 'ab-fill', style: `width:${Math.round(x.progress * 100)}%` })) : null))))) : null,
      el('h4', { class: 'sub-title' }, 'Ton parcours'),
      el('ol', { class: 'ms-list ms-done' }, ...shown.map(x => el('li', { class: 'ms-item' + (x.recent ? ' recent' : '') },
        el('span', { class: 'ms-icon', 'aria-hidden': 'true' }, x.icon),
        el('div', {}, el('b', {}, x.title), el('div', { class: 'muted small' }, fmtDate(x.date) + (x.sub ? ' · ' + x.sub : '')))))),
      R.done.length > 5 ? el('button', { type: 'button', class: 'link small', onclick: () => { this._msAll = !open; this.renderMilestones(); } }, open ? 'Réduire' : `Voir les ${R.done.length} étapes`) : null,
      this.historyPoints ? null : el('p', { class: 'muted small' }, 'Paliers et records calculés une fois l\'évolution du portefeuille chargée.')].filter(Boolean));
    this.celebrateMilestones(R.done);
  },

  /** Salue une fois un palier atteint depuis la dernière visite (pas au premier calcul : tout serait « nouveau ») */
  celebrateMilestones(done) {
    if (!this.historyPoints) return;
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem('apistock:milestones') || 'null'); } catch (e) { seen = null; }
    const ids = done.filter(x => !x.id.startsWith('ath-')).map(x => x.id);
    if (seen) {
      const fresh = done.filter(x => ids.includes(x.id) && !seen.includes(x.id) && Date.parse(todayISO()) - Date.parse(x.date) <= 14 * 864e5);
      if (fresh.length) toast(`🎉 Nouvelle étape : ${fresh[0].title}` + (fresh.length > 1 ? ` (et ${fresh.length - 1} autre${fresh.length > 2 ? 's' : ''})` : ''), 'success', 7000);
    }
    try { localStorage.setItem('apistock:milestones', JSON.stringify(Array.from(new Set([...(seen || []), ...ids])))); } catch (e) { /* stockage indisponible */ }
  },
});

App.on('rendered:all', function () { this.renderMilestones(); });
App.on('history:loaded', function () { this.renderMilestones(); });
