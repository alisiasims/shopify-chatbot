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

/** constant-time compare: both sides hashed to 32 bytes, every byte compared */
async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function logReadAllowed(request: NextRequest, token: string) {
  const expected = process.env.TELEGRAM_LOG_READ_TOKEN || "";
  if (expected.length < 32) return false;   // not configured -> the token path is closed
  // owner 11.11: the PM also reads the client conversations themselves (GET /api/inbox/pm, read-only)
  const path = request.nextUrl.pathname;
  const teamLog = path === "/api/inbox/telegram" && Boolean(request.nextUrl.searchParams.get("log"));
  if (request.method !== "GET" || !(teamLog || path === "/api/inbox/pm")) return false;
  return sameSecret(token, expected);
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
  // PM 06.11: read-only token for the team-chat copy (PM checks from the cloud). It opens ONLY
  // GET /api/inbox/telegram?log=1 and GET /api/inbox/pm (client conversations, owner 11.11), only from the Authorization header (never the URL, so it stays out of request logs).
  if (scheme === "Bearer" && value && (await logReadAllowed(request, value))) return NextResponse.next();
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
