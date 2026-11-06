/**
 * Team routines in Telegram (owner 06.11, the studio's ones adapted to the shop):
 *  - shift list every day except Sunday at 15:00 Tallinn: who waits for a person, follow-up drafts, collaborations,
 *    paid orders to ship, Deisi's orders waiting for payment, team tasks;
 *  - reminders while the showroom is open: a client waits for a person 60+ min (at most 2 reminders);
 *  - evening summary at 21:00: what happened today.
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { admin, adminReady } from "./shopify";

const CHANNEL_RU: Record<string, string> = { web: "сайт", instagram: "Instagram", messenger: "Messenger", email: "почта" };

/** Showroom Tatari 64 opening hours (deesse.ee/pages/contact, 06.11): [open, close] in Tallinn time; Sunday by appointment. */
const SHOWROOM: Record<number, [number, number] | null> = { 0: null, 1: [15, 19], 2: [16, 19], 3: [15, 19], 4: [16, 19], 5: [13, 17], 6: [14, 17] };

function tallinn() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tallinn", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dow, hour: Number(get("hour")), minute: Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}` };
}
export function showroomOpen() {
  const t = tallinn();
  const h = SHOWROOM[t.dow];
  return Boolean(h && t.hour >= h[0] && t.hour < h[1]);
}
function dayStart() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Tallinn" }));
  const off = local.getTime() - now.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() - off);
}
const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  return m < 60 ? `${m} мин` : m < 48 * 60 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} дн`;
};
const who = (s: { customerName: string | null; customerEmail: string | null; title: string } | null) => (s ? s.customerName || s.customerEmail || s.title.slice(0, 40) : "клиент");

async function paidToShip() {
  if (!adminReady()) return [] as string[];
  try {
    const d = await admin<{ orders: { nodes: { name: string; createdAt: string; shippingLine: { title: string } | null; customer: { displayName: string } | null }[] } }>(
      `{ orders(first: 25, sortKey: CREATED_AT, query: "financial_status:paid fulfillment_status:unfulfilled status:open") { nodes { name createdAt shippingLine { title } customer { displayName } } } }`,
    );
    return d.orders.nodes.map((o) => `${o.name} · ${o.customer?.displayName ?? ""} · ${o.shippingLine?.title ?? "без доставки"} · с ${o.createdAt.slice(8, 10)}.${o.createdAt.slice(5, 7)}`);
  } catch (e) {
    console.error("[shift] orders", e);
    return [];
  }
}

async function deisiUnpaid() {
  if (!adminReady()) return [] as string[];
  try {
    const d = await admin<{ draftOrders: { nodes: { name: string; createdAt: string; email: string | null; totalPriceSet: { shopMoney: { amount: string } } }[] } }>(
      `{ draftOrders(first: 20, sortKey: UPDATED_AT, reverse: true, query: "status:open tag:deisi") { nodes { name createdAt email totalPriceSet { shopMoney { amount } } } } }`,
    );
    return d.draftOrders.nodes
      .filter((o) => Date.now() - new Date(o.createdAt).getTime() > 20 * 3600_000)
      .map((o) => `${o.name} · ${o.email ?? ""} · ${Number(o.totalPriceSet.shopMoney.amount).toFixed(2)} € · ждёт оплаты ${ago(new Date(o.createdAt))}`);
  } catch (e) {
    console.error("[shift] drafts", e);
    return [];
  }
}

/** The shift list (15:00 Mon-Sat). */
export async function shiftList() {
  const [handoffs, drafts, collabs, tasks, ship, unpaid] = await Promise.all([
    prisma.handoff.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, include: { session: { select: { customerName: true, customerEmail: true, title: true, channel: true, topic: true } } } }),
    prisma.followUp.findMany({ where: { status: { in: ["draft", "failed"] } }, include: { session: { select: { customerName: true, customerEmail: true, title: true } } } }),
    prisma.chatSession.findMany({ where: { topic: "collab", reviewedAt: null }, select: { customerName: true, customerEmail: true, title: true, channel: true } }),
    prisma.teamTask.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" } }),
    paidToShip(),
    deisiUnpaid(),
  ]);
  const people = handoffs.filter((h) => h.session?.topic == null);
  const lines: string[] = [];
  if (people.length) lines.push("🙋 Ждут ответа человека:\n" + people.map((h) => `• ${who(h.session)} · ${CHANNEL_RU[h.channel] ?? h.channel} · ждёт ${ago(h.createdAt)}\n  ${h.summary.slice(0, 160)}`).join("\n"));
  if (ship.length) lines.push("📦 Оплачены, отправить:\n" + ship.map((s) => `• ${s}`).join("\n"));
  if (tasks.length) lines.push("📝 Задачи:\n" + tasks.map((t, i) => `${i + 1}. ${t.text}${t.by ? ` (${t.by})` : ""} · ${ago(t.createdAt)}`).join("\n") + "\nСделали — напишите Дейси в этой теме: «задача 2 готова».");
  if (drafts.length) lines.push("🔁 Фоллоу-апы, отправьте сами:\n" + drafts.map((f) => `• ${who(f.session)}: ${f.text.slice(0, 100)}`).join("\n"));
  if (unpaid.length) lines.push("🧾 Заказы Дейси не оплачены:\n" + unpaid.map((s) => `• ${s}`).join("\n"));
  if (collabs.length) lines.push(`🤝 Сотрудничество, не просмотрено: ${collabs.map((c) => who({ ...c, title: c.title })).join(", ")}`);
  const text = lines.length ? `🗒 Задачи смены на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Tallinn", day: "2-digit", month: "2-digit" })}\n\n${lines.join("\n\n")}\n\nВсё в Shopify → Приложения → Deisi.` : "🗒 Задачи смены: всё сделано, никто не ждёт ✨";
  return text;
}

/** The evening summary (21:00 every day). */
export async function eveningDigest() {
  const since = dayStart();
  const [sessions, deisi, team, handoffsNew, handoffsDone, followUps, orders, collabs, spam, tasksDone, rules, mentions] = await Promise.all([
    prisma.chatSession.findMany({ where: { createdAt: { gte: since }, channel: { not: "app" } }, select: { channel: true, topic: true } }),
    prisma.message.count({ where: { createdAt: { gte: since }, role: "assistant", NOT: { content: "SKIP" }, session: { channel: { not: "app" } } } }),
    prisma.message.count({ where: { createdAt: { gte: since }, role: "assistant", OR: [{ meta: { path: ["by"], equals: "team" } }, { meta: { path: ["engine"], equals: "team" } }] } }),
    prisma.handoff.count({ where: { createdAt: { gte: since } } }),
    prisma.handoff.count({ where: { createdAt: { gte: since }, status: "done" } }),
    prisma.followUp.groupBy({ by: ["status"], where: { createdAt: { gte: since }, status: { not: "skipped" } }, _count: true }),
    prisma.message.findMany({ where: { createdAt: { gte: since }, role: "assistant" }, select: { meta: true } }),
    prisma.chatSession.count({ where: { topic: "collab", updatedAt: { gte: since } } }),
    prisma.chatSession.count({ where: { topic: "spam", updatedAt: { gte: since } } }),
    prisma.teamTask.count({ where: { doneAt: { gte: since } } }),
    prisma.rule.count({ where: { createdAt: { gte: since } } }),
    prisma.message.count({ where: { createdAt: { gte: since }, meta: { path: ["storyMention"], equals: true } } }),
  ]);
  const byCh: Record<string, number> = {};
  sessions.filter((s) => s.topic !== "spam").forEach((s) => (byCh[s.channel] = (byCh[s.channel] ?? 0) + 1));
  const fu = Object.fromEntries(followUps.map((g) => [g.status, g._count]));
  const orderNames = [...new Set(orders.map((o) => String((o.meta as { order?: string } | null)?.order ?? "")).filter(Boolean))];
  const open = await prisma.handoff.count({ where: { status: "open" } });
  const lines = [
    `🌙 Итоги дня в магазине`,
    `💬 Новые переписки: ${Object.entries(byCh).map(([c, n]) => `${CHANNEL_RU[c] ?? c} ${n}`).join(", ") || "нет"}`,
    `🤖 Ответов Дейси: ${deisi} · ответов команды: ${team}`,
    `🙋 Передано человеку: ${handoffsNew} (закрыто ${handoffsDone}) · сейчас ждут: ${open}`,
    orderNames.length ? `🧾 Заказы через Дейси: ${orderNames.join(", ")}` : "",
    fu.sent || fu.draft ? `🔁 Фоллоу-апы: отправлено ${fu.sent ?? 0}, черновиков ${fu.draft ?? 0}` : "",
    mentions ? `📸 Отметки в сторис: ${mentions}` : "",
    collabs ? `🤝 Сотрудничество: ${collabs}` : "",
    spam ? `🗑 Спам и рассылки: ${spam}` : "",
    tasksDone ? `✅ Задач выполнено: ${tasksDone}` : "",
    rules ? `📝 Новых правил для Дейси: ${rules}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/** During showroom hours: a client waits for a person 60+ min -> reminder (after 1 h, then after 3 more h; at most 2). */
export async function remindWaiting() {
  if (!showroomOpen()) return 0;
  const now = Date.now();
  const open = await prisma.handoff.findMany({
    where: { status: "open", reminders: { lt: 2 }, createdAt: { lte: new Date(now - 60 * 60_000), gte: new Date(now - 3 * 86400_000) } },
    include: { session: { select: { id: true, customerName: true, customerEmail: true, title: true, topic: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, meta: true, createdAt: true } } } } },
  });
  let sent = 0;
  for (const h of open) {
    if (h.session?.topic) continue;
    const last = h.session?.messages[0];
    const meta = (last?.meta ?? {}) as { by?: string; engine?: string };
    if (last && last.role === "assistant" && (meta.by === "team" || meta.engine === "team") && last.createdAt > h.createdAt) continue; // the team answered
    if (h.remindedAt && now - h.remindedAt.getTime() < 3 * 3600_000) continue;
    await notifyTeam(`⏰ Клиент ждёт ответа уже ${ago(h.createdAt)}: ${who(h.session)} · ${CHANNEL_RU[h.channel] ?? h.channel}\n${h.summary.slice(0, 300)}`);
    await prisma.handoff.update({ where: { id: h.id }, data: { reminders: { increment: 1 }, remindedAt: new Date() } });
    sent++;
  }
  return sent;
}

async function once(key: string) {
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch {
    return false; // already done today
  }
}

/** Every 5 minutes: shift list at 15:00 (Mon-Sat), evening summary at 21:00, reminders while the showroom is open. */
export function startTeamTimer() {
  const tick = async () => {
    try {
      const t = tallinn();
      if (t.dow !== 0 && t.hour === 15 && t.minute < 30 && (await once(`shift_list:${t.date}`))) await notifyTeam(await shiftList());
      if (t.hour === 21 && t.minute < 30 && (await once(`digest:${t.date}`))) await notifyTeam(await eveningDigest());
      await remindWaiting();
    } catch (e) {
      console.error("[team timer]", e);
    }
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 5 * 60_000);
}
