import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { runAgent, type IncomingFile } from "@/lib/shop/agent";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";
import { saveExample } from "@/lib/shop/learning";
import { metaAutoSend, sendMeta } from "@/lib/shop/meta";

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
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; attachments?: { type: string; payload?: { url?: string } }[] };
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
  // replies our team writes by hand in Instagram / Messenger (echoes not sent by this app): Deisi learns from them
  const appId = String(process.env.META_APP_ID || "1640472837550030");
  const teamEchoes = (body.entry ?? [])
    .flatMap((e) => e.messaging ?? [])
    .filter((e) => e.message?.is_echo && e.message.text && String(e.message.app_id ?? "") !== appId && e.recipient?.id);
  // answer Meta at once; the replies are made after the response
  after(async () => {
    for (const ev of teamEchoes) await learnFromTeam(channel, ev).catch((e) => console.error("[meta] team echo", e));
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

/**
 * A person from our team answered a client by hand (owner 05.11: Deisi learns from our Instagram / Messenger answers).
 * The answer goes into the conversation history and becomes an example for similar questions.
 */
async function learnFromTeam(channel: "instagram" | "messenger", ev: MetaEvent) {
  const session = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel, externalId: ev.recipient!.id } } });
  if (!session) return;
  const text = ev.message!.text!.slice(0, 2000);
  const recent = await prisma.message.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "desc" }, take: 6 });
  if (recent.some((m) => m.role === "assistant" && m.content.trim() === text.trim())) return; // our own reply
  await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: text, meta: { engine: "team" } } });
  const question = recent
    .reverse()
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  if (question) await saveExample(question, text, `${channel}_team`, null, `${channel}:${ev.message!.mid ?? Date.now()}`);
}

/** The shop's own Instagram account id (recipient of Instagram DMs); kept for the start check and read once with instagram_basic. */
let igSaved = false;
async function rememberInstagramAccount(id: string) {
  if (igSaved) return;
  igSaved = true;
  await prisma.setting.upsert({ where: { key: "ig_account_id" }, update: { value: id }, create: { key: "ig_account_id", value: id } });
  if (!process.env.META_PAGE_TOKEN) return;
  const res = await fetch(`https://graph.facebook.com/v21.0/${id}?fields=id,username&access_token=${encodeURIComponent(process.env.META_PAGE_TOKEN)}`);
  console.log(`[meta] instagram account: ${res.ok ? "ok" : `HTTP ${res.status}`}`);
}

async function claimMessage(mid: string) {
  try {
    await prisma.setting.create({ data: { key: `meta_mid:${mid}`.slice(0, 190), value: new Date().toISOString() } });
  } catch {
    return false; // already taken by an earlier delivery
  }
  if (Math.random() < 0.02) {
    // forget message ids older than 7 days
    const old = new Date(Date.now() - 7 * 86400_000).toISOString();
    await prisma.setting.deleteMany({ where: { key: { startsWith: "meta_mid:" }, value: { lt: old } } }).catch(() => {});
  }
  return true;
}

async function handle(channel: "instagram" | "messenger", ev: MetaEvent) {
  const senderId = ev.sender!.id;
  if (channel === "instagram" && ev.recipient?.id) await rememberInstagramAccount(ev.recipient.id).catch((e) => console.error("[meta] ig account", e));
  const mid = ev.message!.mid ?? "";
  // Meta sometimes delivers the same message twice within seconds (05.11: two replies to one DM).
  // Claim the message id atomically: only the first delivery gets an answer.
  if (mid && !(await claimMessage(mid))) return;
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

  // the client sees «typing…» while Deisi checks the catalog (answers take 10-30 s)
  if (metaAutoSend()) void senderAction(senderId, "typing_on");
  const persona = await prisma.systemPrompt.findUnique({ where: { name: SHOP_PERSONA_NAME } });
  const reply = await runAgent({ ...session, systemPrompt: persona ? { name: persona.name, content: persona.content } : null }, files);
  // spam: no answer at all (owner 06.11: spam goes to its own inbox section)
  if (reply.meta.skip || /^SKIP\b/.test(reply.text.trim())) {
    await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: "SKIP", meta: { ...reply.meta, sent: false } } });
    return;
  }
  const auto = metaAutoSend() && reply.meta.engine === "claude";
  let sent = false;
  if (auto) sent = await sendMeta(senderId, reply.text);
  await prisma.message.create({
    data: { sessionId: session.id, role: "assistant", content: reply.text, meta: { ...reply.meta, sent, draft: !sent } },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
  if (!sent)
    await notifyTeam(`💬 ${channel === "instagram" ? "Instagram" : "Messenger"} · черновик ответа (не отправлен)\nКлиент: ${text.slice(0, 400)}\n\nДейси: ${reply.text.slice(0, 1500)}`);
}

async function senderAction(recipientId: string, action: "typing_on" | "mark_seen") {
  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_TOKEN!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, sender_action: action }),
  }).catch(() => null);
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
