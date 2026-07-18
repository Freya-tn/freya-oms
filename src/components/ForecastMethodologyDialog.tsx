"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Typography,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

/** Bouton + Dialog : explication complète de l'algorithme de prévision, à la demande (retour utilisateur 2026-07-18 : "une vraie explication, faut cliquer sur un truc"). */
export function ForecastMethodologyDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<InfoOutlinedIcon />}
        onClick={() => setOpen(true)}
      >
        Comment ça marche, en détail
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Comment fonctionne l&apos;algorithme de prévision
          <IconButton onClick={() => setOpen(false)} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2.5 }}>
            La prévision d&apos;un mois = ce qui est <strong>déjà réellement vendu</strong> depuis le début du mois,
            plus une <strong>extrapolation</strong>{" "}
            uniquement sur les jours restants. Chaque jour qui passe, la
            part réelle grandit et la part extrapolée rétrécit mécaniquement - la prévision devient donc de plus en
            plus précise à mesure que le mois avance, ce n&apos;est pas un réglage artificiel.
          </Typography>

          <Divider sx={{ mb: 2.5 }} />

          <Step title="1. B2B et B2C, toujours calculés séparément">
            Vérifié sur les vraies données : le B2B est très irrégulier (certains mois n&apos;ont carrément aucune
            vente B2B, d&apos;autres ont un gros pic ponctuel) alors que le B2C vend en continu tous les mois. Les
            mélanger dans un seul calcul ferait porter l&apos;irrégularité du B2B sur le signal B2C, pourtant fiable.
            Chaque prévision calcule donc B2B et B2C indépendamment (chacun avec son propre taux de base, sa propre
            saisonnalité, sa propre croissance), puis additionne les deux résultats - jamais un seul calcul mélangé.
          </Step>

          <Step title="2. Le taux de base : à quelle vitesse ça se vend en ce moment">
            Pour chaque produit, on calcule sa vitesse de vente récente (les ventes les plus récentes comptent plus
            que les anciennes, sur un historique remontant jusqu&apos;à 1 an - même calcul que la page Stock). On
            additionne ce taux pour tous les produits du périmètre (global ou une catégorie), séparément par canal.
          </Step>

          <Step title="3. La saisonnalité : ce mois est-il structurellement plus fort ou plus faible ?">
            On compare les ventes de ce mois calendaire (ex : décembre) sur toutes les années passées à la moyenne
            des 12 mois, par canal. Si décembre vend historiquement 30% de plus que la moyenne, l&apos;indice de
            saisonnalité de décembre est ×1.3. La pleine confiance demande au moins 3 années complètes de données
            pour ce mois précis - en dessous, l&apos;indice est rapproché de 1.0 proportionnellement au nombre
            d&apos;années réellement observées (2 années sur 3 gardent 2/3 du signal, jamais coupé net à 1.0 dès
            qu&apos;il manque ne serait-ce qu&apos;une année, comme c&apos;était le cas avant).
          </Step>

          <Step title="4. La croissance : le magasin vend-il plus ou moins qu'avant ?">
            On compare les ventes des 90 derniers jours à la même période il y a un an, par canal. Si ça a doublé, le
            facteur de croissance est ×2 - mais toujours plafonné entre ×0,3 et ×3 (un pic ponctuel ne doit jamais
            démultiplier une prévision par 10). Neutre (×1.0, non fiable) s&apos;il n&apos;y a pas assez de
            commandes un an plus tôt pour comparer valablement.
          </Step>

          <Step title="5. Les jours restants, pondérés par jour de semaine">
            Vérifié sur les vraies données : le jeudi représente environ 19% du volume de ventes total contre
            11-12% le week-end - un écart réel d&apos;environ ×1,7. Plutôt que de compter chaque jour restant du
            mois comme équivalent, chaque jour restant est pondéré par son poids habituel (jeudi compte plus qu&apos;un
            dimanche) - important surtout en fin de mois, quand les jours restants ne sont plus un échantillon
            représentatif de la semaine.
          </Step>

          <Step title="6. Le calcul final, par canal">
            Unités prévues (par canal) = <strong>déjà vendu ce mois</strong>{" "}
            + (taux de base × jours restants pondérés ×
            indice de saisonnalité × facteur de croissance). Le chiffre d&apos;affaires prévu convertit ces unités
            en TND avec le prix de vente moyen des 90 derniers jours (repli sur le prix catalogue si aucune vente
            récente) - cette conversion se fait une seule fois, à la toute fin. Le total affiché = B2B + B2C.
          </Step>

          <Step title="7. Jamais un chiffre inventé sur un signal trop faible">
            Chaque hypothèse (saisonnalité, croissance, jour de semaine, prix moyen) a son propre garde-fou et
            retombe sur une valeur neutre plutôt que d&apos;extrapoler à partir de trop peu de données - un badge
            orange l&apos;indique à chaque fois sur les cartes ci-dessus, canal par canal.
          </Step>

          <Step title="8. La preuve, pas juste une promesse">
            Chaque prévision générée est conservée (jamais écrasée), puis comparée au réel une fois le mois clos.
            Le graphique &quot;Précision des prévisions dans le temps&quot; montre l&apos;erreur moyenne selon le
            délai de prévision - il se remplit mois après mois et prouve concrètement si l&apos;algorithme
            s&apos;améliore, plutôt que de l&apos;affirmer sans preuve.
          </Step>
        </DialogContent>
      </Dialog>
    </>
  );
}
