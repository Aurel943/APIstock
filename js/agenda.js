/*
 * Agenda financier : toutes les échéances au même endroit (versements programmés, dividendes attendus,
 * jours de bourse fermée, jalons PEA / assurance-vie, déclaration fiscale, relevés à saisir),
 * exportables vers l'agenda du téléphone (fichier .ics).
 */
'use strict';

const AGENDA_KINDS = {
  plan: { label: 'Versements', icon: '🗓' },
  div: { label: 'Dividendes', icon: '💶' },
  market: { label: 'Bourse', icon: '🏛' },
  tax: { label: 'Fiscalité', icon: '🧾' },
  todo: { label: 'Relevés', icon: '✏️' },
};

const Agenda = {
  /** Échéances des `days` prochains jours, triées par date : [{ date, kind, title, sub, amount? }] */
  events(today = todayISO(), days = 366) {
    const end = addDaysISO(today, days);
    const cur = Store.state.settings.baseCurrency;
    const out = [];
    const inRange = d => d >= today && d <= end;

    // versements programmés actifs : chaque mois jusqu'à l'horizon
    for (const p of Store.state.plans || []) {
      if (p.active === false || !p.start) continue;
      let month = (p.start > today ? p.start : today).slice(0, 7);
      for (let g = 0; g < 14; g++, month = addMonthsISO(month + '-01', 1).slice(0, 7)) {
        const d = Portfolio.planDate(p, month);
        if (d < p.start || !inRange(d) || (p.done && p.done[month])) continue;
        out.push({ date: d, kind: 'plan', amount: parseNum(p.amount), title: `Versement programmé · ${Store.label(p.key)}`,
          sub: fmtMoney(parseNum(p.amount), cur, 0) + (Store.state.accounts.length > 1 ? ' · ' + Store.account(p.account).name : '') });
      }
    }

    // dividendes attendus (d'après les détachements des 12 derniers mois)
    if (typeof App !== 'undefined' && App.divForecast) {
      for (const d of App.divForecast(today, 'all')) {
        if (!inRange(d.date)) continue;
        out.push({ date: d.date, kind: 'div', amount: d.amount, title: `Dividende attendu · ${Store.label(d.key)}`,
          sub: (isFinite(d.amount) ? '≈ ' + fmtMoney(d.amount, cur) + ' brut' : 'montant inconnu') + ` (${fmtMoney(d.perShare, d.currency, 3)} par part)` });
      }
    }

    // bourses où tu as des lignes : jours fériés et clôtures anticipées
    const held = Portfolio.snapshot('all').rows;
    const exchanges = new Map();
    for (const r of held) { const ex = r.inst && Markets.forMic(r.inst.mic); if (ex && ex.holidays) exchanges.set(ex.id, ex); }
    for (const ex of exchanges.values()) {
      const H = HOLIDAYS[ex.holidays] || {};
      for (const d of H.closed || []) {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if (inRange(d) && wd !== 0 && wd !== 6) out.push({ date: d, kind: 'market', title: `${ex.name} fermée (jour férié)`, sub: '' });
      }
      for (const [d, at] of Object.entries(H.early || {})) {
        if (inRange(d)) out.push({ date: d, kind: 'market', title: `${ex.name} : clôture anticipée à ${at} (heure locale)`, sub: '' });
      }
    }

    // jalons fiscaux : 5 ans du PEA, 8 ans de l'assurance-vie, plafond du PEA
    for (const a of Store.state.accounts) {
      if (!Tax.sortedTxs(a.id).length) continue;
      if (a.type === 'pea') {
        const p = Tax.pea(a);
        if (p.five && inRange(p.five)) out.push({ date: p.five, kind: 'tax', title: `${a.name} : 5 ans`, sub: 'Retraits possibles sans clôture, gains exonérés d\'impôt sur le revenu (prélèvements sociaux seulement).' });
        const cap = Tax.peaCapDate(a, p.deposits, taxConf().peaCap, today);
        if (cap && inRange(cap.date)) out.push({ date: cap.date, kind: 'tax', title: `${a.name} : plafond des versements`, sub: `Atteint vers cette date au rythme de ${fmtMoney(cap.monthly, cur, 0)}/mois.` });
      }
      if (a.type === 'av') {
        const v = Tax.av(a, today);
        if (v.eight && inRange(v.eight)) out.push({ date: v.eight, kind: 'tax', title: `${a.name} : 8 ans`, sub: 'Abattement annuel sur les gains rachetés (4 600 €, 9 200 € en couple).' });
      }
    }

    // déclaration de revenus : plus-values et dividendes du compte-titres de l'année précédente
    const declYear = +today.slice(0, 4) - (today.slice(5) < '06-15' ? 1 : 0);
    const declDate = `${declYear + 1}-04-10`;
    if (inRange(declDate)) {
      let gains = 0, divs = 0, any = false;
      for (const a of Store.state.accounts.filter(x => x.type === 'cto' || x.type === 'autre')) {
        const e = Tax.events(a);
        for (const s of e.sales) if (s.date.startsWith(String(declYear))) { gains += s.gain; any = true; }
        for (const d of e.divs) if (d.date.startsWith(String(declYear))) { divs += d.amount; any = true; }
      }
      if (any) out.push({ date: declDate, kind: 'tax', title: `Déclaration des revenus ${declYear}`,
        sub: `Compte-titres : ${gains >= 0 ? 'plus-value' : 'moins-value'} ${fmtMoney(Math.abs(gains), cur, 0)} (case ${gains >= 0 ? '3VG' : '3VH'}), dividendes ${fmtMoney(divs, cur, 0)} (case 2DC ou 2TR). Ouverture en ligne vers avril ; date limite selon ton département (impots.gouv.fr).` });
    }

    // placements à valeur saisie : prochain relevé trimestriel à reporter
    if (typeof Manual !== 'undefined') {
      for (const r of held) {
        if (!Manual.is(r.key)) continue;
        const last = Manual.last(r.key);
        const next = last ? addMonthsISO(last[0], 3) : null;
        if (next) out.push({ date: next < today ? today : next, kind: 'todo', title: `Valeur à mettre à jour · ${Store.label(r.key)}`,
          sub: `Dernière valeur saisie le ${fmtDate(last[0])} : reporte celle de ton prochain relevé.` });
      }
    }

    return out.filter(e => inRange(e.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind.localeCompare(b.kind)));
  },

  /** Fichier iCalendar (journées entières) : importable dans Agenda iPhone, Google Agenda, Outlook */
  ics(events, stamp = new Date()) {
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const ymd = d => d.replace(/-/g, '');
    const fold = line => { // lignes de 75 octets au plus (RFC 5545)
      const out = [];
      let cur = '';
      for (const ch of line) {
        if (new TextEncoder().encode(cur + ch).length > 73) { out.push(cur); cur = ' '; }
        cur += ch;
      }
      out.push(cur);
      return out.join('\r\n');
    };
    const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//APIstock//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:APIstock'];
    for (const e of events) {
      lines.push('BEGIN:VEVENT',
        `UID:${ymd(e.date)}-${e.kind}-${hash(e.title)}@apistock`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${ymd(e.date)}`,
        `DTEND;VALUE=DATE:${ymd(addDaysISO(e.date, 1))}`,
        fold('SUMMARY:' + esc(e.title)),
        fold('DESCRIPTION:' + esc(e.sub)),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  },
};

Object.assign(App, {
  agendaFilter: '',

  bindAgenda() {
    const btn = $('#agendaExport');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const evs = Agenda.events().filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
      if (!evs.length) { toast('Aucune échéance à exporter'); return; }
      const blob = new Blob([Agenda.ics(evs)], { type: 'text/calendar;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'apistock-agenda.ics' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`${evs.length} échéance(s) exportée(s) : ouvre le fichier pour les ajouter à ton agenda`, 'success', 5000);
    });
  },

  renderAgenda() {
    const box = $('#agendaList');
    if (!box) return;
    const all = Agenda.events();
    const counts = {};
    for (const e of all) counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (this.agendaFilter && !counts[this.agendaFilter]) this.agendaFilter = '';
    $('#agendaKinds').replaceChildren(
      el('button', { class: this.agendaFilter ? '' : 'active', onclick: () => { this.agendaFilter = ''; this.renderAgenda(); } }, `Tout (${all.length})`),
      ...Object.entries(AGENDA_KINDS).filter(([k]) => counts[k]).map(([k, v]) =>
        el('button', { class: this.agendaFilter === k ? 'active' : '', onclick: () => { this.agendaFilter = k; this.renderAgenda(); } }, `${v.label} (${counts[k]})`)));
    const evs = all.filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
    if (!evs.length) {
      box.replaceChildren(el('p', { class: 'empty' }, all.length ? 'Rien dans cette catégorie.' : 'Aucune échéance pour l\'instant. Programme un versement (onglet Investir) ou ajoute des lignes : leurs dividendes et les jours fériés de leur bourse apparaîtront ici.'));
      return;
    }
    const today = todayISO();
    const byMonth = new Map();
    for (const e of evs) { const m = e.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(e); }
    const cur = this.base();
    box.replaceChildren(...Array.from(byMonth.entries()).map(([m, list]) => {
      const sum = list.filter(e => e.kind === 'div' && isFinite(e.amount)).reduce((s, e) => s + e.amount, 0);
      const plans = list.filter(e => e.kind === 'plan').reduce((s, e) => s + (e.amount || 0), 0);
      const label = new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return el('section', { class: 'agenda-month' },
        el('h3', {}, label, el('span', { class: 'muted small' }, [plans ? `${fmtMoney(plans, cur, 0)} à investir` : '', sum ? `≈ ${fmtMoney(sum, cur)} de dividendes` : ''].filter(Boolean).join(' · '))),
        el('ul', { class: 'agenda-list' }, ...list.map(e => {
          const d = new Date(e.date + 'T12:00:00Z');
          return el('li', { class: 'agenda-item ' + e.kind + (e.date === today ? ' today' : '') },
            el('div', { class: 'agenda-date' }, el('b', {}, String(d.getUTCDate())),
              el('span', {}, d.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }))),
            el('span', { class: 'agenda-icon', 'aria-hidden': 'true' }, AGENDA_KINDS[e.kind].icon),
            el('div', { class: 'agenda-text' }, el('b', {}, e.title), e.sub ? el('span', { class: 'muted small' }, e.sub) : null));
        })));
    }));
  },
});
