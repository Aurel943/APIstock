/* Import des avis d'opéré (PDF des courtiers) : texte lu avec pdf.js, puis même confirmation que l'import CSV */
'use strict';

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

const Avis = {
  _lib: null,
  /** pdf.js n'est chargé qu'au premier import (≈ 1 Mo) */
  lib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!this._lib) {
      this._lib = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = PDFJS_URL + 'pdf.min.js';
        s.onload = () => {
          if (!window.pdfjsLib) { ko(new Error('lecteur PDF indisponible')); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_URL + 'pdf.worker.min.js';
          ok(window.pdfjsLib);
        };
        s.onerror = () => { this._lib = null; ko(new Error('lecteur PDF non chargé (connexion internet nécessaire)')); };
        document.head.append(s);
      });
    }
    return this._lib;
  },

  /** Texte d'un PDF reconstitué ligne par ligne, colonnes séparées par plusieurs espaces (comme « pdftotext -layout ») */
  async lines(file) {
    const lib = await this.lib();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const { items } = await (await pdf.getPage(p)).getTextContent();
      out.push(...this.layout(items.filter(i => i.str && i.str.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }))));
    }
    return out;
  },

  /** Regroupe des morceaux de texte positionnés {str, x, y, w, h} en lignes lisibles */
  layout(items) {
    const rows = [];
    for (const it of items.slice().sort((a, b) => b.y - a.y)) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.3));
      if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    return rows.map(r => {
      const parts = r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of parts) {
        if (end !== null) {
          const gap = it.x - end;
          s += gap > it.h * 0.8 ? '   ' : gap > it.h * 0.15 && !/\s$/.test(s) ? ' ' : '';
        }
        s += it.str;
        end = it.x + it.w;
      }
      return s;
    });
  },

  /**
   * Lit un avis d'opéré (Boursorama et présentations proches) : sens, date d'exécution, quantité, titre, ISIN, cours,
   * montants brut et net (frais = écart entre les deux), place, type de compte et référence de l'ordre.
   */
  parse(lines) {
    const text = lines.join('\n');
    const num = s => parseNum(String(s || '').replace(/[\s  ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, ''));
    const sens = text.match(/\b(ACHAT|VENTE|SOUSCRIPTION|RACHAT)\b/i);
    const type = !sens ? null : /vente|rachat/i.test(sens[1]) ? 'sell' : 'buy';
    const isinM = text.match(/ISIN\s*:?\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/) || text.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/);
    const isin = isinM ? isinM[1] : '';
    const AMT = '(\\d[\\d\\s\\u00a0\\u202f.]*(?:,\\d+)?)';
    const coursM = text.match(new RegExp('Cours\\s+(?:ex[ée]cut[ée]|net|unitaire)\\s*:?\\s*' + AMT + '\\s*([A-Z]{3}|€)?', 'i'));
    const price = coursM ? num(coursM[1]) : NaN;
    const ccy = coursM && coursM[2] ? (coursM[2] === '€' ? 'EUR' : coursM[2]) : 'EUR';

    // ligne d'exécution : « 27/10/2026   7   AMUNDI PEA SP 500 UC.ETF ACC   Référence : … »
    let date = null, qty = NaN, name = '';
    for (const l of lines) {
      const m = l.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d[\d\s.]*(?:,\d+)?)\s{2,}(\S.*?)\s*(?:\s{2,}|R[ée]f[ée]rence|$)/);
      if (m) { date = csvDate(m[1]); qty = num(m[2]); name = m[3].trim(); break; }
    }
    if (!date) { const m = text.match(/ex[ée]cution[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i) || text.match(/\ble\s+(\d{2}\/\d{2}\/\d{4})/); if (m) date = csvDate(m[1]); }
    if (!(qty > 0)) { const m = text.match(/Quantit[ée]\s*:?\s*(\d[\d\s.]*(?:,\d+)?)\b/i); if (m) qty = num(m[1]); }

    // montants : ligne qui suit « Montant brut … Montant net » (brut en premier, net en dernier ; la colonne frais peut être vide)
    let gross = NaN, net = NaN;
    const hi = lines.findIndex(l => /Montant\s+brut/i.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi, hi + 5)) {
        const amts = Array.from(l.matchAll(/(\d[\d\s  .]*,\d{2})\s*(?:EUR|USD|GBP|CHF|€)/g), m => num(m[1]));
        if (amts.length >= 2) { gross = amts[0]; net = amts[amts.length - 1]; break; }
      }
    }
    if (!(qty > 0) && gross > 0 && price > 0) qty = Math.round(gross / price * 1e4) / 1e4;
    let fees = gross > 0 && net > 0 ? Math.round((type === 'sell' ? gross - net : net - gross) * 100) / 100 : 0;
    if (!(fees >= 0)) fees = 0;

    const placeM = text.match(/Lieu\s+d.ex[ée]cution\s*:?\s*([^\n]+?)(?:\s{2,}|\n|$)/i);
    const place = placeM ? placeM[1].trim() : '';
    const P = place.toUpperCase();
    const mic = /PARIS|EURONEXT$/.test(P) ? 'XPAR' : /XETRA|FRANCFORT|FRANKFURT/.test(P) ? 'XETR' : /AMSTERDAM/.test(P) ? 'XAMS' : /MILAN/.test(P) ? 'XMIL'
      : /BRUXELLES|BRUSSELS/.test(P) ? 'XBRU' : /LONDRES|LONDON/.test(P) ? 'XLON' : /NASDAQ/.test(P) ? 'XNAS' : /NYSE/.test(P) ? 'XNYS' : '';
    // « Compte PEA » l'emporte sur « Références de votre compte titres » (en-tête commun à tous les comptes)
    const accM = text.match(/Compte\s+(PEA[\s-]*PME|PEA)\b/i) || text.match(/Compte\s+(ordinaire|CTO)\b/i) || text.match(/(?:^|\s{2,})Compte[\s-]+(titres?)\b/im);
    const accType = !accM ? '' : /pea/i.test(accM[1]) ? 'pea' : 'cto';
    const refM = text.match(/R[ée]f[ée]rence\s*:\s*([A-Z0-9][A-Z0-9-]{5,})/i);

    const missing = [!type && 'sens (achat/vente)', !date && 'date', !isin && 'ISIN', !(qty > 0) && 'quantité', !(price > 0) && 'cours'].filter(Boolean);
    if (missing.length) return { error: 'non reconnu (' + missing.join(', ') + ' introuvable)' };
    return { type, date, isin, name, qty, price, fees, ccy, mic, place, accType, ref: refM ? refM[1] : '', gross, net };
  },
};

Object.assign(App, {
  bindAvis() {
    $$('.avisImport').forEach(input => input.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) this.importAvis(files);
    }));
  },

  /** Compte d'un avis : celui du type indiqué (PEA, compte-titres) ; en cas de doute, le compte affiché ou par défaut */
  avisAccount(rec) {
    const accs = Store.state.accounts;
    const f = Store.state.accountFilter;
    if (rec.accType) {
      const same = accs.filter(a => a.type === rec.accType);
      if (same.length === 1) return { accountId: same[0].id };
      if (same.length > 1) return { accountId: (same.find(a => a.id === f) || same[0]).id };
      return { account: rec.accType === 'pea' ? 'PEA' : 'Compte-titres' };
    }
    return { accountId: f && f !== 'all' ? f : Store.defaultAccount() };
  },

  async importAvis(files) {
    if ($('#txDialog').open) $('#txDialog').close();
    toast(`Lecture de ${files.length} avis d'opéré…`, '', 2000);
    const records = [], errors = [];
    for (const file of files) {
      try {
        const rec = Avis.parse(await Avis.lines(file));
        if (rec.error) errors.push(`${file.name} : ${rec.error}`);
        else records.push(Object.assign(rec, { file: file.name }));
      } catch (err) {
        if (/lecteur PDF/.test(err.message)) { toast('Import impossible : ' + err.message, 'error', 8000); return; }
        errors.push(`${file.name} : ${err.message}`);
      }
    }
    try {
      const res = this.prepareImport(records.map(r => Object.assign({}, r, { line: r.file }, this.avisAccount(r))),
        { id: 'avis', label: 'Avis d\'opéré (PDF)', verified: true, note: 'Frais = montant net − montant brut (commission et taxe sur les transactions financières).' }, { dedupe: true });
      res.errors.unshift(...errors);
      if (!res.txs.length && res.dups && !res.errors.length) { toast(`Ces ${res.dups} avis sont déjà enregistrés`, 'success', 4000); return; }
      if (!res.txs.length && !res.dups) throw new Error('aucun achat ni vente reconnu' + (res.errors.length ? ' — ' + res.errors[0] : ''));
      if (!(await this.confirmCsvImport(res))) return;
      const n = res.commit(), dups = res.dups;
      this.renderAll();
      this.renderAccountsSettings();
      this.refresh();
      this.preloadFx();
      toast(n + ' opération(s) importée(s)' + (dups ? ` · ${dups} déjà présente(s), ignorée(s)` : ''), 'success', 5000);
    } catch (err) {
      toast('Import des avis impossible : ' + err.message, 'error', 8000);
    }
  },
});

document.addEventListener('DOMContentLoaded', () => App.bindAvis());
