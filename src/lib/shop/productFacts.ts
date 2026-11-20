/**
 * Growth 20.11: product facts the team already told Deisi (heel height, material, fit, how a fastening works...).
 * 19.11 a client asked the heel height of Leather Latin Dance Shoes; it was not in the description, Deisi asked the team and the
 * client waited 7 hours for «7 cm». Every answer to an ask_team product question is now kept per product (Setting pfact:<handle>)
 * and get_product returns it as team_facts, so the next client gets the answer at once without asking anybody.
 * Only durable facts about the product itself - never stock, dates, prices, client details or one-off decisions.
 */
import { prisma } from "@/lib/prisma";
import { callClaude } from "@/lib/llm";

type Fact = { fact: string; at: string };
const KEY = (h: string) => `pfact:${h}`;

export async function productFacts(handle: string): Promise<string[]> {
  if (!handle) return [];
  const row = await prisma.setting.findUnique({ where: { key: KEY(handle) } }).catch(() => null);
  if (!row) return [];
  try {
    return (JSON.parse(row.value) as Fact[]).map((f) => f.fact).filter(Boolean);
  } catch {
    return [];
  }
}

async function addFact(handle: string, fact: string) {
  const old = await prisma.setting.findUnique({ where: { key: KEY(handle) } }).catch(() => null);
  let list: Fact[] = [];
  try {
    list = old ? (JSON.parse(old.value) as Fact[]) : [];
  } catch {
    list = [];
  }
  if (list.some((f) => f.fact.toLowerCase() === fact.toLowerCase())) return;
  list = [...list, { fact, at: new Date().toISOString() }].slice(-8);
  await prisma.setting.upsert({ where: { key: KEY(handle) }, update: { value: JSON.stringify(list) }, create: { key: KEY(handle), value: JSON.stringify(list) } });
}

const RULES = `You read one question that DEESSE's shop assistant asked her colleagues and the colleague's answer.
Decide whether the answer contains a DURABLE FACT ABOUT A PRODUCT that will be true for the next client too
(heel / platform height, shaft height, material, sole, fastening, sizing / fit advice, what is included, care, how it looks / colour shade, which use it suits).
NOT durable (return none): stock, sizes in stock, delivery / supplier dates, prices, discounts, reservations, pickup times, anything about this client or her order, one-off decisions, suggestions of other products.
Candidate products (handle: title) are given; use only one of these handles.
Answer ONLY with JSON: {"facts":[{"handle":"<handle>","fact":"<one short English sentence with the product name and the fact, e.g. \\"Leather Latin Dance Shoes: heel height 7 cm.\\">"}]} or {"facts":[]}.`;

/** Called after the team answered ask_team: keep the product fact (best effort, never throws). */
export async function learnProductFact(question: string, answer: string, sessionId: string) {
  try {
    const handles = new Set<string>();
    for (const m of question.matchAll(/(?:products\/)?([a-z0-9]+(?:-[a-z0-9]+){1,})/g)) handles.add(m[1]);
    const recent = await prisma.message.findMany({ where: { sessionId, role: "assistant" }, orderBy: { createdAt: "desc" }, take: 6, select: { meta: true } });
    const titles: Record<string, string> = {};
    for (const r of recent) {
      const prods = ((r.meta as { products?: { handle: string; title: string }[] } | null)?.products) || [];
      for (const p of prods) {
        handles.add(p.handle);
        titles[p.handle] = p.title;
      }
    }
    // keep only real product handles
    const cand = [...handles].filter((h) => titles[h] || /-/.test(h)).slice(0, 12);
    if (!cand.length) return;
    const res = await callClaude({
      system: RULES,
      messages: [{ role: "user", content: `Candidates:\n${cand.map((h) => `${h}: ${titles[h] || "?"}`).join("\n")}\n\nQuestion: ${question.slice(0, 800)}\nAnswer: ${answer.slice(0, 800)}` }],
      model: "claude-sonnet-5-5",
      maxTokens: 300,
      temperature: 0,
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { facts?: { handle: string; fact: string }[] };
    for (const f of j.facts || []) {
      if (!f?.handle || !f?.fact || !cand.includes(f.handle)) continue;
      if (/@|\+?\d{7,}|€/.test(f.fact)) continue; // no contacts, no prices
      await addFact(f.handle, String(f.fact).slice(0, 200));
      console.log(`[pfact] ${f.handle}: ${f.fact}`);
    }
  } catch (e) {
    console.error("[pfact]", String(e).slice(0, 200));
  }
}
