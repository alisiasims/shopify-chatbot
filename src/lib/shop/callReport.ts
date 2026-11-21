/**
 * Owner 17.11: «хочу получать информацию о всех звонках, на которые ответила Дейси».
 * Every phone call -> one message to the shop TEAM chat (owner 17.11 17:40: «лучше не мне, а в общий чат магазина, чтобы админы
 * магазина тоже видели» - this overrides the 10.11 «admins do not hear about new abilities» for call cards).
 *
 * Two sources, one card per call (Setting call_report:<conversation id> = sent):
 *  1. ElevenLabs post-call webhook -> /api/voice/postcall (all calls, also when the caller hung up). Needs the workspace webhook
 *     (ElevenLabs dashboard -> Settings -> Webhooks, URL <APP_URL>/api/voice/postcall, HMAC) and its signing secret in Railway
 *     Variable ELEVENLABS_WEBHOOK_SECRET (typed by the owner).
 *  2. Fallback while 1 is not set up: save_call_note from the agent (calls that ended normally).
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { callClaude, hasApiKey, type ContentBlock } from "@/lib/llm";

const setting = async (key: string) => (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value ?? null;

/** ElevenLabs writes its call summary in English: the owner reads Russian. */
async function toRussian(text: string) {
  if (!text.trim() || /[а-яё]/i.test(text) || !hasApiKey()) return text;
  const res = await callClaude({
    system: "Translate the phone call summary into natural, short Russian for the shop team. Keep names, numbers, product names, order numbers. Answer with the translation only.",
    messages: [{ role: "user", content: text.slice(0, 3000) }],
    model: "claude-haiku-5-5", maxTokens: 800, temperature: 0,
  }).catch(() => null);
  const out = res?.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
  return out || text;
}

export const postCallWebhookOn = () => !!process.env.ELEVENLABS_WEBHOOK_SECRET;

function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function tallinnTime(d: Date) {
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Tallinn", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export type CallInfo = {
  conversationId: string;
  caller?: string;
  startedAt?: Date;
  durationSec?: number;
  language?: string;
  summary?: string;
  clientName?: string;
  ended?: string;          // who ended / why
  actions?: string[];      // what Deisi did (tools)
};

/** The card text (Russian). title: «📞 Звонок в магазин» / «📞 Звонок в студию». */
export async function callText(c: CallInfo, title = "📞 Звонок в магазин"): Promise<string> {
  const lines = [
    `${title}${c.startedAt ? ` · ${tallinnTime(c.startedAt)}` : ""}${c.durationSec ? ` · ${mmss(c.durationSec)}` : ""}`,
    `Кто: ${c.caller || "номер скрыт"}${c.clientName ? ` · ${c.clientName}` : ""}${c.language ? ` · язык ${c.language}` : ""}`,
  ];
  if (c.summary) lines.push("", (await toRussian(c.summary.trim())).slice(0, 1500));
  if (c.actions?.length) lines.push("", `Дейси сделала: ${c.actions.join(", ")}`);
  if (c.ended) lines.push(`Окончание: ${c.ended}`);
  return lines.join("\n");
}

/** Once per call (Setting call_report:<id>); false = already sent. */
export async function claimCall(conversationId: string): Promise<boolean> {
  try {
    await prisma.setting.create({ data: { key: `call_report:${conversationId}`, value: new Date().toISOString() } });
    return true;
  } catch {
    return false;
  }
}
export async function releaseCall(conversationId: string) {
  await prisma.setting.delete({ where: { key: `call_report:${conversationId}` } }).catch(() => {});
}

/** Sends the call card to the shop team chat once per call. */
export async function reportCall(c: CallInfo): Promise<boolean> {
  if (!(await claimCall(c.conversationId))) return true;   // already sent
  const ok = await notifyTeam(await callText(c), "Deisi (телефон)");
  if (!ok) await releaseCall(c.conversationId);   // not sent -> the fallback may try again
  return ok;
}

/** Remembers which tools Deisi used in a call (Setting call_tools:<conversation id>, comma list). */
export async function noteCallTool(conversationId: string, tool: string) {
  const key = `call_tools:${conversationId}`;
  const cur = (await setting(key)) || "";
  if (cur.split(",").includes(tool)) return;
  const value = cur ? `${cur},${tool}` : tool;
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }).catch(() => {});
}

/** What Deisi did during the call, in Russian words. */
export async function callActions(conversationId: string): Promise<string[]> {
  const tools = ((await setting(`call_tools:${conversationId}`)) || "").split(",").filter(Boolean);
  const names: Record<string, string> = {
    create_order: "оформила заказ (ссылка на оплату ушла на e-mail)", handoff_to_human: "передала команде", add_team_task: "поставила задачу команде",
    order_status: "проверила заказ", search_products: "искала товары", get_product: "смотрела товар", delivery_options: "считала доставку",
  };
  return tools.filter((t) => t !== "save_call_note").map((t) => names[t] || t);
}

/**
 * PM 21.11: an inbound call that never became a conversation (12:06 Tallinn: «initiated», 0 s, no transcript - the caller hung up
 * before Deisi answered or the stream did not start) produced NO card at all, so nobody called the client back.
 * Every 5 min (teamOps timer): Twilio calls to our two numbers in the last 3 h that have ENDED > 3 min ago and got no post-call
 * webhook (Setting call_sid_done:<CallSid>) -> ONE card «пропущенный звонок» (Setting missed_call:<CallSid>), shop -> shop team chat,
 * studio number -> studio admins (Wix /_functions/phonestudio call_report). Skipped when the same number later had a real call.
 */
export async function markCallSidDone(callSid: string) {
  const key = `call_sid_done:${callSid.slice(0, 64)}`;
  await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: new Date().toISOString() } }).catch(() => {});
}

type TwCall = { sid: string; from: string; to: string; status: string; direction: string; start_time?: string; end_time?: string; duration?: string };
const SHOP_NO = "+37258989535";
const STUDIO_NO = "+37258989356";

export async function missedCalls() {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!sid || !token || !postCallWebhookOn()) return;
  const since = Date.now() - 3 * 3600e3;
  for (const to of [SHOP_NO, STUDIO_NO]) {
    const q = new URLSearchParams({ To: to, PageSize: "50" });
    q.set("StartTime>", new Date(since - 864e5).toISOString().slice(0, 10));
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?${q.toString()}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    }).catch(() => null);
    if (!res?.ok) { console.error("[missed-call] twilio", res?.status); continue; }
    const calls = (((await res.json().catch(() => ({}))) as { calls?: TwCall[] }).calls || []).filter((c) => c.direction === "inbound");
    for (const c of calls) {
      const start = new Date(c.start_time || 0).getTime();
      if (!start || start < since) continue;
      if (["queued", "ringing", "in-progress"].includes(c.status)) continue;
      const end = c.end_time ? new Date(c.end_time).getTime() : start;
      if (Date.now() - end < 3 * 60e3) continue;                                    // the post-call webhook may still come
      if (await setting(`call_sid_done:${c.sid}`)) continue;
      // the same number got through later -> nobody needs to call back
      const later = calls.filter((x) => x.from === c.from && new Date(x.start_time || 0).getTime() > start);
      let answeredLater = false;
      for (const x of later) if (await setting(`call_sid_done:${x.sid}`)) answeredLater = true;
      if (answeredLater) continue;
      if (!(await claimCall(`missed:${c.sid}`))) continue;                            // one card per call
      const caller = String(c.from || "").replace(/[^\d+]/g, "");
      const shop = to === SHOP_NO;
      const text = [
        `📞 Пропущенный звонок ${shop ? "в магазин" : "в студию"} · ${tallinnTime(new Date(start))}`,
        `Кто: ${caller && caller !== "+266696687" ? caller : "номер скрыт"}`,
        "Разговор с Дейси не состоялся (положили трубку до ответа или связь не установилась). Перезвоните, пожалуйста.",
      ].join("\n");
      let ok = false;
      if (shop) ok = await notifyTeam(text, "Deisi (телефон)");
      else {
        const r = await fetch("https://www.deessestudio.ee/_functions/phonestudio", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-voice-secret": process.env.STUDIO_PHONE_SECRET || "" },
          body: JSON.stringify({ tool: "call_report", text }),
        }).catch(() => null);
        ok = !!r?.ok;
      }
      console.log(`[missed-call] ${shop ? "shop" : "studio"} ${c.sid.slice(0, 10)} status=${c.status} card=${ok}`);
      if (!ok) await releaseCall(`missed:${c.sid}`);
    }
  }
}
