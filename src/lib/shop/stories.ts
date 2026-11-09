/**
 * Someone mentioned us in an Instagram story (owner 06.11):
 *  - the team gets «📸 Нас отметили» with the story (photo / video) and Deisi's assessment (repost or not);
 *  - for a good mention Deisi thanks the person in Direct with the gift code FEEDBACK5 (5% off everything, Setting story_gift_code),
 *    once per person. Instagram has no API to repost a story: the team reposts it in the app.
 */
import { prisma } from "@/lib/prisma";
import { callClaude, hasApiKey, type ContentBlock } from "@/lib/llm";
import { notifyTeam, notifyTeamMedia } from "@/lib/notify";
import { messageLanguage } from "./agent";
import { metaAutoSend, sendMeta } from "./meta";

const THANKS: Record<string, (code: string) => string> = {
  Estonian: (c) => `Aitäh, et jagasite 💗 Koodiga ${c} saate järgmiselt ostult deesse.ee-s 5% soodustust. Soovime Teile imelisi tantsuhetki!`,
  Russian: (c) => `Спасибо, что поделились 💗 По коду ${c} Вы получите скидку 5% на следующую покупку на deesse.ee. Желаем Вам прекрасных танцев!`,
  English: (c) => `Thank you for sharing 💗 Please use code ${c} to get 5% off your next purchase at deesse.ee. We wish you a great dancing experience!`,
};

async function igName(senderId: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${senderId}?fields=name,username&access_token=${encodeURIComponent(process.env.META_PAGE_TOKEN || "")}`);
    const d = (await res.json()) as { name?: string; username?: string };
    return { name: d.name ?? null, username: d.username ?? null };
  } catch {
    return { name: null, username: null };
  }
}

async function assess(image: { data: Buffer; type: string } | null) {
  if (!image || !hasApiKey()) return { good: true, note: image ? "оценить не смогла — посмотрите сами" : "видео — посмотрите сами" };
  try {
    const res = await callClaude({
      system:
        "You check Instagram stories where a client mentioned DEESSE (a dance shoes and dancewear shop and pole dance studio in Tallinn). Decide if it is a GOOD mention: positive or neutral, shows our products, shoes, clothes, studio or dancing, decent quality, nothing offensive, no complaint. Answer in Russian in this exact form:\nGOOD или BAD\nОценка: одно-два предложения, что на сторис\nРепост: да / нет - почему (качество, видно ли товар)",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: image.type, data: image.data.toString("base64") } }, { type: "text", text: "The story:" }] }],
      model: process.env.SHOP_MODEL || "claude-opus-5-5",
      maxTokens: 300,
      temperature: 0.2,
    });
    const text = res.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
    return { good: /^\s*GOOD/i.test(text), note: text.replace(/^\s*(GOOD|BAD)\s*/i, "").trim() };
  } catch (e) {
    console.error("[story] assess", e);
    return { good: true, note: "оценить не смогла — посмотрите сами" };
  }
}

export async function handleStoryMention(channel: "instagram" | "messenger", senderId: string, url: string, mid: string) {
  let media: { data: Buffer; type: string } | null = null;
  try {
    const res = await fetch(url);
    const type = (res.headers.get("content-type") || "").split(";")[0];
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length < 45 * 1024 * 1024) media = { data: buf, type: type || "image/jpeg" };
  } catch (e) {
    console.error("[story] download", e);
  }
  const isImage = Boolean(media && /^image\/(jpeg|png|gif|webp)$/.test(media.type) && media.data.length < 5 * 1024 * 1024);
  const { good, note } = await assess(isImage ? media : null);
  const person = await igName(senderId);

  let session = await prisma.chatSession.findUnique({ where: { channel_externalId: { channel, externalId: senderId } } });
  if (!session)
    session = await prisma.chatSession.create({
      data: { channel, externalId: senderId, title: `Отметка в сторис${person.username ? ` @${person.username}` : ""}`, customerName: person.name, model: "claude", temperature: 0.5, topP: 1 },
    });
  await prisma.message.create({ data: { sessionId: session.id, role: "user", content: "📸 Отметила нас в сторис", meta: { mid, storyMention: true, good } } });

  // the gift code once per person, only for a good mention
  const code = (await prisma.setting.findUnique({ where: { key: "story_gift_code" } }).catch(() => null))?.value || "FEEDBACK5";
  const already = await prisma.message.findFirst({ where: { sessionId: session.id, meta: { path: ["gift"], equals: code } } });
  let giftLine = "";
  if (good && !already) {
    // PM 09.11: skip our own «📸 Отметила нас в сторис» line (and internal notes) - it made every thank-you Russian
    const earlier = await prisma.message.findMany({ where: { sessionId: session.id, role: "user" }, orderBy: { createdAt: "desc" }, take: 12, select: { content: true, meta: true } });
    const lang =
      earlier
        .filter((m) => !((m.meta ?? {}) as { storyMention?: boolean; internal?: boolean }).storyMention && !((m.meta ?? {}) as { internal?: boolean }).internal)
        .map((m) => messageLanguage(m.content))
        .find((l) => l && THANKS[l]) ?? "English";
    const text = THANKS[lang](code);
    const sent = metaAutoSend() ? await sendMeta(senderId, text) : false;
    await prisma.message.create({ data: { sessionId: session.id, role: "assistant", content: text, meta: { engine: "claude", gift: code, sent, draft: !sent } } });
    giftLine = sent ? `\n🎁 Дейси поблагодарила и отправила код ${code}.` : `\n🎁 Код ${code} не отправился — отправьте сами:\n${text}`;
  } else if (good && already) giftLine = `\n🎁 Код ${code} ей уже отправляли раньше — повторно не отправляла.`;
  else giftLine = "\n🎁 Код не отправляла (отметка не подходит).";
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date(), reviewedAt: new Date() } });

  const caption = `📸 Нас отметили в сторис: ${person.username ? `@${person.username}` : person.name ?? "клиентка"}\n${note}${giftLine}\nРепост — в приложении Instagram (Директ → сторис → «Добавить в свою историю»).`;
  if (media) await notifyTeamMedia({ data: media.data, type: media.type, name: media.type.startsWith("video/") ? "story.mp4" : "story.jpg" }, caption);
  else await notifyTeam(caption);
}

/** «❤️», «🙏🔥» and similar: no answer needed (the studio's rule). */
export function emojiOnly(text: string) {
  const t = text.trim();
  if (!t || /[0-9#*]/.test(t)) return false;
  return !t.replace(/[\p{Extended_Pictographic}\p{Emoji_Component}\s‍️!?.)(]/gu, "").length;
}
