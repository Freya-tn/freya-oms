import { IconButton, Tooltip } from "@mui/material";
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
          <Tooltip title="Se déconnecter">
            <IconButton type="submit" color="inherit" size="small">
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </form>
      }
    >
      {children}
    </DashboardShell>
  );
}
