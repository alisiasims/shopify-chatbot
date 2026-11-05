import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { botToken, tg, webhookSecret } from "@/lib/notify";
import { addRule, disableRule, importMetaHistory, listRules } from "@/lib/shop/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Update = {
  message?: {
    message_id: number;
    message_thread_id?: number;
    is_topic_message?: boolean;
    text?: string;
    chat: { id: number; type: string; title?: string };
    from?: { first_name?: string };
    reply_to_message?: { text?: string };
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
  } else if (["/fix", "/rules", "/unfix", "/learn"].includes(cmd)) {
    // teaching Deisi (like at the studio): only in the team chat chosen with /here
    const team = await prisma.setting.findUnique({ where: { key: "tg_chat_id" } });
    if (!team || team.value !== String(m.chat.id)) {
      await reply("Эта команда работает только в группе команды DEESSE (там, где написали /here).");
      return NextResponse.json({ ok: true });
    }
    const arg = (m.text || "").trim().replace(/^\/\S+\s*/, "");
    if (cmd === "/fix") {
      if (!arg) await reply("Напишите правило после команды, например:\n/fix Не рекомендуй модели SKY для pole dance.");
      else {
        await addRule(arg, m.from?.first_name);
        const n = (await listRules()).length;
        await reply(`✅ Запомнила правило №${n}:\n«${arg}»\n\nДейси учитывает его со следующего сообщения клиента. Все правила: /rules`);
      }
    } else if (cmd === "/rules") {
      const list = await listRules();
      await reply(
        list.length
          ? "📝 Правила Дейси:\n\n" + list.map((r, i) => `${i + 1}. ${r.text}${r.by ? ` (${r.by})` : ""}`).join("\n") + "\n\nНовое: /fix текст. Выключить: /unfix номер."
          : "Правил пока нет. Новое правило: /fix текст.",
      );
    } else if (cmd === "/unfix") {
      const r = await disableRule(Number(arg));
      await reply(r ? `🗑 Правило выключено: «${r.text}»` : "Нет правила с таким номером. Список: /rules");
    } else if (cmd === "/learn") {
      await reply("📚 Читаю прошлые переписки Instagram и Messenger, это займёт пару минут…");
      after(async () => {
        const only = /insta/i.test(arg) ? ["instagram" as const] : /messenger|facebook/i.test(arg) ? ["messenger" as const] : undefined;
        const res = await importMetaHistory({ platforms: only }).catch((e) => ({ error: String(e?.message || e) }));
        const text =
          "error" in res && typeof res.error === "string"
            ? `⚠️ Не получилось: ${res.error}`
            : "✅ Дейси выучила ответы команды:\n" +
              Object.entries(res as Record<string, { conversations: number; saved: number; error?: string }>)
                .map(([k, v]) => `${k}: ${v.conversations} переписок, ${v.saved} новых примеров${v.error ? ` (⚠️ ${v.error})` : ""}`)
                .join("\n");
        await reply(text);
      });
    }
  } else if (cmd === "/start") {
    await reply("Я Дейси, ассистент магазина DEESSE. Добавьте меня в группу администраторов и напишите /here в нужной теме.");
  }
  return NextResponse.json({ ok: true });
}
