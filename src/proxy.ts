import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/auth.config";

// Utilise la config edge-safe (pas le provider Credentials/Prisma, non
// supportés en Edge Runtime) — vérification "optimiste" de la session,
// voir node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api/cron|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
