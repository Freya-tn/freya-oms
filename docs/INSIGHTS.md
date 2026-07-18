# Insights — formules et règles communes

Toutes les requêtes décrites ici vivent dans `src/lib/insights/*.ts`. Aucune n'est stockée en base : elles interrogent `Order` + `OrderLineItem` + `Variant`/`InventorySnapshot` à la demande (voir [`DATABASE.md`](./DATABASE.md) pour le pourquoi).

## Règle commune à TOUS les insights de vente

```sql
WHERE "isConfirmed" = true AND "cancelledAt" IS NULL
```

Une commande non confirmée (jamais validée par téléphone) ou annulée ne doit **jamais** entrer dans un calcul de vente/vitesse/dormance — sinon les nombreuses annulations de commandes COD fausseraient tout.

Le bucketing temporel se fait toujours sur **`orderCreatedAt`** (date de commande client), jamais sur `syncedAt` ni une date de traitement.

## CA : `Order.subtotalPrice` vs somme des lignes de commande

Bug trouvé et corrigé le 2026-07-16 : le CA affiché (Overview, tendance, B2B vs B2C sans filtre marque) est écarté de ~12% du total "Ventes" affiché nativement par Shopify si on le calcule en sommant `OrderLineItem.quantity * unitPrice`. Cause réelle vérifiée sur les commandes : certaines remises (notamment sur les bundles/duos) sont appliquées au niveau de la commande par Shopify mais **pas toujours allouées** dans `LineItem.discountedTotalSet` au niveau de chaque ligne — donc un calcul par ligne sous-estime systématiquement les remises, même en soustrayant correctement `totalDiscount`.

**Règle retenue** : dès qu'un total ne nécessite pas de détail par produit (CA global, par canal, tendance dans le temps, sans filtre marque), utiliser **`SUM(Order.subtotalPrice)`** — le total déjà calculé par Shopify au niveau de la commande, net de toute remise quel que soit son type. Correspond exactement aux rapports natifs Shopify (à quelques % près, écart résiduel probablement dû à un fuseau horaire différent pour "30 derniers jours" entre notre `now() - interval` en UTC et le calcul de Shopify basé sur le fuseau de la boutique).

**Limite acceptée** : dès qu'un filtre par marque ou un détail par produit est nécessaire (top produits, ABC, répartition par marque), il n'existe pas d'alternative à sommer par ligne de commande — ces figures peuvent donc légèrement **sous-estimer** les remises multi-produits non allouées par Shopify, contrairement aux totaux non filtrés. Ne pas s'attendre à ce qu'un total filtré par marque somme exactement à une fraction du total global.

## 1. Vitesse de vente (sales velocity)

Unités vendues par jour, par variante, calculée sur les `windowDays` derniers **jours de disponibilité réelle** (pas une fenêtre calendaire fixe) :

```
availableDays(variantId, windowDays) =
  les `windowDays` jours calendaires les plus récents (jusqu'à 365j en arrière) où
  InventorySnapshot montre quantity > 0 pour cette variante, quelle que soit la
  distance calendaire à laquelle il faut remonter pour les trouver

velocity(variantId, windowDays) =
  SUM(OrderLineItem.quantity, sur les jours de availableDays(variantId, windowDays))
    WHERE Order.isConfirmed = true AND Order.cancelledAt IS NULL
  / COUNT(availableDays(variantId, windowDays))
```

**Bug réel corrigé le 2026-07-18** : diviser par la fenêtre CALENDAIRE complète (l'ancienne implémentation) dilue artificiellement la vitesse d'une variante qui vend bien mais a été en rupture une bonne partie de la période — un best-seller réapprovisionné récemment, ou carrément en rupture depuis le début de la fenêtre, ressort avec une vitesse proche de 0 alors que la demande réelle (quand il y a du stock) est forte. Ça le fait passer à tort pour "dormant" (`dormant.ts`) ou l'exclut à tort du réappro (`reorder.ts`, qui n'agit que sur `velocity > 0`) — exactement l'inverse de ce qui devrait se passer : un best-seller en rupture est justement la priorité n°1 de réachat.

`getVelocityByVariant`/`getPriorVelocityByVariant` (`src/lib/insights/velocity.ts`) implémentent ça via un rang de disponibilité (`ROW_NUMBER() OVER (PARTITION BY variantId ORDER BY jour DESC)` sur les jours distincts où `InventorySnapshot.quantity > 0`), jamais borné à une fenêtre calendaire fixe côté SQL — seulement à un plafond de 365 jours en arrière (`VELOCITY_MAX_LOOKBACK_DAYS`, même borne que l'algo adaptatif de la page Stock, section suivante), pour rester cohérent avec "au-delà d'un an, les données ne représentent plus la demande actuelle".

**Principe non négociable ajouté le 2026-07-18, retour utilisateur ("soit on a l'info et on donne une info fiable, soit on ne donne rien")** : ces deux fonctions retournent une `Map<variantId, VelocityResult>` (`{ velocityPerDay, availableDays, sufficientData }`), jamais un simple nombre. `sufficientData` est faux si `availableDays < windowDays` demandé — soit parce que la variante est trop récente ou n'a jamais été disponible aussi longtemps même en remontant jusqu'à 1 an, soit parce que l'historique `InventorySnapshot` lui-même n'a pas encore assez de profondeur (base fraîchement initialisée, ex: un conteneur Docker local recréé n'a que quelques jours de snapshots alors que les commandes remontent sur 1 an). **Aucun appelant ne doit traiter une variante absente de la Map ou avec `sufficientData: false` comme une vitesse fiable de 0** : `dormant.ts`/`reorder.ts` excluent ces variantes de leur classement (jamais un "dormant"/une suggestion de réachat basée sur un signal trop court) et exposent un `insufficientDataCount` affiché explicitement à l'utilisateur (bannière d'info sur la page), plutôt que de les faire disparaître silencieusement ou de leur assigner un chiffre non fiable.

**Pourquoi cet historique ne peut pas être rattrapé DEPUIS SHOPIFY** : vérifié directement sur la doc Shopify (2026-07-18) — l'API Admin GraphQL n'expose que le niveau de stock ACTUEL (`InventoryLevel`), jamais un historique interrogeable. `InventoryAdjustmentGroup` (l'historique visible dans l'admin Shopify) n'est retourné qu'en réponse immédiate d'une mutation qu'on vient de faire soi-même (`inventoryAdjustQuantities`, etc.) — aucun champ de requête n'existe pour lister les ajustements passés (une demande de fonctionnalité récurrente côté communauté Shopify, jamais mise en œuvre). Même l'admin Shopify ne garde cet historique que 90 à 180 jours. Sans autre source, `InventorySnapshot` ne peut s'enrichir qu'au fil des polls réels à partir de maintenant — pas de backfill possible depuis Shopify, contrairement à `Order`/`OrderLineItem` (entièrement récupérables rétroactivement via Bulk Operations).

**Backfill ponctuel depuis un tracker externe MongoDB (`backfillInventoryFromMongoStock.ts`, 2026-07-18)** : une base MongoDB (`stockDB.Freya-Stock`, sur le même serveur, alimentée par un script indépendant de freyaOMS depuis le 2025-10-08) enregistre chaque jour la liste des produits en rupture avec un compteur de jours de rupture continu. Contrairement à Shopify, cette source EST rétroactivement exploitable — utilisée pour combler le manque de profondeur réelle d'`InventorySnapshot` (découvert le 2026-07-18 : le poll réel n'avait que 2 jours d'historique en prod). Limites assumées, jamais devinées :
- **Uniquement les produits à variante UNIQUE** (matching par titre exact) - un produit multi-tailles (ex: 30ml/100ml) ne permet pas de savoir laquelle des variantes était en rupture, donc jamais rien inféré pour ces cas (vérifié le 2026-07-18 sur le catalogue réel : 111 produits à variante unique backfillés sur 121 titres matchés, 13 produits multi-variantes volontairement exclus, 22 titres non trouvés - tous des "Pack ...", déjà hors périmètre par la règle 8/section "Produits exclus").
- **Signal binaire, jamais une quantité inventée** : `quantity = 1` si le tracker ne liste pas le produit ce jour-là (disponible, quantité réelle inconnue - seul le signe compte pour `velocity.ts`), `quantity = 0` s'il est listé en rupture.
- **Jamais de chevauchement avec le vrai historique de polling** : seuls les jours strictement antérieurs au tout premier `InventorySnapshot` réel connu sont backfillés - le poll réel reste toujours la source de vérité dès qu'il existe pour un jour donné.
- **Jamais avant `Variant.shopifyCreatedAt`** (bug réel corrigé le 2026-07-18, signalé par l'utilisateur sur "SKIN1004 Madagascar Centella Double Cleansing Duo" : la vitesse de vente sur 120j paraissait diluée par des jours de disponibilité remontant à octobre 2025, alors que la variante n'a été créée sur Shopify que le 10 décembre 2025 et sa première vente réelle date du 11 décembre). Le tracker Mongo ne liste que les produits déjà présents dans le catalogue - un produit pas encore lancé n'apparaît dans AUCUNE liste ce jour-là (ni "en rupture" ni confirmé "en stock"), donc son absence de la liste "en rupture" ne prouve rien avant sa création réelle. **433 lignes erronées sur 16 variantes** ont été trouvées et corrigées (toutes les lignes backfillées avant `shopifyCreatedAt` supprimées, script relancé avec la borne ajoutée) - une variante sans `shopifyCreatedAt` connu n'est désormais simplement jamais backfillée, plutôt que de risquer la même erreur.
- **`recordedAt` à minuit UTC** (jamais une heure de poll réaliste) - marqueur volontaire pour rester distinguable d'un vrai poll a posteriori, sans colonne dédiée. Piège trouvé le 2026-07-18 en développant l'extension ci-dessous : ce marqueur sert aussi à calculer la coupure (plus vieux vrai poll) - un re-run après un premier backfill doit exclure ses propres lignes de ce calcul, sinon il confond son propre backfill avec du vrai historique et la coupure se décale à tort (silencieusement transformé en no-op la première fois).
- **Produits "toujours en stock" (jamais mentionnés en rupture), confirmés au cas par cas, jamais inférés automatiquement** (`ALWAYS_IN_STOCK_CONFIRMED_TITLES`, 2026-07-18) : 10 produits à variante unique n'apparaissent dans AUCUNE liste de rupture sur les 283 jours suivis - ambigu par nature (soit réellement en stock en continu, soit angle mort du tracker sur ce titre précis, ex: renommage). Chaque titre a été confirmé individuellement par l'équipe avant d'être backfillé comme "en stock" sur toute la période couvrable - jamais une hypothèse automatique généralisée à tout produit "jamais listé" (2 546 lignes ajoutées pour ces 10 produits).
- Script ponctuel (`npm run backfill:inventory-from-mongo -- --execute`, nécessite `MONGO_STOCK_URL` en variable d'environnement au moment du run, jamais commité) - relançable sans risque (supprimer d'abord les lignes déjà backfillées, identifiables par leur `recordedAt` à minuit UTC pile, avant de relancer).

**Page pas encore prête (`getInventoryHistoryDepthDays`, `HistoryDepthNotice.tsx`, 2026-07-18)** : tant que `MIN(InventorySnapshot.recordedAt)` (tous variantes confondues) remonte à moins de jours que la fenêtre requise (`windowDays` pour Réappro, `VELOCITY_WINDOW_DAYS = 60` fixe pour Dormants), la page Réappro/Dormants n'affiche RIEN de ses filtres/tableau habituels — juste un encart expliquant pourquoi (voir ci-dessus) et un compte à rebours ("Xj sur Yj nécessaires, encore Zj, vers le [date]"). Décision équipe 2026-07-18 : mieux vaut ce compte à rebours explicite qu'une page vide ou une bannière "tout exclu" sans contexte pendant les premières semaines suivant un déploiement/une réinitialisation de base.

`getPriorVelocityByVariant` désigne le bloc de `windowDays` jours de disponibilité réelle **immédiatement avant** celui de `getVelocityByVariant` (rangs `windowDays+1` à `2×windowDays`) — pas nécessairement les mêmes dates calendaires que l'ancienne fenêtre "jours -60 à -30", puisque les deux blocs sautent par-dessus les jours d'indisponibilité.

Peut être splitté par `Order.channel` pour comparer la vitesse B2B vs B2C sur le même produit. Utilisée par `reorder.ts` (30j de disponibilité par défaut, réglable par l'utilisateur — voir section 5), `dormant.ts` (60j de disponibilité, fixe) et, **depuis le 2026-07-18, par la page Stock elle-même** (`stockDays.ts`, 30j par défaut, réglable par l'utilisateur via le même slider que Réappro) — les trois répondent en fait à la même question ("est-ce que ce produit se vend, en ignorant les périodes où il n'y avait justement rien à vendre ?"), donc au même calcul.

### Vitesse de vente adaptative — désormais réservée au moteur de prévisions

**Changement du 2026-07-18** : la page Stock utilisait ce calcul (`getAdaptiveVelocityByVariant`) jusqu'au 2026-07-18. Retour utilisateur : "je veux que Stock et Réappro soient iso, la logique de Réappro est la bonne". Vérifié sur un cas réel avant de trancher (`B_PATCH_SKIN1004`, 29 unités vendues sur 365j glissants, mais rien vendu depuis 102 jours) : l'ancien calcul adaptatif affichait 0,03 unité/jour (la rupture récente, bien réelle, était comptée comme une baisse de la demande - exactement le même biais déjà corrigé pour reorder.ts/dormant.ts, voir plus haut dans cette section), alors que le nouveau calcul de Stock (disponibilité réelle, sans décroissance temporelle, voir ci-dessus) retrouve 0,43 unité/jour en allant chercher la dernière période où le produit avait vraiment du stock - cohérent avec ses 16 commandes réelles de décembre 2025 à avril 2026. **Compromis assumé** en unifiant Stock sur la logique de Réappro : un produit plus jeune que la fenêtre choisie (défaut 30j) ne peut jamais atteindre `sufficientData: true`, même s'il se vend très bien depuis son lancement - contrairement à l'ancien calcul qui bornait sa fenêtre à l'âge réel du produit pour lui donner quand même une estimation. Assumé comme cohérent avec le principe déjà validé pour dormants/réappro ("soit on a l'info fiable, soit on ne dit rien") plutôt qu'une exception pour Stock.

`getAdaptiveVelocityByVariant` (`src/lib/insights/velocity.ts`) reste utilisé, inchangé, par `forecast.ts` (`getBaseUnitsRate`, voir section 15) - une question différente ("quel est le taux de base agrégé sur tout un périmètre pour extrapoler un mois entier", qui a besoin d'une fenêtre continue même en cas de rupture partielle), pas concernée par ce changement :

```
ageDays(variantId)         = jours depuis Variant.shopifyCreatedAt
effectiveWindowDays        = min(365, max(1, ageDays))   -- jamais plus vieux que la variante, jamais plus d'un an
decayRate                  = ln(2) / 30                  -- demi-vie de 30 jours
weightedUnits(variantId)   = Σ quantity * exp(-decayRate * joursDepuisLaVente)   sur les commandes confirmées des `effectiveWindowDays` derniers jours
weightSum                  = (1 - exp(-decayRate * effectiveWindowDays)) / decayRate   -- somme géométrique continue des poids, ramène weightedUnits à une vitesse
velocityPerDay(variantId)  = weightedUnits(variantId) / weightSum
```

- **Produit récent** (< 1 an) : `effectiveWindowDays` = son âge réel, jamais la fenêtre max - un produit de 23 jours n'est JAMAIS jugé sur 365 jours dont 342 où il n'existait pas.
- **Produit ancien avec beaucoup d'historique** : jusqu'à 1 an de données utilisé (`effectiveWindowDays = 365`), mais chaque vente pèse selon son ancienneté (demi-vie 30j) - vérifié sur données réelles (2026-07-17) : une variante de 995 jours avec une seule vente il y a ~360 jours et rien depuis affiche une vitesse quasi nulle (0,00001/j) plutôt que la moyenne plate trompeuse (1/365 = 0,003/j).
- Au-delà d'un an, les données sont de toute façon jugées trop vieilles pour représenter la demande actuelle - jamais chargées même si elles existent.

`Variant.shopifyCreatedAt` (ajouté le 2026-07-18) vient du champ `createdAt` de l'API Shopify, absent pour les variantes synchronisées avant cette date tant que `npm run backfill:variant-created-at` n'a pas tourné. En son absence, `ageDays` est supposé égal au maximum (365j) plutôt que de sous-estimer une hypothétique variante récente sans données pour le prouver.

## 15. Prévisions de ventes

Demande explicite (2026-07-18) : prédire les chiffres de ventes du mois, de façon à devenir "de plus en plus précis jour après jour, mois après mois", pour aider à améliorer les prédictions de stock. Moteur dans `src/lib/insights/forecast.ts`, orchestration/cron dans `src/lib/sync/generateForecasts.ts`.

**Principe directeur** : jamais de saisonnalité/croissance par SKU individuel - un SKU seul a souvent trop peu d'historique pour ça (voir section 1 : un SKU réel avec 3 ventes en 9 mois). Ces deux facteurs se calculent à un niveau agrégé (`GLOBAL` ou par `CATEGORY`, c'est-à-dire `Product.productType`), où le signal est statistiquement exploitable, et s'appliquent multiplicativement à un taux de base par SKU qui, lui, EST fiable individuellement (`getAdaptiveVelocityByVariant`, section précédente - réutilisé tel quel, jamais dupliqué).

```
forecast(scope, scopeKey, targetYear, targetMonth, asOf) =
  forecastChannel(scope, scopeKey, "B2B", ...) + forecastChannel(scope, scopeKey, "B2C", ...)

forecastChannel(scope, scopeKey, channel, targetYear, targetMonth, asOf) =
  actualUnitsToDate(scope, channel, moisCible, jusqu'à asOf)                 -- RÉEL, jamais ré-estimé
  + baseUnitsRate(scope, channel, asOf) * joursRestantsPondérés(jourDeSemaine) * seasonalIndex(scope, channel, mois) * growthFactor(scope, channel)
```

**Découpage B2B/B2C obligatoire, jamais un calcul mélangé (corrigé le 2026-07-18)** : vérifié sur données réelles - le B2B est extrêmement irrégulier (0 unité vendue sur 5 des 12 mois calendaires observés, gros pics ponctuels les autres mois, cohérent avec une demande de réassort par lots plutôt qu'un flux continu), alors que le B2C vend en continu tous les mois. Mélanger les deux dans un seul calcul de saisonnalité/croissance faisait porter la lumpiness de B2B sur le signal B2C, pourtant fiable et representative d'une vraie demande retail. `forecastForScope` calcule donc `computeChannelForecast` indépendamment pour B2B et B2C (chacun avec son propre taux de base, sa propre saisonnalité, sa propre croissance, son propre prix moyen, sa propre pondération jour de semaine) puis additionne les deux résultats pour le total affiché. Les champs scalaires de premier niveau (`baseUnitsRate`, `seasonalIndex`, `growthFactor`, `*Trusted`) restent une moyenne pondérée par le taux de base de chaque canal (vue résumée, utilisée par la table `ForecastOverviewTable` et stockée telle quelle dans `SalesForecast` pour rester rétro-compatible) - le détail fiable canal par canal vit dans `ForecastResult.byChannel`, affiché explicitement sur chaque carte (jamais caché).

- **Part réelle vs part extrapolée** : `actualUnitsToDate`/`actualRevenueToDate` (par canal, puis sommées) sont les vraies ventes du mois cible depuis son début jusqu'à `asOf` (ou jusqu'à la fin du mois si déjà clos) - jamais ré-estimées. C'est ce qui rend la prévision "de plus en plus précise" : la part réelle grandit et la part extrapolée rétrécit mécaniquement chaque jour, ce n'est pas un ajustement artificiel.
- **`baseUnitsRate`** : par canal, somme de `velocityPerDay` (voir ci-dessus, `getAdaptiveVelocityByVariant` filtré par `channel`) de TOUTES les variantes du périmètre vendues sur ce canal, y compris celles `confident: false` - agréger de nombreux signaux individuellement faibles lisse le bruit, contrairement à extrapoler un SKU seul (le garde-fou `confident` protège un cas différent, voir plus haut).
- **`seasonalIndex(mois)`, lissé par confiance plutôt que coupé net (corrigé le 2026-07-18)** : moyenne des unités de ce mois calendaire sur les années complètes disponibles pour ce canal, divisée par la moyenne des 12 indices mensuels (pas par le total brut / nombre de mois, ce qui biaiserait le dénominateur si un mois a plus d'historique qu'un autre). Pleine confiance (`trusted: true`) à partir de 3 années complètes distinctes pour ce mois. **En dessous de 3, l'indice n'est plus coupé net à 1.0** (ancien comportement, jugé trop brutal - "on a un bon historique, pourquoi le jeter ?") **mais rapproché de 1.0 proportionnellement au nombre d'années réellement observées** : `index = 1 + (occurrences/3) * (indexBrut - 1)` - à 2 années sur 3, on garde 2/3 du signal brut ; à 0 année, indice neutre (1.0) comme avant ; à 3+ années, comportement strictement identique à l'ancien calcul (`occurrences/3 = 1`). Vérifié sur données réelles (2026-07-18) : l'historique par ligne de commande (jointure `Variant`) ne commence réellement qu'en octobre 2023, donc en juillet 2026 les mois de juillet/août/septembre n'ont que 2 années complètes utilisables (2024, 2025) - ils gardent maintenant 2/3 de leur signal saisonnier réel au lieu d'être jetés à plat.
- **`growthFactor`** : par canal, ratio unités des 90 derniers jours vs la même fenêtre un an plus tôt. Neutre (1.0, `growthTrusted: false`) si moins de 3 commandes distinctes sur la fenêtre antérieure (rien de fiable à comparer) - en pratique quasi toujours le cas pour B2B sur ce catalogue vu son irrégularité. Volontairement PAS de repli sur une croissance mois-sur-mois : ça compterait deux fois le même signal ~30-60j déjà capté par l'EWMA de `baseUnitsRate`. Toujours borné à [0.3, 3.0] même quand fiable (jamais un pic ponctuel qui démultiplie une prévision par 10).
- **`joursRestantsPondérés` par jour de semaine (nouveau, 2026-07-18)** : vérifié sur données réelles - le jeudi représente ~19% du volume total de ventes contre ~11-12% le week-end, un écart réel d'environ ×1,7 entre le meilleur et le pire jour. `getDayOfWeekIndices` calcule un indice par jour de semaine (moyenne = 1.0, normalisé sur le nombre réel de dates de chaque jour dans la fenêtre de 365j, pas une approximation `/7`), utilisé pour pondérer chaque jour restant du mois cible plutôt que de le traiter comme équivalent - important surtout en fin de mois, quand les jours restants ne sont plus un échantillon représentatif de la semaine. Neutre (`dowTrusted: false`, jours comptés à parts égales = comportement identique à l'ancien calcul) si moins de 50 commandes distinctes sur la fenêtre de 365j - en pratique presque toujours le cas pour B2B sur ce catalogue.
- **Conversion en TND** (`getAvgSellingPrice`) : UNE SEULE fois par canal, à la toute fin (jamais mélangée dans les facteurs ci-dessus, pour ne pas empiler l'hypothèse "prix stable" plusieurs fois) - prix de vente moyen des 90 derniers jours de ce canal ; repli sur le prix catalogue moyen (`Variant.price`, jamais filtré par canal - pas de tarification distincte B2B/B2C modélisée) si aucune vente récente sur ce canal dans le périmètre.
- **CA du périmètre GLOBAL sans filtre canal** : `Order.subtotalPrice`, comme partout ailleurs sans filtre produit (voir "CA : `Order.subtotalPrice` vs somme des lignes de commande" en haut de ce document). **Dès qu'un filtre canal OU catégorie est appliqué** (donc systématiquement dans `computeChannelForecast`, qui filtre toujours par canal) : par ligne de commande (limite acceptée déjà documentée - pas d'alternative dès qu'un filtre produit/canal est nécessaire) - vérifié : sommer par ligne de commande sur avril 2026 aurait surestimé le CA réel GLOBAL non filtré d'environ 23%, cohérent avec le biais déjà documenté, mais reste la seule option possible pour un total par canal.

**Backtest de validation (2026-07-18, avant le découpage B2B/B2C)**, avant tout branchement cron/UI : `forecastForScope("GLOBAL", "GLOBAL", 2026, 4, asOf)` avec `asOf` après la clôture d'avril reproduit exactement le CA réel déjà connu (65 364,18 TND), puisqu'il n'y a alors plus rien à extrapoler ; avec `asOf` fixé au milieu du mois (16 avril), la prévision (602,6 unités / 58 493 TND) reste raisonnablement proche du réel final (698 unités / 65 364 TND) malgré `seasonalTrusted=false` pour ce mois à cette date - une erreur honnête, pas un résultat fabriqué à partir d'un signal trop pauvre.

**`asOf` explicite partout** (jamais `new Date()` implicite dans le moteur, y compris dans `getAdaptiveVelocityByVariant` qui accepte désormais un `asOf` optionnel) : indispensable pour backtester sur un mois déjà clos sans fuite de données (une variante regardée "à cette date passée" ne doit jamais voir de ventes postérieures).

**Stockage (exception documentée, voir `DATABASE.md`)** : `SalesForecast`, une ligne par (scope, scopeKey, mois cible, jour de génération) - jamais écrasée d'un jour à l'autre. C'est ce qui permet `getForecastAccuracy` (MAPE par délai de prévision, page Prévisions) de prouver concrètement que l'algorithme devient plus précis avec le temps, pas juste de l'affirmer. Génération quotidienne (mois courant + mois suivant, tous les scopes) et réconciliation des mois clos via `generateForecasts.ts`, câblées sur un cron dédié (`?resource=forecast`, voir `ARCHITECTURE.md`) - délibérément PAS dans le poll `resource=all` ni dans le bouton "Actualiser" de l'Overview (concept "une fois par jour", pas "à chaque poll").

**Chip informatif sur la page Réappro** : `ReorderRow.category` (additif, n'entre dans AUCUN calcul de `getReorderSuggestions`) permet d'afficher l'indice de saisonnalité du mois PROCHAIN pour la catégorie de chaque suggestion - le réappro décidé aujourd'hui se vend dans les semaines à venir, pas ce mois-ci.

**Vue d'ensemble multi-catégories (`forecastAllScopes`, `ForecastOverviewTable.tsx`, 2026-07-18)** : retour utilisateur ("je veux plus qu'une estimation, quelque chose de puissant") - la page Prévisions affichait auparavant UN SEUL périmètre à la fois (sélecteur `?category=`). `forecastAllScopes(categories, asOf)` appelle `forecastForScope` pour GLOBAL + chaque catégorie, mois en cours et mois prochain, et retourne tout en une fois pour une table triable (CA prévu, part déjà réelle, tendance de croissance, indice de saisonnalité du mois prochain) - cliquer une ligne ouvre le détail (les deux cartes `ForecastCard`) de ce périmètre précis via `?category=`. Volontairement pas optimisé pour partager le calcul entre les deux vues (redondance acceptée, catalogue restreint à ~11 catégories - même principe que `productProfile.ts`).

**Détail du calcul, à la demande (`ForecastMethodologyDialog.tsx`, 2026-07-18)** : retour utilisateur ("une vraie explication, faut cliquer sur un truc") - bouton "Comment ça marche, en détail" à côté du titre, ouvre une explication complète de l'algorithme (découpage B2B/B2C, taux de base, saisonnalité lissée, croissance, pondération jour de semaine, conversion en TND, garde-fous, preuve par le MAPE) en langage clair, avec des exemples concrets tirés des vraies données. Chaque `ForecastCard` affiche en plus le détail par canal (`ChannelDetail`, chips base/saisonnalité/croissance/jour-de-semaine/prix par canal) et un accordéon "Voir le détail du calcul" avec la recette numérique exacte de CHAQUE canal séparément, puis le total - jamais juste un chiffre final sans montrer comment il a été obtenu, ni un chiffre B2B/B2C mélangé sans distinction.

## 2. Jours de stock restant / date de rupture estimée

```
daysOfStock(variantId) = Variant.inventoryQuantity / velocity(variantId, 30)
estimatedStockoutDate  = today + daysOfStock(variantId) jours
```

(Page Stock : `velocity` ici est `getVelocityByVariant`, voir section 1 - jours de disponibilité réelle, fenêtre réglable par l'utilisateur, défaut 30j, identique à Réappro depuis le 2026-07-18.)

Cas limites à gérer explicitement dans le code (pas juste laisser diviser par zéro) :
- `velocity = 0` ou `sufficientData = false` → pas de vitesse de vente fiable sur la fenêtre → `daysOfStock = null` ("pas de rupture prévisible" plutôt qu'Infinity).
- `inventoryQuantity = 0` → `daysOfStock = 0`, produit déjà en rupture, à faire remonter en priorité dans l'UI indépendamment de la vitesse.

## 3. Produits dormants / surstock

Variantes à rotation quasi nulle mais avec du stock immobilisé :

```
dormant(variantId) = velocity(variantId, 60) < SEUIL_DORMANT
                      AND Variant.inventoryQuantity > 0
```

`velocity(variantId, 60)` ici = les 60 derniers jours **de disponibilité réelle** (voir section 1), pas 60 jours calendaires — retour utilisateur du 2026-07-18 : un best-seller en rupture de stock pendant 60 jours calendaires ne doit pas être classé dormant simplement parce qu'il n'a pas pu vendre faute de stock, ce n'est pas la même chose que "personne n'en veut".

**Variantes exclues faute de recul (`getDormantStockDetailed`, `insufficientDataCount`)** : une variante en stock dont on n'a pas encore 60 jours de disponibilité réelle recensés (`sufficientData: false`, voir section 1) n'est **jamais** classée dormante par défaut — elle est exclue du classement, et comptée séparément dans `insufficientDataCount`, affiché explicitement sur la page (`getDormantStock` reste l'export simple qui ne retourne que les lignes, pour les appelants qui n'ont pas besoin de ce compteur, ex: `overview.ts`/`productProfile.ts`).

Triées par **valeur de stock immobilisée** décroissante pour prioriser :

```
stockValue(variantId) = Variant.inventoryQuantity * COALESCE(Variant.cost, Variant.price)
```

(`cost` préféré à `price` quand disponible — la valeur immobilisée réelle est au prix de revient, pas au prix de vente ; `price` en repli si `cost` n'est pas renseigné côté Shopify.)

`SEUIL_DORMANT` : constante configurable dans `src/lib/insights/dormant.ts`, à ajuster avec l'équipe une fois les premières données réelles observées (pas de valeur "correcte" universelle a priori).

**Dernière vente** (`lastSaleAt`) : date de la dernière commande confirmée contenant cette variante, tous historique confondu (pas de fenêtre glissante, contrairement à la vitesse de vente) — `null` si la variante n'a jamais été vendue depuis le début de l'historique synchronisé. Affiché en relatif ("il y a X j" / "Jamais vendu") sur la page Dormants : répond à "depuis combien de temps cet argent est-il immobilisé", complémentaire à la vitesse de vente qui répond à "est-ce que ça bouge en ce moment".

## 13. KPI de synthèse (page Dormants)

`summarizeDormantStock`/`groupDormantValueByVendor` (`src/lib/insights/dormant.ts`) — agrégats calculés **en mémoire** sur le résultat déjà filtré de `getDormantStock` (pas de nouvelle requête Prisma/SQL filtrée : c'est une simple réduction/regroupement d'un jeu de lignes déjà correct, même principe que les KPI dérivés des pages B2B vs B2C et Déclaré vs black) :
- `totalValue` : somme de `stockValue` sur toutes les variantes dormantes affichées - le chiffre "argent immobilisé" mis en avant en haut de la page Dormants, jamais recalculé indépendamment de la table en dessous (même source, donc toujours cohérent avec elle).
- `variantCount`, `averageValue` : nombre de variantes dormantes et valeur moyenne immobilisée par variante.
- `neverSoldCount` : nombre de variantes dont `lastSaleAt` est `null` - un sous-cas plus grave du surstock (jamais vendu, pas juste "ralenti"), mis en évidence séparément plutôt que noyé dans le total. Affiché avec une date concrète (`getHistoryStartDate`, `MIN(Order.orderCreatedAt)` sur toute la table, pas de fenêtre) plutôt que le texte vague "depuis le début de l'historique" - retour utilisateur du 2026-07-17 : une mesure "jamais" doit toujours dire depuis quand on regarde, sinon elle est invérifiable.
- `groupDormantValueByVendor` : répartition de `totalValue` par marque, affichée en `BarListChart` **une seule teinte** (magnitude par marque, même principe que la répartition par marque section 7 - jamais une couleur catégorielle par marque, la liste n'est pas bornée).

## 4. Comparaison B2B vs B2C

Toutes les métriques ci-dessus, groupées par `Order.channel` sur une même fenêtre :
- Répartition du CA (`SUM(OrderLineItem.quantity * OrderLineItem.unitPrice)`) par canal.
- Top produits par canal (classement séparé B2B / B2C, pas un classement global avec une colonne canal).
- Marge par canal, si `Variant.cost` est renseigné : `(unitPrice - cost) * quantity`, sinon la métrique est simplement omise de l'UI plutôt que d'afficher un chiffre trompeur basé sur un cost manquant traité comme 0.

**Moyenne mensuelle par canal, par année** (`getMonthlyChannelBreakdown`, ajouté 2026-07-18, retour utilisateur "combien on fait par mois en B2B et en B2C, avec la possibilité de voir les autres années") : CA confirmé par mois pour UNE année choisie (`?year=`, sélecteur `YearSelector.tsx`, défaut l'année en cours), splitté B2B/B2C. Comme `getChannelTotals` sans filtre marque : `Order.subtotalPrice`, pas une somme par ligne (voir "CA : `Order.subtotalPrice` vs somme des lignes de commande") ; avec un filtre marque, somme par ligne de commande (seule option possible pour un total par produit). La moyenne mensuelle affichée (`avgPerMonth`) divise par `monthsWithData` (mois ayant au moins une vente), **pas toujours 12** : sur l'année en cours, diviser par 12 sous-estimerait la vraie moyenne des mois déjà écoulés (les mois futurs n'ont simplement pas encore de ligne) - le nombre de mois utilisé est affiché à côté de la moyenne dès qu'il est inférieur à 12.

**Bug réel corrigé le 2026-07-18** : `getRevenueTrend` (section 8) et `getMonthlyChannelBreakdown` n'acceptaient aucun filtre marque du tout, et la page appelait `getRevenueTrend` avec une fenêtre codée en dur (90j) au lieu du sélecteur de période de la page — les deux courbes restaient donc figées quels que soient les filtres choisis, en violation directe de la règle "tout insight filtrable redescend le filtre jusqu'à la requête SQL" (voir "Filtres marque et période"). Les deux fonctions acceptent désormais `{ vendor?: string }`, redescendu en SQL comme partout ailleurs, et la page passe `windowDays` (le filtre période actif) à `getRevenueTrend` au lieu d'une constante séparée.

## 5. Réapprovisionnement (reorder point & quantité suggérée)

`src/lib/insights/reorder.ts` — répond directement à "faut-il racheter ce produit, et combien ?". Hypothèses globales v1 (pas de modèle `Supplier`/délai par fournisseur en base pour l'instant) :

```
REORDER_SAFETY_DELAY_DAYS = 30  # délai de sécurité global (fournisseur + marge fusionnés, décision équipe 2026-07-18)
TARGET_COVERAGE_DAYS = 90       # couverture visée après une commande : au moins 3 mois de vente (décision équipe 2026-07-16)
                                # réglable dans l'UI (slider sur la page Réappro, ?coverage=), 30-180j — voir CoverageControl.tsx
windowDays = 30 (défaut)        # fenêtre d'analyse (vitesse de vente/tendance), réglable dans l'UI (slider, ?window=),
                                # 14-120j — voir AnalysisWindowControl.tsx

reorderPoint(variantId)      = velocity(variantId, windowDays) * REORDER_SAFETY_DELAY_DAYS
suggestedOrderQty(variantId) = max(0, velocity(variantId, windowDays) * TARGET_COVERAGE_DAYS - inventoryQuantity)
```

**Simplifié le 2026-07-18** (retour utilisateur : "ça sert à rien d'avoir délai fournisseur 14j, stock de sécurité 7j") : les deux anciennes constantes `LEAD_TIME_DAYS` (14j) + `SAFETY_STOCK_DAYS` (7j), qui n'étaient de toute façon que des hypothèses globales sans donnée fournisseur réelle en base pour les distinguer, sont fusionnées en une seule `REORDER_SAFETY_DELAY_DAYS`, réglée à **30 jours (un mois)** sur demande explicite de l'équipe.

**Fenêtre d'analyse réglable** (`AnalysisWindowControl.tsx`, `?window=`, 2026-07-18, retour utilisateur : pouvoir choisir la période sur laquelle sont basés les calculs de rotation, pour que les prédictions suivent) : contrôle continu (14 à 120 jours), même principe URL/`router.replace` que `CoverageControl` — jamais figé en dur dans les calculs, `VELOCITY_WINDOW_DAYS = 30` n'est qu'un défaut. S'applique à `velocity`/`priorVelocity` (donc à `reorderPoint`, `suggestedOrderQty`, et à la tendance ci-dessous), jamais à `TARGET_COVERAGE_DAYS` (question distincte : "sur quelle période je juge la vitesse actuelle" vs "combien de stock je veux après la commande").

Urgence :
- `critical` : `inventoryQuantity = 0`
- `serious` : `inventoryQuantity <= reorderPoint * 0.5`
- `warning` : `inventoryQuantity <= reorderPoint`
- `good` : au-dessus du seuil (non affiché sur la page Réapprovisionnement)

**Important** : ne considère QUE les variantes avec `velocity(windowDays) > 0` (qui se vendent réellement, jours de disponibilité réelle inclus) **ET** dont la vitesse est mesurée sur un bloc complet de `windowDays` jours de disponibilité réelle (`sufficientData: true`, voir section 1) — sinon exclue et comptée dans `insufficientDataCount` (`getReorderSuggestionsDetailed`), affiché explicitement sur la page plutôt que silencieusement absent. Un produit dormant en rupture n'est pas une urgence de rachat — c'est un problème de dormance (section 3), pas de réappro. C'est une distinction volontaire : sur le catalogue réel (2026-07-16), 95 variantes étaient en rupture de stock mais seulement 4 avaient une vitesse de vente positive (avec l'ancien calcul, dilué par la fenêtre calendaire) — depuis le correctif du 2026-07-18 (vitesse basée sur les jours de disponibilité réelle, section 1), un best-seller en rupture depuis le début de la fenêtre n'a plus une vitesse artificiellement nulle : sa vitesse est calculée sur sa dernière période de disponibilité réelle, quitte à remonter jusqu'à un an en arrière pour la trouver, et il réapparaît donc correctement dans les suggestions — à condition que l'historique `InventorySnapshot` ait assez de profondeur pour ça (voir la note `sufficientData` section 1 : une base tout juste initialisée n'aura pas encore ce recul).

**Tendance de la demande** (`DemandTrend`) : compare `velocity(windowDays)` (bloc de jours de disponibilité réelle le plus récent) à `velocity(windowDays)` du bloc précédent (via `getPriorVelocityByVariant`) :

```
ratio = currentVelocity / priorVelocity
trend = ratio >= 1.2 ? "up" : ratio <= 0.8 ? "down" : "stable"
# prior absent ou sufficientData=false           -> "unknown" (jamais "new" : on ne sait juste pas, ce n'est pas
#                                                    la même affirmation que "cette variante est neuve")
# prior.velocityPerDay = 0 et current > 0        -> "new" (pas de rapport calculable, mais prior fiable)
# prior.velocityPerDay = 0 et current = 0        -> "unknown"
```

Affichée en icône (↑/↓/→) sur la table Réapprovisionnement — permet de distinguer une variante en rupture dont la demande accélère (à commander en plus grande quantité) d'une variante en rupture dont la demande ralentit.

**Regroupement par fournisseur** (`groupReorderByVendor`) : agrège les suggestions par `vendor` (SKUs à commander, unités totales, ruptures) — vue "bon de commande" façon apps de gestion de stock Shopify (Assisty, Stocky), pour préparer une commande fournisseur sans avoir à re-trier la table manuellement.

**Export CSV** (`ExportReorderCsvButton.tsx`, `src/lib/csv.ts`, 2026-07-17) : exporte exactement les lignes actuellement affichées (déjà filtrées par marque/couverture/fenêtre d'analyse) - jamais un export "tout le catalogue" qui ignorerait le filtre actif. Séparateur `;` (pas `,`) : Excel en locale fr-FR utilise la virgule comme séparateur décimal. BOM UTF-8 ajouté pour qu'Excel affiche correctement les accents.

**Prochaine évolution naturelle** : remplacer `REORDER_SAFETY_DELAY_DAYS` global par un délai par marque/fournisseur (nécessite un modèle `Supplier` — volontairement pas encore construit, voir la question roadmap dans la conversation avec l'équipe du 2026-07-16).

## 6. Classification ABC (Pareto)

`src/lib/insights/abc.ts` — CA confirmé sur 90 jours par variante, trié décroissant, % cumulé calculé, puis :

```
tier = cumulativeShare <= 0.80 ? "A" : cumulativeShare <= 0.95 ? "B" : "C"
```

Présentée en **table**, toujours au niveau **variante/SKU** (jamais agrégée par produit) car c'est le niveau de détail nécessaire pour les décisions de réapprovisionnement (savoir si c'est le 30ml ou le 100ml qui tourne). Jamais en graphique à deux axes (CA + % cumulé) — un double axe induit systématiquement en erreur de lecture, voir la skill `dataviz`. Pour une vue d'ensemble par produit/catégorie, voir la section 11.

## 7. Répartition par marque (vendor)

`src/lib/insights/vendorBreakdown.ts` — CA + unités par `Product.vendor` sur une fenêtre glissante. Affiché en bar chart **une seule teinte** (magnitude par marque, pas une comparaison d'identité entre catégories fixes) — ne jamais assigner une couleur catégorielle distincte par marque, la liste de marques n'est pas bornée à 8 et change dans le temps.

## 11. Répartition par produit et par catégorie

`src/lib/insights/productBreakdown.ts` — deux vues complémentaires à la classification ABC (qui reste au niveau SKU) :
- `getRevenueByProduct` : CA agrégé par **produit** (`Product.id`), toutes tailles/variantes confondues — répond au problème "un CA par variante fragmente un même produit en plusieurs barres (30ml, 100ml...)" (décision équipe 2026-07-16).
- `getRevenueByCategory` : CA agrégé par **catégorie** (`Product.productType` Shopify : Nettoyant Visage, Soin Visage, Sérum...) — vue macro par type de produit.

Les deux utilisent le composant générique `RankedBarChart` (une seule teinte, pas de couleur par catégorie — même principe que la répartition par marque). Les titres de produit étant souvent longs (ex: "SKIN1004 Madagascar Centella..."), le graphique par produit utilise un `labelWidth`/`rowHeight` plus généreux pour laisser le libellé s'enrouler sur 2 lignes plutôt que de le tronquer — tronquer un préfixe de marque long fait perdre l'information distinctive (voir l'historique de ce fichier : une première version tronquait à 26 caractères, ce qui masquait la partie utile du nom pour toute la gamme SKIN1004 Madagascar Centella).

## 8. Tendances (CA et volume de commandes dans le temps)

`src/lib/insights/orderTrend.ts` :
- `getRevenueTrend` : CA confirmé par jour, splitté B2B/B2C — graphique en aires empilées, un seul axe (montant), les deux canaux sommés = le total. Filtrable par marque (`{ vendor? }`, redescendu en SQL, corrigé le 2026-07-18 — voir section 4) ; la fenêtre (`windowDays`) est celle du sélecteur de période de la page B2B vs B2C, plus une constante séparée figée à 90j.
- `getOrderCountTrend` : nombre de commandes confirmées vs annulées par jour — permet de suivre le taux d'annulation dans le temps plutôt qu'en instantané.

## 10. Comparaison période sur période (Overview)

`getOverviewKpis(windowDays)` compare systématiquement la fenêtre demandée à la fenêtre équivalente immédiatement précédente (ex: 30 derniers jours vs les 30 jours d'avant) pour le CA et le taux d'annulation — affiché comme un delta (`+12% vs période précédente`) plutôt qu'un chiffre isolé. Le taux d'annulation utilise `higherIsBetter = false` côté UI (`KpiCard`) : une baisse du taux d'annulation est un delta positif (vert), pas négatif.

## 12. Ventes déclarées vs black

`src/lib/insights/blackMarketComparison.ts` (`getSaleTypeTotals`, `getTopProductsBySaleType`) — même forme que la comparaison B2B/B2C (section 4), mais ventile par `Variant.isBlackMarket` (voir `docs/SHOPIFY_SYNC.md`) au lieu de `Order.channel`. Page `/black-market`.

Différence structurelle avec B2B/B2C, qui a une conséquence directe sur le calcul : `channel` est une propriété de la commande, `isBlackMarket` est une propriété du **SKU/variante** — une même commande peut mélanger des lignes déclarées et black. `getSaleTypeTotals` ne peut donc **jamais** utiliser `Order.subtotalPrice` (même sans filtre marque, contrairement à `getChannelTotals`) : il retombe systématiquement sur une somme par ligne de commande, avec la même limite de précision documentée plus haut ("CA : `Order.subtotalPrice` vs somme des lignes de commande").

Les deux dimensions (`channel` et `saleType`) sont indépendantes et ne doivent jamais être combinées sur un même graphique (une commande B2B peut très bien contenir une ligne black).

**Tendance de la part du black** (`getSaleTypeTrend`, `SaleTypeTrendChart.tsx`, 2026-07-17) : un total figé sur la période ("18,9% de black ce mois-ci") ne dit pas si la situation s'améliore ou empire. Le graphique affiche `blackRatio` par jour (part du black dans le CA du jour, jamais le CA absolu empilé - un seul axe, un seul pourcentage). Un jour sans aucune vente a `blackRatio = null` (jamais 0, ce serait faux) - recharts laisse un vrai trou dans la ligne plutôt que de suggérer "0% de black ce jour-là". Sur une petite fenêtre quotidienne le ratio peut swinguer fort (peu de commandes/jour) - fenêtre fixe de 90j comme la tendance CA de B2B vs B2C, indépendante du sélecteur de période de la page.

## 14. Marge (rentabilité)

`src/lib/insights/margin.ts` — `getMarginByProduct`, `getMarginByVendor`, `getMarginByChannel`, `getAbcClassificationByMargin`. Répond à un manque documenté depuis longtemps (voir section 4) mais jamais codé jusqu'au 2026-07-17 : un produit peut être Top 1 en CA et catastrophique en marge, la classification ABC (section 6) étant purement CA ne le révèle pas.

```
margin = SUM(quantity * unitPrice - totalDiscount) - SUM(quantity * cost)   -- uniquement sur les lignes où Variant.cost est renseigné
marginRate = margin / costedRevenue
costCoverage = costedRevenue / revenue
```

**Règle non négociable : un coût manquant n'est jamais traité comme 0.** Toute agrégation (par produit/marque/canal) calcule `costedRevenue` et `cost` uniquement sur les lignes dont `Variant.cost IS NOT NULL` ; `revenue` (le CA affiché à côté) reste lui basé sur toutes les lignes. `costCoverage` (0 à 1) doit toujours être affiché à côté du taux de marge - un `marginRate` calculé sur 20% du CA n'a pas le même poids qu'un calculé sur 100%, et le cacher induirait en erreur. `marginRate` est `null` (jamais 0) si aucune ligne n'a de coût.

Toujours calculée par ligne de commande (le coût vit sur `Variant`, jamais sur `Order`) - même limite de précision que documentée pour `isBlackMarket`/les CA filtrés par marque (remises multi-produits non allouées par Shopify au niveau ligne).

`getAbcClassificationByMargin` : même Pareto que la classification ABC (section 6) mais cumulé sur la marge plutôt que le CA. Exclut entièrement les variantes sans coût (impossible de les classer par marge sans supposer un coût de 0) - `excludedVariantCount` retourné à côté pour l'afficher explicitement plutôt que de les faire disparaître silencieusement.

## Fiche produit unifiée

`src/lib/insights/productProfile.ts` (`getProductProfile`), page `/produit/[variantId]` — répond à "il faut ouvrir 4-5 pages pour tout savoir sur un SKU" (retour utilisateur 2026-07-17). Regroupe stock/vitesse/réappro/ABC (CA)/ABC (marge)/dormance/black pour UNE variante.

**Choix volontaire : réutilise les insights catalogue-entier existants plutôt que d'écrire une seconde implémentation par variante.** `getProductProfile` appelle `getStockOverview()`, `getAbcClassification(90)`, `getAbcClassificationByMargin(90)`, `getDormantStock()`, `getReorderSuggestions({})` (sans filtre) puis fait un simple `.find(variantId)` sur chacun. Plus coûteux qu'une requête scopée à une seule variante, mais le catalogue est petit (~150 variantes) et le vrai risque à éviter est la dérive entre deux implémentations de la même formule (`daysOfStock`, tier ABC, etc.) - même principe que documenté pour `STOCK_STATUS_OPTIONS`.

Accessible depuis `StockTable`/`ReorderTable`/`DormantTable` (titre produit cliquable, `Link` MUI + `next/link`).

## Alertes

`src/lib/insights/alerts.ts` (`getAlerts`), page `/alertes` — décision équipe 2026-07-17 : une page dédiée aux données manquantes/anomalies détectées automatiquement, jamais corrigées toutes seules, toujours validées ou rejetées par un humain.

**Catégories actuelles** :
- `missing-cost` : toute variante avec `Variant.cost IS NULL`. Auto-résolue dès que le coût est rempli sur Shopify (pas besoin d'acquittement, sauf si on veut volontairement faire taire une variante qui n'aura jamais de coût, ex: échantillon).
- `margin-anomaly-negative` : marge négative sur 90 jours (vendu à perte) — signal absolu, toujours affiché, ne dépend pas d'une moyenne.
- `margin-anomaly-high` : marge très supérieure à la moyenne du catalogue (`> moyenne + 2 écarts-types`), calculée sur l'échantillon des variantes costées avec vente sur la fenêtre. Souvent le signe d'une erreur de saisie de coût (ex: un chiffre oublié) plutôt qu'un vrai produit très rentable - à confirmer, pas à corriger automatiquement. Sauté si l'échantillon a moins de 5 variantes (`MIN_SAMPLE_FOR_ANOMALY`) : une moyenne/écart-type sur trop peu de points n'est pas fiable.

**Acquittement persistant** (`AlertAcknowledgment`, `alertKey` unique du type `"<catégorie>:<variantId>"`) : une fois qu'un humain confirme qu'une valeur surprenante est correcte, elle ne doit plus jamais réapparaître comme "à vérifier" tant que la donnée ne change pas de forme - contrairement à `missing-cost` qui se résout de lui-même, une marge élevée légitime peut rester vraie indéfiniment sans que ce soit un problème. Server Actions `acknowledgeAlert`/`unacknowledgeAlert` (`src/app/(dashboard)/alertes/actions.ts`).

**Prochaines catégories naturelles** (pas encore implémentées, mais la structure `Alert`/`getAlerts()` est faite pour en accueillir d'autres facilement) : tout autre champ Shopify qu'on découvre manquant/incohérent au fil de l'usage - voir `docs/SHOPIFY_SYNC.md`, "État des lieux : champs vérifiés vs supposés".

## Saisonnalité (CA par mois, année sur année)

`src/lib/insights/seasonality.ts` (`getRevenueByMonthYoY`), carte sur l'Overview sous la tendance CA — décision équipe 2026-07-17 : un delta "vs période précédente" (section 10) ne dit pas si un mois est structurellement fort/faible (saisonnalité) ou si c'est juste une tendance récente. Avec plusieurs années d'historique désormais disponibles, une vraie comparaison calendaire (même mois, années différentes) est possible.

Une ligne par année, coloriée via la rampe séquentielle bleue (année la plus ancienne = la plus claire, la plus récente = la plus foncée) plutôt que des teintes catégorielles - ce n'est pas une comparaison d'identités fixes (comme B2B/B2C) mais une progression dans le temps, même logique que la rampe ABC. `Order.subtotalPrice` (pas de somme par ligne) : total non filtré par marque, même règle que documentée pour le CA global. Un mois sans aucune donnée pour une année (ex: janvier-novembre 2022, historique commençant fin décembre 2022) n'a simplement pas de clé pour cette année dans le point de données - recharts ne trace rien plutôt que de suggérer un CA à 0. N'est affichée que si au moins 2 années sont présentes dans l'historique (sinon la comparaison n'a pas de sens).

## Filtres marque et période

Toutes les pages d'insights acceptent des filtres pilotés par l'URL (`?vendor=...&window=...`), gérés par `src/lib/filterParams.ts` (fonctions pures, **sans import Prisma** — voir la note dans `ARCHITECTURE.md` sur pourquoi ce fichier est séparé de `src/lib/insights/filters.ts`) et le composant `FilterBar.tsx`. Chaque insight (`getStockOverview`, `getDormantStock`, `getReorderSuggestions`, `getAbcClassification`, `getChannelTotals`, `getTopProductsByChannel`, `getRevenueTrend`, `getMonthlyChannelBreakdown`, `getSaleTypeTotals`, `getTopProductsBySaleType`) accepte un filtre `{ vendor?: string }` optionnel qui redescend jusqu'à la requête Prisma/SQL — jamais un filtrage a posteriori en JS sur des lignes déjà chargées. `getRevenueTrend`/`getMonthlyChannelBreakdown` n'acceptaient PAS ce filtre avant le 2026-07-18 (voir section 4) — vérifier, avant d'ajouter un nouvel insight filtrable, qu'aucun appelant ne se contente d'ignorer silencieusement le filtre actif de la page.

Page Réappro (2026-07-18) : `getReorderSuggestions` accepte en plus `{ windowDays?: number }` (fenêtre d'analyse, `AnalysisWindowControl.tsx`, `?window=`, 14-120j) — même principe, redescend jusqu'à `getVelocityByVariant`/`getPriorVelocityByVariant`.

**Page Stock (2026-07-17) : filtre `category` (colonne réelle) vs filtre `status` (dérivé) — même règle, deux mécanismes différents.** `getStockOverview` accepte aussi `{ category?: string }` (`Product.productType`), qui redescend en SQL exactement comme `vendor`. Le filtre `status` (Rupture/Critique/Faible/Ok/Pas de vente, `STOCK_STATUS_OPTIONS` dans `filterParams.ts`) est différent par nature : `StockRow.status` est **calculé en JS** (`computeStockStatus` dans `stockDays.ts`) en combinant `inventoryQuantity` (Variant) et la vitesse de vente (agrégée depuis `OrderLineItem` par `getVelocityByVariant`) - deux sources distinctes fusionnées après coup, pas une colonne. Le pousser en SQL demanderait de dupliquer la formule de `daysOfStock` dans une sous-requête corrélée, un risque de dérive entre deux implémentations de la même règle pour un gain nul (la page Stock charge déjà toutes les variantes, pas de pagination serveur). Le filtre `status` est donc appliqué page.tsx (Server Component), sur le résultat déjà calculé par `getStockOverview` - toujours côté serveur avant rendu, jamais un filtrage client sur des lignes déjà affichées. `STOCK_STATUS_OPTIONS` vit dans `filterParams.ts` (fichier pur) précisément pour rester la seule source de vérité des seuils, partagée par le filtre (page.tsx), l'affichage (`StockTable.tsx`) et le calcul (`stockDays.ts`) - jamais trois copies des mêmes seuils (7j/21j) qui pourraient dériver entre elles.

**Barres d'outils DataGrid désactivées partout (2026-07-17)** : `showToolbar` (sélecteur de colonnes, filtre intégré, export, recherche) retiré de `StockTable`/`ReorderTable`/`DormantTable`/`AbcTable` - jugé inutile par l'équipe, et de toute façon redondant avec les filtres de page (`FilterBar`) qui redescendent au niveau Prisma/SQL plutôt que de filtrer côté client sur les lignes déjà chargées.

## Produits exclus de l'outil

`La Roche-Posay`, `CeraVe`, `FREYA Tunisie` (vendor) et les types de produit `Pack`/`Pack Saint-Valentin` sont **exclus dès la synchro** (jamais stockés) — décision équipe du 2026-07-16, voir `src/lib/shopify/queries/products.ts` (`EXCLUDED_VENDORS`/`EXCLUDED_PRODUCT_TYPES`). Si la liste doit changer : modifier ces constantes, relancer `npm run prune:excluded-products` pour nettoyer l'existant (les `OrderLineItem` historiques ne sont jamais supprimés, seul le lien vers `Variant` est mis à `null` — voir `DATABASE.md`).

## Ce qui n'est délibérément PAS fait en v1

- Prévisions de ventes (section 15) : uniquement aux niveaux GLOBAL et CATEGORY, pas par marque (vendor) — à envisager plus tard si le besoin se confirme, une fois plus de recul sur la fiabilité au niveau catégorie.
- Pas de vues matérialisées Postgres — les requêtes directes sont suffisantes au volume actuel. À revisiter si les pages insights deviennent lentes.
- Pas de modèle `Supplier`/délai fournisseur réel — `REORDER_SAFETY_DELAY_DAYS` est une constante globale en attendant cette donnée (voir section 5).
