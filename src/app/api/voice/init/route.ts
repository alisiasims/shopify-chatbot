/**
 * Owner 20.11 (from her husband's ElevenLabs agent): the phone Deisi knows WHO is calling before the first word.
 * ElevenLabs «conversation initiation client data» webhook (workspace setting, header x-voice-secret = VOICE_TOOL_SECRET) for inbound
 * Twilio calls of both agents. Lookup ONLY by the caller's own number (caller ID): shop -> Shopify customer + latest orders,
 * studio -> Wix contact (first name, membership, next bookings) via /_functions/phonestudio {tool: "caller_lookup"}.
 * Must answer fast: every lookup has a timeout and an unknown caller is the fallback.
 */
import { customerByPhone } from "@/lib/shop/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_AGENT = "agent_6601m7n421e5f5bbxmm1rsstxs3v";
const OUR_NUMBERS = new Set(["+37258989535", "+37258989356", "+37256210021"]);

function authorized(req: Request) {
  const want = process.env.VOICE_TOOL_SECRET || "";
  const got = req.headers.get("x-voice-secret") || "";
  if (!want || want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

// a known caller is greeted by her first name (owner 20.11: «как у мужа» - the name once, in the greeting)
const GREETING = {
  shop: (n: string) => `Tere, ${n}! Mina olen Deisi, Desse poe virtuaalne assistent. Kuidas saan Teid aidata? Räägin ka vene ja inglise keeles.`,
  studio: (n: string) => `Tere, ${n}! Desse Stuudio, mina olen Deisi, stuudio virtuaalne assistent. Administraatorid on hetkel hõivatud - kuidas saan Teid aidata? Räägin ka vene ja inglise keeles.`,
};

function reply(v: { known: string; first_name: string; info: string }, who: "shop" | "studio" = "shop") {
  return Response.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: { caller_known: v.known, caller_first_name: v.first_name, caller_info: v.info },
    ...(v.known === "yes" && v.first_name ? { conversation_config_override: { agent: { first_message: GREETING[who](v.first_name) } } } : {}),
  });
}


export async function POST(req: Request) {
  const unknown = { known: "no", first_name: "", info: "" };
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const caller = String(b.caller_id || "").replace(/[^\d+]/g, "");
  if (!caller || OUR_NUMBERS.has(caller)) return reply(unknown);
  try {
    if (String(b.agent_id) === STUDIO_AGENT) {
      const r = await withTimeout(
        fetch("https://www.deessestudio.ee/_functions/phonestudio", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-voice-secret": process.env.STUDIO_PHONE_SECRET || "" },
          body: JSON.stringify({ tool: "caller_lookup", caller }),
        }).then((x) => x.json() as Promise<{ result?: { known?: string; first_name?: string; info?: string } }>),
        4500,
        {} as { result?: { known?: string; first_name?: string; info?: string } },
      );
      const v = r?.result;
      console.log(`[voice-init] studio known=${v?.known ?? "timeout"}`);
      return reply(v?.known === "yes" ? { known: "yes", first_name: String(v.first_name || ""), info: String(v.info || "") } : unknown, "studio");
    }
    const c = await withTimeout(customerByPhone(caller).catch((e) => { console.error("[voice-init] shopify", e instanceof Error ? e.message : e); return null; }), 3500, null);
    console.log(`[voice-init] shop known=${c ? "yes" : "no"}`);
    if (!c) return reply(unknown);
    const orders = c.latest
      .map((o) => `${o.order} from ${o.created}: ${o.items.slice(0, 3).join(", ")}; payment ${o.payment ?? "?"}, ${o.cancelled ? "CANCELLED" : `fulfillment ${o.fulfillment ?? "?"}`}${o.shipments.length ? `, shipped ${o.shipments[0].date}` : ""}`)
      .join(" | ");
    const name = /^[\p{L}][\p{L}' -]{1,30}$/u.test(c.firstName) ? c.firstName.split(" ")[0] : "";
    return reply({ known: "yes", first_name: name, info: `${c.orders} order(s) in our shop${orders ? `. Latest: ${orders}` : ""}`.slice(0, 700) });
  } catch (e) {
    console.error("[voice-init]", e instanceof Error ? e.message : e);
    return reply(unknown);
  }
}
