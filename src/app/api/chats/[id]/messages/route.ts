import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, withDb } from "@/lib/api";
import { sendMessage } from "@/lib/mock-ai";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean || "New Chat";
}

export const POST = withDb(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return badRequest("Message content is required");

  const chat = await prisma.chatSession.findUnique({
    where: { id },
    include: { systemPrompt: true, _count: { select: { messages: true } } },
  });
  if (!chat) return notFound("Chat not found");

  const userMessage = await prisma.message.create({
    data: { sessionId: id, role: "user", content },
  });

  const reply = await sendMessage(
    content,
    chat.model,
    { temperature: chat.temperature, topP: chat.topP },
    chat.systemPrompt ? { name: chat.systemPrompt.name, content: chat.systemPrompt.content } : null,
  );

  const assistantMessage = await prisma.message.create({
    data: { sessionId: id, role: "assistant", content: reply },
  });

  const session = await prisma.chatSession.update({
    where: { id },
    data: {
      ...(chat._count.messages === 0 && chat.title === "New Chat" ? { title: titleFrom(content) } : {}),
      updatedAt: new Date(),
    },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ userMessage, assistantMessage, session }, { status: 201 });
});

/** Clears all messages of a chat while keeping the session and its settings. */
export const DELETE = withDb(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await prisma.message.deleteMany({ where: { sessionId: id } });
  const session = await prisma.chatSession.update({
    where: { id },
    data: { title: "New Chat" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, session });
});
