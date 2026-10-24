"use client";

import { Fragment, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, type ChatMessage } from "./types";

/** Renders **bold** and bare URLs; everything else is plain text. */
function RichText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/\S+)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {part}
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
              <RichText text={m.content} />
            </div>
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
