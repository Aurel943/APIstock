/*
 * Chargement à la demande : les modules propres à une page ne sont téléchargés et exécutés qu'à la première
 * ouverture de cette page (ou d'un bouton qui en a besoin), pas au démarrage.
 *
 * Chaque module :
 *   files    scripts à charger, dans l'ordre
 *   deps     modules à charger avant
 *   pages    pages (« espace/sous-onglet ») dont les cartes utilisent le module
 *   probe    méthode d'App définie par le module : présente = module déjà chargé (tests, ancienne page)
 *   bind     méthode d'App appelée une fois le module chargé (branchement des boutons)
 *   stubs    méthodes d'App appelées d'ailleurs (copilote…) : remplacées en attendant par « charger puis appeler »
 *   triggers boutons hors des pages (menu…) : un clic charge le module puis appelle la méthode
 *
 * Une fois chargé, les écouteurs que le module vient d'ajouter (« view:shown », « rendered:all »…) sont appelés
 * pour la page affichée, comme s'il avait été là dès le départ. Un clic sur un bouton de la page pendant le
 * chargement est rejoué une fois le module prêt.
 */
'use strict';

const LAZY = {
  desk: { files: ['js/desk.js'], pages: ['portfolio/operations', 'analysis/performance', 'markets/signaux'], probe: 'bindDesk', bind: 'bindDesk', stubs: ['runSignals'] },
  institut: { files: ['js/institut.js'], deps: ['desk'], pages: ['plan/objectifs', 'analysis/risque', 'analysis/optimiser'], probe: 'bindInstitut', bind: 'bindInstitut', stubs: ['runReverseStress', 'runBlackLitterman'] },
  arena: { files: ['js/arena.js'], pages: ['plan/arene'], probe: 'bindArena', bind: 'bindArena', stubs: ['newArenaGame', 'speakBriefing'] },
  terminal: { files: ['js/termchart.js', 'js/terminal.js'], pages: ['analysis/composition', 'markets/signaux'], probe: 'bindTerminal', bind: 'bindTerminal', stubs: ['openTerminal', 'runScan'], triggers: { '#termOpen': 'openTerminal' } },
  screener: { files: ['js/screener.js'], pages: ['markets/signaux'], probe: 'runScreener' },
  attribution: { files: ['js/attribution.js'], pages: ['analysis/performance'], probe: 'bindAttribution' },
  revue: { files: ['js/revue.js'], deps: ['desk'], pages: ['analysis/performance'], probe: 'renderReviewForm' },
  xlsx: { files: ['js/xlsx.js'], pages: ['portfolio/operations', 'settings'], probe: 'exportXlsx' },
  etfcompare: { files: ['js/etfcompare.js'], pages: ['markets/comparer'], probe: 'renderEtfCompareForm' },
  credit: { files: ['js/credit.js'], pages: ['plan/simuler'], probe: 'renderCredit' },
  courtiers: { files: ['js/courtiers.js'], pages: ['portfolio/operations'], probe: 'renderBrokers' },
  obligations: { files: ['js/obligations.js'], pages: ['analysis/risque'], probe: 'renderBonds' },
  diversif: { files: ['js/diversif.js'], pages: ['analysis/risque'], probe: 'renderDiversif' },
  budget: { files: ['js/budget.js'], pages: ['plan/investir'], probe: 'renderBudget' },
  enveloppes: { files: ['js/enveloppes.js'], deps: ['budget'], pages: ['plan/investir'], probe: 'renderEnvelopes' },
};
/* événements rejoués pour les écouteurs ajoutés par un module chargé en retard */
const LAZY_REPLAY = ['rendered:all', 'rendered:portfolio', 'rendered:invest', 'view:shown', 'detail:selected'];

const Lazy = {
  done: new Set(),
  loading: new Map(), // module -> promesse
  version: '',

  init() {
    const me = typeof document !== 'undefined' && document.currentScript ? document.currentScript.getAttribute('src') || '' : '';
    this.version = (me.match(/\?v=([^&]+)/) || [])[1] || '';
    for (const [name, m] of Object.entries(LAZY)) {
      if (typeof App[m.probe] === 'function') { this.done.add(name); continue; }
      for (const s of m.stubs || []) {
        if (typeof App[s] === 'function') continue;
        const stub = function (...args) { return Lazy.load(name).then(() => (App[s] === stub ? undefined : App[s].apply(App, args))); };
        App[s] = stub;
      }
    }
    if (typeof document === 'undefined' || !document.addEventListener) return;
    // boutons hors des pages (menu ⋯) : un clic charge le module
    document.addEventListener('click', e => {
      for (const [name, m] of Object.entries(LAZY)) {
        if (this.done.has(name) || !m.triggers) continue;
        for (const [sel, method] of Object.entries(m.triggers)) {
          if (!e.target.closest || !e.target.closest(sel)) continue;
          e.preventDefault(); e.stopPropagation();
          if (App.toggleTabMenu) App.toggleTabMenu(false);
          this.load(name).then(() => App[method]());
          return;
        }
      }
      // clic sur la page pendant le chargement de ses modules : rejoué une fois prêts
      const busy = this.pagePending;
      const t = e.target.closest && e.target.closest('button, a[href], input[type=checkbox], input[type=radio], summary, [role=button]');
      if (busy && t && t.closest('.view.active') && !t.dataset.lazyReplay) {
        e.preventDefault(); e.stopPropagation();
        busy.then(() => { t.dataset.lazyReplay = '1'; try { t.click(); } finally { delete t.dataset.lazyReplay; } });
      }
    }, true);
    App.on('view:shown', page => this.forPage(page));
  },

  /** Modules nécessaires à une page */
  modulesFor(page) {
    const view = String(page || '').split('/')[0];
    return Object.keys(LAZY).filter(n => LAZY[n].pages.some(p => p === page || p === view));
  },

  /** Charge les modules d'une page (appelé à chaque affichage de page) */
  forPage(page) {
    const need = this.modulesFor(page).filter(n => !this.done.has(n));
    if (!need.length) return null;
    const p = Promise.all(need.map(n => this.load(n))).catch(() => {});
    this.pagePending = p;
    p.finally(() => { if (this.pagePending === p) this.pagePending = null; });
    return p;
  },

  script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src + (this.version ? '?v=' + this.version : '');
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('fichier ' + src + ' introuvable'));
      document.body.append(s);
    });
  },

  /** Charge un module (et ses dépendances) une seule fois */
  load(name) {
    const m = LAZY[name];
    if (!m || this.done.has(name)) return Promise.resolve();
    if (this.loading.has(name)) return this.loading.get(name);
    const p = (async () => {
      for (const d of m.deps || []) await this.load(d);
      const before = {};
      for (const ev of LAZY_REPLAY) before[ev] = (App._listeners[ev] || []).slice();
      for (const f of m.files) await this.script(f);
      this.done.add(name);
      if (m.bind && typeof App[m.bind] === 'function') { try { App[m.bind](); } catch (e) { App.reportError(e); } }
      // écouteurs ajoutés par le module : appelés pour l'état actuel
      const call = (ev, ...args) => {
        for (const fn of (App._listeners[ev] || []).filter(f => !before[ev].includes(f))) {
          try { fn.apply(App, args); } catch (e) { App.reportError(e); }
        }
      };
      call('rendered:all');
      call('rendered:portfolio');
      if (App.isPage('plan/investir', 'plan/objectifs')) call('rendered:invest');
      if (App.detailKey) call('detail:selected', App.detailKey, null);
      call('view:shown', App.page);
    })();
    this.loading.set(name, p);
    p.catch(e => {
      this.loading.delete(name);
      if (typeof toast === 'function') toast('Chargement impossible (' + e.message + '). Vérifie ta connexion, puis réessaie.', 'error', 8000);
    });
    return p;
  },

  /** Tous les fichiers chargés à la demande (rechargement complet, cache hors ligne) */
  allFiles() { return Object.values(LAZY).flatMap(m => m.files); },
};

Lazy.init();
