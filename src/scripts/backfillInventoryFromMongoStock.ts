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
 * - **Jamais backfillé avant `Variant.shopifyCreatedAt`** (bug réel corrigé
 *   le 2026-07-18, découvert par l'utilisateur sur "Double Cleansing Duo" :
 *   le tracker Mongo ne liste que les produits DÉJÀ dans le catalogue au
 *   moment du jour concerné — un produit pas encore lancé n'apparaît dans
 *   AUCUNE liste ce jour-là, ni "en rupture" ni "en stock", donc l'absence
 *   de mention ne prouve rien avant sa création réelle). Une variante sans
 *   `shopifyCreatedAt` connu (voir `npm run backfill:variant-created-at`)
 *   n'est PAS backfillée du tout, plutôt que de risquer la même erreur.
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
 * - **Produits "toujours en stock" (jamais mentionnés en rupture) : confirmés
 *   au cas par cas avec l'équipe, jamais supposés automatiquement** (2026-07-18).
 *   Un produit à variante unique absent de TOUTES les listes de rupture du
 *   tracker peut vouloir dire deux choses très différentes : soit il est
 *   réellement resté en stock en continu, soit le tracker a un angle mort
 *   dessus (renommage, produit hors du périmètre suivi) — dans ce second cas,
 *   le backfiller comme "toujours en stock" inventerait une disponibilité
 *   fausse. `ALWAYS_IN_STOCK_CONFIRMED_TITLES` liste donc explicitement les
 *   titres confirmés par l'équipe (jamais une inférence automatique) ; tout
 *   autre produit "jamais mentionné" reste non backfillé tant qu'il n'a pas
 *   été confirmé de la même façon.
 *
 * Nécessite `MONGO_STOCK_URL` en variable d'environnement au moment de
 * l'exécution (jamais commité, ce n'est qu'un identifiant pour ce run
 * ponctuel) : `MONGO_STOCK_URL="mongodb://..." npx tsx src/scripts/backfillInventoryFromMongoStock.ts [--execute]`
 * Sans `--execute`, le script tourne en dry-run (affiche ce qu'il ferait,
 * n'écrit rien).
 */

// Confirmés le 2026-07-18 par l'équipe : jamais en rupture depuis leur
// création, alors qu'absents de toutes les listes du tracker Mongo — voir le
// commentaire ci-dessus sur pourquoi ce n'est JAMAIS une inférence automatique.
const ALWAYS_IN_STOCK_CONFIRMED_TITLES = [
  "AHA 7 Whitehead Power Liquid",
  "Soothing and Barrier Support Serum",
  "Calming Serum: Green Tea + Panthenol",
  "Clear Fit Master Patch",
  "Radiance Cleansing Balm",
  "Anua Heartleaf 77% Soothing Toner",
  "Anua Heartleaf Pore Control Cleansing Oil",
  "SKIN1004 Madagascar Centella Poremizing Quick Clay Stick Mask",
  "SKIN1004 Madagascar Centella Quick Calming Duo",
  "SKIN1004 Madagascar Centella Toning Toner",
].map((t) => t.trim().toLowerCase());

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

  // Exclut nos propres lignes backfillées (marquées à minuit UTC pile, voir
  // le commentaire en tête de fichier) — sinon un re-run après un premier
  // backfill confondrait ce backfill avec du vrai historique de poll et
  // déplacerait la coupure à tort (bug réel rencontré le 2026-07-18 en
  // testant l'extension "toujours en stock").
  const earliestRealSnapshot = await prisma.$queryRaw<Array<{ min: Date | null }>>`
    SELECT MIN("recordedAt") AS min FROM "InventorySnapshot"
    WHERE "recordedAt" != date_trunc('day', "recordedAt");
  `;
  const realMin = earliestRealSnapshot[0]?.min;
  const cutoff = realMin
    ? new Date(Date.UTC(realMin.getUTCFullYear(), realMin.getUTCMonth(), realMin.getUTCDate()))
    : new Date(); // pas de poll réel du tout -> tout l'historique Mongo est backfillable

  const relevantDocs = docs.filter((d) => new Date(d.date) < cutoff);
  console.log(
    `Historique réel démarre le ${cutoff.toISOString().slice(0, 10)} — ${relevantDocs.length}/${docs.length} jours Mongo backfillables avant cette date.`,
  );

  // Matching : titre exact (insensible casse) -> produit à variante unique,
  // avec sa date de création Shopify (jamais backfillée avant cette date).
  const products = await prisma.product.findMany({
    select: { title: true, variants: { select: { id: true, shopifyCreatedAt: true } } },
  });
  const singleVariantByTitle = new Map<string, { variantId: string; shopifyCreatedAt: Date | null }>();
  let multiVariantSkipped = 0;
  let noCreatedAtSkipped = 0;
  for (const p of products) {
    if (p.variants.length !== 1) {
      if (p.variants.length > 1) multiVariantSkipped++;
      continue;
    }
    const [variant] = p.variants;
    if (!variant.shopifyCreatedAt) {
      noCreatedAtSkipped++;
      continue;
    }
    singleVariantByTitle.set(p.title.trim().toLowerCase(), { variantId: variant.id, shopifyCreatedAt: variant.shopifyCreatedAt });
  }

  const mongoTitles = new Set<string>();
  for (const d of relevantDocs) for (const item of d.products) mongoTitles.add(item.title);
  const matchedTitles = [...mongoTitles].filter((t) => singleVariantByTitle.has(t.trim().toLowerCase()));
  console.log(
    `${mongoTitles.size} titres distincts dans Mongo, ${matchedTitles.length} matchés à une variante unique avec date de création connue ` +
      `(${multiVariantSkipped} produits multi-variantes, ${noCreatedAtSkipped} sans shopifyCreatedAt connu — ni l'un ni l'autre jamais backfillés).`,
  );

  const rows: Array<{ variantId: string; quantity: number; recordedAt: Date }> = [];
  let skippedBeforeCreation = 0;
  for (const doc of relevantDocs) {
    const day = new Date(
      Date.UTC(new Date(doc.date).getUTCFullYear(), new Date(doc.date).getUTCMonth(), new Date(doc.date).getUTCDate()),
    );
    const outOfStockTitles = new Set(doc.products.map((p) => p.title.trim().toLowerCase()));
    for (const title of matchedTitles) {
      const { variantId, shopifyCreatedAt } = singleVariantByTitle.get(title.trim().toLowerCase())!;
      if (shopifyCreatedAt && day < shopifyCreatedAt) {
        skippedBeforeCreation++;
        continue; // le produit n'existait pas encore ce jour-là : l'absence de mention "en rupture" ne prouve rien.
      }
      const outOfStock = outOfStockTitles.has(title.trim().toLowerCase());
      rows.push({ variantId, quantity: outOfStock ? 0 : 1, recordedAt: day });
    }
  }
  console.log(`${skippedBeforeCreation} jours sautés (antérieurs à la création Shopify de la variante concernée).`);

  // Produits confirmés "toujours en stock" (jamais mentionnés en rupture,
  // voir ALWAYS_IN_STOCK_CONFIRMED_TITLES) : un jour "en stock" (quantity=1)
  // par jour calendaire, de max(shopifyCreatedAt, début du tracking Mongo) au
  // cutoff (jamais après confirmation explicite, voir commentaire en tête de
  // fichier).
  const mongoTrackingStart = new Date(
    Date.UTC(new Date(docs[0].date).getUTCFullYear(), new Date(docs[0].date).getUTCMonth(), new Date(docs[0].date).getUTCDate()),
  );
  let alwaysInStockRows = 0;
  let alwaysInStockMatched = 0;
  for (const p of products) {
    if (p.variants.length !== 1) continue;
    const [variant] = p.variants;
    if (!variant.shopifyCreatedAt) continue;
    if (!ALWAYS_IN_STOCK_CONFIRMED_TITLES.includes(p.title.trim().toLowerCase())) continue;

    alwaysInStockMatched++;
    for (let day = mongoTrackingStart; day < cutoff; day = new Date(day.getTime() + 86_400_000)) {
      // Même règle que la boucle principale ci-dessus (jamais avant l'heure
      // exacte de création, pas juste le jour calendaire tronqué à minuit).
      if (day < variant.shopifyCreatedAt) continue;
      rows.push({ variantId: variant.id, quantity: 1, recordedAt: day });
      alwaysInStockRows++;
    }
  }
  console.log(
    `${alwaysInStockMatched}/${ALWAYS_IN_STOCK_CONFIRMED_TITLES.length} titres "toujours en stock" confirmés trouvés dans le catalogue -> ${alwaysInStockRows} lignes "en stock" ajoutées.`,
  );

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
