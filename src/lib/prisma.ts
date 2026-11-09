import { PrismaClient } from "@prisma/client";
import { DEESY_PROMPT_NAME, DEFAULT_PROMPTS, LEGACY_DEESY_PROMPT_NAME } from "./default-prompts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

let ensured = false;
const SEED_KEY = "default_prompts_v2";

/**
 * Railway runs `prisma migrate deploy` on start but not the seed, so the default prompts are
 * inserted on first use. It runs once per prompt set version (Setting row), so a prompt the
 * owner deleted does not come back. The first Deesy prompt said payment links were simulated;
 * that text is upgraded at the same time.
 */
export async function ensureDefaultPrompts() {
  if (ensured) return;
  const done = await prisma.setting.findUnique({ where: { key: SEED_KEY } });
  if (!done) {
    await prisma.systemPrompt.createMany({ data: DEFAULT_PROMPTS, skipDuplicates: true });
    const deesy = DEFAULT_PROMPTS.find((p) => p.name === DEESY_PROMPT_NAME)!;
    await prisma.systemPrompt.updateMany({
      where: { name: DEESY_PROMPT_NAME, content: { contains: "the draft order and payment link are simulated" } },
      data: { content: deesy.content },
    });
    await prisma.setting.upsert({ where: { key: SEED_KEY }, update: { value: "1" }, create: { key: SEED_KEY, value: "1" } });
  }
  // Owner 09.11: the assistant is called Deisi, not "Deesy". Rename the old prompt row once (chats keep their link by id)
  // and replace the name in its text, also when the owner edited it.
  const RENAME_KEY = "prompt_rename_deisi_v1";
  if (!(await prisma.setting.findUnique({ where: { key: RENAME_KEY } }))) {
    const old = await prisma.systemPrompt.findUnique({ where: { name: LEGACY_DEESY_PROMPT_NAME } });
    const taken = await prisma.systemPrompt.findUnique({ where: { name: DEESY_PROMPT_NAME } });
    if (old && !taken) {
      await prisma.systemPrompt.update({ where: { id: old.id }, data: { name: DEESY_PROMPT_NAME, content: old.content.replaceAll("Deesy", "Deisi") } });
    }
    await prisma.setting.upsert({ where: { key: RENAME_KEY }, update: { value: "1" }, create: { key: RENAME_KEY, value: "1" } });
  }
  ensured = true;
}
