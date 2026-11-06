import { NextResponse } from "next/server";
import { appUrl, botToken, notifyTeam, telegramTarget, tg, webhookSecret } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Telegram status (behind the inbox password). No token is ever returned. */
export async function GET(request: Request) {
  // ?log=1: the copy of the team chat (last 14 days), newest first
  if (new URL(request.url).searchParams.get("log")) {
    const rows = await prisma.teamLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } }, orderBy: { createdAt: "desc" }, take: 200 });
    return NextResponse.json({ log: rows });
  }
  if (!botToken()) return NextResponse.json({ token: false });
  const [me, hook, target] = await Promise.all([tg("getMe", {}), tg("getWebhookInfo", {}), telegramTarget()]);
  const bot = me.result as { username?: string } | undefined;
  const info = hook.result as { url?: string; last_error_message?: string } | undefined;
  return NextResponse.json({ token: true, bot: bot?.username ?? null, webhook: info?.url ?? null, webhookError: info?.last_error_message ?? null, chat: target });
}

/** {action:"setup"} connects the webhook; {action:"test"} sends a test message; {action:"send", text} writes to the team chat. */
export async function POST(request: Request) {
  if (!botToken()) return NextResponse.json({ error: "Add TELEGRAM_BOT_TOKEN in Railway Variables first" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (body.action === "setup") {
    if (!appUrl()) return NextResponse.json({ error: "APP_URL is not set" }, { status: 400 });
    const res = await tg("setWebhook", {
      url: `${appUrl()}/api/telegram`,
      secret_token: webhookSecret(),
      allowed_updates: ["message", "callback_query", "message_reaction"],
      drop_pending_updates: true,
    });
    return NextResponse.json({ ok: Boolean(res.ok), description: res.description ?? null });
  }
  if (body.action === "test") {
    const target = await telegramTarget();
    if (!target) return NextResponse.json({ error: "No chat yet: add the bot to the group and write /here there" }, { status: 400 });
    const ok = await notifyTeam("✅ Проверка: Дейси магазина deesse.ee на связи.");
    return NextResponse.json({ ok });
  }
  if (body.action === "send") {
    // a message to the team chat from the inbox (owner 05.11: Claude writes to the shop team like to the studio admins)
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "Empty text" }, { status: 400 });
    const ok = await notifyTeam(text, String(body.who || "Claude").slice(0, 40));
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
