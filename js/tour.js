/*
 * Visite guidée : quelques bulles qui présentent l'organisation de l'application (5 espaces, sous-onglets, copilote,
 * menu ⋯, ajout d'une opération). Lancée une fois au premier démarrage (puis mémorisée), relançable depuis le menu ⋯.
 * Chaque étape vise le premier élément visible parmi ses sélecteurs (barre du haut sur ordinateur, du bas sur téléphone).
 */
'use strict';

const TOUR_STORE = 'apistock:tourDone';
const TOUR_STEPS = [
  { title: 'Bienvenue dans APIstock', text: 'Tout est rangé en 5 espaces, selon ce que tu veux faire. Petit tour en une minute ; « Passer » pour le faire plus tard (menu ⋯).' },
  { sel: ['.tabs .tab[data-view="portfolio"]', '#bottomNav [data-view="portfolio"]'], title: 'Portefeuille : ce que tu as', text: 'Vue d\'ensemble du jour, patrimoine, revenus & impôts, et l\'historique de tes opérations.' },
  { sel: ['.tabs .tab[data-view="analysis"]', '#bottomNav [data-view="analysis"]'], title: 'Analyse : le comprendre', text: 'Les entreprises que tu possèdes vraiment, d\'où viennent tes gains, ton risque et une répartition optimisée.' },
  { sel: ['.tabs .tab[data-view="markets"]', '#bottomNav [data-view="markets"]'], title: 'Marchés : explorer', text: 'Fiches complètes (analystes, résultats, composition d\'un ETF), marchés du monde, comparateurs et catalogue d\'ETF.' },
  { sel: ['.tabs .tab[data-view="agenda"]', '#bottomNav [data-view="agenda"]'], title: 'Agenda : ce qui arrive', text: 'Résultats des sociétés, décisions des banques centrales, dividendes, versements à faire et tes alertes de prix.' },
  { sel: ['.tabs .tab[data-view="plan"]', '#bottomNav [data-view="plan"]'], title: 'Planifier : décider', text: 'Ton allocation cible et le plan d\'achat du mois, tes objectifs, et des simulations sur données réelles.' },
  { sel: ['.view.active > .subnav'], title: 'Les sous-onglets', text: 'Chaque espace se découpe en sous-onglets. L\'appli rouvre toujours le dernier que tu as consulté.' },
  { sel: ['#copilotBtn'], title: 'Le copilote', text: 'Pose une question en français : « dividendes 2025 », « j\'ai besoin de 5 000 € », « crash test »… Raccourci : Ctrl+K.' },
  { sel: ['#tabMoreBtn'], title: 'Le menu ⋯', text: 'Mode terminal, ton année en bourse, thème clair ou sombre, réglages… et cette visite, pour la refaire.' },
  { sel: ['#addTxBtn', '#fabAdd'], title: 'C\'est parti', text: 'Ajoute tes achats, ventes et dividendes ici (ou importe un relevé CSV depuis Portefeuille › Opérations).' },
];

const Tour = {
  done() { try { return !!localStorage.getItem(TOUR_STORE); } catch (e) { return true; } },
  markDone() { try { localStorage.setItem(TOUR_STORE, String(Date.now())); } catch (e) { /* stockage indisponible */ } },
  /** Premier élément visible (dimensions non nulles) parmi des sélecteurs */
  target(sels) {
    for (const s of sels || []) {
      for (const n of document.querySelectorAll(s)) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return n; }
    }
    return null;
  },
};

Object.assign(App, {
  startTour(i = 0) {
    this.endTour(false);
    if (this.view !== 'portfolio') this.show('portfolio');
    const root = el('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tourTitle' },
      el('div', { class: 'tour-spot' }), el('div', { class: 'tour-bubble' }));
    document.body.append(root);
    this._tour = { root, i: -1 };
    this._tourKey = e => {
      if (!this._tour) return;
      if (e.key === 'Escape') { e.preventDefault(); this.endTour(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.tourGo(this._tour.i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.tourGo(this._tour.i - 1); }
    };
    this._tourPlace = () => { if (this._tour) this.tourPlace(); };
    document.addEventListener('keydown', this._tourKey);
    window.addEventListener('resize', this._tourPlace);
    window.addEventListener('scroll', this._tourPlace, true);
    this.tourGo(i);
  },

  tourGo(i) {
    const t = this._tour;
    if (!t) return;
    if (i >= TOUR_STEPS.length) { this.endTour(); toast('Bonne découverte ! La visite reste disponible dans le menu ⋯.', 'success', 4000); return; }
    t.i = Math.max(0, i);
    const s = TOUR_STEPS[t.i];
    const last = t.i === TOUR_STEPS.length - 1;
    const bubble = t.root.querySelector('.tour-bubble');
    bubble.replaceChildren(
      el('p', { class: 'tour-step muted small' }, `${t.i + 1} / ${TOUR_STEPS.length}`,
        el('span', { class: 'tour-dots', 'aria-hidden': 'true' }, ...TOUR_STEPS.map((x, k) => el('i', { class: k === t.i ? 'on' : '' })))),
      el('h3', { id: 'tourTitle' }, s.title),
      el('p', {}, s.text),
      el('div', { class: 'tour-actions' },
        el('button', { type: 'button', class: 'link small', onclick: () => this.endTour() }, last ? 'Fermer' : 'Passer'),
        t.i > 0 ? el('button', { type: 'button', class: 'btn small', onclick: () => this.tourGo(t.i - 1) }, 'Précédent') : null,
        el('button', { type: 'button', class: 'btn small primary tour-next', onclick: () => this.tourGo(t.i + 1) }, last ? 'Terminer' : t.i === 0 ? 'C\'est parti' : 'Suivant')));
    const node = Tour.target(s.sel);
    if (node) node.scrollIntoView({ block: 'nearest' });
    this.tourPlace();
    requestAnimationFrame(() => { const b = bubble.querySelector('.tour-next'); if (b) b.focus(); });
  },

  /** Projecteur sur l'élément visé et bulle au plus près, sans sortir de l'écran */
  tourPlace() {
    const t = this._tour;
    if (!t) return;
    const s = TOUR_STEPS[t.i];
    const spot = t.root.querySelector('.tour-spot'), bubble = t.root.querySelector('.tour-bubble');
    const node = Tour.target(s.sel);
    const W = window.innerWidth, H = window.innerHeight, pad = 6, gap = 12;
    const bw = Math.min(340, W - 24);
    bubble.style.width = bw + 'px';
    if (!node) {
      spot.style.cssText = `left:${W / 2}px;top:${H / 2}px;width:0;height:0`;
      const bh = bubble.offsetHeight;
      bubble.style.left = Math.round((W - bw) / 2) + 'px';
      bubble.style.top = Math.round(Math.max(12, (H - bh) / 2)) + 'px';
      return;
    }
    const r = node.getBoundingClientRect();
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    const bh = bubble.offsetHeight;
    const below = r.bottom + pad + gap + bh <= H - 8 || r.top < H / 2;
    const top = below ? Math.min(r.bottom + pad + gap, H - bh - 8) : Math.max(8, r.top - pad - gap - bh);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), W - bw - 12);
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(Math.max(8, top)) + 'px';
  },

  endTour(mark = true) {
    if (!this._tour) return;
    this._tour.root.remove();
    this._tour = null;
    document.removeEventListener('keydown', this._tourKey);
    window.removeEventListener('resize', this._tourPlace);
    window.removeEventListener('scroll', this._tourPlace, true);
    if (mark) Tour.markDone();
  },

  bindTour() {
    if ($('#tourOpen')) $('#tourOpen').addEventListener('click', () => this.startTour());
    // premier lancement : la visite démarre une fois l'écran prêt (pas pendant un lien partagé ou une fenêtre ouverte)
    if (!Tour.done()) setTimeout(() => { if (!Tour.done() && !this._tour && !document.querySelector('dialog[open]')) this.startTour(); }, 900);
  },
});
