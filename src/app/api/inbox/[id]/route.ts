import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, withDb } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withDb(async (_r: Request, { params }: Ctx) => {
  const { id } = await params;
  const chat = await prisma.chatSession.findFirst({
    where: { id, channel: { not: "app" } },
    include: { messages: { orderBy: { createdAt: "asc" } }, handoffs: { orderBy: { createdAt: "desc" } } },
  });
  return chat ? NextResponse.json(chat) : notFound("Conversation not found");
});

/**
 * {action:"reply", text} - a colleague answers in the site chat (the visitor sees it in the window; the AI pauses for 2 h).
 * {action:"resolve"} - the handoff is done.
 */
export const POST = withDb(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const chat = await prisma.chatSession.findFirst({ where: { id, channel: { not: "app" } } });
  if (!chat) return notFound("Conversation not found");
  if (body.action === "resolve") {
    await prisma.$transaction([
      prisma.chatSession.update({ where: { id }, data: { needsHuman: false } }),
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
