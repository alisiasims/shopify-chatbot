"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Camera, Check, CheckCircle2, Copy, Globe, Mail, MessageCircle, RefreshCw, Repeat, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type View = "review" | "human" | "followups" | "collab" | "spam" | "all";
type Counts = Record<View, number>;
type Summary = {
  id: string;
  title: string;
  channel: string;
  customerName: string | null;
  customerEmail: string | null;
  needsHuman: boolean;
  toReview: boolean;
  topic: string | null;
  updatedAt: string;
  messages: { content: string; role: string; byTeam: boolean }[];
};
type FollowUp = {
  id: string;
  sessionId: string;
  kind: string;
  channel: string;
  text: string;
  status: string;
  reason: string | null;
  createdAt: string;
  session?: { id: string; title: string; channel: string; customerName: string | null; customerEmail: string | null };
};
type Card = { handle: string; title: string; price: string; image: string | null; url: string };
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments: { name: string }[] | null;
  meta: { by?: string; engine?: string; products?: Card[]; cartUrl?: string; tools?: string[]; draft?: boolean; followup?: string } | null;
};
type Detail = Omit<Summary, "messages" | "toReview"> & {
  reviewedAt: string | null;
  messages: Msg[];
  handoffs: { id: string; reason: string; summary: string; contact: string | null; status: string; createdAt: string }[];
  followUps: FollowUp[];
};

const ICON: Record<string, typeof Globe> = { web: Globe, email: Mail, instagram: Camera, messenger: MessageCircle };
const CHANNEL: Record<string, string> = { web: "сайт", email: "почта", instagram: "Instagram", messenger: "Messenger" };
const STATUS: Record<string, string> = { draft: "черновик · отправьте сами", failed: "не отправилось · отправьте сами", sent: "Дейси отправила", done: "готово" };
const KIND: Record<string, string> = { link: "ссылка не оплачена", chat: "замолчала после вопроса" };
const TABS: { id: View; label: string; hint: string }[] = [
  { id: "review", label: "Проверить", hint: "Дейси ответила сама — просто проверьте" },
  { id: "human", label: "Нужен человек", hint: "Дейси передала коллеге — нужно ответить" },
  { id: "followups", label: "Фоллоу-апы", hint: "Дейси напомнила клиентам о покупке" },
  { id: "collab", label: "Сотрудничество", hint: "Инфлюенсеры, бренды, медиа — решает владелица" },
  { id: "spam", label: "Спам", hint: "Спам, реклама и рассылки (от рассылок Дейси отписывается сама)" },
  { id: "all", label: "Все", hint: "Все переписки, кроме спама" },
];
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const byTeam = (m: Msg) => m.meta?.by === "team" || m.meta?.engine === "team";

export function Inbox() {
  const [view, setView] = useState<View>("review");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [list, setList] = useState<Summary[]>([]);
  const [fus, setFus] = useState<FollowUp[]>([]);
  const [active, setActive] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [rule, setRule] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ count: number; syncedAt: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inbox?view=${view}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCounts(data.counts);
      if (view === "followups") setFus(data.items);
      else setList(data.items);
    } catch (e) {
      setNote(`⚠️ ${(e as Error).message}`);
    }
  }, [view]);

  const open = useCallback(async (id: string) => {
    const res = await fetch(`/api/inbox/${id}`);
    if (res.ok) setActive(await res.json());
    setRule("");
    const url = new URL(window.location.href);
    url.searchParams.set("chat", id);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("chat");
    if (id) void open(id);
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }, [open]);

  async function act(body: Record<string, string>, ok?: string) {
    if (!active) return;
    const res = await fetch(`/api/inbox/${active.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setNote(`⚠️ ${(await res.json().catch(() => ({}))).error ?? "Не получилось"}`);
      return;
    }
    if (ok) setNote(ok);
    if (body.action === "reply") setReply("");
    if (body.action === "rule") setRule("");
    await open(active.id);
    await load();
  }

  async function telegramTest() {
    const res = await fetch("/api/inbox/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) });
    const data = await res.json().catch(() => ({}));
    setNote(res.ok && data.ok ? "Telegram: тестовое сообщение отправлено ✅" : `Telegram: ${data.error ?? "не отправилось"}`);
  }

  async function sync() {
    const res = await fetch("/api/catalog", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setNote(res.ok ? "Каталог обновлён ✅" : data.error ?? "Не получилось обновить каталог");
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Текст скопирован ✅");
    } catch {
      setNote("Не получилось скопировать: выделите текст вручную.");
    }
  }

  const tab = TABS.find((t) => t.id === view)!;
  const openDrafts = active?.followUps.filter((f) => f.status === "draft" || f.status === "failed") ?? [];

  return (
    <div className="flex h-dvh flex-col bg-white text-zinc-900">
      <header className="flex items-center gap-3 bg-[#080808] px-4 py-3 text-white">
        <span className="font-[cursive] text-2xl leading-none">Дейси</span>
        <span className="text-xs tracking-[0.2em] text-[#cdc7a1] uppercase">магазин DEESSE</span>
        <span className="ml-auto hidden text-[11px] text-white/60 sm:inline">
          {catalog ? `${catalog.count} товаров · каталог ${catalog.syncedAt ? when(catalog.syncedAt) : "не обновлялся"}` : ""}
        </span>
        <Button size="xs" variant="outline" className="border-[#989061] bg-transparent text-white hover:bg-[#989061]" onClick={() => void telegramTest()}>
          Тест Telegram
        </Button>
        <Button size="xs" variant="outline" className="border-[#989061] bg-transparent text-white hover:bg-[#989061]" onClick={() => void sync()}>
          <RefreshCw /> Каталог
        </Button>
      </header>
      {note && (
        <button className="bg-amber-50 px-4 py-2 text-left text-sm text-amber-900" onClick={() => setNote(null)}>
          {note}
        </button>
      )}
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium",
              view === t.id ? "bg-[#080808] text-white" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {t.label}
            {counts && t.id !== "all" && t.id !== "spam" && counts[t.id] > 0 && (
              <span className={cn("rounded-full px-1.5 text-[11px]", t.id === "human" ? "bg-red-600 text-white" : view === t.id ? "bg-white/20" : "bg-zinc-200")}>{counts[t.id]}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1">
        <aside className={cn("w-full shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex md:w-[340px]", active ? "hidden" : "flex")}>
          <p className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500">{tab.hint}</p>
          <ul className="flex-1 overflow-y-auto">
            {view === "followups" ? (
              <>
                {fus.length === 0 && <li className="p-6 text-center text-xs text-zinc-500">За 14 дней фоллоу-апов не было.</li>}
                {fus.map((f) => {
                  const Icon = ICON[f.channel] ?? Globe;
                  const s = f.session;
                  return (
                    <li key={f.id}>
                      <button
                        onClick={() => void open(f.sessionId)}
                        className={cn("flex w-full gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left hover:bg-white", active?.id === f.sessionId && "bg-white")}
                      >
                        <Repeat className={cn("mt-0.5 size-4 shrink-0", f.status === "draft" || f.status === "failed" ? "text-amber-600" : "text-[#989061]")} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{s?.customerName || s?.customerEmail || s?.title}</span>
                            <Icon className="size-3.5 shrink-0 text-zinc-400" />
                          </span>
                          <span className="block truncate text-xs text-zinc-500">{KIND[f.kind] ?? f.kind} · {STATUS[f.status] ?? f.status}</span>
                          <span className="block truncate text-xs text-zinc-400">{f.text}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-400">{when(f.createdAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </>
            ) : (
              <>
                {list.length === 0 && (
                  <li className="p-6 text-center text-xs text-zinc-500">{view === "review" ? "Всё проверено ✨" : view === "human" ? "Сейчас никто не ждёт человека ✨" : view === "collab" ? "Предложений о сотрудничестве нет." : view === "spam" ? "Спама нет ✨" : "Переписок пока нет."}</li>
                )}
                {list.map((s) => {
                  const Icon = ICON[s.channel] ?? Globe;
                  const last = s.messages[0];
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => void open(s.id)}
                        className={cn("flex w-full gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left hover:bg-white", active?.id === s.id && "bg-white")}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0 text-[#989061]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{s.customerName || s.customerEmail || s.title}</span>
                            {s.needsHuman && <UserRound className="size-3.5 shrink-0 text-red-600" aria-label="нужен человек" />}
                            {view === "all" && s.toReview && <span className="size-2 shrink-0 rounded-full bg-[#989061]" aria-label="проверить" />}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {last ? `${last.role === "user" ? "Клиент: " : last.byTeam ? "Команда: " : "Дейси: "}${last.content}` : "…"}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-400">{when(s.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        </aside>

        <main className={cn("min-w-0 flex-1 flex-col", active ? "flex" : "hidden md:flex")}>
          {!active ? (
            <p className="m-auto text-sm text-zinc-500">Выберите переписку.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2">
                <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={() => setActive(null)} aria-label="Назад">
                  <ArrowLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{active.customerName || active.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {CHANNEL[active.channel] ?? active.channel} {active.customerEmail ? `· ${active.customerEmail}` : ""}
                  </p>
                </div>
                <select
                  value={active.topic ?? ""}
                  onChange={(e) => void act({ action: "topic", topic: e.target.value }, e.target.value === "spam" ? "Перенесено в спам" : e.target.value === "collab" ? "Перенесено в «Сотрудничество»" : "Перенесено в обычные")}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  aria-label="Раздел"
                >
                  <option value="">Клиент</option>
                  <option value="collab">Сотрудничество</option>
                  <option value="spam">Спам</option>
                </select>
                {!active.needsHuman && (
                  <Button size="sm" variant="outline" onClick={() => void act({ action: "reviewed" }, "Отмечено как проверенное ✅")}>
                    <Check /> Проверено
                  </Button>
                )}
                {active.needsHuman && (
                  <Button size="sm" className="bg-[#989061] hover:bg-[#7f784f]" onClick={() => void act({ action: "resolve" }, "Готово ✅")}>
                    <CheckCircle2 /> Готово, ответили
                  </Button>
                )}
              </div>
              {active.handoffs
                .filter((h) => h.status === "open")
                .map((h) => (
                  <div key={h.id} className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-900">
                    <b>Нужен человек</b> · {when(h.createdAt)} · {h.contact ?? "контакта нет"}
                    <br />
                    {h.summary}
                  </div>
                ))}
              {openDrafts.map((f) => (
                <div key={f.id} className="space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="text-xs">
                    <b>Фоллоу-ап · {STATUS[f.status]}</b> · {KIND[f.kind] ?? f.kind} · {CHANNEL[f.channel] ?? f.channel}
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-white px-3 py-2">{f.text}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void copy(f.text)}>
                      <Copy /> Скопировать
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act({ action: "followup_done", followUpId: f.id }, "Фоллоу-ап отмечен ✅")}>
                      <Check /> Отправили / не нужно
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-[#f6e4dc]/40 to-white px-4 py-4">
                {active.messages.map((m) => {
                  const me = m.role === "user";
                  const team = byTeam(m);
                  return (
                    <div key={m.id} className={cn("flex flex-col", me ? "items-start" : "items-end")}>
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                          me ? "rounded-bl-md bg-zinc-100" : team ? "rounded-br-md border border-[#cdc7a1] bg-white" : "rounded-br-md bg-[#080808] text-white",
                        )}
                      >
                        {m.content || (m.attachments?.length ? `📎 ${m.attachments.map((a) => a.name).join(", ")}` : "")}
                      </div>
                      <span className="mt-0.5 text-[10px] text-zinc-400">
                        {when(m.createdAt)}{" "}
                        {team ? "· команда" : !me ? `· Дейси${m.meta?.followup ? " · фоллоу-ап" : ""}${m.meta?.draft ? " (черновик, не отправлен)" : ""}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2 border-t border-zinc-200 p-3">
                {active.channel === "web" ? (
                  <div className="flex gap-2">
                    <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ответить клиенту от команды DEESSE (Дейси замолчит на 2 часа)" className="min-h-[44px]" />
                    <Button onClick={() => void act({ action: "reply", text: reply })} disabled={!reply.trim()} className="bg-[#989061] hover:bg-[#7f784f]" aria-label="Отправить">
                      <Send />
                    </Button>
                  </div>
                ) : (
                  <p className="text-center text-xs text-zinc-500">
                    {active.channel === "email" ? "Ответ клиенту — в Gmail (черновик Дейси лежит в переписке)." : "Ответ клиенту — в Instagram / Meta Business Suite."}
                  </p>
                )}
                <div className="flex gap-2">
                  <Textarea
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                    placeholder="Дейси ошиблась? Напишите правило, она запомнит (как /fix в Telegram)"
                    className="min-h-[38px] text-xs"
                  />
                  <Button size="sm" variant="outline" disabled={!rule.trim()} onClick={() => void act({ action: "rule", text: rule }, "Дейси запомнила правило ✅")}>
                    Запомнить
                  </Button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
