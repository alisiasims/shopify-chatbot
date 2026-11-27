/**
 * Deisi for the shop team in Telegram (owner 06.11: «могут ли админы магазина общаться с Дейси через чат "бот"?»).
 * In the topic chosen with /bot (or when someone replies to the bot / mentions it) a team member writes in plain words,
 * Deisi answers in Russian: stock and products, orders, what was written to a client, what is waiting in the inbox,
 * and she remembers corrections (same as /fix). She never writes to clients from here.
 */
import { prisma } from "@/lib/prisma";
import { callClaude, type ContentBlock, type LlmMessage, type ToolDef } from "@/lib/llm";
import { appUrl } from "@/lib/notify";
import { SHOP_FACTS } from "./knowledge";
import { addRule } from "./learning";
import { adminReady, findOrdersForTeam } from "./shopify";
import { runTool, toolDefs, type ToolContext } from "./tools";

const CHANNEL_RU: Record<string, string> = { web: "сайт", instagram: "Instagram", messenger: "Messenger", email: "почта" };

const TEAM_TOOLS: ToolDef[] = [
  {
    name: "find_client_chats",
    description: "Find client conversations (Instagram, Messenger, website chat, e-mail) by the client's name, e-mail, Instagram name or a word from the conversation. Returns the latest messages, open handoffs and follow-ups.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "order_lookup",
    description:
      "Shopify orders AND draft orders (unpaid invoices). order_number = an order number (1234 or #1234), a draft number (#D516), the buyer's e-mail, or the buyer's name. Returns status, payment, delivery, tracking, items, buyer; for a draft: whether the invoice was sent, whether it is paid and which order it became.",
    input_schema: { type: "object", properties: { order_number: { type: "string" } }, required: ["order_number"] },
  },
  {
    name: "close_waiting",
    description:
      "Close a client's request «ждёт человека» (and the tasks tied to that conversation) when a team member says the client was answered / the question is closed / asks you to close it. query = the client's name, e-mail or a word from the conversation. If several clients match, you get the list: ask which one. all=true closes every open request - only when the team member clearly says ALL are answered.",
    input_schema: { type: "object", properties: { query: { type: "string" }, all: { type: "boolean" } } },
  },
  {
    name: "order_hold",
    description:
      "Remember that a paid order is NOT to be shipped yet for a reason agreed with the client (waiting for the supplier's delivery, the client asked to wait, exchange in progress). It leaves the «оплачены, отправить» list and is shown as «ждут поставку / согласовано». clear=true removes the mark (the order can be shipped).",
    input_schema: { type: "object", properties: { order_number: { type: "string" }, note: { type: "string", description: "short reason in Russian" }, clear: { type: "boolean" } }, required: ["order_number"] },
  },
  {
    name: "quiet_clients",
    description: "List of client conversations to come back to (owner 23.11, asked by the team): (1) the client did NOT answer our last message, (2) the client wrote she will think / come back later. Site chat and e-mail now; Instagram / Messenger appear here once Meta delivers those chats. Use when the team asks who went quiet, who promised to think, whom to write again.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "look back this many days, default 14, max 30" } } },
  },
  {
    name: "inbox_overview",
    description: "What is waiting in Deisi's inbox now: chats to check, chats that need a person, follow-up drafts the team should send.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "team_tasks",
    description: "The team's task list (numbered like in the 15:00 shift list), and the shift list itself (who waits, orders to ship, follow-up drafts). action=list shows them; action=done closes task number n; action=add adds a task.",
    input_schema: {
      type: "object",
      properties: { action: { type: "string", enum: ["list", "done", "add"] }, n: { type: "integer" }, text: { type: "string" } },
      required: ["action"],
    },
  },
  {
    name: "add_rule",
    description: "Save a correction / rule for Deisi's answers to clients (same as /fix). Use when a team member says how Deisi should answer from now on.",
    input_schema: { type: "object", properties: { text: { type: "string", description: "the rule, short and clear, in Russian or English" } }, required: ["text"] },
  },
];

async function findChats(query: string) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return { error: "Too short" };
  const sessions = await prisma.chatSession.findMany({
    where: {
      channel: { not: "app" },
      OR: [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { messages: { some: { content: { contains: q, mode: "insensitive" } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 4,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 8, select: { role: true, content: true, createdAt: true, meta: true } },
      handoffs: { where: { status: "open" }, select: { reason: true, summary: true } },
      followUps: { where: { status: { not: "skipped" } }, orderBy: { createdAt: "desc" }, take: 2, select: { status: true, text: true, createdAt: true } },
    },
  });
  return {
    found: sessions.length,
    chats: sessions.map((s) => ({
      client: s.customerName || s.customerEmail || s.title,
      email: s.customerEmail,
      channel: CHANNEL_RU[s.channel] ?? s.channel,
      needs_person: s.needsHuman,
      open_handoffs: s.handoffs,
      follow_ups: s.followUps,
      link: appUrl() ? `${appUrl()}/inbox?chat=${s.id}` : null,
      last_messages: s.messages.reverse().map((m) => {
        const meta = (m.meta ?? {}) as { engine?: string; by?: string; draft?: boolean };
        const who = m.role === "user" ? "клиент" : meta.engine === "team" || meta.by === "team" ? "команда" : meta.draft ? "Дейси (черновик)" : "Дейси";
        return `${m.createdAt.toISOString().slice(0, 16).replace("T", " ")} ${who}: ${m.content.slice(0, 400)}`;
      }),
    })),
  };
}

const THINKING = /(подума|обдума|посоветуюсь|позже|попозже|потом (напишу|решу|закажу)|вернусь|дам знать|сообщу|пока не готова|ещё не решила|еще не решила|m[oõ]tlen|hiljem|annan teada|pean n[oõ]u|think about|think it over|get back to you|let you know|maybe later|mietin|palaan asiaan)/i;
const CLOSING = /^\s*(спасибо|благодарю|спс|ок|окей|хорошо|понятно|ясно|поняла|супер|отлично|ait[aä]h|t[aä]nan|selge|okei|thanks|thank you|ok|okay|great|got it|kiitos)[\s!.,)❤️🙏👍😊]*$/i;

/** Conversations worth coming back to: the client went quiet after our message, or said she will think (owner 23.11). */
export async function quietClients(days = 14) {
  const d = Math.min(30, Math.max(2, Math.round(days) || 14));
  const now = Date.now();
  const sessions = await prisma.chatSession.findMany({
    where: { channel: { in: ["web", "email", "instagram", "messenger"] }, topic: null, updatedAt: { gte: new Date(now - d * 86400_000) } },
    orderBy: { updatedAt: "desc" },
    take: 300,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true, createdAt: true, meta: true } },
      followUps: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
    },
  });
  type Item = { client: string; channel: string; quiet_days: number; client_said: string; we_said: string; follow_up: string | null; link: string | null };
  const noAnswer: Item[] = [];
  const thinking: Item[] = [];
  let waitingForUs = 0;
  for (const s of sessions) {
    const msgs = s.messages;
    const lastUser = msgs.find((m) => m.role === "user");
    if (!lastUser) continue;
    if (/^(info@deesse\.ee|info@deessestudio\.ee)$/i.test(s.customerEmail ?? "")) continue;
    // a draft nobody sent is not "our message": the client is the one waiting
    const sent = msgs.filter((m) => m.role === "user" || !((m.meta ?? {}) as { draft?: boolean }).draft);
    const last = sent[0];
    if (!last) continue;
    const lastOurs = sent.find((m) => m.role === "assistant");
    const fu = s.followUps[0];
    const item: Item = {
      client: s.customerName || s.customerEmail || s.title,
      channel: CHANNEL_RU[s.channel] ?? s.channel,
      quiet_days: Math.floor((now - last.createdAt.getTime()) / 86400_000),
      client_said: lastUser.content.replace(/\s+/g, " ").slice(0, 220),
      we_said: (lastOurs?.content ?? "").replace(/\s+/g, " ").slice(0, 220),
      follow_up: fu ? `${fu.status} ${fu.createdAt.toISOString().slice(0, 10)}` : null,
      link: appUrl() ? `${appUrl()}/inbox?chat=${s.id}` : null,
    };
    const hours = (now - last.createdAt.getTime()) / 3600_000;
    if (THINKING.test(lastUser.content) && hours >= 24) {
      thinking.push(item);
    } else if (last.role === "assistant") {
      if (hours < 24 || CLOSING.test(lastUser.content)) continue;
      noAnswer.push(item);
    } else if (s.needsHuman || hours >= 2) {
      waitingForUs++;
    }
  }
  return {
    days: d,
    promised_to_think: thinking.slice(0, 15),
    did_not_answer: noAnswer.slice(0, 20),
    more_not_shown: Math.max(0, thinking.length - 15) + Math.max(0, noAnswer.length - 20),
    client_waits_for_us: waitingForUs,
    channels: "сайт и почта; Instagram и Messenger появятся в этом списке, когда Meta одобрит доступ",
    note: "follow_up = Deisi's own reminder for this chat (sent = уже напомнила клиенту, draft = черновик ждёт отправки человеком). Клиентам из этого чата Дейси не пишет.",
  };
}

async function overview() {
  const sessions = await prisma.chatSession.findMany({
    where: { channel: { not: "app" }, updatedAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
    select: { customerName: true, customerEmail: true, title: true, needsHuman: true, reviewedAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, createdAt: true } } },
  });
  const drafts = await prisma.followUp.findMany({ where: { status: { in: ["draft", "failed"] } }, include: { session: { select: { customerName: true, title: true } } } });
  const name = (s: { customerName: string | null; customerEmail?: string | null; title: string }) => s.customerName || s.customerEmail || s.title;
  return {
    need_person: sessions.filter((s) => s.needsHuman).map(name),
    to_check: sessions.filter((s) => !s.needsHuman && s.messages[0]?.role === "assistant" && (!s.reviewedAt || s.messages[0].createdAt > s.reviewedAt)).length,
    follow_up_drafts: drafts.map((d) => `${d.session.customerName || d.session.title}: ${d.text.slice(0, 120)}`),
    inbox: "Shopify → Приложения → Deisi",
  };
}

async function teamTool(name: string, input: Record<string, unknown>, ctx: ToolContext) {
  const s = (v: unknown) => String(v ?? "").trim();
  switch (name) {
    case "find_client_chats":
      return JSON.stringify(await findChats(s(input.query)));
    case "order_lookup": {
      if (!adminReady()) return JSON.stringify({ error: "Shopify orders are not connected" });
      const r = await findOrdersForTeam(s(input.order_number));
      return JSON.stringify(r.orders.length || r.drafts.length ? r : { found: false });
    }
    case "close_waiting": {
      const { closeWaiting } = await import("./teamOps");
      const by = String(input.by || "команда");
      const open = await prisma.handoff.findMany({ where: { status: "open", sessionId: { not: null } }, include: { session: { select: { id: true, customerName: true, customerEmail: true, title: true } } } });
      // 21.11 (Юлия: «Закрой задачу "не проходит код подарочной карты"» -> 6 tool rounds, no result): a chat can be «ждёт человека»
      // (needsHuman) without an open handoff, and a quoted chat title matched several clients by one common word.
      const waiting = await prisma.chatSession.findMany({ where: { needsHuman: true }, select: { id: true, customerName: true, customerEmail: true, title: true } });
      const sessions = new Map<string, string>();
      const hay = new Map<string, string>();
      for (const h of open) {
        if (!h.session) continue;
        sessions.set(h.session.id, h.session.customerName || h.session.customerEmail || h.session.title);
        hay.set(h.session.id, `${hay.get(h.session.id) ?? ""} ${h.session.customerName ?? ""} ${h.session.customerEmail ?? ""} ${h.session.title} ${h.summary}`.toLowerCase());
      }
      for (const w of waiting) {
        if (!sessions.has(w.id)) sessions.set(w.id, w.customerName || w.customerEmail || w.title);
        hay.set(w.id, `${hay.get(w.id) ?? ""} ${w.customerName ?? ""} ${w.customerEmail ?? ""} ${w.title}`.toLowerCase());
      }
      const q = s(input.query).toLowerCase().replace(/^@/, "").replace(/[«»"“”„]/g, " ");
      let ids = [...sessions.keys()];
      if (!input.all) {
        if (q.length < 2) return JSON.stringify({ error: "Whose request? Give a name or e-mail.", open: [...sessions.values()] });
        const STOP = new Set(["не", "на", "по", "от", "за", "из", "для", "чат", "чата", "задачу", "задача", "запрос", "клиент", "клиентка", "закрой", "закрыть", "the", "and"]);
        const all = q.split(/\s+/).filter((w) => w.length > 1);
        const words = all.filter((w) => !STOP.has(w)).length ? all.filter((w) => !STOP.has(w)) : all;
        const scored = ids.map((id) => ({ id, n: words.filter((w) => (hay.get(id) ?? "").includes(w)).length })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
        if (!scored.length) return JSON.stringify({ closed: 0, note: "No open request matches. Nothing is waiting for this client. Tell the team member so in one line; do not search further.", open: [...sessions.values()] });
        // the best match wins when it is clearly better than the next one (more of the words fit)
        ids = scored.filter((x) => x.n === scored[0].n).map((x) => x.id);
        if (ids.length > 1) return JSON.stringify({ closed: 0, note: "Several clients match - ask which one (one line), do not call more tools.", matches: ids.map((id) => sessions.get(id)) });
      }
      const names: string[] = [];
      for (const id of ids) {
        await closeWaiting(id, by);
        names.push(sessions.get(id) ?? "");
      }
      const left = await prisma.handoff.count({ where: { status: "open" } });
      return JSON.stringify({ closed: names.length, clients: names, still_waiting: left });
    }
    case "order_hold": {
      const { setOrderHold } = await import("./teamOps");
      const order = s(input.order_number);
      if (!/\d{3,}/.test(order)) return JSON.stringify({ error: "Order number is required" });
      return JSON.stringify(await setOrderHold(order, input.clear ? null : s(input.note) || "ждём поставку, с клиентом согласовано"));
    }
    case "quiet_clients":
      return JSON.stringify(await quietClients(Number(input.days) || 14));
    case "inbox_overview":
      return JSON.stringify(await overview());
    case "team_tasks": {
      const action = s(input.action);
      if (action === "add") {
        const text = s(input.text);
        if (!text) return JSON.stringify({ error: "Empty task" });
        await prisma.teamTask.create({ data: { text, by: String(input.by || "команда") } });
        return JSON.stringify({ ok: true });
      }
      const open = await prisma.teamTask.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" } });
      if (action === "done") {
        const t = open[Number(input.n) - 1];
        if (!t) return JSON.stringify({ error: "No task with this number", tasks: open.map((x, i) => `${i + 1}. ${x.text}`) });
        await prisma.teamTask.update({ where: { id: t.id }, data: { status: "done", doneAt: new Date() } });
        return JSON.stringify({ ok: true, closed: t.text });
      }
      const { shiftList } = await import("./teamOps");
      return JSON.stringify({ shift_list: (await shiftList()).text });
    }
    case "add_rule": {
      const text = s(input.text);
      if (!text) return JSON.stringify({ error: "Empty rule" });
      await addRule(text, String(input.by || "Telegram"));
      return JSON.stringify({ ok: true, note: "Saved. Deisi follows it from the next client message." });
    }
    default:
      return runTool(name, input, ctx);
  }
}

/** One answer of Deisi to a team member. `history` = the last lines of the team chat (oldest first). */
export async function teamAnswer(question: string, who: string, history: string[]): Promise<string> {
  const catalogTools = toolDefs("app").filter((t) => ["search_products", "get_product", "delivery_options"].includes(t.name));
  const tools = [...catalogTools, ...TEAM_TOOLS];
  const system = `Ты Дейси, AI-ассистент магазина DEESSE (deesse.ee: обувь и одежда для pole dance, high heels, бикини-фитнеса). Сейчас ты во внутреннем Telegram-чате КОМАНДЫ магазина, тебе пишет сотрудник (${who}). Это не клиент.
Пиши по-русски (Юлия не читает по-эстонски), коротко и по делу, как коллега, без приветствий и подписей, без markdown-разметки (Telegram показывает её как текст). Списки - короткими строками с «•».
ДЛИНА (Юлия 11.11): на просьбу что-то сделать отвечай ОДНОЙ строкой - «Готово: …» (что сделано) или что именно тебе нужно от сотрудника. На вопрос - 1-4 строки с ответом. Не перечисляй, чего ты не умеешь, не объясняй, как устроена система, не давай ссылки и инструкции «нажми там-то», если об этом не спросили. Не повторяй то, что сотрудник только что сам написал.
СНАЧАЛА ДЕЛАЙ (Юлия 11.11): если сотрудник просит о действии, для которого у тебя есть инструмент, - сделай его сама, а не объясняй, как сделать руками:
• «закрой запрос», «я ответила ей», «вопрос с X закрыт», «на это письмо ответили» -> close_waiting (по имени клиента из сообщения или из уведомления, на которое он отвечает). Верь сотруднику: если он говорит, что ответил, - закрывай, не спорь, что «не видишь ответа».
• Черновики в Gmail (info@deesse.ee) ты НЕ видишь и удалить не можешь (PM 27.11: на «не пиши черновик для X» ответила «черновиков нет», а он висел со вчера). Никогда не пиши «черновиков нет»: скажи, что закрыла запрос (close_waiting) и больше не напишешь клиентке по этому заказу, а висящий черновик пусть удалят в Gmail вручную - одной строкой.
• заказ не отправляют, потому что ждут поставку / так согласовано с клиентом -> order_hold с короткой причиной; больше не напоминай про этот заказ.
• «проверь заказ / оплату» -> order_lookup: он находит и заказы, и черновики-счета (#D…), по номеру, e-mail или имени покупателя.
• «сообщи, когда оплатит» -> ответь одной строкой, что напишешь сюда, как только счёт будет оплачен: оплату неоплаченных счетов (draft orders) ты проверяешь сама каждые 5 минут и пишешь в этот чат «💶 Оплачено: …». Задачу для этого не создавай.
• письма от наших поставщиков и партнёров ты сама вносишь в список задач (с 11.11).
ОТЧЁТ СМЕНЫ (PM 11.11): если сотрудник пишет отчёт за день или статус по клиентам и заказам («Отправила: …», «Ждём ответ от …», «ответили …», «поменяли модель с …», «заказанной модели нет, ждём поставку»), молча примени его инструментами: клиентам, которым по отчёту ответили, - close_waiting; заказам, которые ждут поставку или решения клиента, - order_hold с причиной из отчёта. Потом ответь ОДНОЙ строкой «Отметила: …» (что именно закрыла и пометила). Если применять нечего - SKIP. Не закрывай запрос клиента, про которого в отчёте сказано только «ждём ответ» без того, что мы ему ответили.
Запросы с 🔴 - срочные (долг клиенту, повторное обращение): про них отвечай в первую очередь.
Ответы команды, отправленные прямо из Gmail, ты теперь видишь (в течение ~5 минут запрос закрывается сам).
Факты бери только из инструментов (остатки, цены, заказы, переписки) - не выдумывай. Если инструмент ничего не нашёл, так и скажи.
Команде можно показывать точные данные: остатки по размерам, статус заказа, e-mail и имя покупателя, что писали клиенту. Данные о здоровье клиентов не пересказывай.
Ты НЕ пишешь клиентам из этого чата и не обещаешь написать. Если просят ответить клиенту - предложи готовый текст, который сотрудник отправит сам, или скажи, где ответить (Instagram / Gmail / раздел в Shopify → Приложения → Deisi).
Если сотрудник поправляет, как отвечать клиентам («всегда…», «никогда…», «запомни…»), сохрани это через add_rule и подтверди одной строкой.
ЗАМЕЧАНИЕ О ТВОЕЙ РАБОТЕ (PM 23.11): если сотрудник говорит, что ты что-то сделала плохо («плохо написала черновик», «ошибка», «следи за этим»), это не SKIP: если это правило на будущее - сохрани его через add_rule, и ответь одной строкой, что учла («Учла: …»). Не оправдывайся и не объясняй, почему так вышло. «Учла» пишешь ТОЛЬКО в ответ на само замечание (последнее сообщение); старые замечания из истории уже учтены - никогда не добавляй «Учла: …» к ответу на другой вопрос (PM 23.11: «Учла» пришло через 1,5 ч в ответе про задачи).
КОМАНДА МАГАЗИНА (владелица 24.11): сотрудники магазина - Юлия и Арина; срочные и рабочие просьбы адресуй им («Арина, Юлия»). Алисия - владелица, к ней по имени в общем чате не обращайся.
КЛИЕНТЫ, К КОТОРЫМ СТОИТ ВЕРНУТЬСЯ (владелица 23.11, просьба Юлии): когда спрашивают, кто из клиентов не ответил нам / обещал подумать / кому написать ещё раз - вызови quiet_clients и дай короткий список: сначала «Обещали подумать», потом «Не ответили»; в строке - клиент, канал, сколько дней тишины, о чём шла речь (5-8 слов своими словами), ссылка на чат; если Дейси уже напоминала (follow_up sent) - отметь «уже напоминала». Не больше 10 строк, остальное - «и ещё N». Список собирается по сайту и почте. Переписки в Instagram и Messenger ты пока НЕ видишь - Meta ещё не одобрила доступ приложению (App Review подан 06.11); скажи это одной строкой и добавь, что они появятся в этом же списке после одобрения. Не выдумывай чаты, которых нет в ответе инструмента.
В этой теме приходят и твои уведомления, и коллеги могут переговариваться между собой. Если сообщение не вопрос и не просьба к тебе («ок», «сделала», «спасибо», коллеги обсуждают что-то друг с другом, ответ на уведомление без вопроса, «ап» / «up» - сотрудник поднимает своё сообщение для коллег) - ответь ровно SKIP, ничего больше.

${SHOP_FACTS}

Сейчас в Таллине: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Tallinn", dateStyle: "full", timeStyle: "short" })}.`;
  const context = history.length ? `Последние сообщения в чате команды (для контекста):\n${history.join("\n")}\n\n` : "";
  const messages: LlmMessage[] = [{ role: "user", content: `${context}${who}: ${question}` }];
  const ctx: ToolContext = { sessionId: "team", channel: "app", discountGiven: true, out: { products: [], tools: [] } };
  for (let round = 0; round < 6; round++) {
    // PM 25.11 (Юлия 16:30 / 16:33 «список клиентов, к которым надо вернуться» -> quiet_clients ran, then NO answer twice): with 900 tokens the
    // model's thinking used the whole budget on the long tool result, the text came back empty and empty = SKIP. Bigger budget + an empty
    // answer after a tool call is never SKIP (the final-answer pass below writes it).
    const res = await callClaude({ system, messages, tools, model: process.env.SHOP_MODEL || "claude-opus-5-5", maxTokens: 4000, temperature: 0.3 });
    const uses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (res.stop_reason !== "tool_use" || !uses.length) {
      if (text) return text.replace(/\*\*(.+?)\*\*/g, "$1");
      console.warn("[team] empty answer", res.stop_reason, "round", round);
      if (round === 0 && res.stop_reason !== "max_tokens") return "SKIP";
      break; // a tool already ran (or the budget ran out) -> the final-answer pass below
    }
    messages.push({ role: "assistant", content: res.content });
    const results: ContentBlock[] = [];
    for (const u of uses) {
      let out: string;
      try {
        console.log("[team] tool", u.name, JSON.stringify(u.input ?? {}).slice(0, 200));
        out = await teamTool(u.name, { ...(u.input ?? {}), ...(["add_rule", "team_tasks", "close_waiting"].includes(u.name) ? { by: who } : {}) }, ctx);
      } catch (e) {
        console.error("[team] tool", u.name, e);
        out = JSON.stringify({ error: "The tool failed" });
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.slice(0, 12000) });
    }
    messages.push({ role: "user", content: results });
  }
  // 21.11: tool rounds ran out -> one final answer without tools (what was done / what is needed), never the canned «разбейте на части».
  try {
    const last = messages[messages.length - 1];
    const note: ContentBlock = { type: "text", text: "Инструменты больше недоступны. Ответь сотруднику сейчас одной-двумя строками: что уже сделано и что именно нужно уточнить." };
    if (last && last.role === "user" && Array.isArray(last.content)) (last.content as ContentBlock[]).push(note);
    const res = await callClaude({ system, messages, tools, toolChoice: "none", model: process.env.SHOP_MODEL || "claude-opus-5-5", maxTokens: 3000, temperature: 0.3 });
    const text = res.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) return text.replace(/\*\*(.+?)\*\*/g, "$1");
  } catch (e) {
    console.error("[team] final answer", e);
  }
  return "Не получилось сделать это за один раз. Напишите, пожалуйста, имя клиента или номер заказа - сделаю сразу.";
}
