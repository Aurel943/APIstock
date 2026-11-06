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

**Comptes, dividendes, objectif**
- Plusieurs comptes (PEA, compte-titres, assurance-vie, PER…) avec filtre, récapitulatif par compte et plus-value nette d'impôt estimée selon le taux de chaque compte
- Saisie des dividendes reçus, inclus dans le gain total et le rendement annualisé
- Objectif patrimonial : progression, date estimée d'atteinte, versement mensuel nécessaire
- Calendrier des performances mois par mois (hors versements)
- Mode discret 👁 : masque tous les montants en un clic
- Import / export CSV des opérations (Excel, historique de courtier)

**Comparer**
- Compare jusqu'à 5 valeurs sur la même base : indices (S&P 500, Nasdaq, Nasdaq 100, Dow Jones, CAC 40, DAX, Euro Stoxx 50, Nikkei…), tes ETF, n'importe quelle action, l'or, le Bitcoin… et **ton propre portefeuille** (performance pondérée dans le temps, pour savoir si tu bats le marché)
- Comparaisons rapides en un clic (Nasdaq vs S&P 500, CAC 40 vs DAX, USA vs Europe vs Japon, Or vs Bitcoin, Mon portefeuille vs MSCI World)
- Périodes de 1 mois à 20 ans ou date libre ; affichage en performance %, base 100 ou baisse depuis le plus haut
- Courbe d'écart de performance par rapport à la valeur de référence
- Statistiques : performance, rendement annualisé, volatilité, pire baisse, meilleur et pire jour, 1 000 € deviennent, rendement/risque, bêta, matrice de corrélation

**Monde**
- Horloge des 14 grandes bourses (Paris, Amsterdam, Francfort, Londres, Zurich, Milan, Madrid, New York, Toronto, Tokyo, Hong Kong, Shanghai, Mumbai, Sydney) : ouvert / fermé / pause déjeuner, compte à rebours, horaires convertis à ton heure locale, heure d'été gérée automatiquement
- Frise 24 h des séances avec repère « maintenant », filtre « Mes marchés »
- Jours fériés et clôtures anticipées 2026-2027 pour Euronext, Xetra, Londres et New York
- Indice phare de chaque place en direct avec mini-graphique (CAC 40, DAX, FTSE 100, S&P 500, Nasdaq, Nikkei…) + Euro Stoxx 50, EUR/USD, or, Brent, Bitcoin, VIX
- L'état du marché de chaque ETF s'affiche aussi dans le portefeuille et dans la barre du haut

**Investir**
- Allocation cible en % et **plan d'investissement** : « j'investis 500 € ce mois-ci » → nombre de parts à acheter de chaque ETF pour se rapprocher de la cible (parts entières ou fractionnées, rééquilibrage complet avec ventes en option), puis enregistrement des achats en un clic
- **Alertes de prix** (cours ≥ / ≤, hausse ou baisse du jour en %) avec notifications du navigateur

**Indicateurs supplémentaires** : rendement annualisé réel (XIRR, tient compte de la date de chaque versement), plus-value nette d'impôt estimée (PEA / compte-titres / taux personnalisé, dans Réglages).

**Application mobile** : interface dédiée sur téléphone (barre de navigation en bas, positions en cartes, bouton « + » flottant, fenêtres en plein écran) et site installable (PWA) — sur iPhone : Safari → Partager → « Sur l'écran d'accueil » ; sur Android : Chrome → menu → « Installer l'application ».

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
3. Onglet **Réglages** → colle ta clé → *Tester la clé* → *Enregistrer*. Pour les ETF européens, configure aussi le relais Yahoo (voir ci-dessous).
4. Onglet **Portefeuille** → *Ajouter une opération* → cherche ton ETF (ex. `CW8`, `ESE`, `IWDA`, `VWCE`) et choisis la bonne place de cotation.

## ETF européens gratuits : le relais Yahoo Finance

Le forfait gratuit de Twelve Data ne couvre que les marchés US (+ forex/crypto). Pour CW8, ESE, IWDA, VWCE… cotés à Paris, Amsterdam, Xetra, Londres, le site utilise **Yahoo Finance** (gratuit, sans clé, sans limite de crédits). Comme un navigateur ne peut pas appeler Yahoo directement (CORS), il faut un petit **relais** gratuit. Deux possibilités :

### A. Cloudflare Worker (recommandé si le site est sur GitHub Pages)
1. Crée un compte gratuit sur <https://dash.cloudflare.com>.
2. **Workers & Pages** → **Create** → **Create Worker** → nomme-le `apistock-yahoo` → **Deploy**.
3. **Edit code** → remplace tout par le contenu de [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js) → **Deploy**.
4. Copie l'URL du worker (`https://apistock-yahoo.<ton-compte>.workers.dev`).
5. Sur le site : **Réglages** → *Relais Yahoo Finance* → colle l'URL → **Tester** → **Enregistrer**.

Le worker n'accepte que les requêtes venant de `aurel943.github.io` et de `localhost:8000` (modifiable en haut du fichier).

### B. Héberger tout le site sur Vercel
Importe le dépôt sur <https://vercel.com/new> : la fonction [`api/yahoo.js`](api/yahoo.js) est déployée automatiquement et le site la détecte tout seul (rien à saisir dans les réglages).

### Comment le site choisit sa source
- Quand tu cherches un ETF, chaque résultat porte une étiquette **Yahoo** ou **Twelve Data** : choisis la ligne Yahoo pour les places européennes.
- Si un ETF déjà enregistré renvoie l'erreur « available starting with the Grow or Venture plan », il bascule automatiquement sur Yahoo dès que le relais est configuré (tes opérations sont conservées).
- Sans clé Twelve Data, tout passe par Yahoo, y compris les taux de change.

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
js/markets.js     horaires des bourses, fuseaux, jours fériés
js/views.js       onglets Monde et Investir (plan, alertes)
js/compare.js     onglet Comparer
js/extras.js      comptes, objectif, calendrier, mode discret, CSV
js/mobile.js      navigation et affichage mobile
sw.js, manifest.webmanifest, icons/   application installable (PWA)
js/app.js         interface
api/yahoo.js      relais Yahoo Finance (fonction Vercel)
proxy/cloudflare-worker.js   relais Yahoo Finance (Cloudflare Workers)
```
