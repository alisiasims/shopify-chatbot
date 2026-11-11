import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Read-only view of Deisi's client conversations for the PM checks (owner 11.11: «сделай так, чтобы для тебя были доступны
 * сами переписки с клиентами, ты же PM»). Opened by the same read-only token as the team log (see middleware), GET only.
 *   ?days=3            conversations updated in the last N days (max 30), newest first
 *   ?chat=<id>         one conversation in full
 *   ?q=<text>          name / e-mail / title / message text
 *   ?channel=email|web|instagram|messenger   ?topic=all (default: spam is left out)
 *   ?cut=600           max characters per message (full text with ?chat=)
 * Plain text by default (compact for reading), ?format=json for data.
 */
export async function GET(request: Request) {
  const u = new URL(request.url).searchParams;
  const chat = u.get("chat");
  const days = Math.min(30, Math.max(1, Number(u.get("days")) || 3));
  const cut = Math.min(8000, Math.max(100, Number(u.get("cut")) || (chat ? 8000 : 600)));
  const q = (u.get("q") || "").trim();
  const channel = u.get("channel");
  const sessions = await prisma.chatSession.findMany({
    where: chat
      ? { id: chat }
      : {
          channel: channel ? channel : { not: "app" },
          updatedAt: { gte: new Date(Date.now() - days * 86400_000) },
          ...(u.get("topic") === "all" ? {} : { OR: [{ topic: null }, { topic: "collab" }] }),
          ...(q
            ? {
                AND: [{ OR: [
                  { customerName: { contains: q, mode: "insensitive" as const } },
                  { customerEmail: { contains: q, mode: "insensitive" as const } },
                  { title: { contains: q, mode: "insensitive" as const } },
                  { messages: { some: { content: { contains: q, mode: "insensitive" as const } } } },
                ] }],
              }
            : {}),
        },
    orderBy: { updatedAt: "desc" },
    take: chat ? 1 : Math.min(100, Number(u.get("limit")) || 40),
    include: {
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true, createdAt: true, meta: true, attachments: true } },
      handoffs: { orderBy: { createdAt: "asc" }, select: { status: true, reason: true, summary: true, createdAt: true, reminders: true } },
      followUps: { orderBy: { createdAt: "asc" }, select: { status: true, text: true, createdAt: true } },
    },
  });
  const data = sessions.map((s) => ({
    id: s.id,
    channel: s.channel,
    client: s.customerName || s.customerEmail || s.title,
    email: s.customerEmail,
    lang: s.lang,
    page: s.pageUrl,
    topic: s.topic,
    needsHuman: s.needsHuman,
    reviewedAt: s.reviewedAt,
    created: s.createdAt,
    updated: s.updatedAt,
    handoffs: s.handoffs,
    followUps: s.followUps,
    messages: s.messages.map((m) => {
      const meta = (m.meta ?? {}) as { engine?: string; by?: string; via?: string; draft?: boolean; handoff?: string; order?: string; skip?: { category?: string; reason?: string }; tools?: unknown[]; cartUrl?: string };
      const who = m.role === "user" ? "client" : meta.engine === "team" || meta.by === "team" ? `team${meta.via ? `/${meta.via}` : ""}` : "deisi";
      const tools = Array.isArray(meta.tools) ? meta.tools.map((t) => (typeof t === "string" ? t : String((t as { name?: string })?.name ?? ""))).filter(Boolean) : [];
      return {
        at: m.createdAt,
        who,
        text: m.content.slice(0, cut),
        ...(tools.length ? { tools } : {}),
        ...(meta.skip ? { skip: `${meta.skip.category ?? ""}: ${meta.skip.reason ?? ""}`.slice(0, 200) } : {}),
        ...(meta.handoff ? { handoff: true } : {}),
        ...(meta.order ? { order: meta.order } : {}),
        ...(meta.cartUrl ? { cart: true } : {}),
        ...(meta.draft ? { draft: true } : {}),
        ...(Array.isArray(m.attachments) && m.attachments.length ? { files: m.attachments.length } : {}),
      };
    }),
  }));
  if (u.get("format") === "json") return NextResponse.json({ count: data.length, chats: data });
  const t = (d: Date) => d.toISOString().slice(5, 16).replace("T", " ");
  const text = data
    .map((c) =>
      [
        `### ${c.id} · ${c.channel} · ${c.client}${c.lang ? ` · ${c.lang}` : ""}${c.topic ? ` · ${c.topic}` : ""}${c.needsHuman ? " · WAITS FOR A PERSON" : ""} · ${t(c.created)} → ${t(c.updated)}`,
        ...c.messages.map((m) => `${t(m.at)} ${m.who.toUpperCase()}${m.draft ? " (draft)" : ""}${m.tools?.length ? ` [${m.tools.join(",")}]` : ""}${m.handoff ? " [HANDOFF]" : ""}${m.order ? ` [ORDER ${m.order}]` : ""}${m.cart ? " [CART]" : ""}${m.files ? ` [files ${m.files}]` : ""}${m.skip ? ` [SKIP ${m.skip}]` : ""}: ${m.text.replace(/\s+\n/g, "\n")}`),
        ...c.handoffs.map((h) => `  handoff ${h.status} ${t(h.createdAt)} ${h.reason} (reminders ${h.reminders}): ${h.summary.slice(0, 300)}`),
        ...c.followUps.map((f) => `  follow-up ${f.status} ${t(f.createdAt)}: ${f.text.slice(0, 200)}`),
      ].join("\n"),
    )
    .join("\n\n");
  return new NextResponse(`${data.length} conversations\n\n${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
