"use server";

import { signOut } from "@/lib/auth/auth";

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
