# freyaOMS

Outil interne de gestion/insights de stock pour Freya, basé sur les commandes et produits Shopify. Voir [`CLAUDE.md`](./CLAUDE.md) et [`docs/`](./docs) pour l'architecture, le schéma de données et les règles métier.

## Démarrer en local

```bash
cp .env.example .env   # puis renseigner SHOPIFY_ADMIN_API_ACCESS_TOKEN, AUTH_SECRET, etc.
docker compose up -d   # Postgres local (port 5433)
npm install
npm run db:migrate
npm run db:seed        # crée le premier compte ADMIN (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run db:migrate` — applique les migrations Prisma
- `npm run db:seed` — crée/replace le compte admin depuis `.env`
- `npm run db:studio` — explorateur de données Prisma Studio

## Synchro Shopify

Déclenchée via `POST /api/cron/sync` (protégé par `CRON_SECRET`, header `Authorization: Bearer <secret>`). Voir [`docs/SHOPIFY_SYNC.md`](./docs/SHOPIFY_SYNC.md).
