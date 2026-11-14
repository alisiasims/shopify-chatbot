/**
 * Instagram stories of the shop @deesse_style (owner 14.11: «настроить дейси магазина вести сторис, работай как профессиональный
 * СММ уровня 2026 года»; «3–4 в день, но не каждый день — лучше 3 раза в неделю: пн, ср, вскр»; «2 недели одобряю, потом сама»).
 *
 *  - Planner: the evening before a story day (Sun, Tue, Sat at 18:00 Tallinn) Deisi plans 3-4 story frames for Mon / Wed / Sun
 *    from the live catalog, running promotions, the season and what was posted before (no repeats); prices come from the catalog,
 *    never from the model.
 *  - Images: /api/smm/img/<id> renders a 1080x1920 JPEG (brand look: dark, gold, «We create QUEENS!»).
 *  - Approval: each frame goes to the owner in Telegram (her private chat with the bot after «/smm <code>», else the team chat)
 *    with ✅ / ❌ / 🔁. From Setting smm_auto_from (default 2026-11-30, two weeks) frames are approved by themselves.
 *  - Publishing: at the slot time an approved frame is published as a STORY through the Instagram Graph API with the Page token.
 *    If Instagram refuses (no instagram_content_publish permission on the token, etc.) the frame is sent to the team as a file
 *    «опубликуйте вручную» and the error is kept.
 * Instagram does not allow interactive stickers (link, poll, question) through the API, so a CTA is written on the picture
 * («пишите SIZE в директ» - Deisi answers the DM).
 */
import { prisma } from "@/lib/prisma";
import { callClaude, hasApiKey, type ContentBlock } from "@/lib/llm";
import { appUrl, tg, teamLog } from "@/lib/notify";
import { getCatalog } from "./catalog";
import { activePromotions } from "./shopify";

export type StoryData = {
  layout: "product" | "collage" | "text";
  kicker: string; // small line on top, e.g. NEW IN
  headline: string; // 2-6 words
  sub?: string; // one short line (ET or RU)
  body?: string; // text layout: up to ~180 characters
  cta?: string; // e.g. «deesse.ee» / «Kirjuta DM: SIZE»
  products: { handle: string; title: string; image: string | null; price: number; compareAt: number | null; url: string }[];
  showPrice: boolean;
  pillar: string;
  why?: string; // the planner's reason (for the owner)
};

const SLOTS = ["09:00", "12:30", "19:00", "21:00"];
const STORY_DAYS = [1, 3, 0]; // Mon, Wed, Sun (owner 14.11)
const IG_API = "https://graph.facebook.com/v21.0";

function tallinn(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tallinn", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), hour: Number(get("hour")), minute: Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}`, hm: `${get("hour")}:${get("minute")}` };
}
const setting = async (key: string) => (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value ?? null;
async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
async function once(key: string) {
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch {
    return false;
  }
}

// ---------- planning ----------
const SYSTEM = `You are the SMM lead of DEESSE (deesse.ee, Instagram @deesse_style), a Tallinn shop of pole dance shoes (Pleaser and others), dancewear, sporty glam, lingerie, swimwear and accessories, with a showroom; sister brand of the DEESSE pole dance studio. Brand voice: confident, feminine, empowering, a little playful («Sculpted. Refined. Powerful.», «We create QUEENS!»). Audience: women in Tallinn / Estonia who dance pole, exotic, high heels; bilingual (Estonian and Russian), English is the brand language.
You plan Instagram STORIES like a top 2026 SMM professional: each frame has ONE idea, very little text (readable in 2 seconds), a strong product visual, a clear next step. A day's sequence tells a mini-story (hook -> value -> proof/offer -> action), not 4 random ads. Mix pillars over the week: NEW IN / bestsellers, HOW TO CHOOSE (heel height for beginners, sizing, care), LOOKS (shoes + outfit for a class or a show), SOCIAL PROOF / community (why dancers love it), OFFERS (only real running promotions given below), MOTIVATION for the dance week. Seasonal hooks when real (e.g. Black Friday week, Christmas gifts, gift cards).
Interactive stickers cannot be added (API). The action is written on the picture: «deesse.ee», or a DM keyword like «Kirjuta DM: SIZE» / «Напиши в директ SIZE» (our assistant answers DMs), or «Showroom: <address only if given>».
Language: the headline in English (short, brand style) OR in Estonian; the sub line in Russian or Estonian - vary across the frames so both audiences feel addressed. Never mix three languages in one frame. No hashtags. Max 1 emoji per frame.
Rules: use ONLY products from the catalog list (by handle), in stock; never write prices yourself (the picture shows the real price from the catalog when showPrice is true); never invent discounts, codes or promotions - only the ones listed as running; no health claims; no competitor names.
Answer ONLY with JSON: {"frames":[{"slot":"HH:MM","pillar":"...","layout":"product|collage|text","products":["handle",...],"kicker":"max 18 chars","headline":"max 28 chars","sub":"max 60 chars","body":"text layout only, max 160 chars","cta":"max 34 chars","showPrice":true|false,"why":"one sentence for the owner in Russian"}]}
layout product = one product (1 handle); collage = 2-3 products (a look / a choice); text = a tip or a message (0-1 product as a small picture).`;

async function catalogBrief() {
  const all = await getCatalog();
  const items = all.filter((p) => p.inStock && p.image && p.priceMin > 0);
  // a varied sample: discounted first, then the rest shuffled (the catalog is large)
  const disc = items.filter((p) => p.compareAt && p.compareAt > p.priceMin);
  const rest = items.filter((p) => !disc.includes(p)).sort(() => Math.random() - 0.5);
  const pick = [...disc.slice(0, 25), ...rest.slice(0, 90)];
  return pick.map((p) => `${p.handle} | ${p.title} | ${p.productType || "-"} | ${(p.tags || []).slice(0, 6).join(",")} | ${p.priceMin}€${p.compareAt && p.compareAt > p.priceMin ? ` (was ${p.compareAt}€)` : ""}`).join("\n");
}

async function buildFrames(day: string, dow: number, slots: string[]) {
  const perDay = slots.length;
  const promos = await activePromotions().catch(() => null);
  const history = await prisma.storyPost.findMany({ where: { createdAt: { gte: new Date(Date.now() - 28 * 86400_000) } }, orderBy: { createdAt: "desc" }, take: 40 });
  const hist = history.map((h) => { const d = h.data as unknown as StoryData; return `${h.day} ${h.slot} ${h.status} ${d.pillar}: ${d.headline} [${d.products.map((p) => p.handle).join(",")}]`; }).join("\n") || "(nothing yet - this is the first week)";
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow];
  const user = `Plan the stories for ${weekday} ${day} (Tallinn). Slots: ${slots.join(", ")} (${perDay} frame${perDay > 1 ? "s; 3 is fine if the story is stronger" : " - a REPLACEMENT for a frame the owner did not like (status rejected below): make it clearly different"}).
Stories are posted on Monday, Wednesday and Sunday only.
RUNNING PROMOTIONS: ${promos?.active.length ? promos.active.join("; ") : "none time-limited"}${promos?.upcoming.length ? `; COMING: ${promos.upcoming.join("; ")}` : ""}. Permanent: free parcel-locker shipping over 175€, 10% off orders over 250€, 10% off the next order for a story with our tag.
POSTED / PLANNED BEFORE (do not repeat products or ideas from the last 2 weeks; «rejected» = the owner did not like it):
${hist}
CATALOG (handle | title | type | tags | price):
${await catalogBrief()}`;
  const res = await callClaude({ system: SYSTEM, messages: [{ role: "user", content: user }], model: process.env.SHOP_MODEL || "claude-opus-5-5", maxTokens: 2500, temperature: 0.8 });
  const text = res.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
  let plan: { frames?: Record<string, unknown>[] } = {};
  try { plan = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return []; }
  const catalog = await getCatalog();
  const byHandle = new Map(catalog.map((p) => [p.handle, p]));
  const out: { slot: string; data: StoryData }[] = [];
  for (const [i, f] of (plan.frames ?? []).slice(0, perDay).entries()) {
    const handles = (Array.isArray(f.products) ? f.products : []).map(String).filter((h) => byHandle.get(h)?.inStock).slice(0, 3);
    const layout = (["product", "collage", "text"].includes(String(f.layout)) ? String(f.layout) : "product") as StoryData["layout"];
    if ((layout === "product" && handles.length < 1) || (layout === "collage" && handles.length < 2)) continue;   // an unknown product -> skip the frame
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const data: StoryData = {
      layout, kicker: s(f.kicker, 22), headline: s(f.headline, 34), sub: s(f.sub, 70), body: s(f.body, 180), cta: s(f.cta, 40) || "deesse.ee",
      showPrice: f.showPrice !== false && layout !== "text", pillar: s(f.pillar, 30), why: s(f.why, 200),
      products: handles.map((h) => { const p = byHandle.get(h)!; return { handle: h, title: p.title, image: p.image ?? null, price: p.priceMin, compareAt: p.compareAt && p.compareAt > p.priceMin ? p.compareAt : null, url: p.url }; }),
    };
    const slot = slots.includes(String(f.slot)) ? String(f.slot) : slots[i] ?? slots[slots.length - 1];
    if (!out.some((o) => o.slot === slot)) out.push({ slot, data });
  }
  return out;
}

export async function planDay(day: string, dow: number) {
  if (!hasApiKey()) return { ok: false, reason: "no api key" };
  if (await prisma.storyPost.count({ where: { day } })) return { ok: false, reason: "already planned" };
  const perDay = Math.min(4, Math.max(1, Number(await setting("smm_per_day")) || 4));
  const frames = await buildFrames(day, dow, SLOTS.slice(0, perDay));
  if (!frames.length) return { ok: false, reason: "the plan came back empty" };
  const auto = await autoMode();
  for (const f of frames) {
    const r = await prisma.storyPost.create({ data: { day, slot: f.slot, status: auto ? "approved" : "pending", data: f.data as unknown as object, decidedBy: auto ? "auto" : null } });
    await sendCard(r.id).catch((e) => console.error("[smm] card", e));
  }
  return { ok: true, count: frames.length };
}

// the planner's day for each evening: Sun 18:00 -> Mon, Tue 18:00 -> Wed, Sat 18:00 -> Sun
function nextStoryDay() {
  const t = tallinn();
  const tomorrow = tallinn(new Date(Date.now() + 86400_000));
  return STORY_DAYS.includes(tomorrow.dow) ? { day: tomorrow.date, dow: tomorrow.dow, now: t } : null;
}

async function autoMode() {
  const v = await setting("smm_auto");
  if (v === "on") return true;
  if (v === "off") return false;
  const from = (await setting("smm_auto_from")) || "2026-11-30";
  return tallinn().date >= from;
}

// ---------- approval ----------
async function approverChat() {
  return setting("smm_owner_chat");
}
async function toOwner(text: string) {
  const owner = await approverChat();
  if (owner) await tg("sendMessage", { chat_id: owner, text });
}
function caption(r: { day: string; slot: string; status: string }, d: StoryData) {
  const dm = r.day.split("-").reverse().slice(0, 2).join(".");
  return `📲 Сторис @deesse_style · ${dm} ${r.slot} · ${d.pillar}\n${d.headline}${d.sub ? `\n${d.sub}` : ""}${d.products.length ? `\n🛍 ${d.products.map((p) => p.title).join(" · ")}` : ""}${d.why ? `\n💡 ${d.why}` : ""}${r.status === "approved" ? "\n✅ одобрено, выйдет по расписанию" : ""}`;
}
export async function sendCard(id: string) {
  const r = await prisma.storyPost.findUnique({ where: { id } });
  if (!r) return;
  const d = r.data as unknown as StoryData;
  const img = `${appUrl()}/api/smm/img/${r.id}?v=${r.updatedAt.getTime()}`;
  const keyboard = r.status === "pending" ? [[{ text: "✅ Публиковать", callback_data: `sm:ok:${r.id}` }, { text: "❌ Нет", callback_data: `sm:no:${r.id}` }, { text: "🔁 Другой вариант", callback_data: `sm:re:${r.id}` }]] : [];
  const owner = await approverChat();   // frames go ONLY to the owner's private chat, never to the team chat (owner 10.11: admins do not hear about new abilities)
  if (!owner) return;
  const target = { chatId: owner, threadId: null as number | null };
  const res = await tg("sendPhoto", { chat_id: target.chatId, photo: img, caption: caption(r, d).slice(0, 1000), ...(target.threadId ? { message_thread_id: target.threadId } : {}), ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  const mid = (res.result as { message_id?: number } | undefined)?.message_id;
  if (mid) await prisma.storyPost.update({ where: { id }, data: { tgMessageId: mid } });
}

/** Telegram button sm:ok|no|re:<id>. Only the owner's private chat, or a person named in smm_approvers (default «Alisia») in the team chat. */
export async function smmCallback(cb: { id: string; data?: string; from?: { id?: number; first_name?: string; last_name?: string }; message?: { message_id: number; chat: { id: number } } }) {
  const [, act, id] = String(cb.data || "").split(":");
  const owner = await approverChat();
  const names = ((await setting("smm_approvers")) || "Alisia").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ");
  const allowed = (owner && String(cb.message?.chat.id) === owner) || names.some((n) => who.toLowerCase().includes(n));
  if (!allowed) return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Сторис одобряет владелица" });
  const r = await prisma.storyPost.findUnique({ where: { id } });
  if (!r || r.status !== "pending") return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Уже решено" });
  const chat = cb.message?.chat.id;
  if (act === "ok" || act === "no") {
    await prisma.storyPost.update({ where: { id }, data: { status: act === "ok" ? "approved" : "rejected", decidedBy: who || "owner" } });
    if (chat && cb.message) await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: act === "ok" ? `✅ Выйдет ${r.slot}` : "❌ Не публикуем", callback_data: "sm:x:0" }]] } });
    await teamLog("in", `[сторис ${r.day} ${r.slot}: ${act === "ok" ? "одобрено" : "отклонено"}]`, who);
    return tg("answerCallbackQuery", { callback_query_id: cb.id, text: act === "ok" ? `Выйдет в ${r.slot}` : "Не публикуем" });
  }
  if (act === "re") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Делаю другой вариант…" });
    await prisma.storyPost.update({ where: { id }, data: { status: "rejected", decidedBy: `${who || "owner"} (заменить)` } });
    if (chat && cb.message) await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: "🔁 Заменён", callback_data: "sm:x:0" }]] } });
    await replanOne(r.id).catch((e) => console.error("[smm] replan", e));
  }
}

async function replanOne(oldId: string) {
  const old = await prisma.storyPost.findUnique({ where: { id: oldId } });
  if (!old) return;
  const [y, m, d] = old.day.split("-").map(Number);
  const frames = await buildFrames(old.day, new Date(Date.UTC(y, m - 1, d)).getUTCDay(), [old.slot]);
  if (!frames.length) return toOwner(`Не получилось сделать другой вариант сторис ${old.day} ${old.slot}`);
  const r = await prisma.storyPost.create({ data: { day: old.day, slot: old.slot, status: "pending", data: frames[0].data as unknown as object } });
  await sendCard(r.id);
}

// ---------- publishing ----------
async function igAccount() {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return null;
  const id = process.env.META_IG_ID || (await setting("ig_account_id"));
  if (id) return id;
  const pageId = process.env.META_PAGE_ID || "104400848423200";
  const r = await fetch(`${IG_API}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`);
  const j = (await r.json().catch(() => ({}))) as { instagram_business_account?: { id?: string } };
  return j.instagram_business_account?.id ?? null;
}

async function publishStory(id: string) {
  const r = await prisma.storyPost.findUnique({ where: { id } });
  if (!r || r.status !== "approved") return;
  await prisma.storyPost.update({ where: { id }, data: { status: "publishing" } });
  const token = process.env.META_PAGE_TOKEN || "";
  const img = `${appUrl()}/api/smm/img/${r.id}.jpg`;
  try {
    const ig = await igAccount();
    if (!ig || !token) throw new Error("no Instagram account / token");
    const c = await fetch(`${IG_API}/${ig}/media`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ image_url: img, media_type: "STORIES", access_token: token }) });
    const cj = (await c.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!cj.id) throw new Error(cj.error?.message || `container HTTP ${c.status}`);
    for (let i = 0; i < 10; i++) {   // wait for the container (images are usually ready at once)
      const s = await fetch(`${IG_API}/${cj.id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
      const sj = (await s.json().catch(() => ({}))) as { status_code?: string };
      if (sj.status_code === "FINISHED") break;
      if (sj.status_code === "ERROR") throw new Error("Instagram could not process the image");
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    const p = await fetch(`${IG_API}/${ig}/media_publish`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: cj.id, access_token: token }) });
    const pj = (await p.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!pj.id) throw new Error(pj.error?.message || `publish HTTP ${p.status}`);
    await prisma.storyPost.update({ where: { id }, data: { status: "published", igMediaId: pj.id, publishedAt: new Date(), error: null } });
    await teamLog("out", `[сторис ${r.day} ${r.slot} опубликована]`, "Deisi");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.storyPost.update({ where: { id }, data: { status: "failed", error: msg.slice(0, 500) } });
    console.error("[smm] publish", msg);
    // the frame is not lost: the owner gets it to post by hand
    const owner = await approverChat();
    const target = owner ? { chatId: owner, threadId: null as number | null } : null;
    if (target) await tg("sendDocument", { chat_id: target.chatId, document: img, caption: `⚠️ Instagram не принял сторис ${r.slot} автоматически (${msg.slice(0, 150)}). Опубликуйте эту картинку вручную в @deesse_style.`, ...(target.threadId ? { message_thread_id: target.threadId } : {}) });
  }
}

// ---------- timer ----------
export function startSmmTimer() {
  const tick = async () => {
    try {
      if ((await setting("smm_on")) === "off") return;
      if (!(await approverChat())) return;   // nothing runs until the owner has registered her private chat («/smm <code>»)
      const t = tallinn();
      // planning: the evening before a story day
      const next = nextStoryDay();
      if (next && t.hour >= 18 && t.hour < 22 && (await once(`smm_plan:${next.day}`))) {
        const res = await planDay(next.day, next.dow).catch((e) => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
        if (!res.ok && res.reason !== "already planned") await toOwner(`⚠️ Сторис на ${next.day} не спланированы: ${res.reason}`);
      }
      // a story day whose evening was missed (deploy, restart): plan in the morning
      if (STORY_DAYS.includes(t.dow) && t.hour >= 7 && t.hour < 11 && !(await prisma.storyPost.count({ where: { day: t.date } })) && (await once(`smm_plan_late:${t.date}`)))
        await planDay(t.date, t.dow).catch((e) => console.error("[smm] late plan", e));
      // publishing
      const due = await prisma.storyPost.findMany({ where: { day: t.date, status: "approved", slot: { lte: t.hm } } });
      for (const r of due) await publishStory(r.id);
      // pending frames whose time passed by more than 2 h are skipped (not approved in time)
      const late = await prisma.storyPost.findMany({ where: { day: { lte: t.date }, status: "pending" } });
      for (const r of late) {
        const [hh, mm] = r.slot.split(":").map(Number);
        const passed = r.day < t.date || t.hour * 60 + t.minute - (hh * 60 + mm) > 120;
        if (passed) await prisma.storyPost.update({ where: { id: r.id }, data: { status: "skipped" } });
      }
    } catch (e) {
      console.error("[smm] tick", e);
    }
  };
  setTimeout(() => void tick(), 120_000);
  setInterval(() => void tick(), 5 * 60_000);
  void checkPublishPermission();
}

/** On start: does the Page token allow publishing (instagram_content_publish)? Logged + Setting smm_publish_ok. */
async function checkPublishPermission() {
  try {
    const token = process.env.META_PAGE_TOKEN;
    const secret = process.env.META_APP_SECRET;
    const app = process.env.META_APP_ID || "1640472837550030";
    if (!token || !secret) return;
    const r = await fetch(`${IG_API}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${app}|${secret}`)}`);
    const j = (await r.json().catch(() => ({}))) as { data?: { scopes?: string[]; is_valid?: boolean; expires_at?: number } };
    const scopes = j.data?.scopes ?? [];
    const ok = scopes.includes("instagram_content_publish");
    console.log(`[smm] token valid=${j.data?.is_valid} publish=${ok} scopes=${scopes.join(",")}`);
    await setSetting("smm_publish_ok", `${ok ? "yes" : "no"} · ${new Date().toISOString()} · ${scopes.join(",")}`);
  } catch (e) {
    console.error("[smm] permission check", e);
  }
}

/** Private chat commands: «/smm <code>» makes this chat the approver (code = SMM_APPROVER_CODE), «/smm status», «/smm auto on|off». */
export async function smmCommand(chatId: number, text: string, isPrivate: boolean) {
  const [, arg, val] = text.trim().split(/\s+/);
  const reply = (t: string) => tg("sendMessage", { chat_id: chatId, text: t });
  const code = process.env.SMM_APPROVER_CODE || "";
  if (isPrivate && arg && code && arg === code) {
    await setSetting("smm_owner_chat", String(chatId));
    return reply("✅ Готово: сторис @deesse_style на одобрение будут приходить сюда.\nКоманды: /smm plan — сделать сторис на ближайший день сейчас · /smm status · /smm auto on|off · /smm off|on");
  }
  const owner = await approverChat();
  if (String(chatId) !== owner) return reply("Эта команда только для владелицы.");
  if (arg === "auto" && (val === "on" || val === "off")) {
    await setSetting("smm_auto", val);
    return reply(val === "on" ? "Сторис публикуются без одобрения." : "Сторис снова приходят на одобрение.");
  }
  if (arg === "plan") {   // plan the next story day now (Mon / Wed / Sun) and send the frames for approval
    const t0 = tallinn();
    let target = STORY_DAYS.includes(t0.dow) && t0.hour < 18 ? { date: t0.date, dow: t0.dow } : null;
    for (let i = 1; !target && i <= 7; i++) { const x = tallinn(new Date(Date.now() + i * 86400_000)); if (STORY_DAYS.includes(x.dow)) target = { date: x.date, dow: x.dow }; }
    await reply(`Планирую сторис на ${target!.date}…`);
    await once(`smm_plan:${target!.date}`);
    const res = await planDay(target!.date, target!.dow);
    return res.ok ? null : reply(`Не получилось: ${res.reason}`);
  }
  if (arg === "off" || arg === "on") {
    await setSetting("smm_on", arg);
    return reply(arg === "on" ? "Сторис включены." : "Сторис на паузе.");
  }
  const t = tallinn();
  const upcoming = await prisma.storyPost.findMany({ where: { day: { gte: t.date } }, orderBy: [{ day: "asc" }, { slot: "asc" }], take: 12 });
  const ok = await setting("smm_publish_ok");
  return reply(`Сторис: ${(await setting("smm_on")) === "off" ? "пауза" : "включены"} · ${(await autoMode()) ? "без одобрения" : "с одобрением"}\nПубликация через API: ${ok?.startsWith("yes") ? "да" : "нет (отправлю картинку для ручной публикации)"}\n${upcoming.map((u) => `${u.day} ${u.slot} — ${u.status}${u.error ? ` (${u.error.slice(0, 80)})` : ""}`).join("\n") || "запланированных нет"}\nКоманды: /smm plan · /smm auto on|off · /smm off|on`);
}
