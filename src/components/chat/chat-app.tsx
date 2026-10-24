"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookText, Bot, Menu, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEESY_PROMPT_NAME } from "@/lib/default-prompts";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { PromptsDialog } from "./prompts-dialog";
import { SettingsDialog, type Settings } from "./settings-dialog";
import { Sidebar } from "./sidebar";
import { api, MODELS, type ChatDetail, type ChatMessage, type ChatSummary, type SystemPrompt } from "./types";

const NO_PROMPT = "none";

export function ChatApp() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [active, setActive] = useState<ChatDetail | null>(null);
  const [model, setModel] = useState("gpt-4");
  const [promptId, setPromptId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ temperature: 0.7, topP: 1 });

  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);

  const applyChat = useCallback((chat: ChatDetail | null) => {
    setActive(chat);
    if (!chat) return;
    setModel(chat.model);
    setPromptId(chat.systemPromptId);
    setSettings({ temperature: chat.temperature, topP: chat.topP });
  }, []);

  const loadPrompts = useCallback(async () => {
    const list = await api<SystemPrompt[]>("/api/prompts");
    setPrompts(list);
    return list;
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chatList, promptList] = await Promise.all([api<ChatSummary[]>("/api/chats"), loadPrompts()]);
      setChats(chatList);
      const deesy = promptList.find((p) => p.name === DEESY_PROMPT_NAME) ?? promptList[0];
      setPromptId(deesy?.id ?? null);
      if (chatList[0]) applyChat(await api<ChatDetail>(`/api/chats/${chatList[0].id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applyChat, loadPrompts]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  function touchChat(summary: ChatSummary) {
    setChats((list) => [summary, ...list.filter((c) => c.id !== summary.id)]);
  }

  async function createChat(): Promise<ChatDetail | null> {
    try {
      const chat = await api<ChatDetail>("/api/chats", {
        method: "POST",
        body: JSON.stringify({ model, systemPromptId: promptId, ...settings }),
      });
      touchChat(chat);
      applyChat(chat);
      setError(null);
      return chat;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function selectChat(id: string) {
    setSidebarOpen(false);
    if (id === active?.id) return;
    try {
      applyChat(await api<ChatDetail>(`/api/chats/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteChat(id: string) {
    const chat = chats.find((c) => c.id === id);
    if (!confirm(`Delete "${chat?.title ?? "this chat"}"? This cannot be undone.`)) return;
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      setChats((list) => list.filter((c) => c.id !== id));
      if (active?.id === id) setActive(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function newChat() {
    setSidebarOpen(false);
    await createChat();
  }

  async function send(content: string): Promise<boolean> {
    const chat = active ?? (await createChat());
    if (!chat) return false;

    const temp: ChatMessage = {
      id: `temp-${Date.now()}`,
      sessionId: chat.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setActive((c) => (c ? { ...c, messages: [...c.messages, temp] } : c));
    setTyping(true);
    setError(null);

    try {
      const res = await api<{ userMessage: ChatMessage; assistantMessage: ChatMessage; session: ChatSummary }>(
        `/api/chats/${chat.id}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setActive((c) =>
        c && c.id === chat.id
          ? {
              ...c,
              title: res.session.title,
              messages: [...c.messages.filter((m) => m.id !== temp.id), res.userMessage, res.assistantMessage],
            }
          : c,
      );
      touchChat(res.session);
      return true;
    } catch (e) {
      setActive((c) => (c ? { ...c, messages: c.messages.filter((m) => m.id !== temp.id) } : c));
      setError((e as Error).message);
      return false;
    } finally {
      setTyping(false);
    }
  }

  async function clearChat() {
    if (!active || !confirm("Clear all messages in this chat?")) return;
    try {
      const res = await api<{ session: ChatSummary }>(`/api/chats/${active.id}/messages`, { method: "DELETE" });
      setActive({ ...active, title: res.session.title, messages: [] });
      touchChat(res.session);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Updates the toolbar state and, when a chat is open, persists it to that chat. */
  async function updateChat(patch: Partial<Pick<ChatDetail, "model" | "systemPromptId" | "temperature" | "topP">>) {
    if (patch.model !== undefined) setModel(patch.model);
    if (patch.systemPromptId !== undefined) setPromptId(patch.systemPromptId);
    if (patch.temperature !== undefined || patch.topP !== undefined)
      setSettings((s) => ({ temperature: patch.temperature ?? s.temperature, topP: patch.topP ?? s.topP }));
    if (!active) return;
    setActive({ ...active, ...patch });
    try {
      await api(`/api/chats/${active.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onPromptsChanged() {
    const list = await loadPrompts();
    if (promptId && !list.some((p) => p.id === promptId)) setPromptId(null);
  }

  const selectedPrompt = prompts.find((p) => p.id === promptId) ?? null;
  const isDeesy = selectedPrompt?.name === DEESY_PROMPT_NAME;

  return (
    <div className="flex h-dvh overflow-hidden bg-white text-zinc-900">
      <Sidebar
        chats={chats}
        activeId={active?.id ?? null}
        loading={loading}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectChat}
        onDelete={deleteChat}
        onNewChat={newChat}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2.5 sm:px-4 md:h-14 md:flex-nowrap md:py-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open chat history"
          >
            <Menu />
          </Button>
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-white">
              <Bot className="size-4" />
            </span>
            <span className="truncate text-sm font-semibold tracking-wide">
              {active?.title && active.title !== "New Chat" ? active.title : "DEESSE AI Chat"}
            </span>
          </div>

          <div className="order-last flex w-full items-center gap-2 md:order-none md:w-auto">
            <Select value={model} onValueChange={(v) => void updateChat({ model: v })}>
              <SelectTrigger size="sm" className="w-[130px] shrink-0" aria-label="LLM Model">
                <SelectValue placeholder="LLM Model" />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={promptId ?? NO_PROMPT}
              onValueChange={(v) => void updateChat({ systemPromptId: v === NO_PROMPT ? null : v })}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1 md:w-[230px] md:flex-none" aria-label="System Prompt">
                <SelectValue placeholder="System Prompt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROMPT}>No system prompt</SelectItem>
                {prompts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={() => setPromptsOpen(true)} aria-label="Manage Prompts">
            <BookText /> <span className="hidden lg:inline">Manage Prompts</span>
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Advanced Settings">
            <SlidersHorizontal />
          </Button>
        </header>

        {error && (
          <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1">{error}</p>
            <Button size="xs" variant="outline" onClick={() => void loadInitial()}>
              <RefreshCw /> Retry
            </Button>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-amber-100">
              <X className="size-4" />
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-white to-zinc-50/60">
          <MessageList
            messages={active?.messages ?? []}
            typing={typing}
            emptyHint={
              isDeesy
                ? "Hi, I'm Deesy from DEESSE. Ask me about pole dance shoes, high heels, catsuits, knee pads or accessories — in English, Estonian or Russian."
                : "Start a conversation by typing a message below."
            }
          />
        </div>

        <ChatInput disabled={typing || loading} canClear={(active?.messages.length ?? 0) > 0} onSend={send} onClear={clearChat} />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSave={(s) => updateChat(s)}
      />
      <PromptsDialog open={promptsOpen} onOpenChange={setPromptsOpen} prompts={prompts} onChanged={onPromptsChanged} />
    </div>
  );
}
