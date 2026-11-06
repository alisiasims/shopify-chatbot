import { NextResponse, type NextRequest } from "next/server";

/**
 * The inbox shows real customer conversations, so it is protected in two ways:
 *  - HTTP Basic auth (ADMIN_PASSWORD, optional ADMIN_USER, default "deesse") for the separate page /inbox;
 *  - inside the Shopify admin (owner 06.11: «нельзя организовать в Shopify?»): the page /shopify is opened by Shopify
 *    as the embedded app "Deisi" (earlier "Deesy AI Agent"); its requests carry a Shopify session token (JWT signed with SHOPIFY_CLIENT_SECRET).
 */
const enc = new TextEncoder();
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function shopifySession(token: string) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!secret || !clientId) return false;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, b64url(s), enc.encode(`${h}.${p}`)))) return false;
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const c = JSON.parse(new TextDecoder().decode(b64url(p)));
    const now = Date.now() / 1000;
    if (header.alg !== "HS256" || c.aud !== clientId || !(c.exp > now - 10) || (c.nbf && c.nbf > now + 10)) return false;
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    if (shop && new URL(String(c.dest)).host !== shop) return false;
    return true;
  } catch {
    return false;
  }
}

function frameHeaders(res: NextResponse) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  res.headers.set("Content-Security-Policy", `frame-ancestors https://admin.shopify.com${shop ? ` https://${shop}` : ""};`);
  return res;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/shopify" || path.startsWith("/shopify/")) {
    const headers = new Headers(request.headers);
    headers.set("x-deesse-embedded", "1");
    return frameHeaders(NextResponse.next({ request: { headers } }));
  }

  const header = request.headers.get("authorization") || "";
  const [scheme, value] = header.split(" ");
  if (scheme === "Bearer" && value) {
    if (await shopifySession(value)) return NextResponse.next();
    return NextResponse.json({ error: "Сессия Shopify устарела: обновите страницу." }, { status: 401 });
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password)
    return new NextResponse("Inbox is off: set ADMIN_PASSWORD in Railway Variables.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const user = process.env.ADMIN_USER || "deesse";
  if (scheme === "Basic" && value) {
    const decoded = atob(value);
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="DEESSE inbox", charset="UTF-8"' } });
}

export const config = { matcher: ["/inbox", "/inbox/:path*", "/api/inbox", "/api/inbox/:path*", "/shopify", "/shopify/:path*"] };
