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
    // the shop's own Instagram account id: saved by /api/meta from the first Instagram DM, or META_IG_ID
    const { prisma } = await import("@/lib/prisma");
    const ig = process.env.META_IG_ID || (await prisma.setting.findUnique({ where: { key: "ig_account_id" } }))?.value;
    if (ig) {
      const acc = (await get(`${ig}?fields=id,username`)) as { username?: string } | null;
      if (acc?.username && acc.username.toLowerCase() !== igName) console.log(`[meta] instagram account is @${acc.username}, expected @${igName}`);
      await get(`${pageId}/conversations?platform=instagram&limit=1`);
    } else console.log("[meta] instagram account id not known yet (comes with the next Instagram DM)");
  } catch (e) {
    console.error("[meta] check failed", e);
  }
}

void connectTelegram();
void checkMeta();
