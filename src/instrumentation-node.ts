import { appUrl, tg, webhookSecret } from "@/lib/notify";

async function connectTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !appUrl()) return;
  try {
    const res = await tg("setWebhook", { url: `${appUrl()}/api/telegram`, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query", "message_reaction"] });
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
    const subs = (await get(`${pageId}/subscribed_apps`)) as { data?: { id?: string; subscribed_fields?: string[] }[] } | null;
    // echoes of the team's hand-written replies are needed for learning (owner 05.11)
    const fields = subs?.data?.find((a) => a.id === (process.env.META_APP_ID || "1640472837550030"))?.subscribed_fields ?? [];
    if (subs && !fields.includes("message_echoes")) {
      const want = [...new Set([...fields, "messages", "messaging_postbacks", "message_echoes"])].join(",");
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?subscribed_fields=${want}&access_token=${encodeURIComponent(token)}`, { method: "POST" });
      console.log(`[meta] subscribe message_echoes: ${res.ok ? "ok" : `HTTP ${res.status}`}`);
    }
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

/** Instagram history for learning, once after start until it succeeds (the list call often times out at Meta). */
async function learnInstagramOnce() {
  const { prisma } = await import("@/lib/prisma");
  if (!process.env.META_PAGE_TOKEN || (await prisma.setting.findUnique({ where: { key: "ig_history_imported" } }))) return;
  const { importMetaHistory } = await import("@/lib/shop/learning");
  const res = (await importMetaHistory({ platforms: ["instagram"] })) as Record<string, { conversations: number; saved: number; error?: string }>;
  console.log("[learn] instagram on start:", JSON.stringify(res));
  const ig = res.instagram;
  if (ig && ig.conversations > 0) await prisma.setting.create({ data: { key: "ig_history_imported", value: JSON.stringify(ig) } });
}

void connectTelegram();
setTimeout(() => void learnInstagramOnce().catch((e) => console.error("[learn]", e)), 60_000);
void cleanupTests().catch((e) => console.error("[cleanup]", e));
void checkMeta();
// owner 06.11: Deisi's own follow-ups, checked every hour
void import("@/lib/shop/followups").then((m) => m.startFollowUpTimer()).catch((e) => console.error("[followup] timer", e));
// owner 06.11: shift list at 15:00 (Mon-Sat), reminders while the showroom is open, evening summary at 21:00
void import("@/lib/shop/teamOps").then((m) => m.startTeamTimer()).catch((e) => console.error("[team timer]", e));
