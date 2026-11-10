/* Illustrations des actualités sans image, par thème (SVG dessinés ici : aucune image externe) */
'use strict';

const NEWS_ART = (() => {
  const W = 'fill="#fff"';
  const bg = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="192" height="128" fill="url(#g)"/>`;
  const grid = '<g stroke="#fff" stroke-opacity=".08">' + [32, 64, 96].map(y => `<line x1="0" y1="${y}" x2="192" y2="${y}"/>`).join('') + '</g>';
  const svg = body => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 128">${body}</svg>`);
  const candles = (xs, color = '#fff', op = '.9') => xs.map(([x, o, c, h, l]) =>
    `<line x1="${x + 5}" y1="${h}" x2="${x + 5}" y2="${l}" stroke="${color}" stroke-opacity="${op}" stroke-width="2"/><rect x="${x}" y="${Math.min(o, c)}" width="10" height="${Math.max(3, Math.abs(c - o))}" rx="2" fill="${color}" fill-opacity="${o > c ? op : '.45'}"/>`).join('');
  return {
    // Bourse de Paris : tour Eiffel et courbe
    paris: svg(bg('#1e3a8a', '#2563eb') + grid
      + `<path d="M120 112 L136 112 L141 92 L151 92 L156 112 L172 112 L156 76 L152 50 L148 22 L146 22 L144 50 L140 76 Z M143 82 h8 l2 6 h-12 z" ${W} fill-opacity=".92"/>`
      + '<path d="M10 100 L34 88 L52 94 L74 70 L94 78 L112 52" fill="none" stroke="#fde047" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="112" cy="52" r="6" fill="#fde047"/>'),
    // Wall Street : gratte-ciel et chandeliers
    wallstreet: svg(bg('#0f172a', '#1e40af') + grid
      + `<g ${W} fill-opacity=".18"><rect x="8" y="58" width="22" height="70"/><rect x="34" y="34" width="26" height="94"/><rect x="64" y="70" width="18" height="58"/><rect x="150" y="46" width="20" height="82"/><rect x="172" y="66" width="20" height="62"/><path d="M42 34 l5 -14 l5 14 z"/></g>`
      + candles([[92, 92, 76, 100, 70], [110, 80, 86, 92, 74], [128, 84, 62, 90, 56], [146, 64, 40, 70, 30]], '#34d399')),
    // Technologie / Nasdaq : puce électronique
    tech: svg(bg('#312e81', '#7c3aed') + grid
      + '<g stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round">'
      + [74, 90, 106, 122].map(x => `<line x1="${x}" y1="22" x2="${x}" y2="34"/><line x1="${x}" y1="94" x2="${x}" y2="106"/>`).join('')
      + [46, 62, 78].map(y => `<line x1="54" y1="${y}" x2="66" y2="${y}"/><line x1="126" y1="${y}" x2="138" y2="${y}"/>`).join('') + '</g>'
      + `<rect x="66" y="34" width="60" height="60" rx="10" ${W} fill-opacity=".92"/><rect x="80" y="48" width="32" height="32" rx="5" fill="#7c3aed"/>`
      + '<path d="M86 72 L94 64 L100 68 L108 56" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
    // Europe : cercle d'étoiles
    europe: svg(bg('#1d4ed8', '#1e3a8a') + grid
      + Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, x = 96 + 36 * Math.cos(a), y = 64 + 36 * Math.sin(a);
        return `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" d="M0 -7 L2 -2 L7 -2 L3 1 L4.5 6.5 L0 3.2 L-4.5 6.5 L-3 1 L-7 -2 L-2 -2 Z" fill="#facc15"/>`; }).join('')),
    // Asie / Japon / émergents : soleil levant et pagode stylisée
    asia: svg(bg('#7f1d1d', '#dc2626')
      + '<circle cx="128" cy="62" r="34" fill="#fff" fill-opacity=".92"/>'
      + `<g ${W} fill-opacity=".25"><path d="M0 128 L40 70 L70 100 L104 58 L150 128 Z"/></g>`
      + '<path d="M20 108 L46 92 L70 98 L96 74 L118 80" fill="none" stroke="#fde047" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'),
    // Or : lingots
    gold: svg(bg('#78350f', '#b45309')
      + '<g stroke="#78350f" stroke-width="2" stroke-linejoin="round">'
      + '<path d="M34 104 L46 82 H88 L98 104 Z" fill="#fbbf24"/><path d="M98 104 L108 82 H150 L162 104 Z" fill="#f59e0b"/><path d="M66 82 L78 60 H118 L130 82 Z" fill="#fcd34d"/></g>'
      + '<path d="M150 30 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z M40 34 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" fill="#fef3c7"/>'),
    // Pétrole : derrick et goutte
    oil: svg(bg('#111827', '#374151') + grid
      + '<g stroke="#fff" stroke-opacity=".85" stroke-width="4" stroke-linecap="round" fill="none"><path d="M40 112 L62 30 L84 112 M48 84 H76 M54 60 H70"/><path d="M28 112 H96"/></g>'
      + '<path d="M140 30 C140 30 116 64 116 80 a24 24 0 0 0 48 0 C164 64 140 30 140 30 Z" fill="#f59e0b"/><path d="M130 82 a10 10 0 0 0 10 10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>'),
    // Crypto : pièce Bitcoin
    crypto: svg(bg('#9a3412', '#f97316') + grid
      + '<circle cx="96" cy="64" r="40" fill="#fff" fill-opacity=".95"/><circle cx="96" cy="64" r="32" fill="none" stroke="#f97316" stroke-width="3"/>'
      + '<text x="96" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="46" fill="#f97316">₿</text>'),
    // Banques centrales / taux / inflation : édifice à colonnes et pourcentage
    rates: svg(bg('#134e4a', '#0d9488') + grid
      + `<g ${W} fill-opacity=".92"><path d="M40 46 L86 22 L132 46 Z"/><rect x="40" y="50" width="92" height="6"/><rect x="40" y="100" width="92" height="8"/>`
      + [48, 68, 88, 108].map(x => `<rect x="${x}" y="60" width="10" height="38"/>`).join('') + '</g>'
      + '<text x="160" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="40" fill="#fde047">%</text>'),
    // Marchés en général : chandeliers et courbe
    markets: svg(bg('#064e3b', '#059669') + grid
      + candles([[30, 96, 80, 104, 72], [52, 84, 90, 98, 78], [74, 88, 66, 94, 60], [96, 70, 76, 84, 64], [118, 74, 52, 80, 44], [140, 56, 34, 62, 26]])
      + '<path d="M20 92 L60 86 L100 72 L130 60 L170 34" fill="none" stroke="#fde047" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>'),
  };
})();

/* Thème d'un article : d'après son titre, sinon d'après le sujet recherché */
const NEWS_THEME_WORDS = [
  ['crypto', /bitcoin|crypto|ethereum|\bbtc\b|blockchain|stablecoin/i],
  ['gold', /\bor\b|l[’']or\b|\bgold\b|métaux précieux|argent métal|lingot/i],
  ['oil', /pétrole|petrole|brent|\bwti\b|\bopep\b|\bopec\b|baril|énergie|gaz naturel/i],
  ['rates', /\bfed\b|\bbce\b|banque centrale|taux d[’']intérêt|\btaux\b|inflation|\bipc\b|obligat|powell|lagarde|réserve fédérale/i],
  ['tech', /nasdaq|\bia\b|intelligence artificielle|nvidia|apple|microsoft|semi-?conducteur|puces?\b|tech\b|technolog/i],
  ['asia', /nikkei|japon|tokyo|chine|chinois|hong kong|asie|asiatique|inde\b|émergent|corée|taïwan/i],
  ['paris', /cac ?40|bourse de paris|\bparis\b|france|français/i],
  ['europe', /europe|stoxx|\bdax\b|allemagne|zone euro|\bbce\b/i],
  ['wallstreet', /wall street|s&p|dow jones|\bnyse\b|américain|etats-unis|états-unis|\bus\b/i],
];
const NEWS_THEME_BY_PROFILE = { world: 'markets', allworld: 'markets', sp500: 'wallstreet', ndx: 'tech', em: 'asia', europe: 'europe', es50: 'europe',
  cac: 'paris', japan: 'asia', gold: 'gold', crypto: 'crypto', stock: 'markets' };

function newsTheme(title, fallback) {
  for (const [theme, re] of NEWS_THEME_WORDS) if (re.test(title || '')) return theme;
  return NEWS_ART[fallback] ? fallback : 'markets';
}
