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

void connectTelegram();
