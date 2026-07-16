import type { NextAuthConfig } from "next-auth";

// Config "edge-safe" : utilisée par proxy.ts (Edge Runtime), donc SANS le
// provider Credentials (qui a besoin de bcrypt + Prisma, non supportés en
// Edge Runtime). La config complète avec le provider vit dans auth.ts et ne
// tourne que côté Node (Route Handlers, Server Components).
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
