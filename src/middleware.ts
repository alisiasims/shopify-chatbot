import { NextResponse, type NextRequest } from "next/server";

/**
 * The inbox shows real customer conversations, so it is behind a password (HTTP Basic auth).
 * ADMIN_PASSWORD (and optional ADMIN_USER, default "deesse") are set in Railway Variables.
 */
export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password)
    return new NextResponse("Inbox is off: set ADMIN_PASSWORD in Railway Variables.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const user = process.env.ADMIN_USER || "deesse";
  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="DEESSE inbox", charset="UTF-8"' } });
}

export const config = { matcher: ["/inbox", "/inbox/:path*", "/api/inbox", "/api/inbox/:path*"] };
