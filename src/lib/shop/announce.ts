/**
 * One-off messages to the shop team chat that the owner asked for (PM sends them with a deploy: the cloud cannot call the
 * password-protected inbox API). Each id is sent once (Setting announce:<id>), 10:00-20:59 Tallinn, retried on the next start.
 */
import { prisma } from "@/lib/prisma";
import { notifyTeam } from "@/lib/notify";
import { teamAnswer } from "@/lib/shop/team";

const ANNOUNCEMENTS: { id: string; text?: string; make?: () => Promise<string> }[] = [
  {
    // owner 16.11 19:22 «напиши админам магазина о новостях дейси про монтонио»
    id: "2026-11-16-montonio",
    text:
      "📦 Новое у Дейси: она следит за посылками Montonio.\n\n" +
      "Если посылка «в пути» больше 7 дней или ждёт клиентку в пакомате / пункте выдачи больше 4 дней, Дейси напишет сюда номер заказа, перевозчика и ссылку на трекинг.\n\n" +
      "Что делать с таким сообщением: проверить статус у перевозчика и написать клиентке — пока посылка не ушла обратно и клиентка сама не начала её искать.\n\n" +
      "Посылки, отправленные до сегодняшнего дня, Дейси увидит, когда у них в следующий раз сменится статус.",
  },
  {
    // owner 23.11 «да и ответь Юлии там же» (Yuliia 23.11 14:50, topic «Бот»: list of chats where the client went quiet / promised to think)
    id: "2026-11-23-quiet-clients",
    text:
      "Юлия, отвечаю на твой вопрос про чаты, где клиент не ответил или обещал подумать.\n\n" +
      "Да, такой список теперь есть. Напиши мне здесь, например: «Дейси, кто из клиентов не ответил?» или «кто обещал подумать?» — " +
      "пришлю список: клиент, канал, сколько дней тишины, о чём шла речь и ссылка на чат. Можно указать срок: «за последние 7 дней».\n\n" +
      "Сейчас в списке чаты с сайта и почта. Переписки в Instagram я пока не вижу: ждём одобрения доступа от Meta. " +
      "Как только одобрят, Instagram появится в этом же списке, а пока эти чаты нужно просматривать в самом Instagram.",
  },
  {
    // owner 25.11 16:50 «Дейси снова не отвечает Юле»: Юлия 16:30 + 16:33 asked for the list, quiet_clients ran but the answer came back
    // empty (token budget) -> answer her now with the real list after the fix.
    id: "2026-11-25-quiet-clients-answer",
    make: async () => {
      const a = await teamAnswer(
        "[сообщение обращено к тебе по имени - не отвечай SKIP]\nДейси, сделай список чатов в Инстаграм и на почте, клиентов к которым надо вернуться",
        "Юлия",
        [],
      );
      return /^SKIP\b/.test(a.trim()) ? "" : `Юлия, отвечаю на твой вопрос (16:30 и 16:33), простите за задержку.\n\n${a}`;
    },
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
    const text = a.make ? await a.make().catch((e) => (console.error("[announce]", a.id, e), "")) : a.text || "";
    const ok = text ? await notifyTeam(text, a.make ? "Deisi" : "Claude") : false;
    if (!ok) await prisma.setting.delete({ where: { key } }).catch(() => null);
  }
}
