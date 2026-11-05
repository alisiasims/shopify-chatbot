import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { botToken, tg, webhookSecret } from "@/lib/notify";

export const dynamic = "force-dynamic";

type Update = {
  message?: {
    message_id: number;
    message_thread_id?: number;
    is_topic_message?: boolean;
    text?: string;
    chat: { id: number; type: string; title?: string };
    from?: { first_name?: string };
  };
};

/**
 * Webhook of the shop's Telegram bot. Write /here in the group (or in a forum topic) to send
 * Deisi's notices there. Everything else is ignored.
 */
export async function POST(request: Request) {
  if (!botToken() || request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret())
    return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await request.json().catch(() => ({}))) as Update;
  const m = update.message;
  const cmd = (m?.text || "").trim().split(/[\s@]/)[0].toLowerCase();
  if (!m || !cmd.startsWith("/")) return NextResponse.json({ ok: true });

  const reply = (text: string) =>
    tg("sendMessage", { chat_id: m.chat.id, text, ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });

  if (cmd === "/here") {
    if (m.chat.type === "private") {
      await reply("Добавьте меня в группу администраторов и напишите /here в нужной теме.");
      return NextResponse.json({ ok: true });
    }
    const thread = m.is_topic_message && m.message_thread_id ? String(m.message_thread_id) : "";
    await prisma.$transaction([
      prisma.setting.upsert({ where: { key: "tg_chat_id" }, update: { value: String(m.chat.id) }, create: { key: "tg_chat_id", value: String(m.chat.id) } }),
      thread
        ? prisma.setting.upsert({ where: { key: "tg_thread_id" }, update: { value: thread }, create: { key: "tg_thread_id", value: thread } })
        : prisma.setting.deleteMany({ where: { key: "tg_thread_id" } }),
    ]);
    await reply("✅ Сюда будут приходить сообщения Дейси из магазина deesse.ee: передачи коллеге и черновики ответов из Instagram / Messenger.");
  } else if (cmd === "/start") {
    await reply("Я Дейси, ассистент магазина DEESSE. Добавьте меня в группу администраторов и напишите /here в нужной теме.");
  }
  return NextResponse.json({ ok: true });
}
