/**
 * ElevenLabs post-call webhook (owner 17.11: a card about EVERY call Deisi answered, also when the caller hung up).
 * Workspace webhook (ElevenLabs dashboard -> Settings -> Webhooks): URL <APP_URL>/api/voice/postcall, auth HMAC;
 * its signing secret = Railway Variable ELEVENLABS_WEBHOOK_SECRET. Then Agents settings -> post-call webhook = this webhook,
 * event «transcript». Header «ElevenLabs-Signature: t=<unix>,v0=<hex hmac_sha256(secret, `${t}.${rawBody}`)>».
 * Only calls of the shop agent are reported; other agents / events are ignored.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { callActions, reportCall } from "@/lib/shop/callReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOP_AGENT = "agent_3701m7dmc803f28raxgq5vpd97ck";

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
      phone_call?: { external_number?: string; direction?: string };
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
  if (p.type !== "post_call_transcription" || d.agent_id !== SHOP_AGENT || !d.conversation_id) return Response.json({ ok: true, ignored: true });
  const md = d.metadata || {};
  const dv = d.conversation_initiation_client_data?.dynamic_variables || {};
  const caller = String(md.phone_call?.external_number || dv.system__caller_id || "").replace(/[^\d+]/g, "").slice(0, 20);
  const ended = md.termination_reason ? String(md.termination_reason).slice(0, 120) : "";
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
