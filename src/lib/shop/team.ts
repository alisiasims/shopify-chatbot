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
import { adminReady, orderForTeam } from "./shopify";
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
    description: "A Shopify order by its number (e.g. 1234 or #1234): status, payment, delivery, tracking, items, buyer.",
    input_schema: { type: "object", properties: { order_number: { type: "string" } }, required: ["order_number"] },
  },
  {
    name: "inbox_overview",
    description: "What is waiting in Deisi's inbox now: chats to check, chats that need a person, follow-up drafts the team should send.",
    input_schema: { type: "object", properties: {} },
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
    case "order_lookup":
      if (!adminReady()) return JSON.stringify({ error: "Shopify orders are not connected" });
      return JSON.stringify((await orderForTeam(s(input.order_number))) ?? { found: false });
    case "inbox_overview":
      return JSON.stringify(await overview());
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
Пиши по-русски (Юлия не читает по-эстонски), коротко и по делу, как коллега: 1-6 строк, без приветствий и подписей, без markdown-разметки (Telegram показывает её как текст). Списки - короткими строками с «•».
Факты бери только из инструментов (остатки, цены, заказы, переписки) - не выдумывай. Если инструмент ничего не нашёл, так и скажи.
Команде можно показывать точные данные: остатки по размерам, статус заказа, e-mail и имя покупателя, что писали клиенту. Данные о здоровье клиентов не пересказывай.
Ты НЕ пишешь клиентам из этого чата и не обещаешь написать. Если просят ответить клиенту - предложи готовый текст, который сотрудник отправит сам, или скажи, где ответить (Instagram / Gmail / раздел в Shopify → Приложения → Deisi).
Если сотрудник поправляет, как отвечать клиентам («всегда…», «никогда…», «запомни…»), сохрани это через add_rule и подтверди одной строкой.
В этой теме приходят и твои уведомления, и коллеги могут переговариваться между собой. Если сообщение не вопрос и не просьба к тебе («ок», «сделала», «спасибо», коллеги обсуждают что-то друг с другом, ответ на уведомление без вопроса) - ответь ровно SKIP, ничего больше.
Если вопрос адресован Claude (а не тебе) - ответь, что Claude читает этот чат на своих проверках утром и вечером.

${SHOP_FACTS}

Сейчас в Таллине: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Tallinn", dateStyle: "full", timeStyle: "short" })}.`;
  const context = history.length ? `Последние сообщения в чате команды (для контекста):\n${history.join("\n")}\n\n` : "";
  const messages: LlmMessage[] = [{ role: "user", content: `${context}${who}: ${question}` }];
  const ctx: ToolContext = { sessionId: "team", channel: "app", discountGiven: true, out: { products: [], tools: [] } };
  for (let round = 0; round < 6; round++) {
    const res = await callClaude({ system, messages, tools, model: process.env.SHOP_MODEL || "claude-opus-5-5", maxTokens: 900, temperature: 0.3 });
    const uses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (res.stop_reason !== "tool_use" || !uses.length) return (text || "SKIP").replace(/\*\*(.+?)\*\*/g, "$1");
    messages.push({ role: "assistant", content: res.content });
    const results: ContentBlock[] = [];
    for (const u of uses) {
      let out: string;
      try {
        out = await teamTool(u.name, { ...(u.input ?? {}), ...(u.name === "add_rule" ? { by: who } : {}) }, ctx);
      } catch (e) {
        console.error("[team] tool", u.name, e);
        out = JSON.stringify({ error: "The tool failed" });
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.slice(0, 12000) });
    }
    messages.push({ role: "user", content: results });
  }
  return "Слишком сложный вопрос для одного ответа — разбейте его, пожалуйста, на части.";
}
