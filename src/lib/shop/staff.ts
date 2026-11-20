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
  // owner 20.11 («Гмайл - отправлять письмо сразу, это ответ на её же вопрос из чата»): a web client who left the site gets the answer by e-mail too
  let mailed = "";
  if (web && session.customerEmail) {
    const last = await prisma.message.findFirst({ where: { sessionId: session.id, role: "user", NOT: { content: { startsWith: "[INTERNAL NOTE" } } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!last || Date.now() - last.createdAt.getTime() > 15 * 60_000) {
      await queueMail(session.customerEmail, reply.text, session.lang, session.id).catch((e) => console.error("[staff] mail", e));
      mailed = ` и на e-mail ${session.customerEmail}`;
    }
  }
  if (sent || web) return `✅ Дейси ответила клиенту${web ? ` в чате на сайте (увидит при следующем открытии окна)${mailed}` : ""}:\n${reply.text.slice(0, 600)}`;
  await notifyTeam(`💬 Черновик ответа клиенту (не отправлен, отправьте сами):\n${reply.text.slice(0, 1500)}`);
  return "📝 Отправить сама не смогла — черновик выше.";
}

const MAIL_SUBJECT: Record<string, string> = { ru: "DEESSE: ответ на Ваш вопрос", et: "DEESSE: vastus Teie küsimusele", en: "DEESSE: the answer to your question" };
const MAIL_FOOT: Record<string, string> = {
  ru: "Это ответ на Ваш вопрос в чате на deesse.ee. Можно ответить на это письмо или продолжить в чате на сайте.",
  et: "See on vastus Teie küsimusele deesse.ee vestluses. Võite sellele kirjale vastata või jätkata vestlust kodulehel.",
  en: "This is the answer to your question in the chat on deesse.ee. You can reply to this e-mail or continue in the chat on the site.",
};
/** owner 20.11: e-mails the shop sends itself go through the Gmail bridge (op "outbox": the script sends them from info@deesse.ee). */
export async function queueMail(to: string, text: string, lang: string | null | undefined, sessionId: string) {
  const L = lang === "et" || lang === "en" ? lang : "ru";
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = `${text.replace(/\[CART\]/g, "").trim()}\n\n${MAIL_FOOT[L]}\n\nDeisi · DEESSE\nhttps://deesse.ee`;
  await prisma.setting.create({ data: { key: `outbox:${id}`, value: JSON.stringify({ to, subject: MAIL_SUBJECT[L], text: body, sessionId, at: new Date().toISOString() }) } });
  return id;
}
