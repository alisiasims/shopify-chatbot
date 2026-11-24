/**
 * ElevenLabs post-call webhook (owner 17.11: a card about EVERY call Deisi answered, also when the caller hung up).
 * Workspace webhook (ElevenLabs dashboard -> Settings -> Webhooks): URL <APP_URL>/api/voice/postcall, auth HMAC;
 * its signing secret = Railway Variable ELEVENLABS_WEBHOOK_SECRET. Then Agents settings -> post-call webhook = this webhook,
 * event «transcript». Header «ElevenLabs-Signature: t=<unix>,v0=<hex hmac_sha256(secret, `${t}.${rawBody}`)>».
 * Only calls of the shop agent are reported; other agents / events are ignored.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { callActions, callText, claimCall, markCallSidDone, notePhoneDay, releaseCall, reportCall } from "@/lib/shop/callReport";
import { notifyTeam } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOP_AGENT = "agent_3701m7dmc803f28raxgq5vpd97ck";
// owner 17.11: the studio phone agent (number +372 5898 9356, the studio number forwards to it when the admins do not answer).
// One post-call webhook per ElevenLabs workspace -> its card goes on to the STUDIO admins' chat (Wix /_functions/phonestudio).
const STUDIO_AGENT = "agent_6601m7n421e5f5bbxmm1rsstxs3v";
// owner 24.11 («голосовая Дейси на сайте студии: хотелось бы видеть, когда используют»): the website voice agent reports like the studio phone
const WEB_AGENT = "agent_5601m7nn5q8nej48saw6y96jj3yh";

function verify(raw: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t || 0);
  const v0 = parts.v0 || "";
  if (!t || !v0 || Math.abs(Date.now() / 1000 - t) > 30 * 60) return false;
  const want = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return want.length === v0.length && timingSafeEqual(Buffer.from(want), Buffer.from(v0));
}

type Payload = {
  type?: string;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    metadata?: {
      start_time_unix_secs?: number;
      call_duration_secs?: number;
      termination_reason?: string;
      main_language?: string;
      phone_call?: { external_number?: string; direction?: string; call_sid?: string };
      sms?: { sms_user_phone_number?: string; agent_phone_number?: string };
      conversation_initiation_source?: string;
    };
    analysis?: { transcript_summary?: string; call_summary_title?: string };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
};

export async function POST(req: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET || "";
  const raw = await req.text();
  if (!secret || !verify(raw, req.headers.get("elevenlabs-signature") || "", secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let p: Payload = {};
  try { p = JSON.parse(raw); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const d = p.data || {};
  if (p.type !== "post_call_transcription" || ![SHOP_AGENT, STUDIO_AGENT, WEB_AGENT].includes(String(d.agent_id)) || !d.conversation_id) return Response.json({ ok: true, ignored: true });
  const md = d.metadata || {};
  if (md.phone_call?.call_sid) await markCallSidDone(md.phone_call.call_sid);   // PM 21.11: the missed-call sweep skips this Twilio call
  const dv = d.conversation_initiation_client_data?.dynamic_variables || {};
  // owner 24.11: an SMS conversation with Deisi gets its own card («💬 SMS …») and a line in the daily phone summary
  const isSms = md.conversation_initiation_source === "twilio_sms" || !!md.sms;
  const title = String(d.analysis?.call_summary_title || "").slice(0, 90);
  const caller = String(md.phone_call?.external_number || md.sms?.sms_user_phone_number || dv.system__caller_id || "").replace(/[^\d+]/g, "").slice(0, 20);
  const ended = md.termination_reason ? String(md.termination_reason).slice(0, 120) : "";
  if (d.agent_id === WEB_AGENT) {
    // a visitor who opened the voice chat and said nothing (0-2 s) -> only a line in the daily summary, no card
    // the webhook excludes the transcript (17.11), so «she spoke» = a real summary or a call of 5+ s
    const sum = String(d.analysis?.transcript_summary || "");
    const spoke = (Number(md.call_duration_secs) || 0) >= 5 && !/couldn.t be generated/i.test(sum);
    await notePhoneDay("studio", "web", spoke ? title : "открыли голосовой чат, без разговора");
    if (!spoke) return Response.json({ ok: true, web: "empty" });
    if (!(await claimCall(d.conversation_id))) return Response.json({ ok: true, dup: true });
    const text = await callText({
      conversationId: d.conversation_id, caller: "", ended,
      startedAt: md.start_time_unix_secs ? new Date(md.start_time_unix_secs * 1000) : undefined,
      durationSec: md.call_duration_secs, language: md.main_language, summary: d.analysis?.transcript_summary || "",
    }, "🎙 Голосовая Дейси на сайте студии");
    const r = await fetch("https://www.deessestudio.ee/_functions/phonestudio", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voice-secret": process.env.STUDIO_PHONE_SECRET || "" },
      body: JSON.stringify({ tool: "call_report", text }),
    }).catch(() => null);
    if (!r?.ok) { await releaseCall(d.conversation_id); return Response.json({ error: "studio" }, { status: 502 }); }
    return Response.json({ ok: true, web: true });
  }
  if (d.agent_id === STUDIO_AGENT) {
    if (!(await claimCall(d.conversation_id))) return Response.json({ ok: true, dup: true });
    const text = await callText({
      conversationId: d.conversation_id, caller, ended,
      startedAt: md.start_time_unix_secs ? new Date(md.start_time_unix_secs * 1000) : undefined,
      durationSec: isSms ? undefined : md.call_duration_secs, language: md.main_language, summary: d.analysis?.transcript_summary || "",
    }, isSms ? "💬 SMS на номер Дейси (студия)" : "📞 Звонок в студию (ответила Дейси)");
    await notePhoneDay("studio", isSms ? "sms" : "call", title);
    const r = await fetch("https://www.deessestudio.ee/_functions/phonestudio", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voice-secret": process.env.STUDIO_PHONE_SECRET || "" },
      body: JSON.stringify({ tool: "call_report", text }),
    }).catch(() => null);
    if (!r?.ok) { await releaseCall(d.conversation_id); console.error("[call-report] studio forward failed", r?.status); return Response.json({ error: "studio" }, { status: 502 }); }
    return Response.json({ ok: true, studio: true });
  }
  await notePhoneDay("shop", isSms ? "sms" : "call", title);
  if (isSms) {
    if (await claimCall(d.conversation_id)) {
      const ok = await notifyTeam(await callText({ conversationId: d.conversation_id, caller, ended,
        startedAt: md.start_time_unix_secs ? new Date(md.start_time_unix_secs * 1000) : undefined, language: md.main_language,
        summary: d.analysis?.transcript_summary || "" }, "💬 SMS на номер Дейси (магазин)"), "Deisi (SMS)");
      if (!ok) await releaseCall(d.conversation_id);
    }
    return Response.json({ ok: true, sms: true });
  }
  await reportCall({
    conversationId: d.conversation_id,
    caller,
    startedAt: md.start_time_unix_secs ? new Date(md.start_time_unix_secs * 1000) : undefined,
    durationSec: md.call_duration_secs,
    language: md.main_language,
    summary: d.analysis?.transcript_summary || "",
    actions: await callActions(d.conversation_id),
    ended,
  }).catch((e) => console.error("[call-report]", e));
  return Response.json({ ok: true });
}
