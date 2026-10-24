"use client";

import { MessageSquare, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, type ChatSummary } from "./types";

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
};

export function Sidebar({ chats, activeId, loading, open, onClose, onSelect, onDelete, onNewChat }: Props) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px] transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-zinc-200 bg-zinc-50 transition-transform duration-200",
          "md:static md:translate-x-0",
          open ? "translate-x-0 shadow-xl md:shadow-none" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-4">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-800">Chat History</h2>
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onClose} aria-label="Close menu">
            <X />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {loading && chats.length === 0 ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-200/70" />
              ))}
            </div>
          ) : chats.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-500">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {chats.map((chat) => (
                <li key={chat.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(chat.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 pr-10 text-left transition-colors",
                      chat.id === activeId
                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                    )}
                  >
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{chat.title}</span>
                      <span className="block text-[11px] text-zinc-400">{formatDate(chat.updatedAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(chat.id)}
                    aria-label={`Delete ${chat.title}`}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="sticky bottom-0 border-t border-zinc-200 bg-zinc-50 p-3">
          <Button className="h-10 w-full rounded-lg" onClick={onNewChat}>
            <Plus /> New Chat
          </Button>
        </div>
      </aside>
    </>
  );
}
