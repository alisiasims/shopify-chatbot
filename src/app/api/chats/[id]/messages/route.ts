import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, withDb } from "@/lib/api";
import { runAgent } from "@/lib/shop/agent";
import { parseFiles } from "@/lib/files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean || "New Chat";
}

export const POST = withDb(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 8000) : "";
  const files = parseFiles(body.files);
  if (typeof files === "string") return badRequest(files);
  if (!content && files.length === 0) return badRequest("Message content is required");

  const chat = await prisma.chatSession.findFirst({
    where: { id, channel: "app" },
    include: { systemPrompt: true, _count: { select: { messages: true } } },
  });
  if (!chat) return notFound("Chat not found");

  const attachments = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
  const userMessage = await prisma.message.create({
    data: { sessionId: id, role: "user", content, ...(attachments.length ? { attachments } : {}) },
  });

  const reply = await runAgent(chat, files);

  const assistantMessage = await prisma.message.create({
    data: { sessionId: id, role: "assistant", content: reply.text, meta: reply.meta },
  });

  const session = await prisma.chatSession.update({
    where: { id },
    data: {
      ...(chat._count.messages === 0 && chat.title === "New Chat"
        ? { title: titleFrom(content || attachments[0]?.name || "New Chat") }
        : {}),
      updatedAt: new Date(),
    },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ userMessage, assistantMessage, session }, { status: 201 });
});

/** Clears all messages of a chat while keeping the session and its settings. */
export const DELETE = withDb(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const existing = await prisma.chatSession.findFirst({ where: { id, channel: "app" }, select: { id: true } });
  if (!existing) return notFound("Chat not found");
  await prisma.message.deleteMany({ where: { sessionId: id } });
  const session = await prisma.chatSession.update({
    where: { id },
    data: { title: "New Chat" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, session });
});
