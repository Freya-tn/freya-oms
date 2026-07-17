# Synchro Shopify — stratégie et règles de dérivation

freyaOMS n'utilise **pas de webhooks**. Toutes les données viennent d'un **polling périodique** de l'Admin API GraphQL de Shopify. Ce choix a été fait délibérément pour rester simple (pas d'endpoint public à exposer/sécuriser) — la contrepartie est de faire très attention au volume d'appels API.

## Priorité n°1 : minimiser les appels à l'API Shopify

Shopify limite l'Admin API GraphQL par un système de "cost" (leaky bucket : un maximum de points disponibles, qui se régénère à un taux fixe par seconde — les valeurs exactes dépendent du plan de la boutique et sont retournées dynamiquement dans `extensions.cost.throttleStatus` de chaque réponse, donc **ne jamais coder les valeurs de bucket en dur** : toujours lire `maximumAvailable`/`currentlyAvailable`/`restoreRate` en temps réel). Chaque champ d'une requête a un coût ; une requête mal conçue peut épuiser le quota en quelques appels. Règles suivies dans ce projet :

1. **Backfill initial et resynchronisations complètes → Bulk Operations API.** `bulkOperationRunQuery` exécute une requête de façon asynchrone côté Shopify et renvoie un fichier JSONL téléchargeable une fois prête. Ça compte pour **un seul appel côté quota**, quel que soit le nombre de produits/commandes. C'est la méthode utilisée pour :
   - Le tout premier import de `Product`/`Variant` (potentiellement des milliers de variantes).
   - Le tout premier import historique des `Order`.
   - Toute resynchronisation complète demandée manuellement (ex: après un changement de règle de tag).

2. **Polls incrémentaux → requêtes paginées classiques, filtrées.** Une fois le backfill fait, chaque poll suivant ne récupère que ce qui a changé :
   - Produits/variantes : `updated_at:>'<dernier syncedAt>'` — en pratique peu de changements entre deux polls (stock qui bouge, prix modifié).
   - Commandes : `updated_at:>'<dernier syncedAt>'` — capture aussi bien les nouvelles commandes que les changements de statut (ex: annulation tardive d'une commande déjà "traitée", voir plus bas).
   - Toujours demander le **maximum de champs utiles en une seule requête** (produit + variante + `inventoryQuantity` en une fois, commande + line items en une fois) pour éviter tout pattern N+1. **À ne jamais reproduire** : `drest-stock-api` (projet voisin) fait un appel `/inventory_levels.json` par variante avec un `sleep(1000)` fixe — ça ne passe pas à l'échelle et gaspille le quota même quand rien n'a changé.
   - Pagination GraphQL par curseur, page size 250 (le maximum autorisé), jamais de pagination `page`/`offset`.

3. **Throttle dynamique, pas de `sleep()` fixe.** Chaque réponse GraphQL inclut `extensions.cost.throttleStatus` (`currentlyAvailable`, `maximumAvailable`, `restoreRate`). Le client (`src/lib/shopify/client.ts`) lit cette valeur après chaque appel et calcule le temps d'attente réel avant le prochain appel si `currentlyAvailable` devient bas, plutôt que d'attendre un temps fixe arbitraire. En cas de réponse `THROTTLED`, retry avec backoff exponentiel (jamais de retry immédiat en boucle).

4. **Fréquence de polling conservatrice, configurable.** Par défaut (`.env.example`) :
   - Produits/stock : toutes les **60 min** (`SYNC_PRODUCTS_INTERVAL_MINUTES`).
   - Commandes : toutes les **20 min** (`SYNC_ORDERS_INTERVAL_MINUTES`) — un peu plus fréquent car les changements de statut (confirmation téléphonique, annulation) sont plus sensibles au temps pour les insights de vente.
   - Ces valeurs sont un point de départ ; à ajuster une fois qu'on observe la consommation réelle du quota en prod.

5. **Chaque run est tracé (`SyncRun`)** avec son statut, son curseur, son nombre d'enregistrements traités et ses erreurs — permet de diagnostiquer un run qui a échoué sans avoir à ré-appeler Shopify pour comprendre ce qui s'est passé.

## Produits exclus de la synchro

Décision équipe (2026-07-16) : `La Roche-Posay`, `CeraVe`, `FREYA Tunisie` (routines/bundles internes, vendor Shopify) et les produits de type `Pack`/`Pack Saint-Valentin` (product_type Shopify) sont **hors périmètre de freyaOMS** et ne sont jamais synchronisés. Deux couches de protection, dans `src/lib/shopify/queries/products.ts` :

1. **Filtre `query:` Shopify côté source** (`withExclusionFilter`), appliqué **uniquement au backfill complet** (Bulk Operations) — réduit le volume transféré du tout premier import, ex: `-vendor:'CeraVe' AND -product_type:'Pack'`.
2. **Garde-fou applicatif** (`isExcludedProduct`) dans `syncProducts.ts` — seule source de vérité pour les **polls incrémentaux**.

**Piège corrigé le 2026-07-16 : `vendor`/`productType` peuvent changer avec le temps** (ex: un produit passe de `productType: "Sérum"` à `"Pack"`, ou de marque). Le poll incrémental **n'applique plus** le filtre d'exclusion dans la requête `query:` Shopify (uniquement `updated_at:>...`) — sinon un produit qui *bascule vers* un vendor/type exclu ne matcherait plus jamais `-product_type:'Pack'` et resterait indéfiniment en base avec des infos périmées (et le script `prune:excluded-products`, qui ne regarde que les valeurs déjà stockées en base, ne le rattraperait jamais non plus, puisque la base n'a toujours que l'ancienne valeur non-exclue). À la place, chaque poll incrémental fetch tout ce qui a changé (y compris chez les marques/types exclus) et `syncProducts()` décide après coup, produit par produit, via `isExcludedProduct` : upsert normal si toujours dans le périmètre, sinon `prisma.product.deleteMany` immédiat (auto-nettoyage, cascade sur `Variant`/`InventorySnapshot`, jamais sur `OrderLineItem` historique — voir `docs/DATABASE.md`). Un produit qui bascule dans l'autre sens (exclu -> inclus) était déjà géré correctement (il recommence à matcher `updated_at:>`).

**`npm run prune:excluded-products` reste utile pour un seul cas** : juste après avoir *ajouté* une entrée à `EXCLUDED_VENDORS`/`EXCLUDED_PRODUCT_TYPES` (changement de règle métier, pas un changement de données Shopify) — nettoyage rétroactif immédiat des produits déjà en base qui correspondent à la nouvelle règle, sans attendre leur prochain `updated_at`.

**Même principe de "auto-vérification à chaque poll" pour `Variant.isBlackMarket`** (voir la section dédiée plus bas) et pour `Product.productType` en général (hors bascule vers/depuis l'exclusion) : ces deux champs sont réécrits à chaque upsert à partir de la donnée Shopify fraîche, donc tout changement se propage automatiquement dès que le produit est re-fetché (pas besoin d'action manuelle), en s'appuyant sur l'hypothèse Shopify standard que modifier un produit ou une de ses variantes met à jour le `updatedAt` du produit parent (donc il matche `updated_at:>` au prochain poll).

## Règle de dérivation : `channel` (B2B / B2C)

> Confirmé par l'équipe métier : les commandes B2C n'ont **aucun tag** particulier ; une commande B2B porte le tag littéral **`"B2B"`**.

```
channel = order.tags.includes("B2B") ? "B2B" : "B2C"
```

Les tags bruts sont conservés dans `Order.tags` pour pouvoir rejouer cette règle rétroactivement si elle évolue (ex: passage à un système de tags plus riche).

## Règle de dérivation : `isConfirmed`

> Confirmé par l'équipe métier : le paiement en Tunisie se fait à la livraison (COD), donc une grande partie des commandes sont annulées avant expédition. Une commande ne doit être comptée dans les insights que si elle est **"traitée" = confirmée par téléphone**. Ce statut est représenté par les champs **natifs** `financial_status`/`fulfillment_status` de Shopify (pas un tag custom, pas une app tierce).

**Règle validée le 2026-07-15** sur les 7375 commandes réelles du premier backfill complet (voir `src/lib/shopify/deriveOrderFields.ts`) :

```
isConfirmed = cancelledAt IS NULL
              AND financialStatus != 'VOIDED'
              AND NOT (financialStatus = 'PENDING' AND fulfillmentStatus = 'UNFULFILLED')
```

Répartition observée sur l'échantillon complet (`cancelledAt IS NULL`) qui a permis de valider la règle avec l'équipe :

| financial_status | fulfillment_status | Décision | Nb commandes |
|---|---|---|---|
| PAID | FULFILLED | confirmée | 4949 |
| PENDING | FULFILLED | confirmée | 73 |
| REFUNDED | FULFILLED / UNFULFILLED | confirmée | 10 |
| PARTIALLY_REFUNDED | FULFILLED | confirmée | 1 |
| **PENDING** | **UNFULFILLED** | **pas confirmée** | **5** |

Le seul cas exclu (`PENDING` + `UNFULFILLED`, non annulée) est trop ambigu : impossible de distinguer avec les seuls statuts natifs une commande "confirmée par téléphone mais pas encore expédiée" d'une commande "jamais encore appelée". Décision équipe : ne pas la compter tant qu'elle n'a pas progressé (payée ou expédiée). Sur les données réelles ça ne concerne que 5 commandes/7375 — impact négligeable.

Toutes les commandes annulées (`cancelledAt` renseigné) ont quasi-systématiquement `financial_status = VOIDED` — les deux conditions sont redondantes en pratique mais gardées toutes les deux par robustesse (le champ `cancelledAt` est plus fiable que le statut financier dérivé).

**Si cette règle doit être re-jouée sur des commandes déjà en base** (ex: nouvelle nuance découverte plus tard) : modifier `deriveOrderFields.ts` puis lancer `npm run recompute:orders` — recalcule `channel`/`isConfirmed` sur toute la table `Order` à partir des tags/statuts bruts déjà stockés, **sans ré-appeler Shopify**.

**Auto-correction native grâce au polling.** Une commande confirmée peut, rarement, être annulée plus tard. Comme chaque poll re-lit l'état *courant* de la commande sur Shopify (pas un flux d'événements), `isConfirmed`/`cancelledAt` sont simplement écrasés à la valeur actuelle à chaque poll — pas besoin de log de transitions de statut pour la v1. Toute requête d'insight doit filtrer sur `isConfirmed = true AND cancelledAt IS NULL` (voir [`INSIGHTS.md`](./INSIGHTS.md)), donc une commande qui bascule d'annulée à confirmée (ou l'inverse) entre deux polls est automatiquement incluse/exclue à son prochain re-sync.

## Règle de dérivation : `isBlackMarket` (Déclaré vs black)

> Confirmé par l'équipe métier (2026-07-16) : les SKU préfixés **`"B_"`** identifient un duplicata volontaire d'un SKU officiel, créé pour tracer en stock les ventes qui ne passent pas par la comptabilité déclarée ("vente au black"). Vérifié sur les données réelles : 60 des 148 variantes du catalogue portent ce préfixe.

```
isBlackMarket = sku?.startsWith("B_") ?? false
```

Voir `src/lib/shopify/deriveVariantFields.ts` (`deriveIsBlackMarket`). Dérivé à l'ingestion dans `syncProducts.ts` et dénormalisé sur `Variant.isBlackMarket` — **même principe que `channel`/`isConfirmed`**, mais avec une différence structurelle importante :

- `channel`/`isConfirmed` sont des propriétés de la **commande** (`Order`) — dérivées une fois à la synchro des commandes.
- `isBlackMarket` est une propriété de la **variante** (`Variant`) — dérivée à la synchro des produits, indépendamment de toute commande. Une même commande peut donc mélanger des lignes déclarées et des lignes black ; il n'existe pas de notion de "commande black" au niveau `Order`, contrairement au canal B2B/B2C.

Conséquence pour les insights (voir `docs/INSIGHTS.md`) : toute requête qui ventile par `isBlackMarket` doit joindre `Variant` et sommer par ligne de commande — jamais utiliser `Order.subtotalPrice`, même sans filtre marque (contrairement à `getChannelTotals`).

**Auto-vérification à chaque poll, sans action manuelle** : contrairement à un changement de *règle* (le préfixe lui-même), un SKU qui bascule déclaré <-> black côté Shopify (quelqu'un renomme le SKU) est automatiquement recapturé — `upsertProduct` recalcule `isBlackMarket` depuis le `sku` frais à **chaque** upsert (create et update), donc dès que la variante est re-fetchée (son produit parent matche `updated_at:>` au prochain poll). Aucun script à lancer pour ce cas, contrairement au cas "le préfixe métier change" ci-dessous.

**Si la règle elle-même doit être rejouée sur des variantes déjà en base** (ex: le préfixe `"B_"` change pour autre chose) : modifier `deriveVariantFields.ts` puis lancer `npm run recompute:variants` — recalcule `isBlackMarket` sur toute la table `Variant` à partir du `sku` déjà stocké, **sans ré-appeler Shopify**.

## Piège : le coût n'est PAS couvert par le poll produits

**Découvert et corrigé le 2026-07-17, sur un changement réel** : un changement de `InventoryItem.unitCost` (coût d'achat, `Variant.cost` chez nous) sur Shopify **ne met à jour ni `Product.updatedAt` ni `ProductVariant.updatedAt`**. Vérifié avec un vrai changement (84 → 83 TND sur une variante réelle) : les deux timestamps sont restés figés à leur dernière valeur (plus d'un mois avant) alors que le coût venait de changer. Conséquence : le poll incrémental produits (`updated_at:>...` sur `products`) ne peut **jamais** détecter un changement de coût seul — la variante ne matche simplement plus le filtre, et `Variant.cost` reste périmé indéfiniment en base, sans erreur ni signal.

Seul `InventoryItem.updatedAt` (un champ séparé, sur une ressource Shopify différente) bouge réellement quand le coût change (vérifié : passé de mi-2025 à l'instant du changement). Fix : un second poll incrémental dédié, sur `inventoryItems(query: "updated_at:>...")` (voir `INVENTORY_ITEMS_PAGE_QUERY` dans `src/lib/shopify/queries/products.ts`, `fetchInventoryItemCostUpdates`/`applyInventoryItemCostUpdates` dans `syncProducts.ts`) — appelé uniquement sur un poll incrémental (le tout premier sync, via Bulk Operations, lit déjà un coût frais pour toutes les variantes) et avec le **même curseur** que le poll produits (`SyncRun` resource `PRODUCTS`), pour rester cohérent sans ajouter de ressource `SyncRun` séparée.

**Pourquoi c'est important** : `Variant.cost` alimente directement `stockValue` (Overview : "Valeur du stock", Dormants : "Argent immobilisé") — un coût périmé fausse silencieusement ces chiffres, sans qu'aucune erreur ne le signale. Si un jour d'autres champs Shopify se révèlent avoir le même comportement (changement qui ne bump pas `updatedAt` du produit/variante), vérifier avec un vrai changement en prod avant de supposer que le poll standard suffit — ne pas se fier à la doc Shopify seule, qui ne documente explicitement que le cas des ajustements de quantité de stock (`inventory adjustment`), pas des autres champs d'`InventoryItem`.

### État des lieux : champs vérifiés vs supposés (2026-07-17)

Principe posé après la découverte du coût (voir `CLAUDE.md`, règle 13) : **ne jamais supposer qu'un champ Shopify qu'on exploite est bien rattrapé par le poll qui est censé le couvrir** — soit c'est vérifié avec un vrai changement en prod, soit c'est marqué comme une hypothèse à tester le jour où on en aura besoin/le temps.

**Vérifiés empiriquement (avec un vrai changement en prod)** :
- `Order.channel`/`isConfirmed`/`cancelledAt`/`financialStatus`/`fulfillmentStatus` : le mécanisme de poll incrémental commandes est en production depuis le début du projet et a déjà capturé de vrais changements de statut/annulation au fil des polls réguliers.
- `InventoryItem.unitCost` (`Variant.cost`) : **cassé puis corrigé** le 2026-07-17 (voir ci-dessus) — c'est cette vérification qui a révélé le trou.

**Documentés explicitement par Shopify (pas testés par nous, mais la doc est explicite)** :
- `Variant.inventoryQuantity` : la doc Shopify du champ `Product.updatedAt` mentionne explicitement qu'un ajustement de quantité de stock ("inventory adjustment") compte comme une mise à jour du produit — donc couvert par le poll produits standard.

**Hypothèses non vérifiées à ce jour** (champs natifs de leur ressource, donc a priori couverts par construction, mais jamais stress-testés comme le coût) :
- `Product.title`/`vendor`/`productType`/`status` et `ProductVariant.price`/`compareAtPrice`/`sku`/`barcode`/`title` : champs natifs de `Product`/`ProductVariant` eux-mêmes (pas d'une ressource liée séparée comme `InventoryItem`), donc a priori couverts par `updatedAt` du poll produits — mais "a priori" seulement, pas vérifié avec un vrai changement comme le coût.
- `Order.tags`/`totalPrice`/`subtotalPrice`/infos client : champs natifs d'`Order`, a priori couverts par le poll incrémental commandes — jamais stress-testé isolément (contrairement au statut de confirmation, capturé indirectement via l'usage réel en production).

Si un doute survient sur un de ces champs (des chiffres qui semblent périmés sans raison apparente), reproduire la méthode utilisée pour le coût : changer la vraie valeur sur Shopify, comparer `updatedAt` avant/après sur la ressource concernée ET sur ses ressources parentes, avant de conclure.

## Version d'API

`SHOPIFY_API_VERSION` dans `.env` — voir la note dans `AGENTS.md`/`node_modules/next/dist/docs` : toujours vérifier la version d'API Admin GraphQL supportée au moment de l'implémentation plutôt que de se fier à une valeur mémorisée, Shopify publie une nouvelle version trimestrielle et déprécie les anciennes.
