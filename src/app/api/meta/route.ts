import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { runAgent, type IncomingFile } from "@/lib/shop/agent";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Instagram and Facebook Messenger webhook (Meta app → Webhooks → callback URL https://<app>/api/meta).
 * Variables: META_VERIFY_TOKEN, META_APP_SECRET (signature check), META_PAGE_TOKEN (to send),
 * META_AUTO_REPLY=on to send answers directly. Without it the answer goes to Telegram as a draft.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.META_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token)
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

type MetaEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type: string; payload?: { url?: string } }[] };
};

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  const raw = await request.text();
  if (!secret) return NextResponse.json({ error: "META_APP_SECRET is not set" }, { status: 503 });
  const sig = request.headers.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: { object?: string; entry?: { messaging?: MetaEvent[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const channel = body.object === "instagram" ? "instagram" : "messenger";
  const events = (body.entry ?? []).flatMap((e) => e.messaging ?? []).filter((e) => e.message && !e.message.is_echo && e.sender?.id);
  // answer Meta at once; the replies are made after the response
  after(async () => {
    for (const ev of events) {
      try {
        await handle(channel, ev);
      } catch (e) {
        console.error("[meta] event failed", e);
      }
    }
  });
  return NextResponse.json({ ok: true });
}

async function handle(channel: "instagram" | "messenger", ev: MetaEvent) {
  const senderId = ev.sender!.id;
  const mid = ev.message!.mid ?? "";
  const text = (ev.message!.text ?? "").slice(0, 2000);
  const files = await downloadImages(ev.message!.attachments ?? []);
  if (!text && !files.length) return;

  let session = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel, externalId: senderId } } });
  if (!session)
    session = await prisma.chatSession.create({
      data: { channel, externalId: senderId, title: (text || "Photo").slice(0, 40), model: "claude", temperature: 0.5, topP: 1 },
    });
  if (mid && (await prisma.message.findFirst({ where: { sessionId: session.id, meta: { path: ["mid"], equals: mid } } }))) return;
  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: text,
      meta: { mid },
      ...(files.length ? { attachments: files.map((f) => ({ name: f.name, type: f.type })) } : {}),
    },
  });

  const persona = await prisma.systemPrompt.findUnique({ where: { name: SHOP_PERSONA_NAME } });
  const reply = await runAgent({ ...session, systemPrompt: persona ? { name: persona.name, content: persona.content } : null }, files);
  const auto = process.env.META_AUTO_REPLY === "on" && process.env.META_PAGE_TOKEN && reply.meta.engine === "claude";
  let sent = false;
  if (auto) sent = await sendMeta(senderId, reply.text);
  await prisma.message.create({
    data: { sessionId: session.id, role: "assistant", content: reply.text, meta: { ...reply.meta, sent, draft: !sent } },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
  if (!sent)
    await notifyTeam(`💬 ${channel === "instagram" ? "Instagram" : "Messenger"} · draft answer (not sent)\nClient: ${text.slice(0, 400)}\n\nDeisi: ${reply.text.slice(0, 1500)}`);
}

async function sendMeta(recipientId: string, text: string) {
  const parts = text.match(/[\s\S]{1,950}(\s|$)/g) ?? [text];
  for (const part of parts) {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_TOKEN!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: part.trim() } }),
    });
    if (!res.ok) {
      console.error("[meta] send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
  }
  return true;
}

async function downloadImages(atts: { type: string; payload?: { url?: string } }[]): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const a of atts.slice(0, 2)) {
    if (a.type !== "image" || !a.payload?.url) continue;
    try {
      const res = await fetch(a.payload.url);
      const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.length < 5 * 1024 * 1024 && /^image\/(jpeg|png|gif|webp)$/.test(type))
        out.push({ name: "photo", type, data: buf.toString("base64") });
    } catch (e) {
      console.error("[meta] image download failed", e);
    }
  }
  return out;
}
