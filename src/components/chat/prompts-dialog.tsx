"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type SystemPrompt } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: SystemPrompt[];
  onChanged: () => Promise<void>;
};

type Draft = { id?: string; name: string; content: string };

export function PromptsDialog({ open, onOpenChange, prompts, onChanged }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!draft) return;
    const body = JSON.stringify(draft);
    void run(() => api("/api/prompts", { method: draft.id ? "PUT" : "POST", body }));
  }

  function remove(prompt: SystemPrompt) {
    if (!confirm(`Delete the prompt "${prompt.name}"?`)) return;
    void run(() => api(`/api/prompts?id=${encodeURIComponent(prompt.id)}`, { method: "DELETE" }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setDraft(null);
          setError(null);
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft ? (draft.id ? "Edit Prompt" : "New Prompt") : "Manage Prompts"}</DialogTitle>
          <DialogDescription>System prompts define the assistant&apos;s persona and rules.</DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {draft ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="prompt-name">Name</Label>
              <Input
                id="prompt-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Customer Support"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
              <Label htmlFor="prompt-content">Content</Label>
              <Textarea
                id="prompt-content"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="You are a helpful assistant…"
                className="min-h-[240px] flex-1 font-mono text-xs leading-relaxed"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy || !draft.name.trim() || !draft.content.trim()}>
                {busy ? "Saving…" : "Save Prompt"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {prompts.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">No prompts yet.</p>
              ) : (
                <Accordion type="single" collapsible className="rounded-lg border border-zinc-200">
                  {prompts.map((p) => (
                    <AccordionItem key={p.id} value={p.id} className="px-3">
                      <AccordionTrigger className="text-sm">{p.name}</AccordionTrigger>
                      <AccordionContent>
                        <pre className="max-h-60 overflow-y-auto rounded-md bg-zinc-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-700">
                          {p.content}
                        </pre>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setDraft(p)} disabled={busy}>
                            <Pencil /> Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => remove(p)} disabled={busy}>
                            <Trash2 /> Delete
                          </Button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setDraft({ name: "", content: "" })}>
                <Plus /> Add Prompt
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
