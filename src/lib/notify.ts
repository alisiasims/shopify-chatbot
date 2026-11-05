import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Telegram messages to the shop team (handoffs, Instagram/Messenger drafts).
 * TELEGRAM_BOT_TOKEN lives in Railway Variables. The chat (and forum topic) comes from
 * TELEGRAM_CHAT_ID / TELEGRAM_THREAD_ID, or from the "/here" command written in the group.
 */
export function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

/** Secret Telegram sends with every webhook call (derived from the token, so no extra variable). */
export function webhookSecret() {
  return crypto.createHash("sha256").update(`deesse-shop:${botToken()}`).digest("hex").slice(0, 48);
}

export async function telegramTarget(): Promise<{ chatId: string; threadId: number | null } | null> {
  if (process.env.TELEGRAM_CHAT_ID)
    return { chatId: process.env.TELEGRAM_CHAT_ID, threadId: process.env.TELEGRAM_THREAD_ID ? Number(process.env.TELEGRAM_THREAD_ID) : null };
  const rows = await prisma.setting.findMany({ where: { key: { in: ["tg_chat_id", "tg_thread_id"] } } }).catch(() => []);
  const chat = rows.find((r) => r.key === "tg_chat_id")?.value;
  const thread = rows.find((r) => r.key === "tg_thread_id")?.value;
  return chat ? { chatId: chat, threadId: thread ? Number(thread) : null } : null;
}

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!data.ok) console.error("[telegram]", method, res.status, data.description);
  return data;
}

/** Saves a team-chat message (in / out) for Claude's checks; old rows (30 days) are removed now and then. */
export async function teamLog(dir: "in" | "out", text: string, who?: string | null) {
  try {
    await prisma.teamLog.create({ data: { dir, text: text.slice(0, 4000), who: who ?? null } });
    if (Math.random() < 0.03) await prisma.teamLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
  } catch (e) {
    console.error("[teamlog]", e);
  }
}

export async function notifyTeam(text: string, who?: string): Promise<boolean> {
  if (!botToken()) return false;
  try {
    const target = await telegramTarget();
    if (!target) return false;
    const data = await tg("sendMessage", {
      chat_id: target.chatId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
      ...(target.threadId ? { message_thread_id: target.threadId } : {}),
    });
    if (data.ok) await teamLog("out", text, who ?? "Deisi");
    return Boolean(data.ok);
  } catch (e) {
    console.error("[notify] telegram failed", e);
    return false;
  }
}

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "";
}
