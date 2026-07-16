import { createTheme } from "@mui/material/styles";
import { STATUS, CHART_INK } from "./chartColors";

// Identité de marque (chrome UI uniquement — jamais pour encoder de la
// donnée dans un graphique, voir chartColors.ts).
export const theme = createTheme({
  palette: {
    primary: { main: "#1B4332" },
    secondary: { main: "#B08968" },
    success: { main: STATUS.good },
    warning: { main: STATUS.warning },
    error: { main: STATUS.critical },
    // Pas de couleur MUI "serious" native : utilisée directement via chartColors
    // dans les composants qui en ont besoin (ex: chips d'urgence réappro).
    background: {
      default: "#f9f9f7", // page plane
      paper: CHART_INK.surface, // cartes/surfaces
    },
    text: {
      primary: CHART_INK.primary,
      secondary: CHART_INK.secondary,
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    h4: { fontWeight: 700, letterSpacing: -0.5 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      defaultProps: { color: "inherit" },
      styleOverrides: {
        root: { backgroundColor: CHART_INK.surface },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(11,11,11,0.08)",
          boxShadow: "none",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, textTransform: "none", fontWeight: 600 },
      },
    },
  },
});
