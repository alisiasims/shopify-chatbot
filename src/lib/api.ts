import { NextResponse } from "next/server";

export const DB_ERROR_MESSAGE =
  "We can't reach the database right now. Please try again in a moment.";

/** Wraps a route handler so database failures return a friendly 503 instead of crashing. */
export function withDb<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") return notFound();
      if ((error as { code?: string })?.code === "P2002")
        return NextResponse.json({ error: "An item with this name already exists" }, { status: 409 });
      console.error("[api] database error", error);
      return NextResponse.json({ error: DB_ERROR_MESSAGE }, { status: 503 });
    }
  };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function clamp01(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(1, Math.max(0, n)) * 10) / 10;
}
