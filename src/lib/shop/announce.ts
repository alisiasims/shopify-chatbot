/**
 * One-off messages to the shop team chat that the owner asked for (PM sends them with a deploy: the cloud cannot call the
 * password-protected inbox API). Each id is sent once (Setting announce:<id>), 10:00-20:59 Tallinn, retried on the next start.
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";

const ANNOUNCEMENTS: { id: string; text: string }[] = [
  {
    // owner 16.11 19:22 «напиши админам магазина о новостях дейси про монтонио»
    id: "2026-11-16-montonio",
    text:
      "📦 Новое у Дейси: она следит за посылками Montonio.\n\n" +
      "Если посылка «в пути» больше 7 дней или ждёт клиентку в пакомате / пункте выдачи больше 4 дней, Дейси напишет сюда номер заказа, перевозчика и ссылку на трекинг.\n\n" +
      "Что делать с таким сообщением: проверить статус у перевозчика и написать клиентке — пока посылка не ушла обратно и клиентка сама не начала её искать.\n\n" +
      "Посылки, отправленные до сегодняшнего дня, Дейси увидит, когда у них в следующий раз сменится статус.",
  },
];

export async function sendAnnouncements() {
  const h = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Tallinn", hour: "2-digit", hour12: false }));
  if (h < 10 || h > 20) return;
  for (const a of ANNOUNCEMENTS) {
    const key = `announce:${a.id}`;
    if (await prisma.setting.findUnique({ where: { key } }).catch(() => null)) continue;
    // claim first, so two instances never send it twice
    try {
      await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    } catch {
      continue;
    }
    const ok = await notifyTeam(a.text, "Claude");
    if (!ok) await prisma.setting.delete({ where: { key } }).catch(() => null);
  }
}
