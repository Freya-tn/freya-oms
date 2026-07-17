import { IconButton } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { auth } from "@/lib/auth/auth";
import { DashboardShell } from "@/components/DashboardShell";
import { logoutAction } from "./logoutAction";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <DashboardShell
      userEmail={session?.user?.email}
      logout={
        <form action={logoutAction}>
          {/* Info-bulle native (`title`), pas <Tooltip> : Tooltip clone son
              enfant et déclenche un hydration mismatch avec un IconButton
              dans un <form action={...}> (Server Action) en Next 16/React 19 -
              même cause que le mismatch Chip vu sur les pages Prévisions/Réappro. */}
          <IconButton type="submit" color="inherit" size="small" title="Se déconnecter">
            <LogoutIcon fontSize="small" />
          </IconButton>
        </form>
      }
    >
      {children}
    </DashboardShell>
  );
}
