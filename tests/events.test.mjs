import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

test('bus d\'événements : ordre d\'inscription, this = App, arguments, désabonnement', () => {
  const { App } = loadApp({});
  const seen = [];
  const off = App.on('test:e', function (a, b) { seen.push(['1', a, b, this === App]); });
  App.on('test:e', () => seen.push(['2']));
  App.emit('test:e', 'x', 2);
  off();
  App.emit('test:e');
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [['1', 'x', 2, true], ['2'], ['2']]);
});

test('les modules sont abonnés aux événements documentés en haut de js/app.js', () => {
  const { App } = loadApp({});
  const n = name => (App._listeners[name] || []).length;
  assert.equal(n('rendered:all'), 5);         // fiscalité/exposition, espèces/versements/à faire, risque/dividendes/rééquilibrage, patrimoine, aujourd'hui
  assert.equal(n('rendered:portfolio'), 5);   // variations du jour, à faire, patrimoine, carte du portefeuille, aujourd'hui
  assert.equal(n('refreshed'), 3);            // cartes lentes, dividendes et divisions, actualités
  assert.equal(n('view:shown'), 19);          // barre mobile, actualités, retraite, météo du labo quant, aujourd'hui, colonnes de la liste de suivi, comparateur d'ETF,
                                              // performance réelle, attribution, styles, crédit ou placement, filtre d'actions, courtiers, obligations,
                                              // devises, diversification, budget, revue du mois, export tableur
  assert.equal(n('detail:selected'), 5);      // actualités, résultats trimestriels, analyse fondamentale / composition de la fiche, écart de suivi, passer un ordre
  for (const e of ['rendered:invest', 'rendered:alerts', 'rendered:accountFilter']) assert.equal(n(e), 1, e);
});

test('Store.save émet « data:saved »', () => {
  const { App, Store } = loadApp({});
  let saved = 0;
  App.on('data:saved', () => saved++);
  Store.save();
  assert.equal(saved, 1);
});
