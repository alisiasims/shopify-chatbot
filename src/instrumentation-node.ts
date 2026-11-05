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

/**
 * One-time cleanup (owner 05.11: «удали все тесты»): test conversations made while setting Deisi up,
 * so the team sees only real clients in /inbox. Runs once (Setting cleanup_tests_0511).
 */
async function cleanupTests() {
  const { prisma } = await import("@/lib/prisma");
  const key = "cleanup_tests_0511";
  if (await prisma.setting.findUnique({ where: { key } })) return;
  const TEST_TEXT = /^(тест|test|testing|привет|tere|hi|hello)[!.]?$/i;
  const TEST_QUESTIONS = [/which pole heels for a beginner, size 38/i, /Otsin kingi High Heels trennideks, suurus 38/i];
  const sessions = await prisma.chatSession.findMany({
    where: { channel: { not: "app" }, createdAt: { lt: new Date("2026-11-05T15:00:00Z") } },
    include: { messages: { select: { role: true, content: true, meta: true } } },
  });
  const ids = sessions
    .filter(
      (s) =>
        (s.visitorId ?? "").startsWith("testowner") ||
        (s.customerEmail ?? "").toLowerCase() === "info@deesse.ee" ||
        // the test order #D498 (test buyer info@deesse.ee)
        s.messages.some((m) => (m.role === "user" && /info@deesse\.ee/i.test(m.content)) || JSON.stringify(m.meta ?? {}).includes("D498")) ||
        (s.messages.some((m) => m.role === "user") &&
          s.messages.filter((m) => m.role === "user").every((m) => TEST_TEXT.test(m.content.trim()) || TEST_QUESTIONS.some((r) => r.test(m.content)))),
    )
    .map((s) => s.id);
  const removed = ids.length ? await prisma.chatSession.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
  const handoffs = await prisma.handoff.deleteMany({ where: { OR: [{ contact: { contains: "info@deesse.ee" } }, { sessionId: null, createdAt: { lt: new Date("2026-11-05T15:00:00Z") } }] } });
  await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
  console.log(`[cleanup] removed ${removed.count} test conversations and ${handoffs.count} test handoffs`);
}

void connectTelegram();
void cleanupTests().catch((e) => console.error("[cleanup]", e));
void checkMeta();
