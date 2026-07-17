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

## Topologie SSO Freya (portail, freyaOMS, Freya Hub)

Depuis le 2026-07-18, freyaOMS n'est plus le seul outil interne accessible par Tailscale : **Freya Portal** (`tools/freyaPortal/`, nouveau) centralise l'accès à freyaOMS et à Freya Hub (`freya-front/`, comptabilité) avec **une seule authentification** pour les trois.

**Topologie** : tout passe par le même hostname Tailscale (`ip-172-26-14-45.tail515d61.ts.net`, même certificat qu'avant, aucun nouveau certificat émis) :
- `/` → Freya Portal (port 3002) — la racine, seul endroit où `signIn()` est appelé.
- **`:8444`** (port dédié, PAS un sous-chemin `/oms`) → freyaOMS (proxy vers le port 3001 interne, totalement inchangé).
- `/compta` → Freya Hub, build Vite statique (`freya-front/dist/`, `base: "/compta/"` + `basename="/compta"`), gaté par `nginx auth_request`.

**Pourquoi un port dédié et pas `/oms`** : `basePath: "/oms"` a été tenté et abandonné - bug reproduit le 2026-07-18 (Next.js 16.2.10 + next-auth 5.0.0-beta.31 en local, `next start` avec Turbopack) où `proxy.ts` protégé par `auth()` reste bloqué **indéfiniment** (aucune réponse, jamais d'erreur) dès que `basePath` est activé sur `next.config.ts`, même en alignant `authConfig.basePath` (`/oms/api/auth`) comme la doc `@auth/core` le recommande. Un cookie de session est scopé par **hostname**, pas par port (RFC 6265) - un port dédié sur le même hostname partage donc la session tout aussi bien qu'un sous-chemin, sans ce bug. freyaOMS n'a donc **aucune modification de routing** : ni `basePath`, ni changement de `proxy.ts`, ni changement de la route cron (`http://localhost:3001/api/cron/sync` inchangée dans le crontab).

**Mécanisme SSO** : freyaOMS partage le même `AUTH_SECRET` que Freya Portal (même variable d'env, copiée à la main dans les deux `.env`). NextAuth (v5, JWT strategy) chiffre le cookie de session avec une clé dérivée de `AUTH_SECRET` + le nom du cookie (`authjs.session-token` / `__Secure-...` en HTTPS) - identiques dans les deux apps, donc un cookie émis par le login du portail est accepté tel quel par le `auth()` de freyaOMS, sans jamais que freyaOMS n'appelle son propre `signIn()`. Vérifié en conditions réelles (curl + Playwright, 2026-07-18) : login une fois sur le portail → `freyaOMS:8444/api/auth/session` renvoie la session immédiatement, aucun écran de login revu. Le login propre de freyaOMS (`src/app/login/`) reste fonctionnel si on y accède directement (défense en profondeur), mais n'est jamais atteint dans le flux normal (portail → carte freyaOMS).

**Freya Hub** (SPA statique, pas de notion de session serveur) est gaté différemment : `location /compta/` sur nginx utilise `auth_request` vers `GET /api/auth/verify` (nouvelle route sur le portail, appelle juste `auth()`, 200/401, pas de DB). Point d'attention nginx qui a coûté un vrai bug (2026-07-18) : la sous-requête interne doit explicitement forwarder `Cookie` (`proxy_set_header Cookie $http_cookie;`, pas transmis de façon fiable par défaut) **et** `Host`/`X-Forwarded-Proto` (sans ça, NextAuth voit `Host: localhost:3002` au lieu du vrai hostname et rejette une session pourtant valide - silencieusement, la sous-requête renvoie juste 401). `error_page 401 = @portal_login;` redirige vers `/login` plutôt que d'afficher un 401 brut.

**`api.freya-hub.fr` (le backend de Freya Hub, port 3000) reste public, volontairement** : un webhook Shopify l'appelle depuis l'extérieur. Seul le FRONTEND (`freya-hub.fr`, les fichiers statiques) est coupé du public et déplacé sous `/compta` - ne jamais toucher au vhost `api.freya-hub.fr`.

**Nouveau serveur Postgres** : Freya Portal a sa propre base (`freyaportal`, même instance Docker que `freyaoms`, rôle Postgres séparé) - jamais de migration croisée entre les deux projets.

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
