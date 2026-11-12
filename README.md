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
- Conversion automatique dans ta devise de référence (ETF cotés en USD, GBP…) : valeur actuelle au taux du jour, et **chaque opération au taux de change de sa date** (clôtures Yahoo) pour la fiscalité, les liquidités, le rendement annualisé, l'historique et le rapport annuel
- **Patrimoine global** : ajoute tes livrets (Livret A, LDDS, LEP), fonds euros, compte courant, immobilier (valeur et crédit restant)… → total, répartition titres / espèces / épargne / immobilier net et évolution mois par mois ; les livrets sont revalorisés chaque jour avec leur taux

**Marchés**
- Recherche de n'importe quel ETF / action / indice (Euronext, Xetra, LSE, NYSE…)
- Liste de suivi avec cours en direct, variation, plus bas/haut
- Graphique 1J, 5J, 1M, 6M, 1A, 5A, Max + statistiques (52 semaines, volume, performance de la période)

**Comptes, dividendes, objectif**
- Plusieurs comptes (PEA, compte-titres, assurance-vie, PER…) avec filtre, récapitulatif par compte et plus-value nette d'impôt estimée selon le taux de chaque compte
- Saisie des dividendes reçus, inclus dans le gain total et le rendement annualisé
- Objectif patrimonial : progression, date estimée d'atteinte, versement mensuel nécessaire ; autres actifs (livrets, immobilier…) inclus ou non
- Calendrier des performances mois par mois (hors versements)
- Mode discret 👁 : masque tous les montants en un clic
- Import / export CSV des opérations : modèle APIstock, **relevés Degiro** (Transactions.csv, en anglais ou en français) et **Trade Republic** (export des transactions, format non vérifié sur un vrai fichier) reconnus automatiquement ; autres relevés (Boursorama, Fortuneo…) lus d'après leurs en-têtes (date, sens, ISIN ou symbole, quantité, cours, frais, montant). Les lignes connues seulement par leur ISIN sont associées à un symbole par la recherche ISIN, à confirmer avant l'import
- **Import des avis d'opéré PDF** (Boursorama et présentations proches) : sélectionne tous tes avis d'un coup (bouton « 📄 Importer des avis d'opéré » des Opérations, ou en haut de la fenêtre « Nouvelle opération ») ; sens, date, quantité, cours, frais (net − brut), ISIN, place et compte (PEA / compte-titres) sont lus, aperçu avant l'import, et un avis déjà importé (même référence d'ordre) ou une opération déjà saisie est ignoré. Lecture locale avec pdf.js, chargé à la demande : le PDF ne quitte pas l'appareil

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
- *Phase de retraite* : retraits mensuels indexés sur l'inflation sur un capital placé (bouton « Mon patrimoine ») → probabilité que le capital tienne jusqu'au bout, âge ou date d'épuisement dans les scénarios défavorable / médian / favorable, retrait maximal soutenable à 90 %, graphique en éventail (Monte-Carlo).

**Temps réel**
- Rafraîchissement automatique réglable de **1 seconde** à 15 min, mis en pause quand l'onglet est caché
- Prix qui s'allument brièvement en vert ou en rouge quand ils changent
- Mini-graphique de la séance dans le portefeuille, la liste de suivi et les cartes mobiles
- Carte **Variations du jour** : plus fortes hausses et baisses de tes positions, en % et en €
- Compteur des requêtes envoyées aujourd'hui (ce navigateur, et total du relais pour tous les visiteurs)

**Exposition réelle & frais**
- Répartition de ton portefeuille par **pays**, **secteurs** et **devises**, en regardant à l'intérieur de chaque ETF (MSCI World, S&P 500, Nasdaq-100, All-World, émergents, Europe, CAC 40, Japon, or, crypto, actions en direct)
- Alertes de concentration (ex. « 73 % dépend des actions américaines ») et de **recoupement** entre ETF (ex. CW8 et ESE ≈ 68 %)
- **Frais annuels** en € à partir du TER de chaque ETF (valeurs indicatives pré-remplies pour les ETF courants, modifiables)
- **Coût des frais sur le long terme** : TER et courtage déjà payé sur 10 et 20 ans, intérêts composés perdus compris (rendement supposé réglable), et **équivalents moins chers** connus (même type d'indice, TER plus bas, éligibles au PEA si la ligne est dans un PEA) avec l'écart estimé — à titre d'information

**Fiscalité** (estimations indicatives)
- **Taux à jour et modifiables** (Réglages → Fiscalité) : valeurs par défaut des revenus 2026 — prélèvements sociaux 18,6 % (loi de financement de la Sécurité sociale 2026), prélèvement forfaitaire unique 31,4 %, PEA de plus de 5 ans 18,6 %, assurance-vie 17,2 % de prélèvements sociaux (+ 7,5 % au-delà de 8 ans), plafond PEA 150 000 € ; bouton « Valeurs par défaut »
- **PEA** : versements estimés face au plafond de 150 000 €, date des 5 ans et compte à rebours ; date d'ouverture et versements réels modifiables
- **Compte-titres** : plus-values réalisées par année (prix moyen pondéré d'acquisition), imputation des moins-values sur 10 ans, dividendes, cases de la déclaration (3VG / 3VH, 2DC / 2TR) et impôt estimé au prélèvement forfaitaire unique (31,4 % par défaut) ; montants en devises convertis au taux de change du jour de chaque opération

**Versements programmés & liquidités**
- **Versements programmés (DCA)** : « 200 € sur CW8 le 5 de chaque mois » (onglet Investir). À chaque échéance, l'achat apparaît dans la carte **À faire** du portefeuille, pré-rempli avec le cours de clôture du jour de l'échéance : un clic pour l'enregistrer (ou « Tout enregistrer », ou « Ignorer »). Parts entières ou fractionnées, mise en pause possible
- **Liquidités par compte** : bouton « + Versement / retrait » (carte Opérations). Dès le premier mouvement, le compte suit ses espèces (versements − retraits − achats + ventes + dividendes) : carte Liquidités, KPI « Liquidités » et valeur totale titres + espèces, objectif patrimonial calculé avec les espèces, et pour un PEA le plafond est calculé sur les **versements réels**
- **Divisions d'actions (splits)** : type d'opération « Division / regroupement » (parité `10`, `1:10` ou `10:1`). Le nombre de parts est multiplié, le prix de revient total ne change pas, l'historique et la fiscalité en tiennent compte. Les divisions survenues sur tes positions sont **détectées automatiquement** (Yahoo) et proposées dans « À faire »
- **Dividendes détachés non saisis** : proposés dans « À faire » avec le montant estimé (dividende par part × parts détenues)

**Analyses**
- **Risque du portefeuille** : volatilité annuelle, pire baisse (avec dates), performance annualisée (TWR), ratios de Sharpe et de Sortino, bêta et corrélation face au MSCI World. Taux sans risque réglable dans Réglages
- **Projection Monte-Carlo** (onglet Simulation) : 2 000 trajectoires aléatoires selon le rendement et la volatilité choisis → scénarios défavorable / médian / favorable, zone de 80 % des cas sur le graphique, risque de finir sous le total versé et probabilité d'atteindre ton objectif
- **Rééquilibrage sans vente** (onglet Investir) : montant minimal à investir pour revenir à l'allocation cible sans rien vendre (pas d'impôt en compte-titres), répartition par ligne ; alerte dans « À faire » quand une ligne s'écarte de plus de N points (seuil réglable)
- **Dividendes à venir** : estimation des 12 prochains mois d'après les détachements de l'année écoulée (montant par mois, rendement, prochain versement)
- **Actualités** de tes placements (carte du portefeuille) et de chaque valeur (onglet Marchés), via Yahoo Finance

**Confort**
- **Recherche par ISIN** (ex. `IE00B4L5Y983`, `FR0010315770`) : toutes les places de cotation du fonds sont proposées
- **Annuler** une suppression (opération, mouvement d'espèces, versement programmé, alerte, actif) pendant quelques secondes
- **Note libre** sur chaque opération (affichée dans la liste, exportée en CSV)
- **Rapport annuel imprimable / PDF** (bouton dans Opérations) : synthèse de l'année, performance mois par mois, cases fiscales du compte-titres, PEA, cessions, opérations et positions
- **Alertes de prix même site fermé** : notifications push envoyées par ton worker Cloudflare (voir plus bas)

**Synchronisation entre appareils** : opérations, comptes, liste de suivi et réglages identiques sur ton téléphone et ton ordinateur, **chiffrés de bout en bout** avec ton code (voir plus bas). Une suppression faite sur un appareil est conservée lors de la fusion (elle ne réapparaît plus depuis l'autre appareil) ; les traces de suppression sont oubliées après 180 jours.

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

#### Synchronisation entre appareils (optionnel)
Les données sont chiffrées dans le navigateur (AES-256, clé dérivée de ton code) : le worker ne stocke qu'un bloc illisible, identifié par une empreinte du code. Pour l'activer :
1. Cloudflare → **Storage & Databases** → **Workers KV** → **Create** : nomme l'espace `apistock-sync`.
2. Worker `apistock-yahoo` → **Settings** → **Bindings** → **Add binding** → **KV namespace** : *Variable name* = `SYNC`, *KV namespace* = `apistock-sync` → **Deploy**.
3. Sur le site, 1er appareil : **Réglages** → *Synchronisation entre appareils* → **Générer** → note le code → **Activer**. Sur les autres appareils : saisis le même code → **Activer**.

Les modifications sont envoyées quelques secondes après chaque changement, et récupérées au retour sur l'onglet et toutes les 2 minutes. Si deux appareils ont été modifiés en même temps, leurs opérations sont fusionnées. La clé Twelve Data est synchronisée (chiffrée) ; la fréquence de rafraîchissement reste propre à chaque appareil. Le forfait gratuit KV autorise 1 000 écritures par jour, largement suffisant pour un usage personnel. **Garde ton code** : il n'est stocké nulle part ailleurs et ne peut pas être récupéré.

#### Compteur global de requêtes (optionnel)
Dans **Réglages**, le site affiche le nombre de requêtes envoyées aujourd'hui par ton navigateur et, si le worker est configuré pour, le **total reçu par le worker, tous visiteurs confondus** (quota gratuit : 100 000/jour, remis à zéro à minuit UTC). Pour l'activer :
1. Cloudflare → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token** : permission *Account* · *Account Analytics* · *Read* → **Create Token**, et copie le jeton.
2. Worker `apistock-yahoo` → **Settings** → **Variables and Secrets** → **Add** :
   - `CF_ACCOUNT_ID` (type *Text*) : ton Account ID (visible sur la page *Workers & Pages*, colonne de droite) ;
   - `CF_API_TOKEN` (type *Secret*) : le jeton créé à l'étape 1.
3. **Deploy**. Le jeton reste dans le worker : le site ne reçoit que les totaux, rafraîchis au plus une fois par minute.

#### Mettre à jour le worker (actualités, dividendes, divisions, alertes push)
Les actualités, le calendrier des dividendes et la détection des divisions passent par de nouvelles requêtes du relais. Si tu utilises ton propre worker (ou le relais par défaut), **remplace son code** par la dernière version de [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js) → **Deploy**. Sans cette mise à jour, le reste du site fonctionne normalement ; ces cartes restent simplement vides (ou affichent « redéploie le worker »).

#### Alertes de prix même site fermé (optionnel)
Le worker vérifie tes alertes toutes les 5 minutes et t'envoie une notification push (Web Push chiffré, sans service tiers). Prérequis : l'espace KV `SYNC` de la synchronisation (voir ci-dessus).
1. Sur le site : **Investir** → *Alertes de prix* → **Générer les clés du worker…** et copie les deux valeurs.
2. Worker → **Settings** → **Variables and Secrets** → **Add**, type *Secret* : `VAPID_PUBLIC` et `VAPID_PRIVATE` (et, facultatif, `VAPID_SUBJECT` = `mailto:…` ou l'URL de ton site).
3. Worker → **Settings** → **Triggers** → **Cron Triggers** → **Add** : `*/5 * * * *` → **Deploy**.
4. Sur chaque appareil : **Investir** → **Activer sur cet appareil** (sur iPhone : ajoute d'abord le site à l'écran d'accueil, iOS 16.4 ou plus, et ouvre-le depuis l'icône), puis **Envoyer une notification de test**.

Une alerte déclenchée par le worker est marquée « Déclenchée » sur tes appareils à leur prochaine ouverture. Le worker stocke, pour chaque appareil, l'adresse d'abonnement push et les alertes (symbole Yahoo, condition, seuil) en clair, puisqu'il doit les lire ; rien d'autre de ton portefeuille. Coût : une lecture de la liste KV toutes les 5 minutes (≈ 290 par jour, quota gratuit 1 000) et une écriture seulement quand une alerte se déclenche.

### B. Héberger tout le site sur Vercel
Importe le dépôt sur <https://vercel.com/new> : la fonction [`api/yahoo.js`](api/yahoo.js) est déployée automatiquement et le site la détecte tout seul (rien à saisir dans les réglages). La synchronisation, le compteur global et les alertes push restent réservés au relais Cloudflare.

### Comment le site choisit sa source
- Quand tu cherches un ETF, chaque résultat porte une étiquette **Yahoo** ou **Twelve Data** : choisis la ligne Yahoo pour les places européennes.
- Si un ETF déjà enregistré renvoie l'erreur « available starting with the Grow or Venture plan », il bascule automatiquement sur Yahoo dès que le relais est configuré (tes opérations sont conservées).
- Sans clé Twelve Data, tout passe par Yahoo, y compris les taux de change.
- Un relais public par défaut (`https://apistock-yahoo.aurelien-potot.workers.dev`) est utilisé si aucun relais n'est saisi ni détecté : le site fonctionne donc directement, sans aucune configuration. Un relais saisi dans les réglages reste prioritaire.

## Bon à savoir

- **Crédits API** : 1 cotation = 1 crédit, 1 historique = 1 crédit. L'appli respecte automatiquement ta limite par minute (file d'attente) et met les historiques en cache 6 h. Avec le forfait gratuit et ~8 lignes, garde un rafraîchissement ≥ 1 min. Pense aussi à la limite de 800 crédits/jour.
- **Places de cotation** : selon ton forfait Twelve Data, certaines bourses européennes peuvent ne pas être incluses ; l'appli affiche alors le message d'erreur de l'API. Dans ce cas, essaie une autre place de cotation pour le même ETF.
- **Données privées** : tes opérations et ta clé sont enregistrées uniquement dans le `localStorage` de ton navigateur. Utilise *Exporter (JSON)* pour sauvegarder ou passer sur un autre appareil (la clé n'est pas exportée). Si tu publies le site sur GitHub Pages, le code est public mais tes données restent dans ton navigateur.
- **Devises** : la valeur actuelle est convertie au taux du jour ; les opérations passées au taux de clôture de leur date (historique Yahoo, chargé une fois et gardé en cache). Si l'historique n'est pas disponible, le taux du jour sert de repli.
- Les simulations ignorent frais de courtage et fiscalité. Les performances passées ne préjugent pas des performances futures.

## Structure

```
index.html        page unique (7 onglets)
css/style.css     styles (thème clair / sombre)
js/utils.js       formatage, helpers DOM
js/store.js       persistance locale, taux fiscaux (TAX_DEFAULTS / taxConf), suppressions mémorisées
js/api.js         client Twelve Data / relais Yahoo (limite de crédits, caches, taux de change historiques)
js/portfolio.js   calculs : PRU, plus-values, instantané en cache, rejeu historique, projection, Monte-Carlo, retraite
js/charts.js      graphiques (Chart.js)
js/markets.js     horaires des bourses, fuseaux, jours fériés
js/views.js       onglets Monde et Investir (plan, alertes)
js/compare.js     onglet Comparer
js/extras.js      comptes, réglages fiscaux, objectif, calendrier, mode discret, import CSV (formats des courtiers)
js/mobile.js      navigation et affichage mobile
js/features.js    temps réel, exposition & frais (coût long terme, équivalents), fiscalité, synchronisation
js/money.js       versements programmés, liquidités, divisions, ISIN, carte « À faire »
js/insights.js    risque, rééquilibrage, dividendes à venir, actualités, rapport annuel, alertes push
js/wealth.js      patrimoine global (autres actifs), phase de retraite
js/avis.js        import des avis d'opéré PDF (lecture du texte avec pdf.js)
sw.js, manifest.webmanifest, icons/   application installable (PWA)
js/app.js         interface et bus d'événements (App.on / App.emit, liste des événements en tête du fichier)
api/yahoo.js      relais Yahoo Finance (fonction Vercel)
proxy/cloudflare-worker.js   relais Yahoo Finance (Cloudflare Workers) + synchronisation + alertes push
scripts/sw-version.mjs       version du cache de l'application, calculée d'après le contenu des fichiers
scripts/record-fixtures.mjs  enregistre les réponses Yahoo utilisées par les tests de bout en bout
tests/*.test.mjs             tests unitaires (node --test)
tests/e2e/                   tests de bout en bout (Playwright, relais simulé)
tests/fixtures/              réponses Yahoo enregistrées, relevés CSV d'exemple anonymisés
```

## Développement

Le site lui-même n'a aucune dépendance : pas de framework ni d'étape de compilation, les fichiers sont servis tels quels. Les outils de développement (ESLint, Playwright, Chart.js pour les tests) sont déclarés dans `package.json` (Node 20 ou plus) :

```bash
npm install
```

Vérification complète (code avec ESLint, version du cache, tests unitaires) :

```bash
npm run check
```

ESLint seul : `npm run lint`. Les scripts du site partagent leurs déclarations de premier niveau (pas de modules) : `eslint.config.mjs` les relève automatiquement, ce qui permet de signaler toute variable inconnue.

Après avoir modifié un fichier du site, mets à jour la version du cache de l'application installée (sinon les tests et l'intégration continue échouent) :

```bash
npm run sw-version
```

Tests de bout en bout (navigateur Chromium) : ils servent le site en local et simulent le relais Yahoo avec les réponses de `tests/fixtures/relay/` — aucun appel réseau, et toute requête externe fait échouer le test. Après `npm install`, installe une fois le navigateur : `npx playwright install chromium`. Chart.js est servi aux tests depuis `node_modules`, ce qui vérifie le rendu réel des graphiques.

```bash
npm run test:e2e
```

Pour réenregistrer les réponses Yahoo des tests (symboles publics uniquement, aucune donnée personnelle envoyée) :

```bash
npm run record-fixtures
```

Les modules ne modifient pas les fonctions d'`App` : ils s'abonnent aux événements (`App.on('rendered:all', fn)`, `'rendered:portfolio'`, `'refreshed'`, `'view:shown'`…), listés et documentés en tête de `js/app.js`.

L'intégration continue (GitHub Actions, `.github/workflows/ci.yml`) vérifie la syntaxe des scripts, la version du cache, lance les tests unitaires et, dans un second job, les tests de bout en bout.
