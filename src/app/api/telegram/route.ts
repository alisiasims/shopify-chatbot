import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { botToken, teamLog, tg, webhookSecret } from "@/lib/notify";
import { addRule, disableRule, importMetaHistory, listRules } from "@/lib/shop/learning";
import { teamAnswer } from "@/lib/shop/team";
import { answerFromTeam, questionFor } from "@/lib/shop/staff";

let me: { id: number; username: string; can_read_all_group_messages?: boolean } | null = null;
async function bot() {
  if (!me) {
    const r = await tg("getMe", {});
    if (r.ok) me = r.result as typeof me;
  }
  return me;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Update = {
  callback_query?: { id: string; data?: string; from?: { first_name?: string; last_name?: string }; message?: { message_id: number; text?: string; chat: { id: number } } };
  message_reaction?: { chat: { id: number }; message_id: number; user?: { first_name?: string; last_name?: string }; new_reaction?: { type: string; emoji?: string }[] };
  message?: {
    message_id: number;
    message_thread_id?: number;
    is_topic_message?: boolean;
    text?: string;
    chat: { id: number; type: string; title?: string };
    from?: { id?: number; first_name?: string; last_name?: string; is_bot?: boolean; username?: string };
    caption?: string;
    reply_to_message?: { message_id?: number; text?: string; from?: { id?: number; is_bot?: boolean } };
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
  // owner 06.11 (like the studio): buttons under tasks / handoffs and a 👍 under the notice close them
  if (update.callback_query || update.message_reaction) {
    await teamDone(update).catch((e) => console.error("[telegram] done", e));
    return NextResponse.json({ ok: true });
  }
  const m = update.message;
  // copy of the team chat for Claude's daily checks (only what the bot can see: commands, replies to it, or all if it is an admin)
  if (m && !m.from?.is_bot && m.chat.type !== "private") {
    const team = await prisma.setting.findUnique({ where: { key: "tg_chat_id" } }).catch(() => null);
    if (team?.value === String(m.chat.id) && (m.text || m.caption))
      await teamLog("in", (m.reply_to_message?.text ? `[ответ на: ${m.reply_to_message.text.slice(0, 200)}] ` : "") + (m.text || m.caption || ""), [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" "));
  }
  const cmd = (m?.text || "").trim().split(/[\s@]/)[0].toLowerCase();
  if (!m) return NextResponse.json({ ok: true });

  const reply = (text: string) =>
    tg("sendMessage", { chat_id: m.chat.id, text, ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });

  // owner 06.11: the team talks to Deisi in plain words in the topic chosen with /bot (or by replying to her / mentioning her)
  if (!cmd.startsWith("/")) {
    const text = (m.text || "").trim();
    if (!text || m.from?.is_bot || m.chat.type === "private") return NextResponse.json({ ok: true });
    const [team, botTopic, noticeTopic] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "tg_chat_id" } }).catch(() => null),
      prisma.setting.findUnique({ where: { key: "tg_bot_thread_id" } }).catch(() => null),
      prisma.setting.findUnique({ where: { key: "tg_thread_id" } }).catch(() => null),
    ]);
    // owner 06.11: the topic «бот» where Deisi's notices go is also the place to talk to her (unless /bot chose another topic)
    const topic = botTopic ?? noticeTopic;
    if (team?.value !== String(m.chat.id)) return NextResponse.json({ ok: true });
    // the team answered Deisi's question (ask_team) by replying to it: Deisi writes to the client herself
    const asked = m.reply_to_message?.message_id ? await questionFor(m.reply_to_message.message_id).catch(() => null) : null;
    if (asked) {
      const by = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "коллега";
      const thread = m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {};
      after(async () => {
        const result = await answerFromTeam(asked.id, text, by).catch((e) => {
          console.error("[telegram] staff answer", e);
          return "⚠️ Не получилось ответить клиенту — ответьте сами.";
        });
        const r = await tg("sendMessage", { chat_id: m.chat.id, ...thread, reply_parameters: { message_id: m.message_id }, text: result.slice(0, 3900) });
        if (r.ok) await teamLog("out", result, "Deisi");
      });
      return NextResponse.json({ ok: true });
    }
    const b = await bot();
    const inTopic = Boolean(topic?.value && m.is_topic_message && String(m.message_thread_id) === topic.value);
    // outside the topic only a mention wakes her (replies to her notices like «сделала» stay without an answer)
    const toBot = Boolean(b && text.toLowerCase().includes(`@${b.username.toLowerCase()}`));
    if (!inTopic && !toBot) return NextResponse.json({ ok: true });
    const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "коллега";
    const thread = m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {};
    if (/^\s*(claude|клод)\b/i.test(text)) {
      await tg("sendMessage", { chat_id: m.chat.id, ...thread, reply_parameters: { message_id: m.message_id }, text: "📌 Передала Claude. Он читает этот чат на проверках утром и вечером и ответит здесь." });
      await teamLog("out", "📌 Передала Claude (вопрос для проверки)", "Deisi");
      return NextResponse.json({ ok: true });
    }
    after(async () => {
      try {
        await tg("sendChatAction", { chat_id: m.chat.id, ...thread, action: "typing" });
        const rows = await prisma.teamLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } }, orderBy: { createdAt: "desc" }, take: 12 });
        const history = rows.reverse().slice(0, -1).map((r) => `${r.dir === "in" ? r.who || "коллега" : r.who || "Дейси"}: ${r.text.slice(0, 300)}`);
        const quoted = m.reply_to_message?.text ? `[в ответ на сообщение: «${m.reply_to_message.text.slice(0, 600)}»]\n` : "";
        const answer = await teamAnswer(quoted + text.replace(new RegExp(`@${b?.username ?? "_none_"}`, "ig"), "").trim(), who, history);
        if (/^SKIP\b/.test(answer.trim())) return; // colleagues talking to each other, «ок», «сделала»
        const sent = await tg("sendMessage", { chat_id: m.chat.id, ...thread, reply_parameters: { message_id: m.message_id }, text: answer.slice(0, 3900), disable_web_page_preview: true });
        if (sent.ok) await teamLog("out", answer, "Deisi");
      } catch (e) {
        console.error("[telegram] team answer", e);
        await tg("sendMessage", { chat_id: m.chat.id, ...thread, text: "⚠️ Не получилось ответить, попробуйте ещё раз через минуту." });
      }
    });
    return NextResponse.json({ ok: true });
  }

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
  } else if (cmd === "/bot") {
    const team = await prisma.setting.findUnique({ where: { key: "tg_chat_id" } });
    if (!team || team.value !== String(m.chat.id)) {
      await reply("Эта команда работает только в группе команды DEESSE (там, где написали /here).");
      return NextResponse.json({ ok: true });
    }
    if (!m.is_topic_message || !m.message_thread_id) {
      await reply("Создайте в группе тему «Бот» и напишите /bot внутри неё.");
      return NextResponse.json({ ok: true });
    }
    await prisma.setting.upsert({ where: { key: "tg_bot_thread_id" }, update: { value: String(m.message_thread_id) }, create: { key: "tg_bot_thread_id", value: String(m.message_thread_id) } });
    me = null;
    const b = await bot();
    await reply(
      "✅ В этой теме можно писать мне обычным текстом, например:\n• есть ли Pleaser Adore 38 в наличии?\n• что с заказом #1234?\n• что мы ответили клиентке Анне?\n• что сейчас ждёт в инбоксе?\n• запомни: …\n\nВопрос для Claude начните со слова «Claude» — он ответит на своей проверке утром или вечером." +
        (b?.can_read_all_group_messages
          ? ""
          : `\n\n⚠️ Сейчас я вижу в группе только команды и упоминания @${b?.username ?? "бота"}. Чтобы я видела все сообщения в этой теме, сделайте меня администратором группы.`),
    );
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

const POSITIVE = /👍|❤|👌|🔥|✅|💯|🙏|🥰|😍|👏|⚡|🤝|✔/u;

/** A task or a handoff is done: a button (td:/hd:) or a positive reaction under its notice. */
async function teamDone(update: Update) {
  const team = await prisma.setting.findUnique({ where: { key: "tg_chat_id" } });
  const cb = update.callback_query;
  const r = update.message_reaction;
  const chatId = cb?.message?.chat.id ?? r?.chat.id;
  if (!team || String(chatId) !== team.value) {
    if (cb) await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Только для группы команды" });
    return;
  }
  const person = cb?.from ?? r?.user;
  const who = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "коллега";
  let closed = "";
  if (cb) {
    const [kind, id] = String(cb.data || "").split(":");
    closed = await closeItem(kind, id, who);
    // the shift list is redrawn without the closed item; a single notice loses its button
    const msg = cb.message;
    if (msg && /^🗒 Задачи смены/.test(msg.text ?? "")) {
      const { shiftList } = await import("@/lib/shop/teamOps");
      const v = await shiftList();
      await tg("editMessageText", { chat_id: chatId, message_id: msg.message_id, text: v.text, reply_markup: { inline_keyboard: v.keyboard }, disable_web_page_preview: true });
    } else if (msg) await tg("editMessageText", { chat_id: chatId, message_id: msg.message_id, text: `${msg.text ?? ""}\n\n✅ ${who}`.slice(0, 4000), disable_web_page_preview: true });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: closed || "Уже закрыто" });
  } else if (r && (r.new_reaction ?? []).some((x) => POSITIVE.test(x.emoji ?? ""))) {
    const task = await prisma.teamTask.findFirst({ where: { tgMessageId: r.message_id, status: "open" } });
    if (task) closed = await closeItem("td", task.id, who);
    const handoff = await prisma.handoff.findFirst({ where: { tgMessageId: r.message_id, status: "open" } });
    if (handoff) closed = await closeItem("hd", handoff.id, who);
  }
  if (closed) await teamLog("in", `[${closed}]`, who);
}

async function closeItem(kind: string, id: string, who: string) {
  if (kind === "td") {
    const t = await prisma.teamTask.updateMany({ where: { id, status: "open" }, data: { status: "done", doneAt: new Date(), doneBy: who } });
    return t.count ? "Задача выполнена" : "";
  }
  if (kind === "hd") {
    const h = await prisma.handoff.findUnique({ where: { id } });
    if (!h || h.status !== "open") return "";
    await prisma.handoff.update({ where: { id }, data: { status: "done" } });
    if (h.sessionId) {
      const left = await prisma.handoff.count({ where: { sessionId: h.sessionId, status: "open" } });
      if (!left) await prisma.chatSession.update({ where: { id: h.sessionId }, data: { needsHuman: false, reviewedAt: new Date() } });
    }
    return "Клиент получил ответ";
  }
  return "";
}
