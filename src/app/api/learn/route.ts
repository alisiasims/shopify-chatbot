import { NextResponse } from "next/server";
import { saveExample } from "@/lib/shop/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Old answers of our team for Deisi to learn from (the Gmail bridge's learnFromSent()).
 * Auth: "Authorization: Bearer <EMAIL_BRIDGE_TOKEN>". Body: { source, pairs: [{ id, question, answer, lang? }] }.
 * Private data (contacts, health) is filtered out in saveExample.
 */
export async function POST(request: Request) {
  const token = process.env.EMAIL_BRIDGE_TOKEN;
  if (!token) return NextResponse.json({ error: "EMAIL_BRIDGE_TOKEN is not set" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    source?: string;
    pairs?: { id?: string; question?: string; answer?: string; lang?: string }[];
  };
  const source = String(body.source || "import").slice(0, 30);
  let saved = 0;
  for (const p of (body.pairs ?? []).slice(0, 200)) {
    if (await saveExample(String(p.question || ""), String(p.answer || ""), source, p.lang ?? null, p.id ? `${source}:${p.id}` : null)) saved++;
  }
  return NextResponse.json({ ok: true, saved });
}
