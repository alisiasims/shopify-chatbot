import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clamp01, notFound, withDb } from "@/lib/api";
import { MODEL_LABELS } from "@/lib/mock-ai";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withDb(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const chat = await prisma.chatSession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return chat ? NextResponse.json(chat) : notFound("Chat not found");
});

/** Saves per-chat settings (model, temperature, top-p, system prompt, title). */
export const PATCH = withDb(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const data: {
    model?: string;
    temperature?: number;
    topP?: number;
    systemPromptId?: string | null;
    title?: string;
  } = {};

  if (typeof body.model === "string" && body.model in MODEL_LABELS) data.model = body.model;
  if (body.temperature !== undefined) data.temperature = clamp01(body.temperature, 0.7);
  if (body.topP !== undefined) data.topP = clamp01(body.topP, 1);
  if (body.systemPromptId === null || typeof body.systemPromptId === "string")
    data.systemPromptId = body.systemPromptId;
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 80);

  const existing = await prisma.chatSession.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return notFound("Chat not found");

  const chat = await prisma.chatSession.update({ where: { id }, data });
  return NextResponse.json(chat);
});

export const DELETE = withDb(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { count } = await prisma.chatSession.deleteMany({ where: { id } });
  return count ? NextResponse.json({ ok: true }) : notFound("Chat not found");
});
