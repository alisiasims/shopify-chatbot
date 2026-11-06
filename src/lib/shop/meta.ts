/** Sending to Instagram / Messenger with the Page token (used by the webhook and by follow-ups). */

/** Deisi sends Meta answers herself only with META_AUTO_REPLY=on and a Page token; otherwise answers are drafts for the team. */
export function metaAutoSend() {
  return process.env.META_AUTO_REPLY === "on" && Boolean(process.env.META_PAGE_TOKEN);
}

export async function sendMeta(recipientId: string, text: string) {
  const parts = text.match(/[\s\S]{1,950}(\s|$)/g) ?? [text];
  for (const part of parts) {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_TOKEN!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: part.trim() } }),
    });
    if (!res.ok) {
      console.error("[meta] send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
  }
  return true;
}
