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
    const pageId = process.env.META_PAGE_ID || "104400848423200"; // Facebook Page "Deesse style"
    const igName = (process.env.META_IG_USERNAME || "deesse_style").toLowerCase();
    await get(`${pageId}/subscribed_apps`);
    await get(`${pageId}/conversations?platform=messenger&limit=1`);
    // the shop's own Instagram account id is one of the participants of its Instagram conversations
    const convs = (await get(`${pageId}/conversations?platform=instagram&fields=participants&limit=5`)) as {
      data?: { participants?: { data?: { id: string; username?: string }[] } }[];
    } | null;
    const ig = convs?.data?.flatMap((c) => c.participants?.data ?? []).find((p) => (p.username ?? "").toLowerCase() === igName)?.id;
    if (ig) await get(`${ig}?fields=id,username,profile_picture_url`);
    else console.log("[meta] instagram account id not found in conversations");
  } catch (e) {
    console.error("[meta] check failed", e);
  }
}

void connectTelegram();
void checkMeta();
