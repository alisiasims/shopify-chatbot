/**
 * Owner 16.11: Deisi watches the Montonio shipments (Parcely -> Montonio Shipping) and tells the team when a parcel is stuck:
 *  - «inTransit» longer than Setting montonio_transit_days (default 7 days) - the carrier may have lost it;
 *  - «awaitingCollection» longer than Setting montonio_collect_days (default 4 days) - it goes back to us soon.
 * The team contacts the client before she starts asking or the parcel is returned.
 *
 * Montonio Shipping API v2 (docs.montonio.com/api/shipping-v2): JWT HS256 {accessKey, exp} signed with the secret key.
 * There is no «list shipments» endpoint, so shipments come from the webhook (shipment.* events -> /api/montonio/webhook,
 * payload = a JWT signed with the secret key). Parcels shipped before the webhook existed are seen at their next status change.
 * Keys: Railway Variables MONTONIO_ACCESS_KEY, MONTONIO_SECRET_KEY (Montonio Partner System -> store -> API keys).
 */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { appUrl, notifyTeam } from "@/lib/notify";

const BASE = "https://shipping.montonio.com/api/v2";
const EVENTS = ["shipment.registered", "shipment.registrationFailed", "shipment.labelsCreated", "shipment.statusUpdated"];
const DAY = 86400_000;

const keys = () => ({ access: process.env.MONTONIO_ACCESS_KEY?.trim() || "", secret: process.env.MONTONIO_SECRET_KEY?.trim() || "" });
export const montonioReady = () => Boolean(keys().access && keys().secret);

const b64u = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function signJwt(payload: Record<string, unknown>, secret: string) {
  const head = b64u(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** the webhook payload: a JWT signed with our secret key; null when the signature or expiry is wrong */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyJwt(token: string): Record<string, any> | null {
  const { secret } = keys();
  const [h, p, s] = String(token || "").split(".");
  if (!secret || !h || !p || !s) return null;
  try {
    const header = JSON.parse(fromB64u(h).toString("utf8"));
    if (header.alg !== "HS256") return null;
    const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
    const got = fromB64u(s);
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    const claims = JSON.parse(fromB64u(p).toString("utf8"));
    if (claims.exp && claims.exp * 1000 < Date.now() - 60_000) return null;
    return claims;
  } catch {
    return null;
  }
}

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const { access, secret } = keys();
  const token = signJwt({ accessKey: access, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Montonio ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const setting = async (key: string) => (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value ?? null;
async function saveSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** one webhook for all shipment events, pointing at this app (created once, kept if it is already there) */
export async function ensureWebhook() {
  const url = `${appUrl()}/api/montonio/webhook`;
  if (!appUrl().startsWith("https://")) return "no public app URL";
  type Hook = { id?: string; url?: string; enabledEvents?: string[] };
  const list = await api<Hook[] | { data?: Hook[]; webhooks?: Hook[] }>("GET", "/webhooks");
  const items: Hook[] = Array.isArray(list) ? list : list?.data ?? list?.webhooks ?? [];
  const mine = items.find((w) => w?.url === url);
  if (mine && EVENTS.every((e) => (mine.enabledEvents ?? []).includes(e))) {
    await saveSetting("montonio_webhook", String(mine.id));
    return `exists ${mine.id}`;
  }
  if (mine?.id) await api("DELETE", `/webhooks/${mine.id}`).catch(() => null);
  const made = await api<Hook>("POST", "/webhooks", { url, enabledEvents: EVENTS });
  await saveSetting("montonio_webhook", String(made?.id ?? ""));
  return `created ${made?.id}`;
}

type Shipment = {
  id?: string;
  status?: string;
  merchantReference?: string;
  shippingMethod?: { carrierCode?: string; countryCode?: string };
  parcels?: { carrierParcelId?: string | null; trackingLink?: string | null }[];
};

/** store the shipment's status; a new status restarts the clock */
export async function recordShipment(id: string, s: Shipment) {
  if (!id || !s?.status) return;
  const parcel = (s.parcels ?? []).find((p) => p?.trackingLink || p?.carrierParcelId) ?? {};
  const fields = {
    orderRef: s.merchantReference ?? undefined,
    carrier: s.shippingMethod?.carrierCode ?? undefined,
    country: s.shippingMethod?.countryCode ?? undefined,
    parcelId: parcel.carrierParcelId ?? undefined,
    trackingLink: parcel.trackingLink ?? undefined,
    checkedAt: new Date(),
  };
  const old = await prisma.shipmentWatch.findUnique({ where: { id } });
  if (!old) {
    await prisma.shipmentWatch.create({ data: { id, status: s.status, statusSince: new Date(), ...fields } });
    return;
  }
  const changed = old.status !== s.status;
  await prisma.shipmentWatch.update({
    where: { id },
    data: { ...fields, ...(changed ? { status: s.status, statusSince: new Date(), alertedFor: null, alertedAt: null } : {}) },
  });
}

/** POST /api/montonio/webhook body {payload: JWT} */
export async function handleWebhook(payload: string) {
  const claims = verifyJwt(payload);
  if (!claims) return false;
  const data: Shipment = claims.data ?? {};
  await recordShipment(String(claims.shipmentId || data.id || ""), data);
  return true;
}

const CARRIER: Record<string, string> = {
  omniva: "Omniva", dpd: "DPD", smartpost: "SmartPost / Itella", itella: "SmartPost / Itella", unisend: "Unisend",
  venipak: "Venipak", latvian_post: "Latvijas Pasts", lp_express: "LP Express", inpost: "InPost", novapost: "Nova Post",
};
const dm = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Tallinn", day: "2-digit", month: "2-digit" });

function alertText(w: { orderRef: string | null; carrier: string | null; country: string | null; trackingLink: string | null; parcelId: string | null; status: string; statusSince: Date }) {
  const days = Math.floor((Date.now() - w.statusSince.getTime()) / DAY);
  const who = `Посылка заказа ${w.orderRef || "(номер заказа не указан)"}`;
  const via = [CARRIER[String(w.carrier || "").toLowerCase()] || w.carrier, w.country].filter(Boolean).join(", ");
  const track = w.trackingLink || (w.parcelId ? `код ${w.parcelId}` : "трекинг не указан");
  if (w.status === "awaitingCollection")
    return `📦 ${who}${via ? ` (${via})` : ""} уже ${days} дн. ждёт клиентку в пакомате / пункте выдачи (с ${dm(w.statusSince)}) — скоро уйдёт обратно к нам.\n${track}\nНапомните, пожалуйста, клиентке забрать посылку.`;
  return `📦 ${who}${via ? ` (${via})` : ""} уже ${days} дн. «в пути» (с ${dm(w.statusSince)}) — возможно, застряла или потерялась у перевозчика.\n${track}\nПроверьте, пожалуйста, у перевозчика и напишите клиентке, пока она сама не начала искать посылку.`;
}

/** hourly: stuck parcels -> one team message per parcel and status */
export async function checkStuckShipments() {
  if (!montonioReady()) return { skipped: "no keys" };
  const transitDays = Number(await setting("montonio_transit_days")) || 7;
  const collectDays = Number(await setting("montonio_collect_days")) || 4;
  const now = Date.now();
  const rows = await prisma.shipmentWatch.findMany({
    where: {
      OR: [
        { status: "inTransit", statusSince: { lt: new Date(now - transitDays * DAY) } },
        { status: "awaitingCollection", statusSince: { lt: new Date(now - collectDays * DAY) } },
      ],
    },
    orderBy: { statusSince: "asc" },
    take: 20,
  });
  let sent = 0;
  for (const w of rows) {
    if (w.alertedFor === w.status) continue;
    // the webhook may have missed a change: ask Montonio before alerting
    try {
      const s = await api<Shipment>("GET", `/shipments/${encodeURIComponent(w.id)}`);
      await recordShipment(w.id, s);
    } catch (e) {
      console.error("[montonio] refresh", w.id, e);
    }
    const cur = await prisma.shipmentWatch.findUnique({ where: { id: w.id } });
    if (!cur || cur.status !== w.status || cur.alertedFor === cur.status) continue;
    if (await notifyTeam(alertText(cur))) {
      await prisma.shipmentWatch.update({ where: { id: w.id }, data: { alertedFor: cur.status, alertedAt: new Date() } });
      sent++;
    }
  }
  // finished parcels are kept 60 days
  await prisma.shipmentWatch
    .deleteMany({ where: { status: { in: ["delivered", "returned"] }, updatedAt: { lt: new Date(now - 60 * DAY) } } })
    .catch(() => null);
  return { checked: rows.length, sent };
}

export function startMontonioTimer() {
  if (!montonioReady()) {
    console.log("[montonio] MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY not set - parcel watch is off");
    return;
  }
  setTimeout(() => {
    ensureWebhook()
      .then((r) => console.log("[montonio] webhook", r))
      .catch((e) => console.error("[montonio] webhook", e));
  }, 30_000);
  const tick = () => {
    const h = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Tallinn", hour: "2-digit", hour12: false }));
    if (h < 10 || h > 19) return; // the team works by day: alerts 10:00-19:59 Tallinn
    void checkStuckShipments().catch((e) => console.error("[montonio] check", e));
  };
  setTimeout(tick, 120_000);
  setInterval(tick, 60 * 60_000);
}
