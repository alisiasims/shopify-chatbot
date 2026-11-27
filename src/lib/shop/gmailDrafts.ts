/**
 * Deisi's own Gmail drafts (owner 27.11: «почему Дейси не видит черновики в Gmail? Это она их пишет»).
 * Deisi's e-mail answers are saved as Gmail drafts by the Apps Script bridge (integrations/gmail-bridge.gs) in info@deesse.ee.
 * Every run the bridge reports the reply drafts it sees (op "drafts"); the app keeps the ones that are Deisi's (the thread has
 * the label Deisi/draft, or the draft text is one of Deisi's answers in that e-mail chat) in Setting gmail_drafts.
 * The team asks in Telegram («какие черновики висят?», «удали черновик для X») -> team tools gmail_drafts / delete_draft.
 * A deletion is queued (Setting draft_drop:<draftId>); the bridge deletes the draft on its next run and acks (op "drafts_dropped").
 */
import { prisma } from "@/lib/prisma";

export type GDraft = { id: string; threadId: string; to: string; subject: string; date: string; text: string; label?: boolean };
type Kept = GDraft & { sessionId?: string; client?: string };
const KEY = "gmail_drafts";
const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();

function clean(x: unknown): GDraft | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const id = String(o.id || "").slice(0, 120), threadId = String(o.threadId || "").slice(0, 100);
  if (!id || !threadId) return null;
  return { id, threadId, to: String(o.to || "").slice(0, 200), subject: String(o.subject || "").slice(0, 200), date: String(o.date || ""), text: String(o.text || "").slice(0, 1500), label: !!o.label };
}

/** op "drafts": store Deisi's drafts, return the ids the team asked to delete. */
export async function syncDrafts(raw: unknown): Promise<{ drop: string[]; kept: number }> {
  const drafts = (Array.isArray(raw) ? raw : []).map(clean).filter((d): d is GDraft => !!d).slice(0, 100);
  const threadIds = [...new Set(drafts.map((d) => d.threadId))];
  const sessions = threadIds.length
    ? await prisma.chatSession.findMany({
        where: { channel: "email", externalId: { in: threadIds } },
        select: { id: true, externalId: true, customerName: true, customerEmail: true, title: true, messages: { where: { role: "assistant" }, orderBy: { createdAt: "desc" }, take: 10, select: { content: true } } },
      })
    : [];
  const byThread = new Map(sessions.map((s) => [s.externalId, s]));
  const kept: Kept[] = [];
  for (const d of drafts) {
    const s = byThread.get(d.threadId);
    const head = norm(d.text).slice(0, 80);
    const mine = d.label || (!!s && head.length > 15 && s.messages.some((m) => norm(m.content).includes(head)));
    if (!mine) continue;
    kept.push({ ...d, text: d.text.slice(0, 400), sessionId: s?.id, client: s ? s.customerName || s.customerEmail || s.title : d.to });
  }
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: JSON.stringify({ at: new Date().toISOString(), drafts: kept }) }, create: { key: KEY, value: JSON.stringify({ at: new Date().toISOString(), drafts: kept }) } });
  const queued = await prisma.setting.findMany({ where: { key: { startsWith: "draft_drop:" } }, take: 50 });
  const present = new Set(drafts.map((d) => d.id));
  const drop: string[] = [];
  for (const q of queued) {
    const id = q.key.slice("draft_drop:".length);
    if (present.has(id)) drop.push(id);
    else await prisma.setting.delete({ where: { key: q.key } }).catch(() => null); // already sent / deleted by a person
  }
  const prev = await prisma.setting.findUnique({ where: { key: "drafts_log_at" } });
  if (drop.length || !prev || Date.now() - new Date(prev.value).getTime() > 3600_000) {   // one log line an hour (or when deleting)
    console.log(`[drafts] gmail reply drafts ${drafts.length}, Deisi's ${kept.length}, to delete ${drop.length}`);
    await prisma.setting.upsert({ where: { key: "drafts_log_at" }, update: { value: new Date().toISOString() }, create: { key: "drafts_log_at", value: new Date().toISOString() } });
  }
  return { drop, kept: kept.length };
}

/** op "drafts_dropped": the bridge deleted these drafts. */
export async function draftsDropped(ids: unknown, failed: unknown) {
  const done: string[] = Array.isArray(ids) ? ids.map(String) : [];
  for (const id of done) await prisma.setting.delete({ where: { key: `draft_drop:${id}` } }).catch(() => null);
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (row && done.length) {
    const o = JSON.parse(row.value) as { at: string; drafts: Kept[] };
    o.drafts = o.drafts.filter((d) => !done.includes(d.id));
    await prisma.setting.update({ where: { key: KEY }, data: { value: JSON.stringify(o) } });
  }
  if (Array.isArray(failed) && failed.length) console.warn("[drafts] delete failed " + JSON.stringify(failed).slice(0, 400));
  if (done.length) console.log(`[drafts] deleted ${done.length}`);
  return { ok: true };
}

async function current(): Promise<{ at: string | null; drafts: Kept[] }> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return { at: null, drafts: [] };
  try { return JSON.parse(row.value); } catch { return { at: null, drafts: [] }; }
}

function match(drafts: Kept[], query: string) {
  const q = norm(query).replace(/[«»"“”„#]/g, " ");
  const words = q.split(/\s+/).filter((w) => w.length > 1 && !["черновик", "черновики", "для", "удали", "удалить", "по", "заказ", "клиентке", "клиента"].includes(w));
  if (!words.length) return [];
  const scored = drafts.map((d) => ({ d, n: words.filter((w) => norm(`${d.client} ${d.to} ${d.subject} ${d.text}`).includes(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  return scored.filter((x) => x.n === scored[0]?.n).map((x) => x.d);
}

const ageRu = (iso: string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  return h < 1 ? "меньше часа" : h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн`;
};

/** team tool gmail_drafts */
export async function listDrafts(query = "") {
  const { at, drafts } = await current();
  if (!at) return { error: "The Gmail bridge has not reported drafts yet (its Apps Script copy must be updated). Say so in one line." };
  const list = query ? match(drafts, query) : drafts;
  const queued = new Set((await prisma.setting.findMany({ where: { key: { startsWith: "draft_drop:" } }, select: { key: true } })).map((r) => r.key.slice(11)));
  return {
    checked: ageRu(at) + " назад",
    count: list.length,
    drafts: list.slice(0, 15).map((d) => ({ client: d.client, subject: d.subject, age: ageRu(d.date), start: d.text.slice(0, 160), deleting: queued.has(d.id) || undefined })),
  };
}

/** team tool delete_draft: queue the deletion; the bridge deletes it within ~5 minutes. */
export async function deleteDraft(query: string, all: boolean, by: string) {
  const { at, drafts } = await current();
  if (!at) return { error: "The Gmail bridge has not reported drafts yet (its Apps Script copy must be updated). Ask to delete it by hand, one line." };
  const found = match(drafts, query);
  if (!found.length) return { queued: 0, note: `No Deisi draft for «${query}» in Gmail (checked ${ageRu(at)} ago). Say so in one line; a person's own draft is not yours to delete.` };
  const threads = new Set(found.map((d) => d.threadId));
  if (threads.size > 1 && !all) return { queued: 0, note: "Drafts of several clients match - ask which one (one line).", matches: found.map((d) => `${d.client} · ${d.subject}`) };
  for (const d of found)
    await prisma.setting.upsert({ where: { key: `draft_drop:${d.id}` }, update: { value: JSON.stringify({ by, at: Date.now() }) }, create: { key: `draft_drop:${d.id}`, value: JSON.stringify({ by, at: Date.now() }) } });
  return { queued: found.length, clients: [...new Set(found.map((d) => d.client))], note: "Gmail deletes it within ~5 minutes (the bridge runs every 5 min). Answer in one line «Удалю черновик для … в течение 5 минут»." };
}
