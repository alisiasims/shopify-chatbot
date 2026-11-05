"use client";

import { Fragment, useEffect, useRef } from "react";
import { Paperclip, ShoppingBag, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, type ChatMessage } from "./types";

/** Renders **bold**, [label](url) and bare URLs; everything else is plain text. */
function RichText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]{1,80}\]\(https?:\/\/[^\s)]+\)|https?:\/\/\S+)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const md = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    const href = md ? md[2] : /^https?:\/\//.test(part) ? part : null;
    if (href)
      return (
        <a key={i} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {md ? md[1] : part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
        </a>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Props = {
  messages: ChatMessage[];
  typing: boolean;
  emptyHint: string;
};

export function MessageList({ messages, typing, emptyHint }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, typing]);

  if (messages.length === 0 && !typing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-900">How can I help you today?</h3>
        <p className="max-w-sm text-sm text-zinc-500">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      {messages.map((m) => {
        const isUser = m.role === "user";
        return (
          <div key={m.id} className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap sm:max-w-[75%]",
                isUser
                  ? "rounded-br-md bg-primary text-white shadow-sm"
                  : "rounded-bl-md border border-zinc-200 bg-zinc-100 text-zinc-800",
              )}
            >
              {m.attachments?.map((a) => (
                <span key={a.name} className="mb-1 flex items-center gap-1 text-xs opacity-80">
                  <Paperclip className="size-3" /> {a.name}
                </span>
              ))}
              <RichText text={m.content} />
            </div>
            {!isUser && m.meta?.products && m.meta.products.length > 0 && (
              <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">
                {m.meta.products.map((p) => (
                  <a
                    key={p.handle}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-xs transition hover:border-primary/50"
                  >
                    {p.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${p.image}${p.image.includes("?") ? "&" : "?"}width=320`} alt="" className="h-32 w-full object-cover" loading="lazy" />
                    )}
                    <span className="line-clamp-2 px-2 pt-1.5 font-medium">{p.title}</span>
                    <span className="px-2 pb-2 font-semibold text-primary">{p.price}</span>
                  </a>
                ))}
              </div>
            )}
            {!isUser && m.meta?.cartUrl && (
              <a
                href={m.meta.cartUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
              >
                <ShoppingBag className="size-3.5" /> Go to checkout
              </a>
            )}
            <span className="mt-1 px-1 text-[10px] text-zinc-400">{formatTime(m.createdAt)}</span>
          </div>
        );
      })}

      {typing && (
        <div className="flex items-start">
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
            <span className="flex gap-1">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="size-1.5 animate-bounce rounded-full bg-zinc-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            Typing...
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
