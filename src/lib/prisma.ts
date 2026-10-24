import { PrismaClient } from "@prisma/client";
import { DEFAULT_PROMPTS } from "./default-prompts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Railway runs `prisma migrate deploy` on start but not the seed, so the
 * default prompts are inserted on first use when the table is empty.
 */
export async function ensureDefaultPrompts() {
  const count = await prisma.systemPrompt.count();
  if (count > 0) return;
  await prisma.systemPrompt.createMany({ data: DEFAULT_PROMPTS, skipDuplicates: true });
}
