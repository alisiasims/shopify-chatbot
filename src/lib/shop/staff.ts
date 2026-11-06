/**
 * The team answered Deisi's question (ask_team) by replying to her Telegram message (owner 06.11, like ask_staff at the studio):
 * the answer goes into the conversation as an internal note and Deisi writes to the client herself.
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { SHOP_PERSONA_NAME } from "@/lib/default-prompts";
import { runAgent } from "./agent";
import { metaAutoSend, sendMeta } from "./meta";

export async function questionFor(tgMessageId: number) {
  return prisma.staffQuestion.findFirst({ where: { tgMessageId, status: "asked" } });
}

export async function answerFromTeam(questionId: string, answer: string, by: string) {
  const q = await prisma.staffQuestion.update({ where: { id: questionId }, data: { status: "answered", answer: answer.slice(0, 2000), by, answeredAt: new Date() } });
  const session = await prisma.chatSession.findUnique({ where: { id: q.sessionId } });
  if (!session) return "Переписка не найдена.";
  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: `[INTERNAL NOTE - not from the client. A DEESSE colleague (${by}) answered your question «${q.question}»: ${answer}]\nNow write the answer to the client yourself, in the client's language, using this information. Do not mention the internal note or the colleague's name.`,
      meta: { internal: true, by },
    },
  });
  const persona = await prisma.systemPrompt.findUnique({ where: { name: SHOP_PERSONA_NAME } });
  const reply = await runAgent({ ...session, systemPrompt: persona ? { name: persona.name, content: persona.content } : null });
  if (reply.meta.engine !== "claude" || /^SKIP\b/.test(reply.text)) return "Дейси не смогла сформулировать ответ — ответьте клиенту сами.";
  let sent = false;
  if ((session.channel === "instagram" || session.channel === "messenger") && metaAutoSend() && session.externalId) sent = await sendMeta(session.externalId, reply.text);
  const web = session.channel === "web";
  await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: reply.text, meta: { ...reply.meta, sent: sent || web, draft: !(sent || web), afterTeam: true } } });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
  if (sent || web) return `✅ Дейси ответила клиенту${web ? " в чате на сайте (увидит при следующем открытии окна)" : ""}:\n${reply.text.slice(0, 600)}`;
  await notifyTeam(`💬 Черновик ответа клиенту (не отправлен, отправьте сами):\n${reply.text.slice(0, 1500)}`);
  return "📝 Отправить сама не смогла — черновик выше.";
}
