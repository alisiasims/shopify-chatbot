import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clamp01, withDb } from "@/lib/api";
import { MODEL_LABELS } from "@/lib/mock-ai";

export const dynamic = "force-dynamic";

export const GET = withDb(async () => {
  const chats = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(chats);
});

export const POST = withDb(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const model = typeof body.model === "string" && body.model in MODEL_LABELS ? body.model : "gpt-4";
  const systemPromptId = typeof body.systemPromptId === "string" ? body.systemPromptId : null;

  const chat = await prisma.chatSession.create({
    data: {
      model,
      temperature: clamp01(body.temperature, 0.7),
      topP: clamp01(body.topP, 1),
      systemPromptId,
    },
    include: { messages: true },
  });
  return NextResponse.json(chat, { status: 201 });
});
