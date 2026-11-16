import { NextResponse } from "next/server";
import { handleWebhook, montonioReady } from "@/lib/shop/montonio";

/** Montonio Shipping webhook (owner 16.11): body {payload: JWT signed with our secret key} -> shipment status for the parcel watch */
export async function POST(request: Request) {
  if (!montonioReady()) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  let body: { payload?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ok = await handleWebhook(String(body.payload || "")).catch((e) => {
    console.error("[montonio] webhook", e);
    return false;
  });
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}

export async function GET() {
  return NextResponse.json({ ok: true, configured: montonioReady() });
}
