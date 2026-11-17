/**
 * Owner 17.11: «хочу получать информацию о всех звонках, на которые ответила Дейси».
 * Every phone call -> one message to the OWNER'S private chat with the shop bot (Setting smm_owner_chat, registered with
 * «/smm <SMM_APPROVER_CODE>»), never to the team chat (owner 10.11: admins do not hear about new abilities).
 *
 * Two sources, one card per call (Setting call_report:<conversation id> = sent):
 *  1. ElevenLabs post-call webhook -> /api/voice/postcall (all calls, also when the caller hung up). Needs the workspace webhook
 *     (ElevenLabs dashboard -> Settings -> Webhooks, URL <APP_URL>/api/voice/postcall, HMAC) and its signing secret in Railway
 *     Variable ELEVENLABS_WEBHOOK_SECRET (typed by the owner).
 *  2. Fallback while 1 is not set up: save_call_note from the agent (calls that ended normally).
 */
import { prisma } from "@/lib/prisma";
import { tg } from "@/lib/notify";
import { callClaude, hasApiKey, type ContentBlock } from "@/lib/llm";

const setting = async (key: string) => (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value ?? null;

/** ElevenLabs writes its call summary in English: the owner reads Russian. */
async function toRussian(text: string) {
  if (!text.trim() || /[а-яё]/i.test(text) || !hasApiKey()) return text;
  const res = await callClaude({
    system: "Translate the phone call summary into natural, short Russian for the shop owner. Keep names, numbers, product names, order numbers. Answer with the translation only.",
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

/** Sends the call card to the owner once per call. Returns false when the owner's chat is not registered. */
export async function reportCall(c: CallInfo): Promise<boolean> {
  const owner = await setting("smm_owner_chat");
  if (!owner) { console.log("[call-report] owner chat not registered (/smm <code>)"); return false; }
  const key = `call_report:${c.conversationId}`;
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
  } catch {
    return true;   // already sent
  }
  const lines = [
    `📞 Звонок в магазин${c.startedAt ? ` · ${tallinnTime(c.startedAt)}` : ""}${c.durationSec ? ` · ${mmss(c.durationSec)}` : ""}`,
    `Кто: ${c.caller || "номер скрыт"}${c.clientName ? ` · ${c.clientName}` : ""}${c.language ? ` · язык ${c.language}` : ""}`,
  ];
  if (c.summary) lines.push("", (await toRussian(c.summary.trim())).slice(0, 1500));
  if (c.actions?.length) lines.push("", `Дейси сделала: ${c.actions.join(", ")}`);
  if (c.ended) lines.push(`Окончание: ${c.ended}`);
  const r = await tg("sendMessage", { chat_id: owner, text: lines.join("\n").slice(0, 3900), disable_web_page_preview: true });
  return !!r.ok;
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
