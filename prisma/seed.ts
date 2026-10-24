import { PrismaClient } from "@prisma/client";
import { DEFAULT_PROMPTS } from "../src/lib/default-prompts";

const prisma = new PrismaClient();

async function main() {
  for (const prompt of DEFAULT_PROMPTS) {
    await prisma.systemPrompt.upsert({
      where: { name: prompt.name },
      update: { content: prompt.content },
      create: prompt,
    });
  }
  console.log(`Seeded ${DEFAULT_PROMPTS.length} system prompts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
