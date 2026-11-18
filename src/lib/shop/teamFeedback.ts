/**
 * Owner 18.11: «отправляй такую обратную связь еженедельно» - a weekly feedback to the shop admins in the team Telegram chat
 * (Wednesday evening). Facts are counted here, Claude writes the text in the format of the 18.11 message: thanks with
 * concrete facts, then «Что улучшить» with concrete actions. Rules (owner 10.11): nothing about Deisi's improvements or
 * new abilities - only what the team did and what it must do. No client e-mails / phones.
 */
import { prisma } from "@/lib/prisma";
import { callClaude } from "@/lib/llm";
import { admin, adminReady } from "./shopify";

type OrderNode = {
  name: string;
  createdAt: string;
  tags: string[];
  sourceName: string | null;
  displayFulfillmentStatus: string;
  fulfillments: { createdAt: string }[];
};

const D = 86400_000;
const day = (d: Date | string) => new Date(d).toLocaleDateString("ru-RU", { timeZone: "Europe/Tallinn", day: "2-digit", month: "2-digit" });

async function shopFacts(since: Date) {
  if (!adminReady()) return null;
  const q = `query($q: String!) { orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $q) { nodes { name createdAt tags sourceName displayFulfillmentStatus fulfillments(first: 1) { createdAt } } } }`;
  const recent = await admin<{ orders: { nodes: OrderNode[] } }>(q, { q: `created_at:>=${since.toISOString()}` });
  const nodes = recent.orders.nodes;
  const offline = nodes.filter((o) => o.tags.includes("offline")).length;
  const web = nodes.filter((o) => o.sourceName === "web");
  const shipHours = web
    .filter((o) => o.fulfillments[0] && !o.tags.includes("STOQ-preorder"))
    .map((o) => (new Date(o.fulfillments[0].createdAt).getTime() - new Date(o.createdAt).getTime()) / 3600_000);
  const avgShip = shipHours.length ? Math.round(shipHours.reduce((a, b) => a + b, 0) / shipHours.length) : null;
  const waitingWeb = web.filter((o) => !o.tags.includes("STOQ-preorder") && /UNFULFILLED|ON_HOLD/.test(o.displayFulfillmentStatus) && Date.now() - new Date(o.createdAt).getTime() > 2 * D);
  const pre = await admin<{ orders: { nodes: OrderNode[] } }>(q, { q: `tag:STOQ-preorder created_at:>=${new Date(Date.now() - 40 * D).toISOString()}` });
  const oldPre = pre.orders.nodes.filter((o) => /UNFULFILLED|ON_HOLD|IN_PROGRESS|PARTIALLY/.test(o.displayFulfillmentStatus) && Date.now() - new Date(o.createdAt).getTime() > 10 * D);
  return {
    showroomSales: offline,
    webOrders: web.length,
    avgHoursToShipWeb: avgShip,
    webNotShippedOver2Days: waitingWeb.map((o) => `${o.name} (${day(o.createdAt)})`),
    preordersOver10Days: oldPre.map((o) => `${o.name} (${day(o.createdAt)})`).reverse(),
  };
}

async function teamFacts(since: Date) {
  const [qs, handoffs, tasks, log] = await Promise.all([
    prisma.staffQuestion.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    prisma.handoff.findMany({ where: { createdAt: { gte: since } }, select: { status: true, createdAt: true, summary: true } }),
    prisma.teamTask.findMany({ where: { createdAt: { gte: since } }, select: { status: true, doneBy: true, createdAt: true, text: true } }),
    prisma.teamLog.findMany({ where: { createdAt: { gte: since }, dir: "in" }, select: { who: true } }),
  ]);
  const real = qs.filter((q) => q.status !== "superseded");
  const answered = real.filter((q) => q.status === "answered" && q.answeredAt);
  const mins = answered.map((q) => (q.answeredAt!.getTime() - q.createdAt.getTime()) / 60000).sort((a, b) => a - b);
  const median = mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null;
  const answeredBy: Record<string, number> = {};
  for (const q of answered) if (q.by) answeredBy[q.by] = (answeredBy[q.by] ?? 0) + 1;
  const tasksDoneBy: Record<string, number> = {};
  for (const t of tasks) if (t.status === "done" && t.doneBy && !/Дейси|тест/i.test(t.doneBy)) tasksDoneBy[t.doneBy] = (tasksDoneBy[t.doneBy] ?? 0) + 1;
  const activity: Record<string, number> = {};
  for (const l of log) if (l.who) activity[l.who] = (activity[l.who] ?? 0) + 1;
  const openOld = (d: Date) => Date.now() - d.getTime() > D;
  return {
    deisiQuestions: real.length,
    deisiQuestionsAnswered: answered.length,
    medianAnswerMinutes: median,
    answeredBy,
    unansweredQuestions: real.filter((q) => q.status === "asked").map((q) => `${day(q.createdAt)}: ${q.question.split("\n")[0].replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "").slice(0, 160)}`),
    clientsWaitingForPerson: handoffs.length,
    clientsStillWaitingOver1Day: handoffs.filter((h) => h.status === "open" && openOld(h.createdAt)).length,
    tasks: tasks.length,
    tasksDone: tasks.filter((t) => t.status === "done").length,
    tasksDoneBy,
    tasksOpenOver3Days: tasks.filter((t) => t.status === "open" && Date.now() - t.createdAt.getTime() > 3 * D).map((t) => t.text.slice(0, 100)),
    teamChatMessagesBy: activity,
  };
}

const RULES = `You write the WEEKLY feedback of the owner (Alisia) to the admins of the DEESSE shop (dancewear and pole shoes, showroom Tatari 64, Tallinn) for their Telegram team chat. In RUSSIAN, warm and respectful («девочки»), short, plain text for Telegram (no markdown, no tables).
Format exactly:
📋 Обратная связь по работе магазина за неделю (<period>)

Спасибо, девочки 💛
• 2-4 bullets: what went well, with concrete numbers from the facts; praise a colleague by name only for what the facts show (who answered Deisi's questions, who closed tasks).

Что улучшить:
1. ... 2. ... (1-4 numbered points, each = a concrete action for the team: unanswered questions of Deisi (list them shortly), clients waiting for a person more than a day, old pre-orders to check with the supplier and tell the clients an estimated date, web orders not shipped, open tasks older than 3 days).
If there is really nothing to improve, write «Что улучшить: на этой неделе замечаний нет 🙌».
Rules: use ONLY the facts given, never invent numbers or names. Never write about Deisi's improvements, new abilities or how the bot works - only what the team did and what it must do. No e-mails or phone numbers. Max ~1300 characters.`;

export async function weeklyTeamFeedback() {
  const since = new Date(Date.now() - 7 * D);
  const period = `${day(since)}–${day(new Date())}`;
  const [shop, team] = await Promise.all([shopFacts(since).catch((e) => ({ error: String(e).slice(0, 200) })), teamFacts(since)]);
  const facts = JSON.stringify({ period, shop, team }, null, 1);
  try {
    const res = await callClaude({ system: RULES, messages: [{ role: "user", content: `Facts of the week:\n${facts}` }], model: "claude-opus-5-5", maxTokens: 900, temperature: 0.3 });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    if (text.length > 80) return text;
  } catch (e) {
    console.error("[team feedback] Claude", e);
  }
  // fallback without Claude: the facts in the same format
  const s = shop && !("error" in shop) ? shop : null;
  return [
    `📋 Обратная связь по работе магазина за неделю (${period})`,
    "",
    "Спасибо, девочки 💛",
    s ? `• Шоурум: ${s.showroomSales} продаж оформлены заказами в Shopify. Онлайн-заказов: ${s.webOrders}.` : "",
    team.deisiQuestionsAnswered ? `• На вопросы Дейси ответили ${team.deisiQuestionsAnswered} из ${team.deisiQuestions}.` : "",
    "",
    "Что улучшить:",
    team.unansweredQuestions.length ? `• Без ответа вопросы Дейси: ${team.unansweredQuestions.join("; ")}` : "",
    s?.preordersOver10Days.length ? `• Предзаказы старше 10 дней: ${s.preordersOver10Days.join(", ")} — проверьте поставку и сообщите клиенткам дату.` : "",
  ].filter((l) => l !== "").join("\n");
}
