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
