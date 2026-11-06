import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDb } from "@/lib/api";

export const dynamic = "force-dynamic";

type M = { role: string; createdAt: Date; content: string; meta: unknown };
const byTeam = (m: M) => {
  const meta = (m.meta ?? {}) as { engine?: string; by?: string };
  return meta.engine === "team" || meta.by === "team";
};
/** Time of Deisi's latest real answer (not the team's, not a skipped e-mail). */
function lastDeisiAt(messages: M[]) {
  const m = messages.find((x) => x.role === "assistant" && !byTeam(x) && !/^SKIP\b/.test(x.content.trim()) && !((x.meta ?? {}) as { skip?: unknown }).skip);
  return m ? m.createdAt : null;
}

/**
 * Customer conversations for the inbox (owner 06.11: easy to find your way, three sections):
 *   ?view=review    - Deisi answered herself, a person only checks (not checked since her last answer)
 *   ?view=human     - needs a person (open handoff)
 *   ?view=followups - Deisi's follow-ups of the last 14 days (drafts first)
 *   ?view=all       - everything, newest first
 * Returns { counts, items }.
 */
export const GET = withDb(async (request: Request) => {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || (url.searchParams.get("filter") === "human" ? "human" : "review");

  const sessions = await prisma.chatSession.findMany({
    where: { channel: { not: "app" } },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: {
      id: true, title: true, channel: true, customerName: true, customerEmail: true, needsHuman: true, updatedAt: true, lang: true, reviewedAt: true,
      messages: { orderBy: { createdAt: "desc" }, take: 8, select: { content: true, role: true, createdAt: true, meta: true } },
      _count: { select: { messages: true } },
    },
  });
  const toReview = (s: (typeof sessions)[number]) => {
    if (s.needsHuman) return false;
    const at = lastDeisiAt(s.messages);
    return Boolean(at && (!s.reviewedAt || at > s.reviewedAt));
  };
  const since = new Date(Date.now() - 14 * 86400_000);
  const followUps = await prisma.followUp.findMany({
    where: { createdAt: { gte: since }, status: { not: "skipped" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { session: { select: { id: true, title: true, channel: true, customerName: true, customerEmail: true } } },
  });
  const counts = {
    review: sessions.filter(toReview).length,
    human: sessions.filter((s) => s.needsHuman).length,
    followups: followUps.filter((f) => f.status === "draft" || f.status === "failed").length,
    all: sessions.length,
  };

  const slim = (s: (typeof sessions)[number]) => ({
    ...s,
    toReview: toReview(s),
    messages: s.messages.slice(0, 1).map((m) => ({ content: m.content.slice(0, 300), role: m.role, byTeam: byTeam(m) })),
  });
  if (view === "followups") {
    const order = { draft: 0, failed: 1, sent: 2, done: 3 } as Record<string, number>;
    const items = [...followUps].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || +b.createdAt - +a.createdAt);
    return NextResponse.json({ counts, items });
  }
  const items = (view === "human" ? sessions.filter((s) => s.needsHuman) : view === "all" ? sessions : sessions.filter(toReview)).slice(0, 200).map(slim);
  return NextResponse.json({ counts, items });
});
