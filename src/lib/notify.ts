/**
 * Telegram messages to the shop team (handoffs, Instagram/Messenger drafts).
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Railway Variables; without them nothing is sent.
 */
export async function notifyTeam(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3900),
        disable_web_page_preview: true,
        ...(process.env.TELEGRAM_THREAD_ID ? { message_thread_id: Number(process.env.TELEGRAM_THREAD_ID) } : {}),
      }),
    });
    if (!res.ok) console.error("[notify] telegram", res.status, await res.text().catch(() => ""));
    return res.ok;
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
