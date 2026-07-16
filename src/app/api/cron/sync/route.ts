import { NextRequest, NextResponse } from "next/server";
import { syncProducts } from "@/lib/sync/syncProducts";
import { syncOrders } from "@/lib/sync/syncOrders";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resource = request.nextUrl.searchParams.get("resource") ?? "all";

  try {
    const ran: string[] = [];
    if (resource === "all" || resource === "products") {
      await syncProducts();
      ran.push("products");
    }
    if (resource === "all" || resource === "orders") {
      await syncOrders();
      ran.push("orders");
    }
    return NextResponse.json({ ok: true, ran });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
