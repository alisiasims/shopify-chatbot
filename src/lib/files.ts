import type { IncomingFile } from "@/lib/shop/agent";

const MAX_FILES = 3;
const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

/**
 * Files arrive as [{name, type, data}] where data is a data: URL or base64.
 * Images and PDFs only; they go to the model for this one reply and are not stored.
 * Returns an error text for bad input.
 */
export function parseFiles(input: unknown): (IncomingFile & { size: number })[] | string {
  if (input == null) return [];
  if (!Array.isArray(input)) return "files must be a list";
  if (input.length > MAX_FILES) return `At most ${MAX_FILES} files per message`;
  const out: (IncomingFile & { size: number })[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const name = String(raw?.name ?? "file").slice(0, 120);
    let data = String(raw?.data ?? "");
    let type = String(raw?.type ?? "").toLowerCase();
    const m = data.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (m) {
      type = type || m[1].toLowerCase();
      data = m[2];
    }
    if (!TYPES.test(type)) return "Only photos (JPG, PNG, GIF, WEBP) and PDF files can be sent";
    const size = Math.floor((data.length * 3) / 4);
    if (!data || size > MAX_BYTES) return "The file is larger than 6 MB";
    out.push({ name, type, data, size });
  }
  return out;
}
