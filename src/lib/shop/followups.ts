/**
 * Deisi's own follow-ups in the shop (owner 06.11: «фоллоу-апы, Дейси тоже должна их делать по примеру как студии, но на лад магазина»).
 * Runs every hour (instrumentation-node), writes only 10:00-20:59 Tallinn. Two kinds:
 *   LINK - Deisi gave a cart link or a payment link (draft order) 3-22 h ago, the client went quiet and has not paid
 *          -> one friendly nudge: size / delivery doubt? the same link again.
 *   CHAT - the client asked about products (Deisi showed products), went quiet 4-22 h ago, no cart link yet
 *          -> the writer reads the chat and writes ONE natural next step, or SKIP.
 * Channels: Instagram / Messenger only within Meta's 24 h window (sent by Deisi when META_AUTO_REPLY=on, otherwise a draft);
 * website chats with a known e-mail -> an e-mail draft for the team (e-mails are always sent by a person). E-mail threads are
 * skipped: Deisi's e-mail answers are Gmail drafts and we do not know whether a person sent them.
 * Safety: Setting followup_enabled (default on), followup_daily_max (default 10), one follow-up per conversation per 14 days,
 * no handoff chats, no chats where our team wrote in the last 48 h, no tests. Every follow-up is saved in FollowUp and shown
 * in the inbox tab «Фоллоу-апы»; one short Telegram summary per run.
 */
import { prisma } from "@/lib/prisma";
import { callClaude, hasApiKey, type ContentBlock } from "@/lib/llm";
import { notifyTeam } from "@/lib/notify";
import { guardLinks, messageLanguage, polishEt } from "./agent";
import { getCatalog } from "./catalog";
import { SHOP_FACTS } from "./knowledge";
import { metaAutoSend, sendMeta } from "./meta";
import { admin, adminReady } from "./shopify";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const COOLDOWN_DAYS = 14;
const TEST_EMAILS = /^(info@deesse\.ee|info@deessestudio\.ee)$/i;
const CHANNEL_RU: Record<string, string> = { web: "сайт", instagram: "Instagram", messenger: "Messenger", email: "почта" };

type Meta = { sent?: boolean; engine?: string; by?: string; cartUrl?: string; order?: string; products?: unknown[]; tools?: string[]; followup?: string; draft?: boolean };
type Row = { role: "user" | "assistant"; content: string; createdAt: Date; meta: unknown };

function tallinnHour() {
  return Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Tallinn", hour: "2-digit", hour12: false }));
}
function tallinnDayStart() {
  const now = new Date();
  const t = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Tallinn" }));
  const off = t.getTime() - now.getTime();
  const m = new Date(t);
  m.setHours(0, 0, 0, 0);
  return new Date(m.getTime() - off);
}
async function setting(key: string) {
  return (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value;
}
const isTeam = (m: Row) => m.role === "assistant" && (((m.meta ?? {}) as Meta).engine === "team" || ((m.meta ?? {}) as Meta).by === "team");

/** Was the cart / draft order paid after the link was given? */
async function paidSince(meta: Meta, since: Date, email: string | null) {
  if (!adminReady()) return false;
  try {
    if (meta.order) {
      const name = meta.order.replace(/^#/, "");
      const d = await admin<{ draftOrders: { nodes: { name: string; status: string }[] } }>(
        `query($q: String!) { draftOrders(first: 3, query: $q) { nodes { name status } } }`,
        { q: `name:${name}` },
      );
      const draft = d.draftOrders.nodes.find((x) => x.name.replace(/^#/, "") === name);
      if (draft && draft.status === "COMPLETED") return true;
    }
    const variants = (meta.cartUrl?.match(/\/cart\/([0-9:,]+)/)?.[1] ?? "").split(",").map((p) => p.split(":")[0]).filter(Boolean);
    if (!variants.length && !email) return false;
    const q = `created_at:>='${since.toISOString()}'` + (email ? ` email:${email}` : "");
    const o = await admin<{ orders: { nodes: { email: string | null; lineItems: { nodes: { variant: { id: string } | null }[] } }[] } }>(
      `query($q: String!) { orders(first: 50, query: $q) { nodes { email lineItems(first: 20) { nodes { variant { id } } } } } }`,
      { q },
    );
    return o.orders.nodes.some(
      (x) =>
        (email && (x.email ?? "").toLowerCase() === email.toLowerCase()) ||
        x.lineItems.nodes.some((l) => l.variant && variants.includes(l.variant.id.split("/").pop() ?? "")),
    );
  } catch (e) {
    console.error("[followup] paid check", e);
    return false;
  }
}

/** The writer: one short natural message in the client's language, or SKIP. */
async function write(kind: "link" | "chat", channel: string, rows: Row[], link: string | undefined, name: string | null) {
  const lang = [...rows].reverse().filter((m) => m.role === "user").map((m) => messageLanguage(m.content)).find(Boolean) ?? "English";
  const chat = rows
    .slice(-14)
    .map((m) => `${m.role === "user" ? "CLIENT" : isTeam(m) ? "DEESSE COLLEAGUE" : "DEISI"} (${m.createdAt.toISOString().slice(0, 16)}): ${m.content.slice(0, 900)}`)
    .join("\n\n");
  const style =
    channel === "email"
      ? `an e-mail (greeting with the client's name if known, 3-5 short sentences, signature «Deisi, DEESSE»), first line «Subject: ...»`
      : "a chat message like a shop assistant typing on the phone: 1-3 short sentences, no signature, no greeting if she was already greeted";
  const task =
    kind === "link"
      ? `Deisi gave the client a ${link?.includes("/invoices/") ? "payment link for her order" : "cart link"} and the client has not paid and not answered since. Write ONE gentle follow-up: ask if anything is unclear (size, delivery time, delivery to her country, payment), offer the help that fits the chat (e.g. 14 days to return or exchange if the size does not fit; items in our Tallinn stock ship in 1-2 business days), and give the same link again: ${link}`
      : "The client asked about products, Deisi answered, and the client went quiet without choosing. Write ONE natural next step that moves her towards buying: e.g. ask which of the shown models / which size she prefers and offer to put it in her cart, or answer the doubt she had. If the conversation ended naturally (she said she will think / buy later, thanked and left, asked only a general question, or is not a buyer) answer SKIP.";
  const system = `You are Deisi, the sales assistant of the DEESSE shop (deesse.ee, dance shoes and dancewear, Tallinn). You write a follow-up to a client who went quiet.
${SHOP_FACTS}

RULES: write in ${lang} (the client's language). Sound like a real, warm shop assistant, not a bot; never pushy; never invent prices, sizes, stock, discounts, links or dates - use only what is in the conversation. Do not repeat the whole previous answer. Do not mention that this is a follow-up or that time has passed in a formal way («I noticed you did not complete...» is forbidden); a light «Did you manage to choose?» style is fine. Only the link given in the task, no other links. If a follow-up would be strange or unwelcome (complaint, the client said no / not now, she already bought, a colleague is handling it), answer exactly SKIP.
Write ${style}. Return only the message text${channel === "email" ? " (Subject line first)" : ""}, or SKIP.`;
  const res = await callClaude({
    system,
    messages: [{ role: "user", content: `Client name: ${name || "unknown"}\nChannel: ${channel}\n\nTASK: ${task}\n\nCONVERSATION:\n${chat}` }],
    model: process.env.SHOP_MODEL || "claude-opus-5-5",
    maxTokens: 700,
    temperature: 0.5,
  });
  let text = res.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text || /^SKIP\b/i.test(text)) return null;
  const catalog = await getCatalog().catch(() => []);
  text = guardLinks(text, catalog, link).text;
  if (channel === "instagram" || channel === "messenger") text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1: $2");
  if (lang === "Estonian") text = await polishEt(text);
  return text;
}

let running = false;

export async function runFollowUps(opts: { force?: boolean } = {}) {
  if (running) return { skipped: "running" };
  running = true;
  try {
    if (!hasApiKey()) return { skipped: "no api key" };
    if ((await setting("followup_enabled")) === "off") return { skipped: "off" };
    const hour = tallinnHour();
    if (!opts.force && (hour < 10 || hour > 20)) return { skipped: "night" };
    const max = Number((await setting("followup_daily_max")) || 10);
    const today = await prisma.followUp.count({ where: { createdAt: { gte: tallinnDayStart() }, status: { not: "skipped" } } });
    if (today >= max) return { skipped: "daily max" };
    let budget = max - today;

    const now = Date.now();
    const sessions = await prisma.chatSession.findMany({
      where: { channel: { in: ["instagram", "messenger", "web"] }, needsHuman: false, updatedAt: { gte: new Date(now - 26 * HOUR), lte: new Date(now - 3 * HOUR) } },
      orderBy: { updatedAt: "desc" },
      take: 80,
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 60, select: { role: true, content: true, createdAt: true, meta: true } },
        followUps: { where: { createdAt: { gte: new Date(now - COOLDOWN_DAYS * DAY) } }, select: { id: true } },
        handoffs: { where: { status: "open" }, select: { id: true } },
      },
    });

    const done: { kind: string; status: string; who: string; channel: string }[] = [];
    for (const s of sessions) {
      if (budget <= 0) break;
      if (s.followUps.length || s.handoffs.length) continue;
      if (s.customerEmail && TEST_EMAILS.test(s.customerEmail)) continue;
      const rows = [...(s.messages as Row[])].reverse();
      const last = rows[rows.length - 1];
      if (!last || last.role !== "assistant" || isTeam(last)) continue; // the client answered last, or our team did
      const lastMeta = (last.meta ?? {}) as Meta;
      if (lastMeta.followup || last.content.trim() === "SKIP") continue;
      if (rows.some((m) => isTeam(m) && now - m.createdAt.getTime() < 48 * HOUR)) continue;
      const lastClient = [...rows].reverse().find((m) => m.role === "user");
      if (!lastClient) continue;
      const quietH = (now - last.createdAt.getTime()) / HOUR;

      // where can we write?
      let channel = s.channel;
      if (s.channel === "instagram" || s.channel === "messenger") {
        if (now - lastClient.createdAt.getTime() > 23 * HOUR) continue; // Meta's 24 h window
        if (!(last.meta as { sent?: boolean } | null)?.sent) continue; // Deisi's answer was only a draft: the client may not have seen it
      } else if (s.channel === "email") {
        continue; // Deisi's e-mail answers are Gmail drafts; we do not know if a person sent them
      } else if (s.channel === "web") {
        if (!s.customerEmail) continue; // the website chat cannot reach her later; only by e-mail
        channel = "email";
      }

      // which kind?
      const deisi = rows.filter((m) => m.role === "assistant" && !isTeam(m));
      const linkMsg = [...deisi].reverse().find((m) => ((m.meta ?? {}) as Meta).cartUrl || ((m.meta ?? {}) as Meta).order);
      const linkMeta = (linkMsg?.meta ?? {}) as Meta;
      let kind: "link" | "chat" | null = null;
      if (linkMsg && linkMsg.createdAt >= lastClient.createdAt && quietH >= 3 && quietH <= 22) kind = "link";
      else if (!linkMsg && quietH >= 4 && quietH <= 22 && deisi.some((m) => (((m.meta ?? {}) as Meta).products ?? []).length > 0)) kind = "chat";
      if (!kind) continue;
      if (kind === "link" && (await paidSince(linkMeta, linkMsg!.createdAt, s.customerEmail))) continue;

      let text: string | null = null;
      try {
        text = await write(kind, channel, rows, kind === "link" ? linkMeta.cartUrl : undefined, s.customerName);
      } catch (e) {
        console.error("[followup] writer", e);
        continue;
      }
      if (!text) {
        // remember the decision so the same chat is not read again every hour
        await prisma.followUp.create({ data: { sessionId: s.id, kind, channel, text: "SKIP", status: "skipped", reason: "writer: not fitting" } });
        continue;
      }

      let status = "draft";
      if ((channel === "instagram" || channel === "messenger") && metaAutoSend() && s.externalId) status = (await sendMeta(s.externalId, text)) ? "sent" : "failed";
      await prisma.followUp.create({ data: { sessionId: s.id, kind, channel, text, status, reason: kind === "link" ? "ссылка не оплачена" : "замолчала после вопроса о товаре" } });
      if (status === "sent")
        await prisma.message.create({ data: { sessionId: s.id, role: "assistant", content: text, meta: { engine: "claude", followup: kind, sent: true } } });
      budget--;
      done.push({ kind, status, channel, who: s.customerName || s.customerEmail || s.title });
    }

    if (done.length) {
      const KIND = { link: "ссылка не оплачена", chat: "замолчала после вопроса" } as Record<string, string>;
      const STATUS = { sent: "✅ отправила", draft: "📝 черновик, отправьте сами", failed: "⚠️ не отправилось" } as Record<string, string>;
      await notifyTeam(
        `🔁 Фоллоу-апы Дейси (${done.length}):\n` +
          done.map((d) => `• ${d.who} · ${CHANNEL_RU[d.channel] ?? d.channel} · ${KIND[d.kind]} · ${STATUS[d.status] ?? d.status}`).join("\n") +
          "\n\nТексты: раздел «Фоллоу-апы» в Дейси (Shopify → Приложения → Deesy AI Agent).",
      );
    }
    console.log("[followup]", JSON.stringify({ checked: sessions.length, done }));
    return { checked: sessions.length, done };
  } finally {
    running = false;
  }
}

/** Hourly timer (one server on Railway). The lock in Setting keeps it to one run per hour across restarts. */
export function startFollowUpTimer() {
  const tick = async () => {
    try {
      const key = "followup_last_run";
      const last = await setting(key);
      if (last && Date.now() - new Date(last).getTime() < 55 * 60_000) return;
      await prisma.setting.upsert({ where: { key }, update: { value: new Date().toISOString() }, create: { key, value: new Date().toISOString() } });
      await runFollowUps();
    } catch (e) {
      console.error("[followup] run failed", e);
    }
  };
  setTimeout(() => void tick(), 5 * 60_000);
  setInterval(() => void tick(), 10 * 60_000);
}
