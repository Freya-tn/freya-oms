"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/DashboardOutlined";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import CompareArrowsIcon from "@mui/icons-material/CompareArrowsOutlined";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottomOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import CategoryIcon from "@mui/icons-material/CategoryOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActiveOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUpOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBackOutlined";

// Portail Freya (racine du hostname Tailscale partagé, voir
// docs/ARCHITECTURE.md, "Topologie SSO Freya") — lien absolu, freyaOMS tourne
// sur son propre port (8444), pas un sous-chemin.
const PORTAL_URL = "https://ip-172-26-14-45.tail515d61.ts.net/";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: DashboardIcon },
  { href: "/alertes", label: "Alertes", icon: NotificationsActiveIcon },
  { href: "/stock", label: "Stock", icon: Inventory2Icon },
  { href: "/previsions", label: "Prévisions", icon: TrendingUpIcon },
  { href: "/reorder", label: "Réapprovisionnement", icon: ShoppingCartIcon },
  { href: "/produits", label: "Produits", icon: CategoryIcon },
  { href: "/b2b-b2c", label: "B2B vs B2C", icon: CompareArrowsIcon },
  { href: "/black-market", label: "Déclaré vs black", icon: VisibilityOffIcon },
  { href: "/dormants", label: "Dormants", icon: HourglassBottomIcon },
];

export const DRAWER_WIDTH = 248;

export function DashboardNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <Toolbar sx={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "center", py: 2.5 }}>
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 800, letterSpacing: -0.3 }} color="primary.main">
          Freya OMS
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          Stock &amp; insights Shopify
        </Typography>
      </Toolbar>
      <Box sx={{ px: 1.5, pb: 1 }}>
        <ListItemButton
          component={Link}
          href={PORTAL_URL}
          sx={{ borderRadius: 2, color: "text.secondary" }}
        >
          <ListItemIcon sx={{ color: "inherit", minWidth: 36 }}>
            <ArrowBackIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 500 } } }}
            primary="Portail Freya"
          />
        </ListItemButton>
      </Box>
      <Box sx={{ overflow: "auto", px: 1.5 }}>
        <List sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const selected = pathname === href;
            return (
              <ListItemButton
                key={href}
                component={Link}
                href={href}
                selected={selected}
                onClick={onNavigate}
                sx={{
                  borderRadius: 2,
                  color: selected ? "primary.main" : "text.secondary",
                  "&.Mui-selected": {
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                    "&:hover": { bgcolor: "primary.dark" },
                    "& .MuiListItemIcon-root": { color: "primary.contrastText" },
                  },
                }}
              >
                <ListItemIcon sx={{ color: "inherit", minWidth: 36 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  slotProps={{ primary: { sx: { fontSize: 14, fontWeight: selected ? 600 : 500 } } }}
                  primary={label}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </>
  );
}

/** Drawer permanent desktop — utilisé uniquement au-dessus du breakpoint md, voir DashboardShell. */
export function DesktopDrawer() {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        display: { xs: "none", md: "block" },
        [`& .MuiDrawer-paper`]: {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          borderRight: "1px solid",
          borderColor: "divider",
        },
      }}
    >
      <DashboardNavContent />
    </Drawer>
  );
}
