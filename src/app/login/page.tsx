"use client";

import { useActionState } from "react";
import { Box, Button, Paper, TextField, Typography, Alert } from "@mui/material";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Paper elevation={3} sx={{ p: 4, width: 360 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Freya OMS
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Gestion de stock &amp; insights Shopify
        </Typography>

        <Box component="form" action={formAction} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField name="email" type="email" label="Email" required autoFocus fullWidth />
          <TextField name="password" type="password" label="Mot de passe" required fullWidth />
          <Button type="submit" variant="contained" disabled={pending} fullWidth>
            {pending ? "Connexion..." : "Se connecter"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
