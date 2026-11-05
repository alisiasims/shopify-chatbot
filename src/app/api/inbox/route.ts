import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDb } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Customer conversations (site chat, e-mail, Instagram, Messenger), newest first. ?filter=human for handoffs. */
export const GET = withDb(async (request: Request) => {
  const url = new URL(request.url);
  const onlyHuman = url.searchParams.get("filter") === "human";
  const sessions = await prisma.chatSession.findMany({
    where: { channel: { not: "app" }, ...(onlyHuman ? { needsHuman: true } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true, title: true, channel: true, customerName: true, customerEmail: true, needsHuman: true, updatedAt: true, lang: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
      _count: { select: { messages: true } },
    },
  });
  return NextResponse.json(sessions);
});
