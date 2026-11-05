"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Globe, Mail, MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Summary = {
  id: string;
  title: string;
  channel: string;
  customerName: string | null;
  customerEmail: string | null;
  needsHuman: boolean;
  updatedAt: string;
  messages: { content: string; role: string }[];
  _count: { messages: number };
};
type Card = { handle: string; title: string; price: string; image: string | null; url: string };
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments: { name: string }[] | null;
  meta: { by?: string; products?: Card[]; cartUrl?: string; tools?: string[]; engine?: string; draft?: boolean } | null;
};
type Detail = Omit<Summary, "messages"> & { messages: Msg[]; handoffs: { id: string; reason: string; summary: string; contact: string | null; status: string; createdAt: string }[] };

const ICON: Record<string, typeof Globe> = { web: Globe, email: Mail, instagram: Camera, messenger: MessageCircle };
const when = (iso: string) => new Date(iso).toLocaleString("et-EE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Inbox() {
  const [list, setList] = useState<Summary[]>([]);
  const [filter, setFilter] = useState<"all" | "human">("all");
  const [active, setActive] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ count: number; syncedAt: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inbox${filter === "human" ? "?filter=human" : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setList(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  const open = useCallback(async (id: string) => {
    const res = await fetch(`/api/inbox/${id}`);
    if (res.ok) setActive(await res.json());
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

  async function act(body: Record<string, string>) {
    if (!active) return;
    const res = await fetch(`/api/inbox/${active.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed");
      return;
    }
    if (body.action === "reply") setReply("");
    await open(active.id);
    await load();
  }

  async function sync() {
    const res = await fetch("/api/catalog", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Sync failed");
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }

  return (
    <div className="flex h-dvh flex-col bg-white text-zinc-900">
      <header className="flex items-center gap-3 bg-[#080808] px-4 py-3 text-white">
        <span className="font-[cursive] text-2xl leading-none">Deisi</span>
        <span className="text-xs tracking-[0.2em] text-[#cdc7a1] uppercase">DEESSE shop inbox</span>
        <span className="ml-auto hidden text-[11px] text-white/60 sm:inline">
          {catalog ? `${catalog.count} products · synced ${catalog.syncedAt ? when(catalog.syncedAt) : "never"}` : ""}
        </span>
        <Button size="xs" variant="outline" className="border-[#989061] bg-transparent text-white hover:bg-[#989061]" onClick={() => void sync()}>
          <RefreshCw /> Catalog
        </Button>
      </header>
      {error && <p className="bg-amber-50 px-4 py-2 text-sm text-amber-900">{error}</p>}
      <div className="flex min-h-0 flex-1">
        <aside className={cn("w-full shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex md:w-[320px]", active ? "hidden" : "flex")}>
          <div className="flex gap-1 border-b border-zinc-200 p-2">
            {(["all", "human"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", filter === f ? "bg-[#989061] text-white" : "text-zinc-600 hover:bg-zinc-200")}
              >
                {f === "all" ? "All" : "Needs a person"}
              </button>
            ))}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {list.length === 0 && <li className="p-6 text-center text-xs text-zinc-500">No conversations yet.</li>}
            {list.map((s) => {
              const Icon = ICON[s.channel] ?? Globe;
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
                        {s.needsHuman && <UserRound className="size-3.5 shrink-0 text-red-600" aria-label="needs a person" />}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{s.messages[0]?.content || "…"}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">{when(s.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className={cn("min-w-0 flex-1 flex-col", active ? "flex" : "hidden md:flex")}>
          {!active ? (
            <p className="m-auto text-sm text-zinc-500">Choose a conversation.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
                <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={() => setActive(null)} aria-label="Back">
                  <ArrowLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{active.customerName || active.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {active.channel} {active.customerEmail ? `· ${active.customerEmail}` : ""}
                  </p>
                </div>
                {active.needsHuman && (
                  <Button size="sm" variant="outline" onClick={() => void act({ action: "resolve" })}>
                    <CheckCircle2 /> Done
                  </Button>
                )}
              </div>
              {active.handoffs.filter((h) => h.status === "open").map((h) => (
                <div key={h.id} className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-900">
                  <b>{h.reason}</b> · {when(h.createdAt)} · {h.contact ?? "no contact"}
                  <br />
                  {h.summary}
                </div>
              ))}
              <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-[#f6e4dc]/40 to-white px-4 py-4">
                {active.messages.map((m) => {
                  const me = m.role === "user";
                  const team = m.meta?.by === "team";
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
                        {when(m.createdAt)} {team ? "· team" : !me ? `· Deisi${m.meta?.draft ? " (draft, not sent)" : ""}${m.meta?.tools?.length ? ` · ${m.meta.tools.join(", ")}` : ""}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              {active.channel === "web" ? (
                <div className="flex gap-2 border-t border-zinc-200 p-3">
                  <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as a DEESSE colleague (the AI pauses for 2 hours)" className="min-h-[44px]" />
                  <Button onClick={() => void act({ action: "reply", text: reply })} disabled={!reply.trim()} className="bg-[#989061] hover:bg-[#7f784f]">
                    <Send />
                  </Button>
                </div>
              ) : (
                <p className="border-t border-zinc-200 p-3 text-center text-xs text-zinc-500">
                  {active.channel === "email" ? "Reply in Gmail (Deisi's draft is in the thread)." : "Reply in Meta Business Suite."}
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
