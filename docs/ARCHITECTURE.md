# Architecture

## Stack

- **Next.js (App Router)** + TypeScript — monolithe unique, back et front dans le même projet.
- **PostgreSQL** + **Prisma** (client généré dans `src/generated/prisma`, voir `prisma/schema.prisma`).
- **MUI** (`@mui/material`) + **recharts** + **TanStack Query** côté front — choisi pour rester cohérent avec `freya-front` (le dashboard principal de l'entreprise, Vite+React, qui utilise déjà cette combinaison), plutôt qu'introduire Tailwind/shadcn.
- **NextAuth (Auth.js v5)**, provider Credentials, stratégie JWT (pas de table `Session` en base — un compte `User` suffit).
- **npm** comme gestionnaire de paquets (convention des projets voisins du monorepo).

## Pourquoi indépendant de `freya-back`

`APIs/shopify-back` (NestJS + Prisma) a déjà des modules Shopify/stock/B2B, mais freyaOMS a été conçu **volontairement indépendant** (décision explicite, pas un oubli) : sa propre synchro Shopify, sa propre base Postgres. freyaOMS ne doit ni lire ni écrire dans la base de `freya-back`. Si un chevauchement de responsabilité devient un problème plus tard (ex: deux systèmes qui pollent Shopify séparément), c'est une décision à reprendre consciemment avec l'équipe, pas à contourner silencieusement dans le code.

## Structure des dossiers

```
prisma/
  schema.prisma          — schéma de données (voir docs/DATABASE.md)
  seed.ts                — création du premier compte ADMIN depuis .env
src/
  generated/prisma/       — client Prisma généré (gitignored)
  lib/
    db.ts                 — singleton PrismaClient (driver adapter @prisma/adapter-pg)
    filterParams.ts        — parsing des filtres URL (vendor/period), fonctions PURES sans import Prisma
    format.ts               — formatCurrency/formatNumber/formatRelativeTime, fonctions PURES (safe client)
    shopify/
      client.ts           — client GraphQL Admin API, throttle cost-aware
      bulkOperations.ts    — helper Bulk Operations (backfill complet)
      deriveOrderFields.ts — dérivation channel/isConfirmed
      deriveVariantFields.ts — dérivation isBlackMarket (préfixe SKU "B_")
      queries/             — requêtes GraphQL typées (products, orders)
    sync/
      syncProducts.ts
      syncOrders.ts
      syncRun.ts           — bookkeeping SyncRun (start/finish/fail)
    insights/
      velocity.ts, stockDays.ts, dormant.ts, channelComparison.ts, overview.ts,
      reorder.ts, abc.ts, vendorBreakdown.ts, orderTrend.ts, syncStatus.ts,
      blackMarketComparison.ts, margin.ts, alerts.ts, productProfile.ts
    auth/
      auth.config.ts        — config NextAuth "edge-safe" (sans Credentials/Prisma), utilisée par proxy.ts
      auth.ts                — config complète (Credentials + Prisma), utilisée côté Node uniquement
    theme/
      theme.ts              — thème MUI (identité de marque : chrome UI uniquement)
      chartColors.ts         — palette de données validée (skill dataviz) : catégoriel, séquentiel, statuts
  proxy.ts                  — anciennement "middleware.ts" (renommé "Proxy" depuis Next.js 16), protège les routes du dashboard
  scripts/
    recomputeOrderFields.ts   — rejoue channel/isConfirmed sur les commandes déjà en base (npm run recompute:orders)
    recomputeVariantFields.ts — rejoue isBlackMarket sur les variantes déjà en base (npm run recompute:variants)
    pruneExcludedProducts.ts  — nettoie les produits déjà synchronisés qui correspondent à la liste d'exclusion
  app/
    api/
      auth/[...nextauth]/route.ts
      cron/sync/route.ts   — endpoint protégé par CRON_SECRET
    login/page.tsx
    (dashboard)/
      layout.tsx
      syncActions.ts         — Server Actions "use server" : sync complète (bouton "Actualiser") + sync produits seule (page Alertes)
      alertes/page.tsx, alertes/actions.ts — page Alertes (coût manquant, anomalies de marge) + acknowledgeAlert/unacknowledgeAlert
      page.tsx              — Overview (KPIs + tendance CA + statut/déclenchement synchro)
      stock/page.tsx
      reorder/page.tsx       — suggestions de réapprovisionnement
      produits/page.tsx      — classification ABC (CA + marge) + répartition par marque
      b2b-b2c/page.tsx
      black-market/page.tsx  — ventes déclarées vs black (Variant.isBlackMarket) + tendance de la part du black
      dormants/page.tsx
      produit/[variantId]/page.tsx — fiche produit unifiée (vue 360° par SKU)
docs/
  DATABASE.md, SHOPIFY_SYNC.md, INSIGHTS.md, ARCHITECTURE.md
docker-compose.yml         — Postgres local de dev (port 5433, le 5432 est déjà pris par un autre projet du monorepo)
```

## Design system des graphiques

Toutes les couleurs de données (jamais de couleur de marque) viennent de `src/lib/theme/chartColors.ts`, dérivé de la skill `dataviz` : ordre catégoriel fixe (B2B = bleu, B2C = vert — jamais réattribué), rampe séquentielle/ordinale pour les magnitudes (ABC), couleurs de statut réservées (réappro : critique/urgent/à commander). Règle non négociable : **jamais deux mesures d'échelles différentes sur le même axe** (ex: CA et unités vendues sont toujours deux graphiques séparés, jamais un bar chart à deux axes). Gridlines/axes toujours **pleines (1px), jamais en pointillés** — `strokeDasharray` ne doit apparaître dans aucun `CartesianGrid` (corrigé le 2026-07-17, c'était le cas par défaut au début du projet).

**Top-N textuel (classement produits/marques/catégories) → `BarListChart`, jamais un bar chart recharts.** Décision équipe du 2026-07-17 : un vrai bar chart avec libellés Y longs (titres de produits) force soit à tronquer le texte (perd l'info distinctive — ex: tous les "SKIN1004 Madagascar Centella..." tronqués à 26 caractères devenaient indistinguables), soit à le laisser s'enrouler sur 2-3 lignes (le graphique prend une hauteur énorme pour un classement qui devrait être compact). `BarListChart` (`src/components/BarListChart.tsx`) résout ça : label sur une ligne (ellipse CSS native + tooltip pour le texte complet, jamais de troncature manuelle en JS), mini-barre proportionnelle en dessous, valeur toujours visible à droite. Beaucoup plus compact (pas d'axe, pas de grille, hauteur par ligne minimale) et plus lisible. Réutilisé pour : Top produits/CA par catégorie/CA par marque (page Produits), CA et unités par canal + Top produits par canal (page B2B vs B2C), argent immobilisé par marque (page Dormants). Réservé aux vrais graphiques d'axe (échelle continue significative comme "jours avant rupture" sur `TopUrgencyChart`, ou série temporelle sur `RevenueTrendChart`) : recharts reste justifié quand l'axe porte une information, pas juste un classement.

**Retour utilisateur du 2026-07-17 : pas de "piste" (track) derrière la mini-barre.** Une première version affichait une piste pleine (teinte claire de la même rampe) derrière chaque barre, façon "meter" de la skill dataviz. Retiré : pour un classement pur (magnitudes comparées entre elles, pas de plafond/cible réel comme une couverture de stock), une barre sur fond plein se lit comme une jauge de progression - une métaphore trompeuse ici puisqu'il n'y a rien à "compléter". `BarListChart` n'affiche plus que la barre elle-même, ancrée à gauche, arrondie uniquement côté pointe (jamais des deux côtés comme un pill de contrôle UI) - un vrai trait de bar chart. Le pattern "meter" (piste + jauge) reste valide ailleurs quand il y a une vraie notion de progression vers un plafond (ex: couverture de stock cible sur la page Réappro), juste pas ici.

**Pièges React Server Components rencontrés et à ne pas reproduire** :
- Un Client Component (`"use client"`) rendu directement par une Server Component (une `page.tsx`) ne peut pas recevoir une **fonction** en prop (ex: un formatter) — React ne peut pas sérialiser une fonction à travers la frontière Server → Client. Solution : passer un identifiant (`valueType: "currency" | "units"`) et laisser le composant choisir sa fonction de formatage en interne (voir `BarListChart.tsx`, refait deux fois pour cette raison — vérifier ce piège avant même d'écrire le composant, pas après). Pareil pour un `href`/`component={Link}` sur un composant MUI (`CardActionArea`, `Link`) : si le composant qui l'utilise est rendu par une Server Component, il doit lui-même être marqué `"use client"` (voir `KpiCard.tsx`, `SupplierOrderSummary.tsx`). En revanche, passer un **élément déjà instancié** (ex: `<Inventory2Icon />`) en prop est safe — c'est du contenu déjà rendu, pas une référence de fonction à invoquer plus tard (voir l'usage des icônes dans `KpiCard` sur la page Overview).
- Un Client Component qui importe, même **indirectement**, un module qui touche `@/lib/db` (Prisma/`pg`) fait planter le build (`pg` a besoin de modules Node natifs — `net`, `tls` — absents du bundle navigateur). C'est pour ça que `filterParams.ts` (fonctions pures de parsing, importées par `FilterBar.tsx` qui est `"use client"`) est **séparé** de `src/lib/insights/filters.ts` (`getVendorList`, qui importe Prisma) — même si les deux fichiers semblent "juste des utilitaires de filtre". Avant d'ajouter une fonction à un fichier importé par un Client Component, vérifier qu'aucune de ses dépendances (même transitives) ne touche `@/lib/db`.

## Déclenchement de la synchro

Route `POST /api/cron/sync` protégée par un header `Authorization: Bearer <CRON_SECRET>`. Deux façons de la déclencher selon l'hébergement :
- **Vercel** : `vercel.json` définit les crons (produits toutes les heures, commandes toutes les 20 min, prévisions une fois par jour à 4h — à garder cohérent manuellement avec `SYNC_PRODUCTS_INTERVAL_MINUTES`/`SYNC_ORDERS_INTERVAL_MINUTES`, Vercel Cron ne lit pas ces variables). Vercel ajoute automatiquement le header `Authorization: Bearer $CRON_SECRET` sur les requêtes cron si la variable d'env `CRON_SECRET` est définie sur le projet — c'est pour ça que la route vérifie exactement ce header. `?resource=forecast` (`generateForecastSync`, voir `docs/INSIGHTS.md` section 15) est délibérément une entrée cron séparée, jamais incluse dans `?resource=all` : générer des prévisions est un concept "une fois par jour," pas "à chaque poll" comme produits/commandes.
- **Auto-hébergé** : une entrée crontab système qui fait un `curl -X POST -H "Authorization: Bearer $CRON_SECRET"` vers la route.
- **Manuellement depuis l'UI** : bouton "Actualiser" sur l'Overview → Server Action `triggerSyncAction` (`src/app/(dashboard)/syncActions.ts`), protégée par la session (le `proxy.ts` matche aussi les requêtes de Server Action car elles passent par la même route que la page). Après succès, `revalidatePath("/")` + `router.refresh()` côté client pour recharger les données affichées sans reload complet.

## Formatage — devise TND

Toute valeur monétaire affichée passe par `formatCurrency()` (`src/lib/format.ts`), qui ajoute systématiquement le suffixe ` TND` (Dinar Tunisien, devise de la boutique Shopify — confirmé via `shop.currencyCode` lors du premier test de connexion). Ne jamais recréer un `Intl.NumberFormat` local dans un composant pour formater un montant — toujours importer depuis `format.ts`. Les axes de graphiques utilisent `formatNumber()` (sans suffixe, pour rester compacts) ; seuls les tooltips et les valeurs affichées en dur (KPI, cellules de table) portent l'unité.

## Next.js 16 — points d'attention

Projet généré avec Next.js 16, qui a des changements de comportement par rapport aux versions antérieures (voir `AGENTS.md` à la racine). Points vérifiés dans `node_modules/next/dist/docs/` pendant l'implémentation :
- Les Route Handlers `GET` peuvent être **prérendus/mis en cache** par défaut sous le modèle "Cache Components" s'ils n'accèdent à aucune donnée runtime. Toutes nos routes API font soit une requête DB soit une lecture de headers (auth), donc elles restent dynamiques nativement — mais rester vigilant si une route simple est ajoutée plus tard.
- `params`/`searchParams` des pages sont des `Promise` à `await`, pas des objets directs.
- Le fichier `middleware.ts` est renommé **`proxy.ts`** depuis Next.js 16 (même fonctionnement, juste un nouveau nom de convention de fichier).
- Le `proxy.ts` tourne en **Edge Runtime**, qui ne supporte pas les modules Node natifs (`node:path`, `node:url`...) qu'utilise le client Prisma généré. C'est pourquoi la config NextAuth est **splittée en deux** : `auth.config.ts` (sans provider Credentials, safe pour l'Edge, utilisée par `proxy.ts`) et `auth.ts` (config complète avec Credentials + Prisma, utilisée uniquement côté Node dans les Route Handlers/Server Components). Ne jamais importer `auth.ts` depuis `proxy.ts`.

## Auth

Pas de self-signup. Le seul moyen de créer un compte est `prisma/seed.ts` (ou un ajout manuel en base) — cohérent avec "usage interne restreint, avec login simple" décidé avec l'équipe.
