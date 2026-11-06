# APIstock — suivi de bourse & d'ETF en direct

Site personnel (100 % statique, sans serveur ni compte) pour suivre ses ETF et la bourse en direct grâce à l'API [Twelve Data](https://twelvedata.com).

## Fonctionnalités

**Portefeuille**
- Saisie de tes opérations (achats / ventes, quantité, prix, frais)
- Calcul du **PRU** (prix de revient unitaire moyen pondéré)
- **Sommes investies**, **% investi** et **% actuel** de chaque ETF dans le portefeuille
- **Plus-value latente** en € et en %, par ligne et au total, + variation du jour et plus-value réalisée
- Répartition (camembert) par valeur actuelle ou par montant investi
- Courbe d'évolution du portefeuille (valeur vs montant investi) reconstruite à partir de tes opérations
- Conversion automatique dans ta devise de référence (ETF cotés en USD, GBP…)

**Marchés**
- Recherche de n'importe quel ETF / action / indice (Euronext, Xetra, LSE, NYSE…)
- Liste de suivi avec cours en direct, variation, plus bas/haut
- Graphique 1J, 5J, 1M, 6M, 1A, 5A, Max + statistiques (52 semaines, volume, performance de la période)

**Simulation**
- *Simulation sur données réelles* : « et si j'avais investi X € + Y €/mois depuis telle date, réparti en % sur ces ETF ? » → somme investie, nombre de parts, PRU, valeur actuelle, % actuel et plus-value latente par ETF, courbe et pire baisse (drawdown). Parts entières ou fractionnées. Bouton pour reprendre la répartition de ton portefeuille.
- *Projection dans le futur* : intérêts composés avec versements mensuels, rendement et frais annuels.

Rafraîchissement automatique réglable (30 s à 15 min), mise en pause quand l'onglet est caché.

## Démarrage

1. Crée une clé API gratuite sur <https://twelvedata.com/pricing> (forfait *Basic* : 8 crédits/min, 800/jour).
2. Ouvre le site :
   - en local : double-clique sur `index.html`, ou mieux :
     ```bash
     python3 -m http.server 8000
     ```
     puis va sur <http://localhost:8000>
   - ou en ligne via **GitHub Pages** (Settings → Pages → branche, dossier `/`).
3. Onglet **Réglages** → colle ta clé → *Tester la clé* → *Enregistrer*.
4. Onglet **Portefeuille** → *Ajouter une opération* → cherche ton ETF (ex. `CW8`, `ESE`, `IWDA`, `VWCE`) et choisis la bonne place de cotation.

## Bon à savoir

- **Crédits API** : 1 cotation = 1 crédit, 1 historique = 1 crédit. L'appli respecte automatiquement ta limite par minute (file d'attente) et met les historiques en cache 6 h. Avec le forfait gratuit et ~8 lignes, garde un rafraîchissement ≥ 1 min. Pense aussi à la limite de 800 crédits/jour.
- **Places de cotation** : selon ton forfait Twelve Data, certaines bourses européennes peuvent ne pas être incluses ; l'appli affiche alors le message d'erreur de l'API. Dans ce cas, essaie une autre place de cotation pour le même ETF.
- **Données privées** : tes opérations et ta clé sont enregistrées uniquement dans le `localStorage` de ton navigateur. Utilise *Exporter (JSON)* pour sauvegarder ou passer sur un autre appareil (la clé n'est pas exportée). Si tu publies le site sur GitHub Pages, le code est public mais tes données restent dans ton navigateur.
- **Devises** : les montants dans une autre devise sont convertis au taux de change actuel (approximation pour l'historique).
- Les simulations ignorent frais de courtage et fiscalité. Les performances passées ne préjugent pas des performances futures.

## Structure

```
index.html        page unique (4 onglets)
css/style.css     styles (thème clair / sombre)
js/utils.js       formatage, helpers DOM
js/store.js       persistance locale
js/api.js         client Twelve Data (limite de crédits, caches)
js/portfolio.js   calculs : PRU, plus-values, rejeu historique, projection
js/charts.js      graphiques (Chart.js)
js/app.js         interface
```
