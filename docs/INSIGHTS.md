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

Unités vendues par jour, par variante, sur une fenêtre glissante (7/30/90 jours typiquement) :

```
velocity(variantId, windowDays) =
  SUM(OrderLineItem.quantity)
    WHERE OrderLineItem.variantId = variantId
      AND Order.isConfirmed = true AND Order.cancelledAt IS NULL
      AND Order.orderCreatedAt >= now() - windowDays
  / windowDays
```

Peut être splitté par `Order.channel` pour comparer la vitesse B2B vs B2C sur le même produit.

## 2. Jours de stock restant / date de rupture estimée

```
daysOfStock(variantId) = Variant.inventoryQuantity / velocity(variantId, 30)
estimatedStockoutDate  = today + daysOfStock(variantId) jours
```

Cas limites à gérer explicitement dans le code (pas juste laisser diviser par zéro) :
- `velocity = 0` → pas de vitesse de vente sur la fenêtre → `daysOfStock = null` ("pas de rupture prévisible" plutôt qu'Infinity).
- `inventoryQuantity = 0` → `daysOfStock = 0`, produit déjà en rupture, à faire remonter en priorité dans l'UI indépendamment de la vitesse.

## 3. Produits dormants / surstock

Variantes à rotation quasi nulle mais avec du stock immobilisé :

```
dormant(variantId) = velocity(variantId, 60) < SEUIL_DORMANT
                      AND Variant.inventoryQuantity > 0
```

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

## 5. Réapprovisionnement (reorder point & quantité suggérée)

`src/lib/insights/reorder.ts` — répond directement à "faut-il racheter ce produit, et combien ?". Hypothèses globales v1 (pas de modèle `Supplier`/délai par fournisseur en base pour l'instant) :

```
LEAD_TIME_DAYS = 14        # délai fournisseur estimé, global (pas encore par marque)
SAFETY_STOCK_DAYS = 7      # stock tampon
TARGET_COVERAGE_DAYS = 90  # couverture visée après une commande : au moins 3 mois de vente (décision équipe 2026-07-16)
                           # réglable dans l'UI (slider sur la page Réappro, ?coverage=), 30-180j — voir CoverageControl.tsx

reorderPoint(variantId)      = velocity(variantId, 30) * (LEAD_TIME_DAYS + SAFETY_STOCK_DAYS)
suggestedOrderQty(variantId) = max(0, velocity(variantId, 30) * TARGET_COVERAGE_DAYS - inventoryQuantity)
```

Urgence :
- `critical` : `inventoryQuantity = 0`
- `serious` : `inventoryQuantity <= reorderPoint * 0.5`
- `warning` : `inventoryQuantity <= reorderPoint`
- `good` : au-dessus du seuil (non affiché sur la page Réapprovisionnement)

**Important** : ne considère QUE les variantes avec `velocity(30) > 0` (qui se vendent réellement). Un produit dormant en rupture n'est pas une urgence de rachat — c'est un problème de dormance (section 3), pas de réappro. C'est une distinction volontaire : sur le catalogue réel (2026-07-16), 95 variantes étaient en rupture de stock mais seulement 4 avaient une vitesse de vente positive — les 91 autres sont simplement des produits qui ne se vendent plus, pas des urgences d'achat.

**Tendance de la demande** (`DemandTrend`) : compare `velocity(30)` (jours -30 à 0) à `velocity(30)` de la fenêtre précédente (jours -60 à -30, via `getPriorVelocityByVariant`) :

```
ratio = currentVelocity / priorVelocity
trend = ratio >= 1.2 ? "up" : ratio <= 0.8 ? "down" : "stable"
# priorVelocity = 0 et currentVelocity > 0  -> "new" (pas de rapport calculable)
# priorVelocity = 0 et currentVelocity = 0  -> "unknown"
```

Affichée en icône (↑/↓/→) sur la table Réapprovisionnement — permet de distinguer une variante en rupture dont la demande accélère (à commander en plus grande quantité) d'une variante en rupture dont la demande ralentit.

**Regroupement par fournisseur** (`groupReorderByVendor`) : agrège les suggestions par `vendor` (SKUs à commander, unités totales, ruptures) — vue "bon de commande" façon apps de gestion de stock Shopify (Assisty, Stocky), pour préparer une commande fournisseur sans avoir à re-trier la table manuellement.

**Prochaine évolution naturelle** : remplacer `LEAD_TIME_DAYS` global par un délai par marque/fournisseur (nécessite un modèle `Supplier` — volontairement pas encore construit, voir la question roadmap dans la conversation avec l'équipe du 2026-07-16).

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
- `getRevenueTrend` : CA confirmé par jour, splitté B2B/B2C — graphique en aires empilées, un seul axe (montant), les deux canaux sommés = le total.
- `getOrderCountTrend` : nombre de commandes confirmées vs annulées par jour — permet de suivre le taux d'annulation dans le temps plutôt qu'en instantané.

## 9. Taux d'écoulement (sell-through rate)

Sur la page Stock, en complément des jours de stock restant :

```
sellThroughRate(variantId) = unitsSold(30) / (unitsSold(30) + inventoryQuantity)
```

Proche de 1 = le produit tourne bien relativement à ce qui est en stock ; proche de 0 = surstock relatif à la demande actuelle. Complémentaire à `daysOfStock` : deux produits peuvent avoir le même nombre de jours de stock restant mais un taux d'écoulement très différent selon le volume de stock en jeu.

## 10. Comparaison période sur période (Overview)

`getOverviewKpis(windowDays)` compare systématiquement la fenêtre demandée à la fenêtre équivalente immédiatement précédente (ex: 30 derniers jours vs les 30 jours d'avant) pour le CA et le taux d'annulation — affiché comme un delta (`+12% vs période précédente`) plutôt qu'un chiffre isolé. Le taux d'annulation utilise `higherIsBetter = false` côté UI (`KpiCard`) : une baisse du taux d'annulation est un delta positif (vert), pas négatif.

## 12. Ventes déclarées vs black

`src/lib/insights/blackMarketComparison.ts` (`getSaleTypeTotals`, `getTopProductsBySaleType`) — même forme que la comparaison B2B/B2C (section 4), mais ventile par `Variant.isBlackMarket` (voir `docs/SHOPIFY_SYNC.md`) au lieu de `Order.channel`. Page `/black-market`.

Différence structurelle avec B2B/B2C, qui a une conséquence directe sur le calcul : `channel` est une propriété de la commande, `isBlackMarket` est une propriété du **SKU/variante** — une même commande peut mélanger des lignes déclarées et black. `getSaleTypeTotals` ne peut donc **jamais** utiliser `Order.subtotalPrice` (même sans filtre marque, contrairement à `getChannelTotals`) : il retombe systématiquement sur une somme par ligne de commande, avec la même limite de précision documentée plus haut ("CA : `Order.subtotalPrice` vs somme des lignes de commande").

Les deux dimensions (`channel` et `saleType`) sont indépendantes et ne doivent jamais être combinées sur un même graphique (une commande B2B peut très bien contenir une ligne black).

## Filtres marque et période

Toutes les pages d'insights acceptent des filtres pilotés par l'URL (`?vendor=...&window=...`), gérés par `src/lib/filterParams.ts` (fonctions pures, **sans import Prisma** — voir la note dans `ARCHITECTURE.md` sur pourquoi ce fichier est séparé de `src/lib/insights/filters.ts`) et le composant `FilterBar.tsx`. Chaque insight (`getStockOverview`, `getDormantStock`, `getReorderSuggestions`, `getAbcClassification`, `getChannelTotals`, `getTopProductsByChannel`, `getSaleTypeTotals`, `getTopProductsBySaleType`) accepte un filtre `{ vendor?: string }` optionnel qui redescend jusqu'à la requête Prisma/SQL — jamais un filtrage a posteriori en JS sur des lignes déjà chargées.

**Page Stock (2026-07-17) : filtre `category` (colonne réelle) vs filtre `status` (dérivé) — même règle, deux mécanismes différents.** `getStockOverview` accepte aussi `{ category?: string }` (`Product.productType`), qui redescend en SQL exactement comme `vendor`. Le filtre `status` (Rupture/Critique/Faible/Ok/Pas de vente, `STOCK_STATUS_OPTIONS` dans `filterParams.ts`) est différent par nature : `StockRow.status` est **calculé en JS** (`computeStockStatus` dans `stockDays.ts`) en combinant `inventoryQuantity` (Variant) et la vitesse de vente (agrégée depuis `OrderLineItem` par `getVelocityByVariant`) - deux sources distinctes fusionnées après coup, pas une colonne. Le pousser en SQL demanderait de dupliquer la formule de `daysOfStock` dans une sous-requête corrélée, un risque de dérive entre deux implémentations de la même règle pour un gain nul (la page Stock charge déjà toutes les variantes, pas de pagination serveur). Le filtre `status` est donc appliqué page.tsx (Server Component), sur le résultat déjà calculé par `getStockOverview` - toujours côté serveur avant rendu, jamais un filtrage client sur des lignes déjà affichées. `STOCK_STATUS_OPTIONS` vit dans `filterParams.ts` (fichier pur) précisément pour rester la seule source de vérité des seuils, partagée par le filtre (page.tsx), l'affichage (`StockTable.tsx`) et le calcul (`stockDays.ts`) - jamais trois copies des mêmes seuils (7j/21j) qui pourraient dériver entre elles.

**Barres d'outils DataGrid désactivées partout (2026-07-17)** : `showToolbar` (sélecteur de colonnes, filtre intégré, export, recherche) retiré de `StockTable`/`ReorderTable`/`DormantTable`/`AbcTable` - jugé inutile par l'équipe, et de toute façon redondant avec les filtres de page (`FilterBar`) qui redescendent au niveau Prisma/SQL plutôt que de filtrer côté client sur les lignes déjà chargées.

## Produits exclus de l'outil

`La Roche-Posay`, `CeraVe`, `FREYA Tunisie` (vendor) et les types de produit `Pack`/`Pack Saint-Valentin` sont **exclus dès la synchro** (jamais stockés) — décision équipe du 2026-07-16, voir `src/lib/shopify/queries/products.ts` (`EXCLUDED_VENDORS`/`EXCLUDED_PRODUCT_TYPES`). Si la liste doit changer : modifier ces constantes, relancer `npm run prune:excluded-products` pour nettoyer l'existant (les `OrderLineItem` historiques ne sont jamais supprimés, seul le lien vers `Variant` est mis à `null` — voir `DATABASE.md`).

## Ce qui n'est délibérément PAS fait en v1

- Pas de prévision de demande par modèle statistique (moyenne mobile simple seulement) — à envisager plus tard si la vitesse de vente simple s'avère insuffisante.
- Pas de vues matérialisées Postgres — les requêtes directes sont suffisantes au volume actuel. À revisiter si les pages insights deviennent lentes.
- Pas de modèle `Supplier`/délai fournisseur réel — `LEAD_TIME_DAYS` est une constante globale en attendant cette donnée (voir section 5).
