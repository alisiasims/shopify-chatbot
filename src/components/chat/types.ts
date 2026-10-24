export type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatDetail = ChatSummary & {
  model: string;
  temperature: number;
  topP: number;
  systemPromptId: string | null;
  messages: ChatMessage[];
};

export type SystemPrompt = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
};

export const MODELS = [
  { value: "gpt-4", label: "GPT-4" },
  { value: "claude", label: "Claude" },
  { value: "local-llama", label: "Local Llama" },
];

/** fetch wrapper that throws the API's friendly error message on failure. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Network error — please check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatTime(iso);
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
