import { NextResponse } from "next/server";

/** Sites allowed to embed the chat window (WIDGET_ORIGINS adds more, comma separated). */
function allowed(origin: string) {
  const extra = (process.env.WIDGET_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = ["https://deesse.ee", "https://www.deesse.ee", ...extra];
  if (list.includes(origin)) return true;
  try {
    const host = new URL(origin).host;
    return /\.myshopify\.com$/.test(host) || /\.shopifypreview\.com$/.test(host) || /\.up\.railway\.app$/.test(host);
  } catch {
    return false;
  }
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (!origin || !allowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function preflight(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}
