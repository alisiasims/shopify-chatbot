/**
 * Owner 18.11: on a phone call the payment link goes to the caller by SMS (no e-mail dictation on the phone).
 * Twilio REST API, from the shop number +372 5898 9535 (Railway Variables TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, optional TWILIO_FROM).
 */
export function smsReady() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export async function sendSms(to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "+37258989535";
  if (!sid || !token) return { ok: false, error: "SMS is not set up (Twilio keys missing)" };
  const number = to.replace(/[^\d+]/g, "");
  if (!/^\+\d{7,15}$/.test(number)) return { ok: false, error: "no valid caller number" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: number, From: from, Body: body.slice(0, 600) }).toString(),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) }) as unknown as Response);
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !data.sid) {
    console.error("[sms] send failed", res.status, data.code, data.message);
    return { ok: false, error: `${data.code ?? res.status} ${data.message ?? "send failed"}` };
  }
  console.log(`[sms] sent ${data.sid} to ${number.slice(0, 6)}…`);
  return { ok: true, sid: data.sid };
}

/** The payment-link SMS in the caller's language. */
export function paymentSmsText(lang: string, order: string, total: string, url: string) {
  const l = (lang || "et").toLowerCase();
  if (l.startsWith("ru")) return `DEESSE: заказ ${order}, ${total}. Ссылка на оплату: ${url}\nЕсли нужна помощь, позвоните или напишите на этот номер.`;
  if (l.startsWith("en")) return `DEESSE: order ${order}, ${total}. Payment link: ${url}\nQuestions? Call or text this number.`;
  return `DEESSE: tellimus ${order}, ${total}. Makselink: ${url}\nKüsimuste korral helistage või kirjutage sellele numbrile.`;
}

/**
 * Owner 20.11 (from her husband's phone agent): names and e-mails are misheard on the phone, so the caller sends them by SMS to the
 * number she is calling (shop +37258989535 or studio +37258989356) and the agent reads it with the tool read_caller_sms.
 * Only messages FROM the caller's own number in the last `minutes` are read.
 */
export async function recentSmsFrom(caller: string, minutes = 20) {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = caller.replace(/[^\d+]/g, "");
  if (!sid || !token) return { ok: false as const, error: "SMS is not set up" };
  if (!/^\+\d{7,15}$/.test(from)) return { ok: false as const, error: "no caller number" };
  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const q = new URLSearchParams({ From: from, PageSize: "20" });
  q.set("DateSent>", day);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q.toString()}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  }).catch(() => null);
  if (!res?.ok) return { ok: false as const, error: `twilio ${res?.status ?? "unreachable"}` };
  const data = (await res.json().catch(() => ({}))) as { messages?: { body: string; direction: string; to: string; date_sent?: string; date_created?: string }[] };
  const ours = new Set(["+37258989535", "+37258989356"]);
  const since = Date.now() - minutes * 60e3;
  const msgs = (data.messages || [])
    .filter((m) => m.direction === "inbound" && ours.has(m.to) && new Date(m.date_sent || m.date_created || 0).getTime() >= since)
    .map((m) => String(m.body || "").trim())
    .filter(Boolean);
  const text = msgs.reverse().join("\n").slice(0, 600);   // oldest first
  const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [""])[0].toLowerCase();
  const rest = text.replace(email ? new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /$^/, " ").replace(/[^\p{L}' -]+/gu, " ").replace(/\s+/g, " ").trim();
  const name = rest.split(" ").filter((w) => w.length > 1).slice(0, 4).join(" ");
  return { ok: true as const, found: msgs.length > 0, text, email, name };
}
