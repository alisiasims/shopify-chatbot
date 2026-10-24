import { NextResponse } from "next/server";
import { ensureDefaultPrompts, prisma } from "@/lib/prisma";
import { badRequest, withDb } from "@/lib/api";

export const dynamic = "force-dynamic";

function parsePrompt(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  return name && content ? { name, content } : null;
}

export const GET = withDb(async () => {
  await ensureDefaultPrompts();
  const prompts = await prisma.systemPrompt.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(prompts);
});

export const POST = withDb(async (request: Request) => {
  const data = parsePrompt(await request.json().catch(() => ({})));
  if (!data) return badRequest("Name and content are required");
  const prompt = await prisma.systemPrompt.create({ data });
  return NextResponse.json(prompt, { status: 201 });
});

/** Body: { id, name, content } */
export const PUT = withDb(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const data = parsePrompt(body);
  if (typeof body.id !== "string" || !data) return badRequest("id, name and content are required");
  const prompt = await prisma.systemPrompt.update({ where: { id: body.id }, data });
  return NextResponse.json(prompt);
});

/** Query: ?id=<promptId> */
export const DELETE = withDb(async (request: Request) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("id is required");
  await prisma.systemPrompt.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
