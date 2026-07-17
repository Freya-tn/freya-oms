"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppBar, Box, Drawer, IconButton, Toolbar, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { DashboardNavContent, DesktopDrawer, DRAWER_WIDTH } from "./DashboardNav";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/alertes": "Alertes",
  "/stock": "Stock",
  "/reorder": "Réapprovisionnement",
  "/produits": "Produits",
  "/b2b-b2c": "B2B vs B2C",
  "/black-market": "Déclaré vs black",
  "/dormants": "Dormants",
};

export function DashboardShell({
  userEmail,
  logout,
  children,
}: {
  userEmail: string | null | undefined;
  logout: React.ReactElement;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? (pathname.startsWith("/produit/") ? "Fiche produit" : "Freya OMS");

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { xs: "100%", md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { xs: 0, md: `${DRAWER_WIDTH}px` },
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: "none", sm: "block" } }}>
              {userEmail}
            </Typography>
            {logout}
          </Box>
        </Toolbar>
      </AppBar>

      <DesktopDrawer />
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        <DashboardNavContent onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Box
        component="main"
        sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, width: { xs: "100%", md: `calc(100% - ${DRAWER_WIDTH}px)` }, minWidth: 0 }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
