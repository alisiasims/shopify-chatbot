import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFiles } from "@/lib/files";
import { runAgent } from "@/lib/shop/agent";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";

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
    const threadId = String(b.threadId || "").slice(0, 100);
    const from = String(b.from || "").toLowerCase();
    const fromEmail = (from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [""])[0];
    const subject = String(b.subject || "").slice(0, 300);
    const text = cleanBody(String(b.text || "")).slice(0, 8000);
    if (!threadId || !fromEmail) return NextResponse.json({ error: "threadId and from are required" }, { status: 400 });

    // cheap filters first: newsletters, robots, our own mail
    const own = (process.env.SHOP_EMAIL || "info@deesse.ee").toLowerCase();
    if (b.listUnsubscribe) return NextResponse.json({ action: "skip", category: "newsletter" });
    if (/(^|[._-])(no-?reply|mailer-daemon|postmaster|notifications?|bounce)/.test(fromEmail.split("@")[0]) || fromEmail === own)
      return NextResponse.json({ action: "skip", category: "notification" });

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

    if (reply.meta.skip || reply.text.trim() === "SKIP") return NextResponse.json({ action: "skip", category: reply.meta.skip?.category ?? "other" });
    if (reply.meta.engine !== "claude") return NextResponse.json({ action: "skip", category: "assistant_offline" });
    return NextResponse.json({ action: "draft", text: reply.text, handoff: Boolean(reply.meta.handoff) });
  } catch (e) {
    console.error("[email]", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

/** Keeps only the newest part of an e-mail (cuts quoted history and long signatures). */
function cleanBody(text: string) {
  const cut = text.search(/\n(On .{5,120} wrote:|-----Original Message-----|From: .+\nSent: |Kirjutas .{3,80}:|\d{1,2}\.\d{1,2}\.\d{2,4}.{0,60}(kirjutas|пишет|wrote))/i);
  const body = (cut > 20 ? text.slice(0, cut) : text).split("\n").filter((l) => !/^>/.test(l)).join("\n");
  return body.replace(/\n{3,}/g, "\n\n").trim();
}
