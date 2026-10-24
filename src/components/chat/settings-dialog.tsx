"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export type Settings = { temperature: number; topP: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
};

const FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "temperature", label: "Temperature", hint: "Higher values make answers more creative, lower more focused." },
  { key: "topP", label: "Top-P", hint: "Limits sampling to the most likely tokens whose probability adds up to P." },
];

export function SettingsDialog({ open, onOpenChange, settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Advanced Settings</DialogTitle>
          <DialogDescription>Saved for this chat session.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor={key}>{label}</Label>
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 tabular-nums">
                  {draft[key].toFixed(1)}
                </span>
              </div>
              <Slider
                id={key}
                min={0}
                max={1}
                step={0.1}
                value={[draft[key]]}
                onValueChange={([v]) => setDraft((d) => ({ ...d, [key]: Math.round(v * 10) / 10 }))}
              />
              <p className="text-xs text-zinc-500">{hint}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
