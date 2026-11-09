import { prisma } from "@/lib/prisma";
import { callClaude, hasApiKey, type ContentBlock, type LlmMessage } from "@/lib/llm";
import { SHOP_PERSONA_NAME, isSalesAgentPrompt } from "@/lib/default-prompts";
import { detectLanguage, ensureDeesySignature, sendMessage as mockSend } from "@/lib/mock-ai";
import { getCatalog, type CatalogProduct } from "./catalog";
import { activePromotions, promoNote } from "./shopify";
import { buildSystemPrompt, SHOP_EMAIL, SHOP_URL, type Channel } from "./knowledge";
import { discountCode, orderLookupReady, runTool, toolDefs, type ToolContext } from "./tools";
import { rulesBlock, similarExamples } from "./learning";

/** Language of one message (null when it has no words, e.g. only emoji or a photo). */
export function messageLanguage(text: string, preferredLang?: string | null): string | null {
  const t = String(text || "");
  if (!/\p{L}/u.test(t)) return null;
  if (/[іїєґ]/i.test(t)) return "Ukrainian";
  if (/[а-яё]/i.test(t)) return "Russian";
  if (/[āēīūčņļķģ]/i.test(t)) return "Latvian";
  if (/[ąęėįų]/i.test(t)) return "Lithuanian";
  if (/[õ]/i.test(t) || /\b(tere|palun|aitäh|soovin|tahan|kingad|suurus|kas|mis|kuidas|hind|tellida|osta|pakiautomaat|jah|minu|teil|mul|tänan)\b/i.test(t)) return "Estonian";
  // Unicode word boundaries also match Finnish words ending in ä/ö. Include all widget chips.
  if (/(?:^|[^\p{L}])(kiitos|moi|haluaisin|haluan|tarvitsen|voinko|voitteko|kengät|koko|kokoani|koon|onko|paljonko|hinta|auta|apua|toimitus|nouto|palautukset|vaihdot|saatavilla|kyllä)(?=$|[^\p{L}])/iu.test(t)) return "Finnish";
  // A model code has no language: retain the last meaningful message's language.
  if (preferredLang === "fi" && /^[A-Z0-9][A-Z0-9 ._/-]*$/.test(t.trim()) && /\d/.test(t)) return null;
  // On a Finnish page, neutral product names and unrecognised Finnish words must not
  // become Estonian just because they contain ä/ö. A clear language switch still wins.
  if (preferredLang === "fi" && !/\b(hello|hi|thanks|thank you|please|help|what|which|where|when|how|can|could|would|is|are|do|does|want|need|delivery|returns|size|shoes)\b/i.test(t)) return "Finnish";
  // Owner 09.11: a bare «Hei» is also Estonian, so it is Finnish only on the Finnish page (handled above);
  // elsewhere it is Estonian unless the message has clear English words.
  if (/(?:^|[^\p{L}])hei(?=$|[^\p{L}])/iu.test(t) && !/\b(hello|hi|thanks|thank you|please|help|what|which|where|when|how|can|could|would|is|are|do|does|want|need|delivery|returns|size|shoes)\b/i.test(t)) return "Estonian";
  if (/[äöü]/i.test(t)) return "Estonian";
  return "English";
}

/**
 * Native Estonian editor pass (studio lesson 03.11): fixes calques, cases and unnatural phrases.
 * Facts are protected: if any link, e-mail, code or number is missing after the edit, the original is kept.
 */
export async function polishEt(src: string) {
  if (src.trim().length < 40 || !hasApiKey()) return src;
  const system =
    "You are a native Estonian copy editor at DEESSE, a pole dance and dancewear shop in Tallinn (deesse.ee). Edit the Estonian text so it reads as if a native Estonian shop assistant wrote it: replace word-for-word translations from Russian or English, wrong cases and endings, and unnatural phrases. Pole dance is «postitants» (never «post» for the pole); keep product names, sizes and English style names (Exotic, Flow, Frame Up, High Heels) as they are. Keep the meaning, the polite «Teie», the structure, paragraphs and line breaks. Keep EXACTLY every name, number, price, size, date, link, e-mail, code and product name. Do not add or remove information, greetings or closings. If the text is already natural, return it unchanged. Return only the text, nothing else.";
  try {
    const res = await Promise.race([
      callClaude({ system, messages: [{ role: "user", content: src }], model: "claude-opus-5-5", maxTokens: 2000, temperature: 0.2 }),
      new Promise<null>((r) => setTimeout(() => r(null), 25_000)),
    ]);
    if (!res || (res.stop_reason && !["end_turn", "stop_sequence"].includes(res.stop_reason))) return src;
    const out = res.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!out || out.length < src.length * 0.6 || out.length > src.length * 1.5) return src;
    const keep = src.match(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\b[A-Z0-9]{6,}\b|\d+(?:[.,:]\d+)*/g) || [];
    const miss = keep.filter((x) => !out.includes(x.replace(/[).,!?»]+$/, "")));
    if (miss.length) {
      console.error("[polishEt] kept original, missing:", miss.slice(0, 5).join(" "));
      return src;
    }
    return out;
  } catch (e) {
    console.error("[polishEt]", e);
    return src;
  }
}

/** Instagram and Messenger show plain text only. */
function plainText(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1: $2");
}

export type IncomingFile = { name: string; type: string; data: string /* base64 without the data: prefix */ };

export type ProductCard = { handle: string; title: string; price: string; image: string | null; url: string; inStock: boolean };

export type AgentMeta = {
  engine: "claude" | "mock" | "offline";
  model?: string;
  products?: ProductCard[];
  cartUrl?: string;
  order?: string;
  discount?: string;
  handoff?: string;
  skip?: { category: string; reason: string };
  tools?: string[];
  usage?: { input: number; output: number };
  error?: string;
};

type SessionForAgent = {
  id: string;
  channel: string;
  model: string;
  temperature: number;
  topP: number;
  pageUrl: string | null;
  customerName: string | null;
  customerEmail: string | null;
  lang?: string | null;
  systemPrompt: { name: string; content: string } | null;
};

/** Claude model id for the model chosen in the chat. GPT-4 and Local Llama stay simulated (homework spec). */
function claudeModelFor(model: string): string | null {
  if (model === "claude") return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  if (model.startsWith("claude-")) return model;
  return null;
}

const HISTORY_LIMIT = 30;
const MAX_TOOL_ROUNDS = 7;

const OFFLINE_TEXT: Record<string, string> = {
  en: `Thank you for your message! Our assistant is offline at the moment. Please write to ${SHOP_EMAIL} and a colleague will answer you.`,
  et: `Aitäh sõnumi eest! Assistent ei ole hetkel saadaval. Palun kirjutage ${SHOP_EMAIL} ja kolleeg vastab teile.`,
  ru: `Спасибо за сообщение! Ассистент сейчас недоступен. Пожалуйста, напишите на ${SHOP_EMAIL}, и коллега Вам ответит.`,
  fi: `Kiitos viestistä! Avustaja ei ole juuri nyt käytettävissä. Lähetä viesti osoitteeseen ${SHOP_EMAIL}, niin DEESSE-tiimi vastaa sinulle.`,
};

/**
 * One reply of the shop assistant. History is read from the database (the new user message must already be saved).
 * Returns the text and meta (product cards, cart link, handoff, tools).
 */
export async function runAgent(session: SessionForAgent, files: IncomingFile[] = []): Promise<{ text: string; meta: AgentMeta }> {
  const channel = session.channel as Channel;
  const rows = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  rows.reverse();
  // a colleague's answer to Deisi's question (ask_team) is stored as an internal note: not the client's words
  const isInternal = (m: { meta: unknown }) => Boolean((m.meta as { internal?: boolean } | null)?.internal);
  const lastUser = [...rows].reverse().find((m) => m.role === "user" && !isInternal(m));
  const preferredLang = channel === "web" ? session.lang : null;
  const replyLang = [...rows].reverse().filter((m) => m.role === "user" && !isInternal(m)).map((m) => messageLanguage(m.content, preferredLang)).find(Boolean)
    ?? (preferredLang === "fi" ? "Finnish" : null);
  const lang = replyLang === "Finnish" ? "fi" : detectLanguage(lastUser?.content ?? "");

  const isDeesyPersona = isSalesAgentPrompt(session.systemPrompt?.name);
  const shopMode = channel !== "app" || isDeesyPersona || session.systemPrompt?.name === SHOP_PERSONA_NAME;
  // owner 05.11 (like at the studio): clients are answered by the strongest model
  const model = channel === "app" ? claudeModelFor(session.model) : process.env.SHOP_MODEL || "claude-opus-5-5";

  // Admin/homework chat with GPT-4 / Local Llama, or no API key yet: the simulated assistant.
  if (!model || !hasApiKey()) {
    if (channel !== "app") return { text: OFFLINE_TEXT[lang] ?? OFFLINE_TEXT.en, meta: { engine: "offline" } };
    const text = await mockSend(lastUser?.content ?? "", session.model, { temperature: session.temperature, topP: session.topP }, session.systemPrompt);
    const note = !hasApiKey() && model ? "\n\n(Demo answer: add ANTHROPIC_API_KEY in Railway Variables to switch on the real Claude.)" : "";
    return { text: text + note, meta: { engine: "mock" } };
  }

  const messages = toLlmMessages(rows, files);
  const prevMeta = rows.filter((m) => m.role === "assistant").map((m) => (m.meta ?? {}) as AgentMeta);
  const ctx: ToolContext = {
    sessionId: session.id,
    channel,
    discountGiven: prevMeta.some((m) => m.discount),
    verifiedEmail: channel === "email" ? session.customerEmail : null,
    out: { products: [], tools: [] },
  };
  // a discount offered earlier in this chat stays in the cart links
  const earlierDiscount = prevMeta.find((m) => m.discount)?.discount;
  if (earlierDiscount) ctx.out.discount = earlierDiscount;

  // studio lessons: answer in the language of the latest message, greet once, learn from our team's answers and corrections
  const greeted = rows.some((m) => m.role === "assistant");
  const [rules, examples, promos] = shopMode
    ? await Promise.all([rulesBlock().catch(() => ""), similarExamples(lastUser?.content ?? "").catch(() => ""), activePromotions().catch(() => null)])
    : (["", "", null] as [string, string, null]);
  const turnNotes = [
    `Now in Tallinn: ${new Date().toLocaleString("en-GB", { timeZone: "Europe/Tallinn", dateStyle: "full", timeStyle: "short" })}.`,
    replyLang ? `LANGUAGE NOW: the client's latest message is in ${replyLang}. Write your whole reply in ${replyLang}, even if earlier messages of this conversation (or your own earlier replies) were in another language.` : "",
    promoNote(promos),
    greeted ? "You already greeted this client in this conversation: do not greet again and do not introduce yourself again, go straight to the answer." : "",
  ].filter(Boolean);
  const system = shopMode
    ? [buildSystemPrompt({
        channel,
        persona: session.systemPrompt?.content,
        pageUrl: session.pageUrl,
        customer: { name: session.customerName, email: session.customerEmail },
        discountAvailable: Boolean(discountCode()) && !ctx.discountGiven,
        orderLookup: orderLookupReady(),
      }), rules].filter(Boolean).join("\n\n")
    : session.systemPrompt?.content || "You are a helpful assistant. Answer clearly and concisely.";
  const systemExtra = shopMode ? [examples, ...turnNotes].filter(Boolean).join("\n\n") : "";
  const tools = shopMode ? toolDefs(channel) : [];

  const usage = { input: 0, output: 0 };
  let text = "";
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await callClaude({
        system,
        systemExtra,
        messages,
        tools,
        model,
        temperature: session.temperature,
        topP: session.topP,
        maxTokens: channel === "email" ? 1600 : 1000,
      });
      usage.input += res.usage?.input_tokens ?? 0;
      usage.output += res.usage?.output_tokens ?? 0;
      const uses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      text = res.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (res.stop_reason !== "tool_use" || uses.length === 0) break;
      messages.push({ role: "assistant", content: res.content });
      const results: ContentBlock[] = [];
      for (const u of uses) {
        let out: string;
        let isError = false;
        try {
          out = await runTool(u.name, u.input ?? {}, ctx);
        } catch (e) {
          console.error("[agent] tool failed", u.name, e);
          out = JSON.stringify({ error: "The tool failed. Do not guess: apologise briefly and offer a colleague's help." });
          isError = true;
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      text = "";
    }
  } catch (e) {
    console.error("[agent] Claude call failed", e);
    if (channel === "app") return { text: `⚠️ ${(e as Error).message}`, meta: { engine: "claude", model, error: (e as Error).message } };
    return { text: OFFLINE_TEXT[lang] ?? OFFLINE_TEXT.en, meta: { engine: "offline", model, error: (e as Error).message } };
  }

  if (!text || (ctx.out.skip && channel !== "email" && ctx.out.skip.category === "spam")) text = ctx.out.skip ? "SKIP" : OFFLINE_TEXT[lang] ?? OFFLINE_TEXT.en;

  let cards: ProductCard[] = [];
  if (shopMode) {
    const catalog = await getCatalog().catch(() => [] as CatalogProduct[]);
    const guarded = guardLinks(text, catalog, ctx.out.cartUrl);
    text = guarded.text;
    cards = guarded.handles
      .map((h) => catalog.find((p) => p.handle === h))
      .filter((p): p is CatalogProduct => Boolean(p))
      .slice(0, 4)
      .map(card);
  }
  if (channel === "app" && isDeesyPersona) text = ensureDeesySignature(text);
  if (channel === "instagram" || channel === "messenger") text = plainText(text);
  // owner 05.11 (like at the studio): every Estonian answer gets a native Estonian editor pass
  if (replyLang === "Estonian" && text !== "SKIP") text = await polishEt(text);

  // review copy for Claude's daily checks (owner 05.11: «контролировать и постоянно улучшать Дейси»): contacts are masked
  if (channel !== "app") {
    const mask = (t: string) =>
      t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\+?\d[\d\s-]{6,}\d/g, "[phone]").slice(0, 1500);
    console.log(
      "[review] " +
        JSON.stringify({ ch: channel, s: session.id.slice(-6), client: mask(lastUser?.content ?? ""), deisi: mask(text), tools: ctx.out.tools, handoff: Boolean(ctx.out.handoff), order: ctx.out.order ?? null }),
    );
  }
  return {
    text,
    meta: {
      engine: "claude",
      model,
      ...(cards.length ? { products: cards } : {}),
      ...(ctx.out.cartUrl && text.includes(ctx.out.cartUrl) ? { cartUrl: ctx.out.cartUrl } : {}),
      ...(ctx.out.order ? { order: ctx.out.order } : {}),
      ...(ctx.out.discount && !earlierDiscount ? { discount: ctx.out.discount } : {}),
      ...(ctx.out.handoff ? { handoff: ctx.out.handoff } : {}),
      ...(ctx.out.skip ? { skip: ctx.out.skip } : {}),
      tools: ctx.out.tools,
      usage,
    },
  };
}

function card(p: CatalogProduct): ProductCard {
  const price = p.priceMin === p.priceMax ? `${p.priceMin.toFixed(2)} €` : `${p.priceMin.toFixed(2)}–${p.priceMax.toFixed(2)} €`;
  return { handle: p.handle, title: p.title, price, image: p.image, url: p.url, inStock: p.inStock };
}

const SAFE_HOSTS = /^(www\.)?(deessestudio\.ee|instagram\.com|facebook\.com)$/i;

/**
 * Studio lesson: the model must never send a link it made up.
 * Product links must point to a real product, cart links must be the one the tool made; other shop pages are fine.
 */
export function guardLinks(text: string, catalog: CatalogProduct[], cartUrl?: string) {
  const shopHost = new URL(SHOP_URL).host.replace(/^www\./, "");
  const handles: string[] = [];
  const out = text.replace(/https?:\/\/[^\s<>()"'\]]+[^\s<>()"'\].,;:!?»]/g, (raw) => {
    if (cartUrl && raw === cartUrl) return raw;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return SHOP_URL;
    }
    const host = u.host.replace(/^www\./, "");
    if (host === shopHost) {
      const m = u.pathname.match(/^\/(?:collections\/[^/]+\/)?products\/([^/?#]+)/);
      if (m) {
        const p = catalog.find((x) => x.handle === decodeURIComponent(m[1]));
        if (!p) return SHOP_URL;
        if (!handles.includes(p.handle)) handles.push(p.handle);
        return p.url;
      }
      if (u.pathname.startsWith("/cart/")) return cartUrl && raw === cartUrl ? raw : cartUrl ?? `${SHOP_URL}/cart`;
      // PM 09.11: a discount link applies a code - Deisi never invents codes (a real code goes into create_order)
      if (u.pathname.startsWith("/discount/") || u.searchParams.has("discount")) return SHOP_URL;
      return raw;
    }
    if (SAFE_HOSTS.test(host)) return raw;
    return SHOP_URL;
  });
  return { text: out, handles };
}

type Row = { role: "user" | "assistant"; content: string; attachments: unknown };

/** Database messages → Anthropic messages (same roles merged, first message from the user). Files only for the newest message. */
function toLlmMessages(rows: Row[], files: IncomingFile[]): LlmMessage[] {
  const list: { role: "user" | "assistant"; blocks: ContentBlock[] }[] = [];
  rows.forEach((m, i) => {
    const blocks: ContentBlock[] = [];
    const isNewest = i === rows.length - 1 && m.role === "user";
    if (isNewest)
      for (const f of files) {
        if (f.type.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
        else if (f.type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      }
    const names = Array.isArray(m.attachments) ? (m.attachments as { name?: string }[]).map((a) => a.name).filter(Boolean) : [];
    const note = names.length && !isNewest ? `[attached: ${names.join(", ")}]` : "";
    const text = [m.content, note].filter(Boolean).join("\n").trim();
    if (text) blocks.push({ type: "text", text });
    if (!blocks.length) return;
    const prev = list[list.length - 1];
    if (prev && prev.role === m.role) prev.blocks.push(...blocks);
    else list.push({ role: m.role, blocks });
  });
  while (list.length && list[0].role !== "user") list.shift();
  return list.map((m) => ({ role: m.role, content: m.blocks }));
}
