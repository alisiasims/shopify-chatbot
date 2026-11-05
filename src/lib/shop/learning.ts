/**
 * How Deisi learns (same way as Deisi at DEESSE Studio):
 * 1. Examples: how our people answered clients before (Instagram / Messenger history, Gmail replies).
 *    For each new client message the most similar examples go into the prompt.
 * 2. Rules: corrections from the owner and admins (/fix in Telegram). They override the knowledge.
 */
import { prisma } from "@/lib/prisma";

// GDPR: no contact data, no health topics, no private deals or codes in learned examples
const PRIVATE_RE =
  /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{6,}\d|IBAN|\bEE\d{6,}|haige|haigus|arsti|tervis|rase|vigastus|болез|болел|больн|травм|беремен|врач|здоров|sick|injur|pregnan|doctor|health|koostöö|barter|сотрудничеств|бартер|promo ?code|\b[A-Z]{3,}\d{2}\b/i;
const AUTO_RE = /I'm here and ready to help|I received your message|You mentioned (him|her|you) in (your|their) story|replied to your story|reacted to your/i;

function cleanAnswer(a: string) {
  const lines = String(a || "").split("\n");
  while (
    lines.length &&
    /^\s*$|^\s*(с уважением|lugupidamisega|parimate soovidega|heade soovidega|best regards|kind regards|tervitades)[,!.]?\s*$|^\s*(deesse( team| shop)?|alisia|алисия)\s*$/i.test(lines[lines.length - 1])
  )
    lines.pop();
  return lines.join("\n").trim();
}

function scrub(q: string, a: string) {
  if (PRIVATE_RE.test(q) || PRIVATE_RE.test(a)) return null;
  const greet = /^(\s*(?:tere|hei|здравствуйте|добрый день|добрый вечер|привет|hi|hello|hey)[,!]?\s+)([A-ZÕÄÖÜА-ЯЁ][\p{L}-]+)/iu;
  const ans = a.replace(greet, (_m, g) => `${g}[name]`);
  return q.trim() && ans.trim() ? { q: q.trim(), a: ans.trim() } : null;
}

export async function saveExample(question: string, answer: string, source: string, lang?: string | null, sourceId?: string | null) {
  const clean = cleanAnswer(answer);
  if (!question || clean.length < 3 || AUTO_RE.test(clean) || AUTO_RE.test(question)) return false;
  const s = scrub(question, clean);
  if (!s) return false;
  if (sourceId && (await prisma.example.findUnique({ where: { sourceId } }))) return false;
  await prisma.example.create({
    data: { question: s.q.slice(0, 1000), answer: s.a.slice(0, 2000), source, lang: lang ?? null, sourceId: sourceId ?? null },
  });
  cache = null;
  return true;
}

let cache: { at: number; items: { question: string; answer: string; source: string }[] } | null = null;
const words = (t: string) =>
  String(t || "")
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length > 3);

/** The most similar earlier answers of our people, as a prompt block (empty when none). */
export async function similarExamples(text: string) {
  if (!cache || Date.now() - cache.at > 10 * 60_000) {
    const items = await prisma.example.findMany({ where: { approved: true }, orderBy: { createdAt: "desc" }, take: 1500, select: { question: true, answer: true, source: true } });
    cache = { at: Date.now(), items };
  }
  const q = new Set(words(text));
  if (!q.size) return "";
  const top = cache.items
    .map((e) => ({ e, hit: words(e.question).filter((w) => q.has(w)).length }))
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, 4);
  if (!top.length) return "";
  return (
    "HOW OUR TEAM ANSWERED SIMILAR MESSAGES BEFORE (copy their tone and approach; [name] = the client's first name; prices, stock and dates may be outdated - always take facts from the tools):\n" +
    top.map((x) => `Client: ${x.e.question}\nDEESSE: ${x.e.answer}`).join("\n---\n")
  );
}

let rulesCache: { at: number; text: string } | null = null;

/** Active corrections from the owner / admins as a prompt block. */
export async function rulesBlock() {
  if (rulesCache && Date.now() - rulesCache.at < 60_000) return rulesCache.text;
  const list = await prisma.rule.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const text = list.length
    ? "CORRECTIONS FROM THE SHOP OWNER AND ADMINS (newer than everything above, they override it; follow them unless they break the rules about payments or privacy):\n" +
      list.map((r, i) => `${i + 1}. ${r.text}`).join("\n")
    : "";
  rulesCache = { at: Date.now(), text };
  return text;
}

export async function addRule(text: string, by?: string) {
  const r = await prisma.rule.create({ data: { text: text.trim().slice(0, 600), by: by ?? null } });
  rulesCache = null;
  return r;
}

export async function listRules() {
  return prisma.rule.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
}

export async function disableRule(n: number) {
  const list = await listRules();
  const r = list[n - 1];
  if (!r) return null;
  await prisma.rule.update({ where: { id: r.id }, data: { active: false } });
  rulesCache = null;
  return r;
}

type GraphMsg = { id: string; message?: string; created_time: string; from?: { id: string; username?: string; name?: string } };

/**
 * Imports how our team answered in Instagram Direct and Messenger before Deisi (owner 05.11).
 * Pairs: the client's messages → the next answer of our account. Only answers written before `before`.
 */
export async function importMetaHistory(opts: { before: string; maxConversations?: number } = { before: "2026-11-05T12:00:00Z" }) {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return { error: "META_PAGE_TOKEN is not set" };
  const pageId = process.env.META_PAGE_ID || "104400848423200";
  const igName = (process.env.META_IG_USERNAME || "deesse_style").toLowerCase();
  const igId = process.env.META_IG_ID || (await prisma.setting.findUnique({ where: { key: "ig_account_id" } }))?.value || "";
  const cutoff = Date.parse(opts.before);
  const max = opts.maxConversations ?? 300;
  const result: Record<string, { conversations: number; saved: number; error?: string }> = {};

  for (const platform of ["instagram", "messenger"] as const) {
    const stat = { conversations: 0, saved: 0 } as { conversations: number; saved: number; error?: string };
    result[platform] = stat;
    let url: string | null =
      `https://graph.facebook.com/v21.0/${pageId}/conversations?platform=${platform}&limit=10` +
      `&fields=${encodeURIComponent("messages.limit(25){id,message,created_time,from}")}&access_token=${encodeURIComponent(token)}`;
    while (url && stat.conversations < max) {
      const res: Response = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as {
        data?: { messages?: { data?: GraphMsg[] } }[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        stat.error = data.error?.message ?? `HTTP ${res.status}`;
        break;
      }
      for (const conv of data.data ?? []) {
        stat.conversations++;
        const msgs = [...(conv.messages?.data ?? [])].reverse(); // oldest first
        const ours = (m: GraphMsg) =>
          m.from?.id === pageId || (igId && m.from?.id === igId) || (m.from?.username ?? "").toLowerCase() === igName;
        let question: string[] = [];
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i];
          if (!m.message) continue;
          if (!ours(m)) {
            question.push(m.message);
            continue;
          }
          if (!question.length || Date.parse(m.created_time) >= cutoff) continue;
          // our answer may be split into several messages in a row
          const answer = [m.message];
          let lastId = m.id;
          while (i + 1 < msgs.length && ours(msgs[i + 1]) && msgs[i + 1].message) {
            i++;
            answer.push(msgs[i].message!);
            lastId = msgs[i].id;
          }
          if (await saveExample(question.slice(-3).join("\n"), answer.join("\n"), platform, null, `${platform}:${lastId}`)) stat.saved++;
          question = [];
        }
      }
      url = data.paging?.next ?? null;
    }
  }
  return result;
}
