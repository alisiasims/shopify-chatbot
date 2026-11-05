import { appUrl, tg, webhookSecret } from "@/lib/notify";

async function connectTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !appUrl()) return;
  try {
    const res = await tg("setWebhook", { url: `${appUrl()}/api/telegram`, secret_token: webhookSecret(), allowed_updates: ["message"] });
    console.log("[telegram] webhook", res.ok ? "connected" : res.description);
  } catch (e) {
    console.error("[telegram] webhook setup failed", e);
  }
}

/**
 * Meta check on start: reads the Page, its Instagram account, the webhook subscription and the conversation lists
 * with the Page token. Logs only ok / error. These read calls also count as the API test calls App Review asks for.
 */
async function checkMeta() {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return;
  const get = async (path: string) => {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`https://graph.facebook.com/v21.0/${path}${sep}access_token=${encodeURIComponent(token)}`);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    console.log(`[meta] ${path.split("?")[0]}: ${res.ok ? "ok" : `HTTP ${res.status} ${data.error?.message ?? ""}`}`);
    return res.ok ? data : null;
  };
  try {
    const page = (await get("me?fields=id,name,instagram_business_account")) as { id?: string; instagram_business_account?: { id: string } } | null;
    if (page?.id) {
      await get(`${page.id}/subscribed_apps`);
      await get(`${page.id}/conversations?platform=messenger&limit=1`);
      await get(`${page.id}/conversations?platform=instagram&limit=1`);
    }
    const ig = page?.instagram_business_account?.id;
    if (ig) await get(`${ig}?fields=id,username,profile_picture_url`);
  } catch (e) {
    console.error("[meta] check failed", e);
  }
}

void connectTelegram();
void checkMeta();
