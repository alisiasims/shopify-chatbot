/**
 * Meta Conversions API: server Purchase events for paid web orders (owner 25.11 «серверная передача покупок с сайта - настрой»).
 * Why: dataset «Deessee Clean» got 4 browser Purchase events for 18-24.11 while the Online Store had 12 orders (consent banner /
 * ad blockers / Shop Pay pages), so Meta optimises Black Week on a third of the sales.
 *
 * How: every 10 min the team timer reads paid Online Store orders of the last 7 days (Meta accepts events up to 7 days old) and sends
 * each one once (Setting capi:<order id>). event_id = "order_<id>"; user data hashed (SHA-256): e-mail, phone, first/last name, city,
 * zip, country, Shopify customer id as external_id; client IP + user agent from the order; fbc from an fbclid in the landing page.
 * Needs Railway Variables META_CAPI_TOKEN (dataset access token from Events Manager) and optionally META_DATASET_ID
 * (default 1973688159941912) and META_CAPI_TEST_CODE (Events Manager «Test events» code -> events go to the test tab only).
 * Without the token it does nothing (log once «[capi] off»).
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { admin, adminRest } from "./shopify";

const DATASET = () => process.env.META_DATASET_ID || "1973688159941912";
const sha = (v?: string | null) => (v ? createHash("sha256").update(v.trim().toLowerCase()).digest("hex") : undefined);
const digits = (v?: string | null) => (v ? v.replace(/\D/g, "") : "");

type Addr = { city?: string | null; zip?: string | null; countryCodeV2?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
type Order = {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  sourceName: string | null;
  email: string | null;
  phone: string | null;
  clientIp: string | null;
  test: boolean;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { legacyResourceId: string; firstName: string | null; lastName: string | null } | null;
  billingAddress: Addr;
  shippingAddress: Addr;
  customerJourneySummary: { lastVisit: { landingPage: string | null } | null; firstVisit: { landingPage: string | null } | null } | null;
  lineItems: { nodes: { quantity: number; variant: { legacyResourceId: string } | null }[] };
};

let warned = false;

export async function sendServerPurchases(): Promise<{ sent: number; skipped: number } | null> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    if (!warned) console.log("[capi] off: META_CAPI_TOKEN not set");
    warned = true;
    return null;
  }
  const since = new Date(Date.now() - 7 * 86400_000 + 3600_000).toISOString();
  const data = await admin<{ orders: { nodes: Order[] } }>(
    `query($q: String!) { orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) { nodes {
      id legacyResourceId name createdAt sourceName email phone clientIp test
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { legacyResourceId firstName lastName }
      billingAddress { city zip countryCodeV2 firstName lastName phone }
      shippingAddress { city zip countryCodeV2 firstName lastName phone }
      customerJourneySummary { lastVisit { landingPage } firstVisit { landingPage } }
      lineItems(first: 30) { nodes { quantity variant { legacyResourceId } } }
    } } }`,
    { q: `financial_status:paid created_at:>='${since}'` },
  );
  let sent = 0;
  let skipped = 0;
  for (const o of data.orders.nodes) {
    // only Online Store checkouts: draft orders (phone / Deisi invoices / showroom) and POS never saw a Meta ad click on the site
    if (o.test || (o.sourceName ?? "") !== "web") {
      skipped++;
      continue;
    }
    const key = `capi:${o.legacyResourceId}`;
    if (await prisma.setting.findUnique({ where: { key } }).catch(() => null)) continue;
    try {
      await prisma.setting.create({ data: { key, value: "sending" } });
    } catch {
      continue; // another instance claimed it
    }
    try {
      const ok = await sendOne(o, token);
      await prisma.setting.update({ where: { key }, data: { value: ok ? `sent ${new Date().toISOString()}` : "failed" } });
      if (ok) sent++;
      else await prisma.setting.delete({ where: { key } }).catch(() => null); // retried on the next tick
    } catch (e) {
      console.error("[capi]", o.name, e);
      await prisma.setting.delete({ where: { key } }).catch(() => null);
    }
  }
  if (sent) console.log(`[capi] sent ${sent} purchase(s), skipped ${skipped} non-web`);
  return { sent, skipped };
}

async function sendOne(o: Order, token: string): Promise<boolean> {
  const a = o.billingAddress ?? o.shippingAddress;
  const s = o.shippingAddress;
  // user agent is only in the REST order (client_details)
  const rest = await adminRest<{ order?: { client_details?: { user_agent?: string | null; browser_ip?: string | null } | null } }>(
    `orders/${o.legacyResourceId}.json?fields=client_details`,
  ).catch(() => ({ order: undefined }));
  const ua = rest.order?.client_details?.user_agent || undefined;
  const ip = o.clientIp || rest.order?.client_details?.browser_ip || undefined;
  const landing = o.customerJourneySummary?.lastVisit?.landingPage || o.customerJourneySummary?.firstVisit?.landingPage || "";
  const fbclid = landing.match(/[?&]fbclid=([^&#]+)/)?.[1];
  const created = Math.floor(new Date(o.createdAt).getTime() / 1000);
  const phone = digits(o.phone || a?.phone || s?.phone);
  const user_data: Record<string, unknown> = {
    em: o.email ? [sha(o.email)] : undefined,
    ph: phone ? [sha(phone)] : undefined,
    fn: sha(o.customer?.firstName || a?.firstName),
    ln: sha(o.customer?.lastName || a?.lastName),
    ct: sha((a?.city || s?.city || "").replace(/\s+/g, "")),
    zp: sha((a?.zip || s?.zip || "").replace(/\s+/g, "")),
    country: sha(a?.countryCodeV2 || s?.countryCodeV2),
    external_id: o.customer ? [sha(o.customer.legacyResourceId)] : undefined,
    client_ip_address: ip,
    client_user_agent: ua,
    fbc: fbclid ? `fb.1.${created * 1000}.${fbclid}` : undefined,
  };
  const event = {
    event_name: "Purchase",
    event_time: created,
    event_id: `order_${o.legacyResourceId}`,
    action_source: ua ? "website" : "system_generated",
    event_source_url: "https://deesse.ee/checkouts/thank_you",
    user_data,
    custom_data: {
      currency: o.totalPriceSet.shopMoney.currencyCode,
      value: Number(o.totalPriceSet.shopMoney.amount),
      order_id: o.legacyResourceId,
      content_type: "product",
      content_ids: o.lineItems.nodes.map((l) => l.variant?.legacyResourceId).filter(Boolean),
      num_items: o.lineItems.nodes.reduce((n, l) => n + (l.quantity || 0), 0),
    },
  };
  const body: Record<string, unknown> = { data: [event] };
  if (process.env.META_CAPI_TEST_CODE) body.test_event_code = process.env.META_CAPI_TEST_CODE;
  const res = await fetch(`https://graph.facebook.com/v21.0/${DATASET()}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string; code?: number } };
  if (!res.ok || !out.events_received) {
    console.error("[capi] refused", o.name, res.status, out.error?.code, (out.error?.message || "").slice(0, 200));
    return false;
  }
  return true;
}
