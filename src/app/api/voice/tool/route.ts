/**
 * Phone calls (owner 14.11): Deisi answers the shop's Estonian number through an ElevenLabs voice agent.
 * The agent's server tools call this endpoint: POST /api/voice/tool with header «x-voice-secret: <VOICE_TOOL_SECRET>»
 * and JSON { tool, conversation_id, caller, ...the tool's own parameters }.
 * Each call is one ChatSession (channel "phone", externalId = the ElevenLabs conversation id) so it shows in /inbox.
 */
import { prisma } from "@/lib/prisma";
import { runTool, type ToolContext } from "@/lib/shop/tools";
import { callActions, noteCallTool, postCallWebhookOn, reportCall } from "@/lib/shop/callReport";
import { askDetailsSmsText, recentSmsFrom, sendSms } from "@/lib/shop/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["search_products", "get_product", "delivery_options", "create_order", "order_status", "handoff_to_human", "add_team_task", "save_call_note", "read_caller_sms", "send_caller_sms"]);

function authorized(req: Request) {
  const want = process.env.VOICE_TOOL_SECRET || "";
  const got = req.headers.get("x-voice-secret") || "";
  if (!want || want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tool = String(body.tool || "");
  if (!ALLOWED.has(tool)) return Response.json({ error: `unknown tool ${tool}` }, { status: 400 });
  const conv = String(body.conversation_id || "").slice(0, 120) || `call-${Date.now()}`;
  const caller = String(body.caller || "").replace(/[^\d+]/g, "").slice(0, 20);
  const input: Record<string, unknown> = { ...body };
  delete input.tool; delete input.conversation_id; delete input.caller;

  // owner 20.11: the caller sends her name / e-mail by SMS (no spelling on the phone); used by BOTH phone agents (shop + studio)
  // owner 24.11: the agent texts the caller first («reply with your name and e-mail») from the line she reached, so a forwarded studio call works too
  if (tool === "send_caller_sms") {
    noteCallTool(conv, tool).catch(() => {});
    const line = String(input.called || "").replace(/[^\d+]/g, "") === "+37258989356" || String(input.line || "") === "studio" ? "studio" : "shop";
    const from = line === "studio" ? "+37258989356" : "+37258989535";
    if (!caller) return Response.json({ result: JSON.stringify({ sent: false, note: `Her number is hidden - cannot text her. Dictate the SMS number instead (${line === "studio" ? "5898 9356" : "5898 9535"}), or take the name and e-mail by voice and spell the e-mail back.` }) });
    const r = await sendSms(caller, askDetailsSmsText(String(input.lang || "et"), line), from);
    console.log(`[voice] ${conv} send_caller_sms ${line} -> ${r.ok ? "sent" : "failed " + r.error}`);
    return Response.json({ result: JSON.stringify(r.ok
      ? { sent: true, note: "The SMS is on its way. Tell her: an SMS just came from us - please reply to it with first name, last name and e-mail. Wait, then call read_caller_sms." }
      : { sent: false, note: `The SMS could not be sent. Dictate the SMS number instead (${line === "studio" ? "5898 9356" : "5898 9535"}, repeat it once), or take the data by voice and spell the e-mail back.` }) });
  }
  if (tool === "read_caller_sms") {
    noteCallTool(conv, tool).catch(() => {});
    const r = await recentSmsFrom(caller, Number(input.minutes) || 20);
    if (!r.ok) return Response.json({ result: JSON.stringify({ found: false, note: `Cannot read SMS (${r.error}). Ask her to say it and spell the e-mail back letter by letter.` }) });
    console.log(`[voice] ${conv} read_caller_sms -> found=${r.found} email=${r.email ? "yes" : "no"}`);
    return Response.json({ result: JSON.stringify(r.found
      ? { found: true, name: r.name, email: r.email, text: r.text, note: "Use exactly these. Say thank you and repeat only the first name; never spell the e-mail aloud." }
      : { found: false, note: "No SMS from her number yet. Wait a little and check once more; if still nothing, she may say it and you spell it back." }) });
  }

  let session = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel: "phone", externalId: conv } } });
  if (!session)
    session = await prisma.chatSession.create({
      data: { channel: "phone", externalId: conv, visitorId: caller || null, title: `Звонок ${caller || "(номер скрыт)"}`.slice(0, 40), model: "claude", temperature: 0.5, topP: 1 },
    });

  if (tool === "save_call_note") {
    const note = String(input.summary || "").slice(0, 3000);
    const name = String(input.client_name || "").slice(0, 80);
    await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: `📞 Звонок${caller ? ` с ${caller}` : ""}${name ? ` · ${name}` : ""}\n${note}`, meta: { phone: true, caller } } });
    await prisma.chatSession.update({ where: { id: session.id }, data: { ...(name ? { customerName: name } : {}), title: `Звонок ${name || caller || ""}`.trim().slice(0, 40) } });
    // owner 17.11: a card about every call to her private chat (the post-call webhook does it when set up, with duration and language)
    if (!postCallWebhookOn())
      await reportCall({ conversationId: conv, caller, startedAt: session.createdAt, summary: note, clientName: name, actions: await callActions(conv) }).catch((e) => console.error("[call-report]", e));
    return Response.json({ result: "saved" });
  }

  const ctx: ToolContext = { sessionId: session.id, channel: "phone", discountGiven: true, verifiedEmail: null, callerPhone: caller || null, out: { products: [], tools: [] } };
  // the team must be able to call back: the caller's number goes into handoffs and tasks
  if (caller && (tool === "handoff_to_human" || tool === "add_team_task")) {
    const key = tool === "handoff_to_human" ? "summary" : "text";
    input[key] = `${String(input[key] || "")}\nТелефон клиента: ${caller}`;
  }
  noteCallTool(conv, tool).catch(() => {});
  const result = await runTool(tool, input, ctx).catch((e) => JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  console.log(`[voice] ${conv} ${tool} -> ${result.slice(0, 160).replace(/\s+/g, " ")}`);
  return Response.json({ result });
}
