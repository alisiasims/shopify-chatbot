/**
 * Minimal Anthropic Messages API client (fetch, no SDK).
 * ANTHROPIC_API_KEY lives only in Railway Variables. ANTHROPIC_MODEL overrides the default model.
 */

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export type TextBlock = { type: "text"; text: string };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type DocumentBlock = { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ContentBlock = TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ToolResultBlock;
export type LlmMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

export type LlmResponse = {
  content: ContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
};

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class LlmError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function callClaude(opts: {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}): Promise<LlmResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LlmError("ANTHROPIC_API_KEY is not set", 0);

  const base: Record<string, unknown> = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 1200,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
  };
  // Some models accept only one of temperature / top_p: send top_p only when it was changed from 1.
  const attempts: Record<string, unknown>[] = [];
  const temperature = opts.temperature ?? 0.7;
  if (opts.topP !== undefined && opts.topP < 1) attempts.push({ temperature, top_p: opts.topP }, { top_p: opts.topP });
  attempts.push({ temperature }, {});

  let last: LlmError | null = null;
  for (const sampling of attempts) {
    for (let retry = 0; retry < 3; retry++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...base, ...sampling }),
      });
      if (res.ok) return (await res.json()) as LlmResponse;
      const text = await res.text().catch(() => "");
      last = new LlmError(`Anthropic API ${res.status}: ${text.slice(0, 300)}`, res.status);
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200 * (retry + 1)));
        continue;
      }
      break;
    }
    // 400 about sampling parameters → try the next, simpler sampling set
    if (!(last && last.status === 400 && /temperature|top_p|sampling/i.test(last.message))) break;
  }
  throw last ?? new LlmError("Anthropic API failed", 500);
}
