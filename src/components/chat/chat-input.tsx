"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Paperclip, SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  disabled: boolean;
  canClear: boolean;
  onSend: (text: string) => Promise<boolean>;
  onClear: () => void;
};

const MAX_HEIGHT = 200;

export function ChatInput({ disabled, canClear, onSend, onClear }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-expand the textarea up to MAX_HEIGHT.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const canSend = !disabled && (text.trim().length > 0 || file !== null);

  async function submit() {
    if (!canSend) return;
    // Attachments are not uploaded yet; the filename is included in the message.
    const content = [text.trim(), file ? `📎 Attached: ${file.name}` : ""].filter(Boolean).join("\n\n");
    const previous = { text, file };
    setText("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    const ok = await onSend(content);
    if (!ok) {
      setText(previous.text);
      setFile(previous.file);
    }
    textareaRef.current?.focus();
  }

  return (
    <div className="border-t border-zinc-200 bg-white/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        {file && (
          <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="rounded p-0.5 hover:bg-zinc-200"
              aria-label="Remove attachment"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm focus-within:border-primary/40 focus-within:ring-3 focus-within:ring-primary/10">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Type your message..."
            rows={1}
            className="max-h-[200px] min-h-[44px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-zinc-500"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip /> <span className="hidden sm:inline">Attach File</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClear} disabled={!canClear || disabled}>
                <Eraser /> <span className="hidden sm:inline">Clear Chat</span>
              </Button>
              <Button type="button" size="sm" className="px-3.5" onClick={() => void submit()} disabled={!canSend}>
                Send <SendHorizontal />
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-1.5 hidden text-center text-[10px] text-zinc-400 sm:block">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
