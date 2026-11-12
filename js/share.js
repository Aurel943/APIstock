/*
 * Partage de répartition par lien : uniquement les ETF et leurs pourcentages, jamais de montant.
 * Tout est dans la partie « # » de l'adresse, qui n'est pas envoyée au serveur qui héberge le site.
 * La personne qui ouvre le lien voit la répartition et peut l'utiliser comme allocation cible.
 */
'use strict';

const Share = {
  /** Encodage base64url d'un texte UTF-8 */
  b64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  unb64(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },

  /** Répartition → fragment « share=… » ; `lines` : [{ symbol, mic, ysymbol, name, currency, weight (%) }] */
  encode(title, lines) {
    const l = lines.filter(x => x.weight > 0).map(x => [x.symbol, x.mic || '', x.ysymbol || '', (x.name || '').slice(0, 60), x.currency || '', Math.round(x.weight * 10) / 10]);
    return 'share=' + this.b64(JSON.stringify({ v: 1, t: (title || '').slice(0, 60), l }));
  },

  /** Fragment → { title, lines } ; null si le lien est invalide (contrôles stricts : il vient de l'extérieur) */
  decode(hash) {
    const m = /^#?share=([A-Za-z0-9_-]{4,4000})$/.exec(hash || '');
    if (!m) return null;
    try {
      const o = JSON.parse(this.unb64(m[1]));
      if (!o || o.v !== 1 || !Array.isArray(o.l) || !o.l.length || o.l.length > 30) return null;
      const txt = (v, n) => String(v || '').replace(/[<>]/g, '').slice(0, n);
      const lines = o.l.map(a => ({ symbol: String(a[0] || '').slice(0, 21).toUpperCase(), mic: txt(a[1], 6).toUpperCase(), ysymbol: txt(a[2], 24), name: txt(a[3], 60), currency: txt(a[4], 4), weight: Number(a[5]) }))
        .filter(x => /^[A-Z0-9.\-^=]{1,20}$/.test(x.symbol) && isFinite(x.weight) && x.weight > 0 && x.weight <= 100);
      const sum = lines.reduce((s, x) => s + x.weight, 0);
      if (!lines.length || sum > 100.5) return null;
      return { title: txt(o.t, 60), lines };
    } catch (e) { return null; }
  },
};

Object.assign(App, {
  /** Ma répartition à partager : la cible si elle fait 100 %, sinon les poids actuels */
  shareLines() {
    const fromKeys = w => Object.entries(w).map(([k, v]) => { const i = Store.instrument(k); return { symbol: i.symbol, mic: i.mic, ysymbol: i.ysymbol, name: Store.label(k), currency: i.currency, weight: v }; });
    const tgt = Object.entries(Store.state.targets || {}).filter(([k, v]) => parseNum(v) > 0 && Store.instrument(k) && !Manual.is(k));
    const tsum = tgt.reduce((s, [, v]) => s + parseNum(v), 0);
    if (tgt.length && Math.abs(tsum - 100) < 0.5) return fromKeys(Object.fromEntries(tgt.map(([k, v]) => [k, parseNum(v)])));
    // valeur actuelle, ou montant investi tant que les cours ne sont pas chargés
    const w = r => (isFinite(r.valueBase) && r.valueBase > 0 ? r.valueBase : r.costBase);
    const rows = Portfolio.snapshot('all').rows.filter(r => !Manual.is(r.key) && w(r) > 0);
    const t = rows.reduce((s, r) => s + w(r), 0);
    return t > 0 ? fromKeys(Object.fromEntries(rows.map(r => [r.key, w(r) / t * 100]))) : [];
  },

  async shareAllocation() {
    const lines = this.shareLines();
    if (!lines.length) { toast('Rien à partager : ajoute des lignes ou une allocation cible.'); return; }
    const url = location.origin + location.pathname + '#' + Share.encode('Ma répartition', lines);
    const text = 'Ma répartition d\'ETF (pourcentages seulement, aucun montant)';
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'APIstock', text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Lien copié : il ne contient que les ETF et leurs pourcentages.', 'success', 5000);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie ce lien :', url);
    }
  },

  /** À l'ouverture d'un lien partagé : aperçu et choix */
  openSharedFromHash(hash = location.hash) {
    const shared = Share.decode(hash);
    if (!shared) return false;
    history.replaceState(null, '', location.pathname + '#portfolio');
    const terOf = s => (typeof ETF_DB !== 'undefined' && ETF_DB[s] ? ETF_DB[s][1] : NaN);
    const known = shared.lines.filter(l => isFinite(terOf(l.symbol)));
    const ter = known.length ? known.reduce((s, l) => s + l.weight * terOf(l.symbol), 0) / known.reduce((s, l) => s + l.weight, 0) : NaN;
    const mine = new Map(this.shareLines().map(l => [l.symbol, l.weight]));
    const dlg = el('dialog', { class: 'share-dialog' },
      el('form', { method: 'dialog', class: 'stack' },
        el('h2', {}, 'Répartition partagée', infoTip('Quelqu\'un t\'a envoyé sa répartition : uniquement des ETF et des pourcentages, aucun montant. Rien n\'est modifié tant que tu ne choisis pas de l\'utiliser.')),
        shared.title ? el('p', { class: 'muted' }, '« ' + shared.title + ' »') : null,
        el('div', { class: 'model-bar' }, ...shared.lines.map((l, i) => el('span', { style: `width:${l.weight}%;background:${PALETTE[i % PALETTE.length]}` }))),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, el('th', {}, 'ETF'), el('th', { class: 'num' }, 'Partagée'), mine.size ? el('th', { class: 'num' }, 'La tienne') : null)),
          el('tbody', {}, ...shared.lines.map((l, i) => el('tr', {},
            el('td', {}, el('span', { class: 'dot', style: `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${PALETTE[i % PALETTE.length]}` }),
              el('b', {}, l.name || l.symbol), el('div', { class: 'muted small' }, l.symbol + (l.mic ? ' · ' + l.mic : ''))),
            el('td', { class: 'num mono' }, fmtNum(l.weight, 1) + ' %'),
            mine.size ? el('td', { class: 'num mono muted' }, mine.has(l.symbol) ? fmtNum(mine.get(l.symbol), 1) + ' %' : '—') : null))))),
        isFinite(ter) ? el('p', { class: 'small muted' }, `Frais courants moyens ≈ ${fmtNum(ter, 2)} % par an (ETF connus du site).`) : null,
        el('div', { class: 'actions end' },
          el('button', { type: 'submit', class: 'btn' }, 'Fermer'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => { dlg.close(); this.adoptShared(shared); } }, 'Utiliser comme cible'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return true;
  },

  /** Crée les lignes (sans recherche : symbole Yahoo fourni) et applique la répartition comme cible */
  adoptShared(shared) {
    if (Object.values(Store.state.targets).some(v => parseNum(v) > 0) && !confirm('Remplacer ton allocation cible actuelle ?')) return;
    for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
    for (const l of shared.lines) {
      const key = Store.upsertInstrument({ symbol: l.symbol, mic: l.mic, name: l.name || l.symbol, currency: l.currency || this.base(),
        provider: l.ysymbol ? 'yahoo' : undefined, ysymbol: l.ysymbol || undefined });
      Store.state.targets[key] = l.weight;
    }
    Store.save();
    this.renderAll();
    this.refresh();
    this.show('invest');
    toast('Répartition appliquée comme cible : le plan te dit quoi acheter pour t\'en rapprocher.', 'success', 6000);
  },
});
