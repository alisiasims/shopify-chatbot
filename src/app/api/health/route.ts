import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasApiKey } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** What is switched on (no secrets, only yes/no). */
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {}
  return NextResponse.json({
    db,
    claude: hasApiKey(),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    gmailBridge: Boolean(process.env.EMAIL_BRIDGE_TOKEN),
    orderLookup: Boolean(process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE_DOMAIN),
    discount: Boolean(process.env.DISCOUNT_CODE),
    meta: Boolean(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN),
    inbox: Boolean(process.env.ADMIN_PASSWORD),
  });
}
