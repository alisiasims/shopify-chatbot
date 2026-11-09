import { prisma } from "@/lib/prisma";
import { json, preflight } from "@/lib/cors";
import { parseFiles } from "@/lib/files";
import { runAgent, type AgentMeta } from "@/lib/shop/agent";
import { ensureDefaultPrompts } from "@/lib/prisma";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;
const PER_VISITOR_PER_DAY = Number(process.env.WIDGET_VISITOR_DAILY_LIMIT || 60);
const ALL_PER_DAY = Number(process.env.WIDGET_DAILY_LIMIT || 800);
const LANGS = new Set(["et", "ru", "en", "fi"]);

type Row = { id: string; role: "user" | "assistant"; content: string; attachments: unknown; meta: unknown; createdAt: Date };

/** Message in the shape the chat window draws. */
function view(m: Row) {
  const meta = (m.meta ?? {}) as AgentMeta & { by?: string };
  const files = Array.isArray(m.attachments)
    ? (m.attachments as { name: string; type: string }[]).map((a) => ({ kind: a.type?.startsWith("image/") ? "image" : "file", name: a.name, url: "" }))
    : [];
  return {
    id: m.id,
    me: m.role === "user",
    by: m.role === "user" ? "me" : meta.by === "team" ? "team" : "deisi",
    text: m.content,
    at: m.createdAt.toISOString(),
    files,
    products: meta.products ?? [],
    cartUrl: meta.cartUrl ?? null,
  };
}

async function findSession(visitorId: string, sessionId?: string | null) {
  if (sessionId) {
    const s = await prisma.chatSession.findFirst({ where: { id: sessionId, channel: "web", visitorId } });
    if (s) return s;
  }
  return prisma.chatSession.findFirst({
    where: { channel: "web", visitorId, updatedAt: { gt: new Date(Date.now() - 30 * 86400_000) } },
    orderBy: { updatedAt: "desc" },
  });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}

/** History of the visitor's conversation: ?visitorId=…&sessionId=…&after=<iso> */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const visitorId = url.searchParams.get("visitorId") || "";
    if (!VISITOR.test(visitorId)) return json(request, { error: "bad visitor" }, 400);
    const session = await findSession(visitorId, url.searchParams.get("sessionId"));
    if (!session) return json(request, { sessionId: null, messages: [] });
    const after = url.searchParams.get("after");
    const rows = await prisma.message.findMany({
      where: { sessionId: session.id, ...(after ? { createdAt: { gt: new Date(after) } } : {}) },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return json(request, { sessionId: session.id, messages: rows.map(view) });
  } catch (e) {
    console.error("[widget] GET", e);
    return json(request, { error: "unavailable" }, 503);
  }
}

/** New visitor message: {visitorId, sessionId?, text, lang, page, files?} → {sessionId, messages:[visitor, reply]} */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const visitorId = String(body.visitorId || "");
    if (!VISITOR.test(visitorId)) return json(request, { error: "bad visitor" }, 400);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    const files = parseFiles(body.files);
    if (typeof files === "string") return json(request, { error: files, reason: /6 MB/.test(files) ? "TOO_BIG" : "TYPE" }, 400);
    if (!text && !files.length) return json(request, { error: "empty" }, 400);
    const lang = LANGS.has(body.lang) ? body.lang : null;
    const page = typeof body.page === "string" && /^https?:\/\//.test(body.page) ? body.page.slice(0, 500) : null;

    const dayAgo = new Date(Date.now() - 86400_000);
    const [mine, all] = await Promise.all([
      prisma.message.count({ where: { role: "user", createdAt: { gt: dayAgo }, session: { channel: "web", visitorId } } }),
      prisma.message.count({ where: { role: "user", createdAt: { gt: dayAgo }, session: { channel: "web" } } }),
    ]);
    if (mine >= PER_VISITOR_PER_DAY || all >= ALL_PER_DAY)
      return json(request, { error: "limit", reason: "LIMIT" }, 429);

    let session = await findSession(visitorId, body.sessionId);
    if (!session)
      session = await prisma.chatSession.create({
        data: { channel: "web", visitorId, title: (text || "Photo").slice(0, 40), model: "claude", temperature: 0.5, topP: 1, lang, pageUrl: page },
      });
    else session = await prisma.chatSession.update({ where: { id: session.id }, data: { pageUrl: page ?? session.pageUrl, ...(lang ? { lang } : {}) } });

    const attachments = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
    const userRow = await prisma.message.create({
      data: { sessionId: session.id, role: "user", content: text, ...(attachments.length ? { attachments } : {}) },
    });
    // a colleague took over this conversation in the inbox: no AI reply, the team answers
    if (session.needsHuman && (await teamActive(session.id)))
      return json(request, { sessionId: session.id, messages: [view(userRow)] });

    await ensureDefaultPrompts().catch(() => {});
    const persona = await prisma.systemPrompt.findUnique({ where: { name: SHOP_PERSONA_NAME } });
    const reply = await runAgent({ ...session, systemPrompt: persona ? { name: persona.name, content: persona.content } : null }, files);
    const spam = Boolean(reply.meta.skip) || /^SKIP\b/.test(reply.text.trim());
    const replyRow = await prisma.message.create({
      data: { sessionId: session.id, role: "assistant", content: spam ? "SKIP" : reply.text, meta: reply.meta },
    });
    await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
    if (spam) return json(request, { sessionId: session.id, messages: [view(userRow)] });
    return json(request, { sessionId: session.id, messages: [view(userRow), view(replyRow)] });
  } catch (e) {
    console.error("[widget] POST", e);
    return json(request, { error: "unavailable" }, 503);
  }
}

/** True when a colleague wrote in this chat in the last 2 hours. */
async function teamActive(sessionId: string) {
  const last = await prisma.message.findFirst({
    where: { sessionId, role: "assistant", createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(last && (last.meta as { by?: string } | null)?.by === "team");
}
