import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, withDb } from "@/lib/api";
import { addRule } from "@/lib/shop/learning";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withDb(async (_r: Request, { params }: Ctx) => {
  const { id } = await params;
  const chat = await prisma.chatSession.findFirst({
    where: { id, channel: { not: "app" } },
    include: { messages: { orderBy: { createdAt: "asc" } }, handoffs: { orderBy: { createdAt: "desc" } }, followUps: { where: { status: { not: "skipped" } }, orderBy: { createdAt: "desc" } } },
  });
  return chat ? NextResponse.json(chat) : notFound("Conversation not found");
});

/**
 * {action:"reply", text} - a colleague answers in the site chat (the visitor sees it in the window; the AI pauses for 2 h).
 * {action:"resolve"} - the handoff is done.
 * {action:"reviewed"} - a person checked Deisi's answers (inbox «Проверить»).
 * {action:"rule", text} - a correction for Deisi from the inbox (same as /fix in Telegram).
 * {action:"topic", topic: "spam" | "collab" | ""} - move the conversation to the spam / collaboration section or back.
 * {action:"followup_done", followUpId} - the team sent / handled a follow-up draft.
 */
export const POST = withDb(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const chat = await prisma.chatSession.findFirst({ where: { id, channel: { not: "app" } } });
  if (!chat) return notFound("Conversation not found");
  if (body.action === "reviewed") {
    await prisma.chatSession.update({ where: { id }, data: { reviewedAt: new Date(), updatedAt: chat.updatedAt } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "topic") {
    const topic = ["spam", "collab"].includes(body.topic) ? body.topic : null;
    await prisma.chatSession.update({ where: { id }, data: { topic, ...(topic ? { needsHuman: false } : {}), updatedAt: chat.updatedAt } });
    if (topic) await prisma.handoff.updateMany({ where: { sessionId: id, status: "open" }, data: { status: "done" } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "rule") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
    if (!text) return badRequest("Text is required");
    await addRule(text, typeof body.by === "string" ? body.by.slice(0, 60) : "inbox");
    return NextResponse.json({ ok: true });
  }
  if (body.action === "followup_done") {
    await prisma.followUp.updateMany({ where: { id: String(body.followUpId || ""), sessionId: id }, data: { status: "done", doneAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "resolve") {
    await prisma.$transaction([
      prisma.chatSession.update({ where: { id }, data: { needsHuman: false, reviewedAt: new Date() } }),
      prisma.handoff.updateMany({ where: { sessionId: id, status: "open" }, data: { status: "done" } }),
    ]);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "reply") {
    if (chat.channel !== "web") return badRequest("Reply to e-mail in Gmail and to Instagram / Messenger in Meta Business Suite.");
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
    if (!text) return badRequest("Text is required");
    const message = await prisma.message.create({ data: { sessionId: id, role: "assistant", content: text, meta: { by: "team" } } });
    await prisma.chatSession.update({ where: { id }, data: { needsHuman: true, updatedAt: new Date() } });
    return NextResponse.json(message, { status: 201 });
  }
  return badRequest("Unknown action");
});
