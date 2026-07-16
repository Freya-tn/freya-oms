"use client";

import Link from "next/link";
import { Box, Card, CardActionArea, CardContent, Typography } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { STATUS } from "@/lib/theme/chartColors";

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0, signDisplay: "never" });

function ChangeIndicator({ changeRatio, higherIsBetter }: { changeRatio: number; higherIsBetter: boolean }) {
  const isUp = changeRatio > 0;
  const isGood = isUp === higherIsBetter;
  const color = changeRatio === 0 ? "text.secondary" : isGood ? STATUS.good : STATUS.critical;
  const Icon = isUp ? ArrowUpwardIcon : ArrowDownwardIcon;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, color, mt: 0.5 }}>
      {changeRatio !== 0 && <Icon sx={{ fontSize: 14 }} />}
      <Typography variant="caption" sx={{ color: "inherit", fontWeight: 600 }}>
        {percentFormatter.format(changeRatio)} vs période précédente
      </Typography>
    </Box>
  );
}

export function KpiCard({
  label,
  value,
  subtext,
  color,
  href,
  changeRatio,
  higherIsBetter = true,
  icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  color?: "error" | "warning" | "success";
  href?: string;
  changeRatio?: number | null;
  higherIsBetter?: boolean;
  icon?: React.ReactElement;
}) {
  const content = (
    <CardContent>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {icon && (
          <Box sx={{ color: color ? `${color}.main` : "text.secondary", opacity: 0.7, display: "flex" }}>{icon}</Box>
        )}
      </Box>
      <Typography variant="h4" component="p" color={color ? `${color}.main` : undefined}>
        {value}
      </Typography>
      {subtext && (
        <Typography variant="caption" color="text.secondary">
          {subtext}
        </Typography>
      )}
      {changeRatio !== undefined && changeRatio !== null && (
        <ChangeIndicator changeRatio={changeRatio} higherIsBetter={higherIsBetter} />
      )}
    </CardContent>
  );

  return (
    <Card sx={{ height: "100%", transition: "box-shadow 0.15s", "&:hover": { boxShadow: 2 } }}>
      {href ? (
        <CardActionArea component={Link} href={href} sx={{ height: "100%" }}>
          {content}
        </CardActionArea>
      ) : (
        content
      )}
    </Card>
  );
}
