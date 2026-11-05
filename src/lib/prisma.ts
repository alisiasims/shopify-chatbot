import { PrismaClient } from "@prisma/client";
import { DEESY_PROMPT_NAME, DEFAULT_PROMPTS } from "./default-prompts";

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
  ensured = true;
}
