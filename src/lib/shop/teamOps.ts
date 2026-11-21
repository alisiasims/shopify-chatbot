/**
 * Team routines in Telegram (owner 06.11, the studio's ones adapted to the shop):
 *  - shift list every day except Sunday at 15:00 Tallinn: who waits for a person, follow-up drafts, collaborations,
 *    paid orders to ship, Deisi's orders waiting for payment, team tasks;
 *  - reminders while the showroom is open: a client waits for a person 60+ min (at most 2 reminders);
 *  - evening summary at 21:00: what happened today.
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam, notifyTeamId, telegramTarget, tg } from "@/lib/notify";
import { admin, adminReady, recentDrafts } from "./shopify";
import { weeklyTeamFeedback } from "./teamFeedback";

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

/**
 * A client got an answer / the question is closed: open handoffs of the conversation are done, «ждёт человека» is cleared,
 * tasks tied to the conversation are done (Юлия 11.11: «Закрой запрос» -> Deisi had no way to close it).
 */
export async function closeWaiting(sessionId: string, by: string) {
  const h = await prisma.handoff.updateMany({ where: { sessionId, status: "open" }, data: { status: "done" } });
  const t = await prisma.teamTask.updateMany({ where: { sessionId, status: "open" }, data: { status: "done", doneAt: new Date(), doneBy: by } });
  await prisma.chatSession.update({ where: { id: sessionId }, data: { needsHuman: false, reviewedAt: new Date() } }).catch(() => null);
  return { handoffs: h.count, tasks: t.count };
}

/** Orders the team agreed to hold (Юлия 11.11: «#1845 … ожидаем поставку, с клиентом согласовано»): Setting order_wait:<#name> = note. */
const HOLD = "order_wait:";
export async function orderHolds() {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: HOLD } } }).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.key.slice(HOLD.length), r.value]));
}
export async function setOrderHold(order: string, note: string | null) {
  const name = `#${order.replace(/[^0-9A-Za-z-]/g, "")}`;
  if (!note) {
    await prisma.setting.deleteMany({ where: { key: HOLD + name } });
    return { ok: true, order: name, hold: null };
  }
  await prisma.setting.upsert({ where: { key: HOLD + name }, update: { value: note.slice(0, 200) }, create: { key: HOLD + name, value: note.slice(0, 200) } });
  return { ok: true, order: name, hold: note.slice(0, 200) };
}

/**
 * Payment watcher (Юлия 11.11: «сообщи когда он будет оплачен» -> Deisi could only check when asked).
 * Every tick: draft orders that were open and are now completed -> one line in the team chat. State: Setting draft_watch = {id: name}.
 */
export async function watchDraftPayments() {
  if (!adminReady()) return 0;
  const row = await prisma.setting.findUnique({ where: { key: "draft_watch" } }).catch(() => null);
  const first = !row;
  let known: Record<string, string> = {};
  try { known = JSON.parse(row?.value || "{}"); } catch { known = {}; }
  const drafts = await recentDrafts();
  const next: Record<string, string> = {};
  let told = 0;
  for (const d of drafts) {
    const fresh = Date.now() - new Date(d.createdAt).getTime() < 45 * 86400_000;
    if (d.status !== "COMPLETED") {
      if (fresh) next[d.id] = d.name;
      continue;
    }
    if (!known[d.id] || first) continue; // was never seen open (or the first run): nothing to announce
    const paid = d.order?.displayFinancialStatus ?? "";
    const sum = `${Number(d.totalPriceSet.shopMoney.amount).toFixed(2)} €`;
    const whoIs = d.customer?.displayName || d.email || "клиент";
    await notifyTeam(
      /PAID|PARTIALLY_PAID|AUTHORIZED/.test(paid)
        ? `💶 Оплачено: ${whoIs} · ${sum} · счёт ${d.name} стал заказом ${d.order?.name ?? ""}. Можно собирать.`
        : `🧾 Счёт ${d.name} (${whoIs}, ${sum}) оформлен как заказ ${d.order?.name ?? ""}, оплата: ${paid || "не отмечена"}.`,
    );
    told++;
    // PM 12.11: the invoice is paid -> the open "check the payment of ..." tasks about this client are done (the shift list kept showing one)
    if (/PAID|PARTIALLY_PAID|AUTHORIZED/.test(paid)) {
      const keys = [d.name, d.email, ...(d.customer?.displayName || "").split(/\s+/)].map((k) => String(k || "").toLowerCase()).filter((k) => k.length >= 4);
      const open = await prisma.teamTask.findMany({ where: { status: "open" } }).catch(() => []);
      for (const t of open) {
        const text = t.text.toLowerCase();
        if (/оплат|счёт|счет|invoice|payment/.test(text) && keys.some((k) => text.includes(k)))
          await prisma.teamTask.update({ where: { id: t.id }, data: { status: "done", doneAt: new Date(), doneBy: "Дейси (оплата пришла)" } }).catch(() => null);
      }
    }
  }
  // a draft that left the 50 newest keeps being watched only while it is in the list; that is enough for open invoices
  const value = JSON.stringify(next);
  if (first || value !== row?.value) await prisma.setting.upsert({ where: { key: "draft_watch" }, update: { value }, create: { key: "draft_watch", value } });
  return told;
}

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
    prisma.chatSession.findMany({ where: { topic: "collab", reviewedAt: null, createdAt: { gte: new Date(Date.now() - 10 * 86400e3) } }, select: { customerName: true, customerEmail: true, title: true, channel: true, _count: { select: { messages: { where: { role: "user" } } } } } }),
    prisma.teamTask.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" } }),
    paidToShip(),
    deisiUnpaid(),
  ]);
  // PM 21.11 (Юлия: «заявка Elina Lehtsalu, её ещё никто не открыл - что ты имеешь ввиду?»): Arina had answered the collaboration from Gmail,
  // but skipped (collab) threads are not watched for our replies, so reviewedAt stayed empty and the line came back every shift.
  // A collaborator who wrote again = we answered her; only a first, unanswered offer of the last 10 days is listed.
  collabs.splice(0, collabs.length, ...collabs.filter((c) => c._count.messages <= 1));
  const seenSession = new Set<string>();
  const people = handoffs
    .filter((h) => h.session?.topic == null)
    .filter((h) => (h.sessionId ? !seenSession.has(h.sessionId) && Boolean(seenSession.add(h.sessionId)) : true))
    .sort((a, b) => Number(/^🔴/.test(b.summary)) - Number(/^🔴/.test(a.summary)));
  const holds = await orderHolds();
  const held = ship.filter((s) => holds[s.split(" · ")[0]]);
  ship.splice(0, ship.length, ...ship.filter((s) => !holds[s.split(" · ")[0]]));
  const lines: string[] = [];
  if (people.length) lines.push("🙋 Ждут ответа человека:\n" + people.map((h, i) => `${String.fromCharCode(65 + (i % 26))}. ${/^🔴/.test(h.summary) ? "🔴 СРОЧНО · " : ""}${who(h.session)} · ${CHANNEL_RU[h.channel] ?? h.channel} · ждёт ${ago(h.createdAt)}\n  ${h.summary.replace(/^🔴\s*/, "").slice(0, 160)}`).join("\n"));
  if (ship.length) lines.push("📦 Оплачены, отправить:\n" + ship.map((s) => `• ${s}`).join("\n"));
  if (held.length) lines.push("⏳ Ждут поставку / согласовано с клиентом:\n" + held.map((s) => `• ${s} — ${holds[s.split(" · ")[0]]}`).join("\n"));
  if (tasks.length) lines.push("📝 Задачи:\n" + tasks.map((t, i) => `${i + 1}. ${t.text}${t.by ? ` (${t.by})` : ""} · ${ago(t.createdAt)}`).join("\n") );
  if (drafts.length) lines.push("🔁 Фоллоу-апы, отправьте сами:\n" + drafts.map((f) => `• ${who(f.session)}: ${f.text.slice(0, 100)}`).join("\n"));
  if (unpaid.length) lines.push("🧾 Заказы Дейси не оплачены:\n" + unpaid.map((s) => `• ${s}`).join("\n"));
  if (collabs.length) lines.push(`🤝 Сотрудничество, не просмотрено: ${collabs.map((c) => who({ ...c, title: c.title })).join(", ")}`);
  const done = (tasks.length || people.length) ? "\n\nСделали — нажмите кнопку под этим сообщением (✅ 1 — задача 1, ✅ A — клиент A получил ответ)." : "";
  const text = lines.length ? `🗒 Задачи смены на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Tallinn", day: "2-digit", month: "2-digit" })}\n\n${lines.join("\n\n")}${done}\n\nВсё в Shopify → Приложения → Deisi.` : "🗒 Задачи смены: всё сделано, никто не ждёт ✨";
  // owner 06.11 (like the studio): tasks are ticked with buttons under the list
  const buttons = [
    ...tasks.slice(0, 20).map((t, i) => ({ text: `✅ ${i + 1}`, callback_data: `td:${t.id}` })),
    ...people.slice(0, 20).map((h, i) => ({ text: `✅ ${String.fromCharCode(65 + (i % 26))}`, callback_data: `hd:${h.id}` })),
  ];
  const keyboard: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < buttons.length; i += 5) keyboard.push(buttons.slice(i, i + 5));
  return { text, keyboard };
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
  const longWait = await prisma.handoff.findMany({ where: { status: "open", createdAt: { lte: new Date(Date.now() - 86400_000) }, session: { topic: null } }, include: { session: { select: { customerName: true, customerEmail: true, title: true } } }, orderBy: { createdAt: "asc" } });
  const viaGmail = await prisma.message.count({ where: { createdAt: { gte: since }, role: "assistant", meta: { path: ["via"], equals: "gmail" } } });
  const lines = [
    `🌙 Итоги дня в магазине`,
    `💬 Новые переписки: ${Object.entries(byCh).map(([c, n]) => `${CHANNEL_RU[c] ?? c} ${n}`).join(", ") || "нет"}`,
    `🤖 Ответов Дейси: ${deisi} · ответов команды: ${team}`,
    `🙋 Передано человеку: ${handoffsNew} (закрыто ${handoffsDone}) · сейчас ждут: ${open}`,
    viaGmail ? `✉️ Из них ответов команды из Gmail: ${viaGmail}` : "",
    longWait.length ? `⏳ Ждут дольше суток (${longWait.length}): ${[...new Set(longWait.map((h) => `${/^🔴/.test(h.summary) ? "🔴 " : ""}${who(h.session)} — ${ago(h.createdAt)}`))].join("; ")}` : "",
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

/**
 * During showroom hours: clients who wait for a person 60+ min -> ONE grouped reminder (PM 11.11: six separate «⏰» messages
 * came in the same minute as the shift list). Each request is reminded at most twice (after 1 h, then 3+ h later), urgent ones first;
 * nothing is sent within an hour after the shift list, which already shows everybody who waits.
 */
export async function remindWaiting() {
  if (!showroomOpen()) return 0;
  const now = Date.now();
  const t = tallinn();
  const list = await prisma.setting.findUnique({ where: { key: `shift_list:${t.date}` } }).catch(() => null);
  if (list && now - new Date(list.value).getTime() < 60 * 60_000) return 0;
  if (t.dow !== 0 && t.hour === 15 && t.minute < 30 && !list) return 0; // the shift list goes out in this tick
  // PM 18.11: Deisi's questions to the team (ask_team) stayed unanswered for a day (a fitting time for 23.11, «hooks or eyelets?»)
  // while the client waited in the chat -> one reminder per question, sent as a new message: a reply to it answers the question.
  const asked = await prisma.staffQuestion.findMany({
    where: { status: "asked", createdAt: { lte: new Date(now - 60 * 60_000), gte: new Date(now - 3 * 86400_000) } },
    orderBy: { createdAt: "asc" },
    take: 5,
  }).catch(() => []);
  for (const q of asked) {
    if (!(await once(`sq_remind:${q.id}`))) continue;
    const id = await notifyTeamId(`⏰ Клиент ждёт ответа на вопрос Дейси (${ago(q.createdAt)}). Ответьте на ЭТО сообщение — Дейси сама напишет клиенту:\n${q.question.slice(0, 700)}`);
    if (id) await prisma.staffQuestion.update({ where: { id: q.id }, data: { tgMessageId: id } }).catch(() => {});
  }
  const open = await prisma.handoff.findMany({
    where: { status: "open", reminders: { lt: 2 }, createdAt: { lte: new Date(now - 60 * 60_000), gte: new Date(now - 5 * 86400_000) } },
    orderBy: { createdAt: "asc" },
    include: { session: { select: { id: true, customerName: true, customerEmail: true, title: true, topic: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, meta: true, createdAt: true } } } } },
  });
  const due = open.filter((h) => {
    if (h.session?.topic) return false;
    const last = h.session?.messages[0];
    const meta = (last?.meta ?? {}) as { by?: string; engine?: string };
    if (last && last.role === "assistant" && (meta.by === "team" || meta.engine === "team") && last.createdAt > h.createdAt) return false; // the team answered
    return !(h.remindedAt && now - h.remindedAt.getTime() < 3 * 3600_000);
  });
  if (!due.length) return 0;
  due.sort((a, b) => Number(/^🔴/.test(b.summary)) - Number(/^🔴/.test(a.summary)));
  const lines = due.map((h) => `${/^🔴/.test(h.summary) ? "🔴" : "•"} ${who(h.session)} · ${CHANNEL_RU[h.channel] ?? h.channel} · ждёт ${ago(h.createdAt)}\n  ${h.summary.replace(/^🔴\s*/, "").replace(/\s+/g, " ").slice(0, 140)}`);
  await notifyTeam(`⏰ Ждут ответа человека (${due.length}):\n${lines.join("\n")}\n\nОтветили — напишите мне «ответили …» или ответьте из Gmail, закрою сама.`);
  await prisma.handoff.updateMany({ where: { id: { in: due.map((h) => h.id) } }, data: { reminders: { increment: 1 }, remindedAt: new Date() } });
  return due.length;
}

async function once(key: string) {
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch {
    return false; // already done today
  }
}

const SKILLS_1111 = `✨ Дейси: что я теперь умею (по сегодняшнему разговору с Юлей)

• Закрываю запросы сама. Напишите «закрой запрос Анны» или «я ответила Negin» — закрою, кнопки нажимать не нужно.
• Вижу ответы из Gmail. Ответили клиенту прямо из почты — в течение ~5 минут запрос закроется сам, напоминаний «клиент ждёт» не будет.
• Слежу за оплатой счетов. Когда клиент оплатит счёт (draft #D…), сама напишу сюда «💶 Оплачено: …». Просить «сообщи, когда оплатит» больше не нужно.
• Вижу черновики и ищу заказы по имени и e-mail: «проверь #D516», «заказ Роличевой», «заказы на anna@…».
• Помню договорённости по заказам. Напишите «#1845 ждём поставку, с клиентом согласовано» — заказ уйдёт из «отправить» в отдельную строку и я перестану о нём напоминать. Когда можно отправлять: «#1845 можно отправлять».
• Письма от наших поставщиков и партнёров вношу в список задач.
• Отвечаю короче: одной строкой «Готово: …» или что именно нужно от вас.

Если что-то из этого не сработает — напишите здесь, поправлю.`;

const FEEDBACK_1811 = `📋 Обратная связь по работе магазина за неделю (11–18.11)

Спасибо, девочки 💛
• Шоурум: 19 продаж за неделю оформлены заказами в Shopify — всё учтено, так и продолжаем.
• Онлайн-заказы уходят быстро, обычно в тот же или на следующий день.
• Арина сама проверила у покупательницы подарочной карты, дошло ли письмо с картой. Это и есть хороший сервис 👏

Что улучшить:
1. Вопросы Дейси в этом чате. Когда Дейси спрашивает про клиентку (время примерки, наличие, детали товара), клиентка в это время ждёт ответа в чате на сайте. Отвечайте ответом (reply) на сообщение Дейси, лучше в течение часа — она сама напишет клиентке. Сейчас без ответа:
   • примерка Camilla в понедельник 23.11 (просила после 10:00, а шоурум в понедельник открыт с 15:00 — предложите ей время);
   • на чём шнуровка у сапог Flamingo-1020 и 1021FS: крючки или люверсы?
2. Предзаказы старше 10 дней: #1839 (5.11), #1844 (6.11), #1862 (9.11), #1867 (10.11). Проверьте поставку и напишите клиенткам ориентировочную дату, чтобы они не волновались.`;

async function closeGiftCardChat2111() {
  const re = /подарочн|gift ?card|kinkekaar/i;
  const waiting = await prisma.chatSession.findMany({
    where: { needsHuman: true, updatedAt: { gte: new Date("2026-11-17T00:00:00Z") } },
    select: { id: true, title: true, handoffs: { where: { status: "open" }, select: { summary: true } }, messages: { where: { role: "user" }, orderBy: { createdAt: "desc" }, take: 6, select: { content: true } } },
  });
  const hits = waiting.filter((w) => re.test(`${w.title} ${w.handoffs.map((h) => h.summary).join(" ")} ${w.messages.map((m) => m.content).join(" ")}`));
  let text: string;
  if (hits.length === 1) {
    await closeWaiting(hits[0].id, "Юлия");
    text = "Юлия, готово: закрыла чат «не проходит код подарочной карты».";
  } else if (!hits.length) text = "Юлия, чат «не проходит код подарочной карты» уже закрыт, в ожидании его нет.";
  else text = `Юлия, по подарочной карте ждут ${hits.length} чата: ${hits.map((h) => `«${h.title.slice(0, 50)}»`).join(", ")}. Какой закрыть?`;
  const [target, topic] = await Promise.all([telegramTarget(), prisma.setting.findUnique({ where: { key: "tg_bot_thread_id" } })]);
  if (!target) return;
  const thread = Number(topic?.value) || target.threadId;
  const res = await tg("sendMessage", { chat_id: target.chatId, text, ...(thread ? { message_thread_id: thread } : {}) });
  console.log("[team] giftcard chat", hits.length, Boolean(res.ok));
}

/** Every 5 minutes: shift list at 15:00 (Mon-Sat), evening summary at 21:00, reminders while the showroom is open. */
export function startTeamTimer() {
  const tick = async () => {
    try {
      const t = tallinn();
      if (t.dow !== 0 && t.hour === 15 && t.minute < 30 && (await once(`shift_list:${t.date}`))) {
        const v = await shiftList();
        await notifyTeamId(v.text, undefined, v.keyboard);
      }
      if (t.hour === 21 && t.minute < 30 && (await once(`digest:${t.date}`))) await notifyTeam(await eveningDigest());
      // Юлия 11.11 16:21: «#1845 Edgar Kurm … ожидаем поставку, с клиентом согласовано» (said before order_hold existed)
      if (await once("seed:order_wait_1845")) await setOrderHold("1845", "ждём поставку, с клиентом согласовано (Юлия 11.11)");
      // owner 11.11: «пошли отчет в чат магазина о новых навыках» (once)
      if (await once("report:skills_2026-11-11")) await notifyTeam(SKILLS_1111);
      if (await once("fix:paid_task_1871")) await prisma.teamTask.updateMany({ where: { status: "open", text: { contains: "Роличев" } }, data: { status: "done", doneAt: new Date(), doneBy: "Дейси (оплата пришла, #1871)" } });   // PM 12.11: #D516 was paid 11.11, the task stayed in the shift list
      // owner 18.11: «отправь админам магазина в телеграм обратную связь о их работе» (once)
      if (await once("report:team_feedback_2026-11-18")) await notifyTeam(FEEDBACK_1811);
      // owner 18.11 «отправляй такую обратную связь еженедельно»: every Wednesday ~19:30 Tallinn (the first one was sent by hand on 18.11)
      if (t.dow === 3 && t.hour === 19 && t.minute >= 30 && t.date !== "2026-11-18" && (await once(`report:team_feedback_week:${t.date}`))) await notifyTeam(await weeklyTeamFeedback());
      // owner 18.11: the hold task from Julia's TEST call (Pole Grip + Seamless shorts L/XL, 18.11 ~17:19) is a test -> close it
      if (await once("fix:test_task_julia_1811")) await prisma.teamTask.updateMany({ where: { status: "open", createdAt: { gte: new Date("2026-11-18T15:00:00Z"), lte: new Date("2026-11-18T15:40:00Z") } }, data: { status: "done", doneAt: new Date(), doneBy: "тест (Алисия 18.11)" } });
      // owner 21.11 «ответь сама Юле»: Юлия 16:57-16:59 asked twice to close the chat «не проходит код подарочной карты» (client ordered) and got
      // «Слишком сложный вопрос…» -> close it and answer her in the «Бот» topic (once)
      if (await once("fix:close_giftcard_chat_2026-11-21")) await closeGiftCardChat2111().catch((e) => console.error("[team] giftcard chat", e));
      await remindWaiting();
      await import("./callReport").then((m) => m.missedCalls()).catch((e) => console.error("[missed-call]", e));   // PM 21.11
      await watchDraftPayments().catch((e) => console.error("[draft watch]", e));
    } catch (e) {
      console.error("[team timer]", e);
    }
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 5 * 60_000);
}
