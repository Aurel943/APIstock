/*
 * Accueil (Portefeuille › Vue d'ensemble) et niveau d'affichage :
 * - mini-courbe des 30 derniers jours dans le chiffre « Valeur actuelle » ;
 * - vue d'ensemble personnalisable : ordre des cartes et cartes masquées (réglages synchronisés entre appareils) ;
 * - mode « Essentiel » : masque les outils avancés (data-level="expert" dans index.html), le mode « Expert » montre tout.
 */
'use strict';

const Home = {
  /** Réglages de la vue d'ensemble : { order: [id…], hidden: [id…] } */
  conf() {
    const h = (Store.state.settings && Store.state.settings.home) || {};
    return { order: Array.isArray(h.order) ? h.order.slice() : [], hidden: Array.isArray(h.hidden) ? h.hidden.slice() : [] };
  },
  setConf(c) {
    Store.state.settings.home = { order: c.order, hidden: c.hidden };
    Store.save();
  },

  /** Ordre effectif : les identifiants enregistrés d'abord (s'ils existent encore), puis les nouveaux dans l'ordre de la page */
  orderOf(ids, saved) {
    const known = saved.filter(id => ids.includes(id));
    return known.concat(ids.filter(id => !known.includes(id)));
  },

  /** Variation sur les 30 derniers jours (hors versements) et points de la mini-courbe */
  spark(points, today = todayISO()) {
    if (!points || points.length < 3) return null;
    const from = addDaysISO(today, -30);
    let i0 = 0;
    for (let i = 0; i < points.length; i++) { if (points[i].date <= from) i0 = i; else break; }
    const pts = points.slice(i0);
    if (pts.length < 3) return null;
    const idx = Portfolio.twr(pts).map(x => x[1]);
    return { values: idx, pct: (idx[idx.length - 1] / idx[0] - 1) * 100, from: pts[0].date };
  },
};

Object.assign(App, {
  /* ---------------- niveau d'affichage ---------------- */
  level() { return Store.state.settings.level === 'essential' ? 'essential' : 'expert'; },

  setLevel(level) {
    Store.state.settings.level = level === 'essential' ? 'essential' : 'expert';
    Store.save();
    this.applyLevel();
    toast(level === 'essential' ? 'Mode Essentiel : les outils avancés sont masqués (Réglages › Affichage pour tout revoir).' : 'Mode Expert : tous les outils sont affichés.', 'success', 5000);
    this.show(this.view, this.sub);
  },

  applyLevel() {
    const ess = this.level() === 'essential';
    document.body.classList.toggle('level-essential', ess);
    $$('#levelSeg button').forEach(b => b.classList.toggle('active', b.dataset.level === this.level()));
    const m = $('#levelMenuBtn');
    if (m) m.textContent = ess ? '🧩 Passer en mode Expert' : '🧩 Passer en mode Essentiel';
  },

  /** Sous-onglet masqué dans le niveau actuel (utilisé par show) */
  subHidden(view, sub) {
    if (this.level() !== 'essential') return false;
    const b = document.querySelector(`#view-${view} > .subnav button[data-tab="${sub}"]`);
    return !!(b && b.dataset.level === 'expert');
  },

  /** Élément d'un outil avancé en mode Essentiel : on propose de passer en Expert au lieu d'y aller */
  levelBlocks(node) {
    if (this.level() !== 'essential' || !node || !node.closest) return false;
    const card = node.closest('[data-level="expert"]');
    const sec = node.closest('.view');
    const sub = card ? null : node.closest('[data-sub]');
    const hiddenSub = sec && sub && sub.dataset.sub.split(' ').every(s => this.subHidden(sec.id.replace('view-', ''), s));
    if (!card && !hiddenSub) return false;
    toast('Cet outil avancé est masqué en mode Essentiel.', 'info', 7000, { label: 'Passer en Expert', fn: () => { this.setLevel('expert'); setTimeout(() => this.reveal(node), 80); } });
    return true;
  },

  /* ---------------- vue d'ensemble personnalisable ---------------- */
  homeUnits() { return $$('#view-portfolio > [data-home]'); },

  applyHome() {
    const units = this.homeUnits();
    if (!units.length) return;
    const c = Home.conf();
    const ids = units.map(u => u.id);
    const order = Home.orderOf(ids, c.order);
    // réordonne les cartes de la vue d'ensemble à la place de la première, sans toucher aux autres sous-onglets
    const parent = units[0].parentNode;
    const anchor = document.createComment('home');
    parent.insertBefore(anchor, units[0]);
    for (const id of order) parent.insertBefore($('#' + id), anchor);
    anchor.remove();
    for (const u of units) u.classList.toggle('home-off', c.hidden.includes(u.id));
    for (const p of $$('#view-portfolio [data-home-part]')) p.classList.toggle('home-off', c.hidden.includes(p.id));
    const row = $('#evoRow');
    if (row) row.classList.toggle('one-col', row.querySelectorAll(':scope > [data-home-part]:not(.home-off)').length < 2);
    requestAnimationFrame(() => Object.values(Charts.instances).forEach(ch => ch.resize()));
  },

  openHomeDialog() {
    const c = Home.conf();
    const units = this.homeUnits();
    let order = Home.orderOf(units.map(u => u.id), c.order);
    const hidden = new Set(c.hidden);
    const list = el('ol', { class: 'home-list' });
    const draw = () => {
      list.replaceChildren(...order.map((id, i) => {
        const u = $('#' + id);
        const parts = Array.from(u.querySelectorAll('[data-home-part]'));
        const box = (pid, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !hidden.has(pid), onchange: e => { if (e.target.checked) hidden.delete(pid); else hidden.add(pid); } }), ' ' + label);
        return el('li', {},
          el('div', { class: 'home-row' },
            parts.length ? el('b', {}, u.dataset.home) : box(id, u.dataset.home),
            el('span', { class: 'home-move' },
              el('button', { type: 'button', class: 'btn small', 'aria-label': 'Monter', disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '▲'),
              el('button', { type: 'button', class: 'btn small', 'aria-label': 'Descendre', disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '▼'))),
          parts.length ? el('div', { class: 'home-parts' }, ...parts.map(p => box(p.id, p.dataset.homePart))) : null);
      }));
    };
    draw();
    const dlg = el('dialog', { class: 'home-dialog' },
      el('h3', {}, 'Personnaliser la vue d\'ensemble'),
      el('p', { class: 'muted small' }, 'Coche les cartes à afficher et choisis leur ordre. Les chiffres clés restent toujours en haut. Réglage synchronisé avec tes autres appareils.'),
      list,
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => { order = units.map(u => u.id); hidden.clear(); draw(); } }, 'Par défaut'),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Annuler'),
        el('button', { type: 'button', class: 'btn primary', onclick: () => { Home.setConf({ order, hidden: Array.from(hidden) }); this.applyHome(); dlg.close(); toast('Vue d\'ensemble enregistrée ✔', 'success', 2500); } }, 'Enregistrer')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  },

  /* ---------------- mini-courbe de la valeur ---------------- */
  renderKpiSpark() {
    const k = $('#kpis > .kpi');
    if (!k) return;
    const s = Home.spark(this.historyPoints);
    let box = k.querySelector('.kpi-spark');
    if (!s) { if (box) box.remove(); return; }
    if (!box) { box = el('div', { class: 'kpi-spark' }); k.append(box); }
    box.replaceChildren(sparkline(s.values, { w: 120, h: 30, ref: s.values[0] }),
      el('span', { class: 'small ' + trendClass(s.pct) }, '30 j : ' + fmtPct(s.pct)));
    box.title = `Performance hors versements depuis le ${fmtDate(s.from)}`;
  },

  bindHome() {
    $$('#levelSeg button').forEach(b => b.addEventListener('click', () => { if (b.dataset.level !== this.level()) this.setLevel(b.dataset.level); }));
    const m = $('#levelMenuBtn');
    if (m) m.addEventListener('click', () => { this.toggleTabMenu(false); this.setLevel(this.level() === 'essential' ? 'expert' : 'essential'); });
    $$('.homeCustomize').forEach(b => b.addEventListener('click', () => { if (this.view !== 'portfolio' || this.sub !== 'synthese') this.show('portfolio', 'synthese'); this.openHomeDialog(); }));
    this.applyLevel();
    this.applyHome();
    // le niveau ou la vue d'ensemble ont pu changer sur un autre appareil (synchronisation)
    this.on('rendered:all', () => { this.applyLevel(); this.applyHome(); this.renderKpiSpark(); });
    this.on('rendered:portfolio', () => this.renderKpiSpark());
    this.on('history:loaded', () => this.renderKpiSpark());
    // page affichée au démarrage (adresse) masquée en mode Essentiel
    if (this.subHidden(this.view, this.sub)) this.show(this.view);
  },
});

document.addEventListener('DOMContentLoaded', () => { try { App.bindHome(); } catch (e) { App.reportError(e); } });
