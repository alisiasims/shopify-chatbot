import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFiles } from "@/lib/files";
import { runAgent } from "@/lib/shop/agent";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";
import { notifyTeam } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gmail bridge (integrations/gmail-bridge.gs) posts each new customer e-mail here and gets back a reply text.
 * The script saves it as a Gmail DRAFT by default, so a person reviews and sends it.
 * Auth: header "Authorization: Bearer <EMAIL_BRIDGE_TOKEN>".
 */
export async function POST(request: Request) {
  const token = process.env.EMAIL_BRIDGE_TOKEN;
  if (!token) return NextResponse.json({ error: "EMAIL_BRIDGE_TOKEN is not set" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = await request.json().catch(() => ({}));
    // the script reports how it unsubscribed (one-click / mailto / link / none)
    if (b.op === "unsub") return NextResponse.json(await unsubResult(String(b.threadId || ""), String(b.method || "none")));
    const threadId = String(b.threadId || "").slice(0, 100);
    const from = String(b.from || "").toLowerCase();
    const fromEmail = (from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [""])[0];
    const subject = String(b.subject || "").slice(0, 300);
    const text = cleanBody(String(b.text || "")).slice(0, 8000);
    if (!threadId || !fromEmail) return NextResponse.json({ error: "threadId and from are required" }, { status: 400 });

    // cheap filters first: newsletters, robots, our own mail
    const own = (process.env.SHOP_EMAIL || "info@deesse.ee").toLowerCase();
    // mass mail (owner 06.11: «обучи Дейси самостоятельно отписываться от рассылок»): unsubscribe, except the domains we keep
    if (b.listUnsubscribe) {
      if (await keepNewsletter(fromEmail)) return NextResponse.json({ action: "skip", category: "newsletter_kept" });
      await prisma.chatSession.upsert({
        where: { channel_externalId: { channel: "email", externalId: threadId } },
        update: { topic: "spam", updatedAt: new Date() },
        create: {
          channel: "email", externalId: threadId, title: subject || "(рассылка)", model: "claude", temperature: 0.4, topP: 1, topic: "spam",
          customerEmail: fromEmail, customerName: String(b.fromName || "").slice(0, 80) || null,
          messages: { create: [
            { role: "user", content: `Subject: ${subject}\nFrom: ${b.fromName ? `${b.fromName} ` : ""}<${fromEmail}>\n\n${text.slice(0, 1500)}` },
            { role: "assistant", content: "SKIP", meta: { skip: { category: "newsletter", reason: "рассылка: Дейси отписывается" } } },
          ] },
        },
      });
      return NextResponse.json({ action: "unsubscribe", category: "newsletter" });
    }
    const robot = /(^|[._-])(no-?reply|mailer-daemon|postmaster|notifications?|bounce)/.test(fromEmail.split("@")[0]);
    // invoices from robots (no-reply-invoice@…) go to the accountant without asking Deisi
    if (robot && INVOICE_RE.test(`${subject} ${(b.attachmentNames ?? []).join(" ")}`)) return NextResponse.json(await invoice(b, fromEmail, subject, ""));
    if (robot || fromEmail === own) return NextResponse.json({ action: "skip", category: "notification" });

    const files = parseFiles(Array.isArray(b.attachments) ? b.attachments.slice(0, 3) : []);
    const okFiles = typeof files === "string" ? [] : files;

    let session = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel: "email", externalId: threadId } } });
    if (!session)
      session = await prisma.chatSession.create({
        data: {
          channel: "email",
          externalId: threadId,
          title: subject || "(no subject)",
          model: "claude",
          temperature: 0.4,
          topP: 1,
          customerEmail: fromEmail,
          customerName: String(b.fromName || "").slice(0, 80) || null,
        },
      });
    const messageId = String(b.messageId || "");
    // the same Gmail message again (script retry): return the reply made last time
    if (messageId) {
      const seen = await prisma.message.findFirst({ where: { sessionId: session.id, role: "user", meta: { path: ["gmailMessageId"], equals: messageId } } });
      if (seen) {
        const answer = await prisma.message.findFirst({ where: { sessionId: session.id, role: "assistant", createdAt: { gte: seen.createdAt } }, orderBy: { createdAt: "asc" } });
        if (answer) return NextResponse.json(answer.content === "SKIP" ? { action: "skip", category: "seen" } : { action: "draft", text: answer.content });
      }
    }

    await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: `Subject: ${subject}\nFrom: ${b.fromName ? `${b.fromName} ` : ""}<${fromEmail}>\n\n${text}`,
        meta: { gmailMessageId: messageId },
        ...(okFiles.length ? { attachments: okFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })) } : {}),
      },
    });

    const persona = await prisma.systemPrompt.findUnique({ where: { name: SHOP_PERSONA_NAME } });
    const reply = await runAgent({ ...session, systemPrompt: persona ? { name: persona.name, content: persona.content } : null }, okFiles);
    await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: reply.text, meta: reply.meta } });
    await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

    if (reply.meta.skip?.category === "invoice") return NextResponse.json(await invoice(b, fromEmail, subject, reply.meta.skip.reason));
    if (reply.meta.skip || reply.text.trim() === "SKIP") return NextResponse.json({ action: "skip", category: reply.meta.skip?.category ?? "other" });
    if (reply.meta.engine !== "claude") return NextResponse.json({ action: "skip", category: "assistant_offline" });
    return NextResponse.json({ action: "draft", text: reply.text, handoff: Boolean(reply.meta.handoff) });
  } catch (e) {
    console.error("[email]", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

const INVOICE_RE = /\b(arve|invoice|счёт|счет|lasku|faktura|rechnung|arved)\b/i;

/**
 * Invoices (owner 06.11, like the studio): forwarded to the accountant (Setting invoice_to, default arved@deesse.ee)
 * only when Gmail confirmed the sender (SPF/DKIM), the sender wrote to us before and nothing looks suspicious.
 * Otherwise the team gets a Telegram notice and the e-mail stays in the inbox with the label Deisi/needs-person.
 */
async function invoice(b: { authOk?: boolean; knownSender?: boolean; fromName?: string }, fromEmail: string, subject: string, reason: string) {
  const to = (await prisma.setting.findUnique({ where: { key: "invoice_to" } }).catch(() => null))?.value?.trim() || "arved@deesse.ee";
  const doubts: string[] = [];
  if (!b.authOk) doubts.push("Gmail не подтвердил отправителя");
  if (!b.knownSender) doubts.push("новый отправитель: раньше писем от него не было");
  if (/suspicious|подозр|phish|фишинг|другой IBAN|new bank|changed bank|сменил/i.test(reason)) doubts.push(reason);
  if (!doubts.length) {
    console.log("[email] invoice forwarded", JSON.stringify({ from: fromEmail.split("@")[1], to }));
    return { action: "forward", to, category: "invoice" };
  }
  await notifyTeam(`📄 Счёт на почте info@ НЕ переслан бухгалтеру: ${b.fromName || ""} <${fromEmail}> · «${subject.slice(0, 120)}»\nПочему: ${doubts.join("; ")}.\nЕсли всё в порядке — перешлите вручную на ${to}.`);
  return { action: "handoff_mail", category: "invoice" };
}

/** Domains whose newsletters we keep: Setting keep_newsletters (comma separated) + services we need. */
const KEEP_DEFAULT = ["shopify.com", "google.com", "facebookmail.com", "meta.com", "railway.app", "github.com", "deesse.ee", "deessestudio.ee"];
async function keepNewsletter(email: string) {
  const extra = (await prisma.setting.findUnique({ where: { key: "keep_newsletters" } }).catch(() => null))?.value ?? "";
  const keep = [...KEEP_DEFAULT, ...extra.split(/[\s,;]+/)].map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  const dom = email.split("@")[1] ?? "";
  return keep.some((k) => email === k || dom === k || dom.endsWith(`.${k}`));
}

async function unsubResult(threadId: string, method: string) {
  const s = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel: "email", externalId: threadId } } });
  if (!s) return { ok: false };
  const label = method === "none" ? "⚠️ не получилось отписаться автоматически (нет ссылки) — отпишитесь вручную" : `✅ Дейси отписалась от рассылки (${method})`;
  await prisma.message.create({ data: { sessionId: s.id, role: "assistant", content: label, meta: { engine: "claude", unsubscribed: method, skip: { category: "newsletter", reason: label } } } });
  return { ok: true };
}

/** Keeps only the newest part of an e-mail (cuts quoted history and long signatures). */
function cleanBody(text: string) {
  const cut = text.search(/\n(On .{5,120} wrote:|-----Original Message-----|From: .+\nSent: |Kirjutas .{3,80}:|\d{1,2}\.\d{1,2}\.\d{2,4}.{0,60}(kirjutas|пишет|wrote))/i);
  const body = (cut > 20 ? text.slice(0, cut) : text).split("\n").filter((l) => !/^>/.test(l)).join("\n");
  return body.replace(/\n{3,}/g, "\n\n").trim();
}
