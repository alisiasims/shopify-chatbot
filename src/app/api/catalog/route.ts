import { NextResponse } from "next/server";
import { brief, catalogStatus, searchProducts, syncCatalog } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let lastManual = 0;

/** Catalog cache status; with ?q=… (and optional size, max) it shows what Deisi's product search finds. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    if (q) {
      const res = await searchProducts({
        query: q,
        size: url.searchParams.get("size") || undefined,
        maxPrice: Number(url.searchParams.get("max")) || undefined,
      });
      return NextResponse.json({ found: res.total, items: res.items.map(brief) });
    }
    return NextResponse.json(await catalogStatus());
  } catch (e) {
    console.error("[catalog]", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/** Re-reads deesse.ee/products.json now (at most once in 5 minutes). */
export async function POST() {
  if (Date.now() - lastManual < 5 * 60_000) return NextResponse.json({ error: "Synced a moment ago, try again in a few minutes" }, { status: 429 });
  lastManual = Date.now();
  try {
    const count = await syncCatalog();
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    console.error("[catalog] sync failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
