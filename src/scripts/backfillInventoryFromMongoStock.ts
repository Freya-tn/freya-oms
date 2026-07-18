import "dotenv/config";
import { MongoClient } from "mongodb";
import { prisma } from "../lib/db";

/**
 * Backfill ponctuel (un seul run nécessaire) : reconstruit l'historique
 * `InventorySnapshot` à partir d'un tracker externe MongoDB (`stockDB.Freya-Stock`,
 * suivi quotidien "produits en rupture" depuis le 2025-10-08, alimenté par un
 * script indépendant de freyaOMS) — demandé le 2026-07-18 après avoir découvert
 * que `InventorySnapshot` réel n'a que quelques jours de profondeur (poll
 * seulement démarré récemment), ce qui empêche les calculs de vitesse
 * "jours de disponibilité réelle" (dormant.ts/reorder.ts) de remonter assez
 * loin pour être fiables.
 *
 * Limites assumées, jamais devinées :
 * - Seuls les produits à VARIANTE UNIQUE sont backfillés (matching par titre
 *   exact insensible à la casse) — un produit multi-tailles (ex: 30ml/100ml)
 *   ne permet pas de savoir laquelle des variantes était en rupture avec ces
 *   données, donc jamais rien inféré pour ces cas plutôt qu'une supposition
 *   risquée.
 * - Quantité inconnue : on ne backfille qu'un signal binaire (disponible /
 *   en rupture), jamais une quantité précise inventée. `quantity = 1` marque
 *   "on sait qu'il y avait du stock ce jour-là" (seul le signe compte pour
 *   tous les calculs actuels, voir velocity.ts) ; `quantity = 0` marque une
 *   rupture confirmée par le tracker.
 * - Jamais de chevauchement avec le vrai historique de polling : seuls les
 *   jours strictement antérieurs au tout premier `InventorySnapshot` réel
 *   connu sont backfillés — le poll réel reste toujours la source de vérité
 *   dès qu'il existe pour un jour donné.
 * - `recordedAt` fixé à minuit UTC (jamais une heure de poll réaliste comme
 *   les vraies lignes) — marqueur volontaire pour rester distinguable d'un
 *   vrai poll a posteriori, sans avoir besoin d'une colonne dédiée.
 *
 * Nécessite `MONGO_STOCK_URL` en variable d'environnement au moment de
 * l'exécution (jamais commité, ce n'est qu'un identifiant pour ce run
 * ponctuel) : `MONGO_STOCK_URL="mongodb://..." npx tsx src/scripts/backfillInventoryFromMongoStock.ts [--execute]`
 * Sans `--execute`, le script tourne en dry-run (affiche ce qu'il ferait,
 * n'écrit rien).
 */

type MongoStockDoc = { date: Date; products: Array<{ title: string }> };

async function main() {
  const execute = process.argv.includes("--execute");
  const mongoUrl = process.env.MONGO_STOCK_URL;
  if (!mongoUrl) throw new Error("MONGO_STOCK_URL manquant (voir le commentaire en tête de fichier).");

  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const docs = (await client
    .db("stockDB")
    .collection("Freya-Stock")
    .find()
    .sort({ date: 1 })
    .toArray()) as unknown as MongoStockDoc[];
  await client.close();

  if (docs.length === 0) throw new Error("Aucun document trouvé dans stockDB.Freya-Stock.");

  const earliestRealSnapshot = await prisma.inventorySnapshot.aggregate({ _min: { recordedAt: true } });
  const cutoff = earliestRealSnapshot._min.recordedAt
    ? new Date(
        Date.UTC(
          earliestRealSnapshot._min.recordedAt.getUTCFullYear(),
          earliestRealSnapshot._min.recordedAt.getUTCMonth(),
          earliestRealSnapshot._min.recordedAt.getUTCDate(),
        ),
      )
    : new Date(); // pas de poll réel du tout -> tout l'historique Mongo est backfillable

  const relevantDocs = docs.filter((d) => new Date(d.date) < cutoff);
  console.log(
    `Historique réel démarre le ${cutoff.toISOString().slice(0, 10)} — ${relevantDocs.length}/${docs.length} jours Mongo backfillables avant cette date.`,
  );

  // Matching : titre exact (insensible casse) -> produit à variante unique.
  const products = await prisma.product.findMany({
    select: { title: true, variants: { select: { id: true } } },
  });
  const singleVariantByTitle = new Map<string, string>();
  let multiVariantSkipped = 0;
  for (const p of products) {
    if (p.variants.length === 1) singleVariantByTitle.set(p.title.trim().toLowerCase(), p.variants[0].id);
    else if (p.variants.length > 1) multiVariantSkipped++;
  }

  const mongoTitles = new Set<string>();
  for (const d of relevantDocs) for (const item of d.products) mongoTitles.add(item.title);
  const matchedTitles = [...mongoTitles].filter((t) => singleVariantByTitle.has(t.trim().toLowerCase()));
  console.log(
    `${mongoTitles.size} titres distincts dans Mongo, ${matchedTitles.length} matchés à une variante unique (${multiVariantSkipped} produits multi-variantes existants dans le catalogue, jamais backfillés).`,
  );

  const rows: Array<{ variantId: string; quantity: number; recordedAt: Date }> = [];
  for (const doc of relevantDocs) {
    const day = new Date(
      Date.UTC(new Date(doc.date).getUTCFullYear(), new Date(doc.date).getUTCMonth(), new Date(doc.date).getUTCDate()),
    );
    const outOfStockTitles = new Set(doc.products.map((p) => p.title.trim().toLowerCase()));
    for (const title of matchedTitles) {
      const variantId = singleVariantByTitle.get(title.trim().toLowerCase())!;
      const outOfStock = outOfStockTitles.has(title.trim().toLowerCase());
      rows.push({ variantId, quantity: outOfStock ? 0 : 1, recordedAt: day });
    }
  }

  const positiveCount = rows.filter((r) => r.quantity > 0).length;
  console.log(
    `${rows.length} lignes à insérer (${positiveCount} jours "en stock", ${rows.length - positiveCount} jours "en rupture").`,
  );

  if (!execute) {
    console.log("Dry-run (pas de --execute) : rien écrit. Exemple des 5 premières lignes :", rows.slice(0, 5));
    return;
  }

  const BATCH_SIZE = 2000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await prisma.inventorySnapshot.createMany({ data: batch });
    inserted += batch.length;
    console.log(`  ${inserted}/${rows.length} insérées...`);
  }
  console.log(`Terminé : ${inserted} lignes InventorySnapshot backfillées pour ${matchedTitles.length} variantes.`);
}

main()
  .catch((e) => {
    console.error("ERREUR", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
