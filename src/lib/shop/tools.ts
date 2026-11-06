import { prisma } from "@/lib/prisma";
import { appUrl, notifyTeam, notifyTeamId } from "@/lib/notify";
import type { ToolDef } from "@/lib/llm";
import { brief, findVariant, getExtras, getProduct, getStock, searchProducts } from "./catalog";
import { SHOP_URL, type Channel } from "./knowledge";
import { adminReady, createOrder, deliveryOptions, orderByNumber, ordersByEmail, type OrderItem } from "./shopify";

/** Team notices are in Russian (owner 06.11: Yulia does not read Estonian). */
const CHANNEL_RU: Record<string, string> = { web: "чат на сайте", instagram: "Instagram", messenger: "Messenger", email: "почта", app: "тест" };
const REASON_RU: Record<string, string> = {
  complaint: "жалоба", defect: "брак", return: "возврат / обмен", exchange: "обмен", wholesale: "опт", custom: "индивидуальный заказ",
  custom_order: "индивидуальный заказ", unknown_answer: "нет ответа в базе", asks_for_human: "клиент просит человека", other: "другое",
  defect_or_wrong_item: "брак / не тот товар", return_exchange: "возврат / обмен", order_question: "вопрос по заказу", payment_proof: "скрин оплаты — проверьте поступление",
};

export type ToolContext = {
  sessionId: string;
  channel: Channel;
  discountGiven: boolean;
  /** e-mail confirmed by the channel (Gmail sender) - allows order lookup without an order number */
  verifiedEmail?: string | null;
  /** collected while the agent runs; saved in Message.meta */
  out: {
    products: string[];
    cartUrl?: string;
    order?: string;
    discount?: string;
    handoff?: string;
    skip?: { category: string; reason: string };
    tools: string[];
  };
};

export const discountCode = () => process.env.DISCOUNT_CODE?.trim() || "";
export const discountLabel = () => process.env.DISCOUNT_LABEL?.trim() || "10%";
export const orderLookupReady = adminReady;

export function toolDefs(channel: Channel): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "search_products",
      description:
        "Search the live DEESSE catalog. Write the query in ENGLISH keywords as products are named in English (e.g. 'pleaser platform sandal black', 'boots', 'knee pads', 'shoe protector', 'grip', 'bodysuit glitter'). Pass the client's size in `size`. Returns up to 8 products with price, heel/platform height, which sizes are in our own stock now (Showroom Tatari 64 / Studio Ehitajate tee 114b) and which sizes are only on order. Products with the client's size in our stock come first.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_price: { type: "number", description: "EUR" },
          min_price: { type: "number", description: "EUR" },
          size: { type: "string", description: "only products with this size available, e.g. '38' or 'M'" },
          in_stock_only: { type: "boolean", description: "only products in the Tallinn stock" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_product",
      description: "Full details of one product: description, all variants with variant_id, size and availability. Use before making a cart link.",
      input_schema: {
        type: "object",
        properties: { handle: { type: "string", description: "product handle or product URL" } },
        required: ["handle"],
      },
    },
    {
      name: "make_cart_link",
      description:
        "Create a checkout link that puts the chosen variants into the client's deesse.ee cart. Use only variant_ids from get_product. The client pays at the Shopify checkout.",
      input_schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { variant_id: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 10 } },
              required: ["variant_id"],
            },
          },
        },
        required: ["items"],
      },
    },
    ...(adminReady()
      ? [
          {
            name: "delivery_options",
            description:
              "Real delivery options and prices for the chosen items to the client's address: local pickup in Tallinn (free), parcel lockers nearest to the address (Omniva, DPD, SmartPosti, Unisend…) and couriers. Needs at least the country; city and/or postcode give the nearest lockers.",
            input_schema: {
              type: "object",
              properties: {
                items: { type: "array", items: { type: "object", properties: { variant_id: { type: "string" }, quantity: { type: "integer" } }, required: ["variant_id"] } },
                country: { type: "string", description: "ISO code, e.g. EE, LV, FI" },
                city: { type: "string" },
                zip: { type: "string" },
                address1: { type: "string", description: "street address, for couriers" },
              },
              required: ["items", "country"],
            },
          },
          {
            name: "create_order",
            description:
              "Create the client's order with the chosen delivery and get the payment link (secure Shopify checkout, card / bank link / Apple Pay). Only after the client confirmed products, sizes and delivery, and gave name + e-mail (+ phone for parcel lockers and couriers). The order becomes paid and real when the client pays.",
            input_schema: {
              type: "object",
              properties: {
                items: { type: "array", items: { type: "object", properties: { variant_id: { type: "string" }, quantity: { type: "integer" } }, required: ["variant_id"] } },
                delivery_title: { type: "string", description: "exact title from delivery_options" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                country: { type: "string" },
                city: { type: "string" },
                zip: { type: "string" },
                address1: { type: "string" },
                note: { type: "string", description: "short note for the shop team, e.g. gift wrapping" },
                discount_code: { type: "string", description: "a discount code the client gave (influencer / gift code)" },
              },
              required: ["items", "delivery_title", "first_name", "email", "country"],
            },
          },
        ]
      : []),
    {
      name: "handoff_to_human",
      description:
        "Pass the conversation to a DEESSE colleague (complaint, defect, return/exchange of an order, wholesale, custom order, unknown answer, the client asks for a person). The team gets a message with your summary.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: ["complaint", "defect_or_wrong_item", "return_exchange", "order_question", "payment_proof", "wholesale", "custom_order", "unknown_answer", "asks_for_human", "other"] },
          summary: { type: "string", description: "2-4 sentences for the colleague, ALWAYS IN RUSSIAN whatever the client's language (owner 06.11: the team reads Russian, Yulia does not read Estonian): what the client wants, products, order number. Quote the client's key words in the original language only if needed. No health details." },
          client_name: { type: "string" },
          client_email: { type: "string" },
          order_number: { type: "string" },
        },
        required: ["reason", "summary"],
      },
    },
  ];
  if (channel !== "app" && channel !== "email")
    tools.push({
      name: "ask_team",
      description:
        "Ask the DEESSE team in Telegram a short question you cannot answer from the tools (e.g. can we hold a size until Friday, is a colour coming back, can the client pick up today at 18:00). The team answers in Telegram and you answer the client yourself as soon as they reply. Tell the client in one line that you are checking with a colleague and will write back here. Do not use for complaints, returns or defects (handoff_to_human).",
      input_schema: {
        type: "object",
        properties: { question: { type: "string", description: "IN RUSSIAN, one or two sentences, with the product / size / order it is about" } },
        required: ["question"],
      },
    });
  if (channel !== "app")
    tools.push({
      name: "add_team_task",
      description:
        "Add a task for the shop team (shown in the shift list at 15:00): something a person must do physically or later - hold / reserve a size for a client, prepare an order for pickup at the showroom at a time, check if an item is in the studio, call back. Not for questions (ask_team) or complaints (handoff_to_human).",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "IN RUSSIAN: what to do, for whom (name), product and size, by when" } },
        required: ["text"],
      },
    });
  if (discountCode())
    tools.push({
      name: "offer_discount",
      description: "Only when the client hesitates because of the price and is ready to buy. Returns a discount code (once per conversation).",
      input_schema: { type: "object", properties: { why: { type: "string" } }, required: ["why"] },
    });
  if (orderLookupReady())
    tools.push({
      name: "order_status",
      description:
        "Status, delivery method and tracking of the client's order. Needs the order number AND the e-mail used for the order (details only if both match). On e-mail the sender's address is already verified: then the order number may be omitted to get the latest orders.",
      input_schema: {
        type: "object",
        properties: { order_number: { type: "string" }, email: { type: "string" } },
      },
    });
  if (channel === "email")
    tools.push({
      name: "skip_email",
      description:
        "The e-mail is not from a customer who needs an answer: advert, newsletter, invoice, cold sales / supplier offer, spam, automatic notification - or a COLLABORATION offer (influencer, blogger, photographer, brand, media, event, sponsorship, barter); collaborations go to the owner's «Сотрудничество» list. No reply will be drafted.",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["advert", "newsletter", "invoice", "supplier", "spam", "notification", "collaboration", "other"] },
          reason: { type: "string", description: "in Russian, one sentence for the team; for an invoice say if anything looks suspicious (changed bank details / IBAN, unknown company, pressure to pay urgently)" },
        },
        required: ["category", "reason"],
      },
    });
  else if (channel !== "app")
    tools.push({
      name: "mark_conversation",
      description:
        "The message is not from a buying client. type=spam: bots, «promote your page / get followers», phishing, «your account violates…», crypto, nonsense - you will not answer at all. type=collaboration: an influencer, blogger, photographer, brand, media, event or sponsorship offer, barter request - the owner decides; reply with ONE short polite line in the client's language (thank you, the team will look at the offer and answer), never promise free products, discounts or barter.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["spam", "collaboration"] },
          summary: { type: "string", description: "in Russian, 1-2 sentences for the team: who and what they offer" },
        },
        required: ["type", "summary"],
      },
    });
  return tools;
}

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

/** skip_email categories -> inbox section (owner 06.11: separate sections for spam and collaborations). */
function topicFor(category: string): "spam" | "collab" | null {
  if (category === "collaboration") return "collab";
  return ["advert", "newsletter", "spam", "notification", "supplier"].includes(category) ? "spam" : null;
}

async function setTopic(ctx: ToolContext, topic: "spam" | "collab", summary: string) {
  if (ctx.sessionId === "team") return;
  const s = await prisma.chatSession.update({ where: { id: ctx.sessionId }, data: { topic }, select: { customerName: true, customerEmail: true, title: true } });
  if (topic === "collab")
    await notifyTeam(`🤝 Сотрудничество · ${CHANNEL_RU[ctx.channel] ?? ctx.channel} · ${s.customerName || s.customerEmail || s.title}\n${summary.slice(0, 600)}\nРаздел «Сотрудничество» в Shopify → Приложения → Deisi.`);
}

export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<string> {
  ctx.out.tools.push(name);
  switch (name) {
    case "search_products": {
      const res = await searchProducts({
        query: str(input.query),
        maxPrice: typeof input.max_price === "number" ? input.max_price : undefined,
        minPrice: typeof input.min_price === "number" ? input.min_price : undefined,
        size: str(input.size) || undefined,
        inStockOnly: input.in_stock_only === true,
      });
      if (!res.items.length) return JSON.stringify({ found: 0, note: "Nothing matched. Try other English keywords, or ask the client for details." });
      return JSON.stringify({ found: res.total, showing: res.items.map((p) => brief(p, res.local, res.extras)) });
    }
    case "get_product": {
      const p = await getProduct(str(input.handle));
      if (!p) return JSON.stringify({ error: "No product with this handle. Use search_products first." });
      if (!ctx.out.products.includes(p.handle)) ctx.out.products.push(p.handle);
      const [local, extra] = await Promise.all([getStock(), getExtras()]);
      return JSON.stringify({
        ...brief(p, local, extra),
        description: p.body.slice(0, 900),
        tags: p.tags,
        options: p.options.map((o) => `${o.name}: ${o.values.join(", ")}`),
        variants: p.variants.map((v) => ({
          variant_id: v.id,
          title: v.title,
          price: v.price,
          in_our_stock: (local[v.id]?.showroom ?? 0) + (local[v.id]?.studio ?? 0) > 0,
          orderable: v.available,
        })),
      });
    }
    case "make_cart_link": {
      const items = Array.isArray(input.items) ? (input.items as Input[]) : [];
      if (!items.length) return JSON.stringify({ error: "No items" });
      const parts: string[] = [];
      const lines: string[] = [];
      let total = 0;
      for (const it of items) {
        const found = await findVariant(str(it.variant_id));
        if (!found) return JSON.stringify({ error: `Unknown variant_id ${str(it.variant_id)}. Use variant_id from get_product.` });
        if (!found.variant.available) return JSON.stringify({ error: `${found.product.title} (${found.variant.title}) is not available.` });
        const qty = Math.min(10, Math.max(1, Number(it.quantity) || 1));
        parts.push(`${found.variant.id}:${qty}`);
        total += found.variant.price * qty;
        lines.push(`${qty} × ${found.product.title}${found.variant.title !== "Default Title" ? ` (${found.variant.title})` : ""} – ${found.variant.price.toFixed(2)} EUR`);
        if (!ctx.out.products.includes(found.product.handle)) ctx.out.products.push(found.product.handle);
      }
      const params = new URLSearchParams({ utm_source: "deisi", utm_medium: ctx.channel });
      if (ctx.out.discount) params.set("discount", ctx.out.discount);
      const url = `${SHOP_URL}/cart/${parts.join(",")}?${params.toString()}`;
      ctx.out.cartUrl = url;
      const freeShip = total >= 175 ? "Free parcel-machine delivery applies (over 175 EUR)." : `Add ${(175 - total).toFixed(2)} EUR more for free parcel-machine delivery.`;
      return JSON.stringify({ cart_url: url, items: lines, subtotal: `${total.toFixed(2)} EUR`, delivery: freeShip, note: "Delivery cost is shown at checkout. The order exists only after payment." });
    }
    case "offer_discount": {
      if (ctx.discountGiven || ctx.out.discount) return JSON.stringify({ error: "A discount was already offered in this conversation." });
      const code = discountCode();
      if (!code) return JSON.stringify({ error: "No discount available." });
      ctx.out.discount = code;
      return JSON.stringify({ code, value: discountLabel(), note: "Applied automatically by cart links made after this. Offer it once, warmly, without pressure." });
    }
    case "order_status": {
      const number = str(input.order_number);
      const email = str(input.email).toLowerCase() || ctx.verifiedEmail || "";
      if (!number) {
        if (!ctx.verifiedEmail) return JSON.stringify({ error: "Ask for the order number and the e-mail used for the order." });
        const list = await ordersByEmail(ctx.verifiedEmail);
        return JSON.stringify(list.length ? { orders: list } : { found: false, note: "No orders for this e-mail. Ask for the order number." });
      }
      if (!email.includes("@")) return JSON.stringify({ error: "Need the e-mail used for the order too." });
      const o = await orderByNumber(number, email);
      return JSON.stringify(
        o
          ? { found: true, order: o, note: "UNFULFILLED = being prepared (1-2 business days after payment); FULFILLED = shipped, give the tracking link if there is one." }
          : { found: false, note: "No order matches this number and e-mail. Ask the client to check both (the e-mail from the order confirmation)." },
      );
    }
    case "delivery_options": {
      const items = Array.isArray(input.items) ? (input.items as OrderItem[]) : [];
      if (!items.length) return JSON.stringify({ error: "Choose the products first (variant_id from get_product)." });
      const res = await deliveryOptions(items, {
        country: str(input.country) || "EE",
        city: str(input.city) || undefined,
        zip: str(input.zip) || undefined,
        address1: str(input.address1) || undefined,
      });
      const lockers = res.options.filter((o) => o.kind === "parcel_locker");
      return JSON.stringify({
        subtotal: res.subtotal,
        pickup: res.options.filter((o) => o.kind === "pickup"),
        parcel_lockers_nearest: lockers.slice(0, 12),
        couriers: res.options.filter((o) => o.kind === "courier"),
        note: "Offer the client 2-4 fitting options (nearest lockers of different carriers, pickup if in Tallinn, courier). Use the exact title in create_order.",
      });
    }
    case "create_order": {
      const items = Array.isArray(input.items) ? (input.items as OrderItem[]) : [];
      const email = str(input.email).toLowerCase();
      if (!items.length || !email.includes("@")) return JSON.stringify({ error: "Need the items and the client's e-mail." });
      for (const it of items) {
        const found = await findVariant(str(it.variant_id));
        if (!found) return JSON.stringify({ error: `Unknown variant_id ${str(it.variant_id)}. Use variant_id from get_product.` });
        if (!ctx.out.products.includes(found.product.handle)) ctx.out.products.push(found.product.handle);
      }
      const res = await createOrder({
        items,
        address: {
          country: str(input.country) || "EE",
          city: str(input.city) || undefined,
          zip: str(input.zip) || undefined,
          address1: str(input.address1) || undefined,
          first_name: str(input.first_name) || undefined,
          last_name: str(input.last_name) || undefined,
        },
        deliveryTitle: str(input.delivery_title),
        email,
        phone: str(input.phone) || undefined,
        note: str(input.note) || undefined,
        discountCode: str(input.discount_code) || ctx.out.discount,
        tags: ["deisi", ctx.channel],
      });
      if ("error" in res) return JSON.stringify(res);
      ctx.out.cartUrl = res.paymentUrl;
      ctx.out.order = res.name;
      await prisma.chatSession.update({
        where: { id: ctx.sessionId },
        data: { customerEmail: email, ...(str(input.first_name) ? { customerName: `${str(input.first_name)} ${str(input.last_name)}`.trim() } : {}) },
      });
      await notifyTeam(`🧾 Дейси оформила заказ ${res.name} · ${res.total} · ${res.delivery}\n${email} · ждёт оплаты по ссылке (${CHANNEL_RU[ctx.channel] ?? ctx.channel})`);
      return JSON.stringify({
        order: res.name,
        payment_url: res.paymentUrl,
        total_with_delivery: res.total,
        delivery: res.delivery,
        note: "Give the client the payment link. The order is confirmed by e-mail after payment; if the client cannot pay by card, offer a colleague's help.",
      });
    }
    case "handoff_to_human": {
      const name = str(input.client_name) || null;
      const email = str(input.client_email).toLowerCase() || null;
      const order = str(input.order_number);
      const contact = [name, email, order ? `order ${order}` : ""].filter(Boolean).join(", ") || null;
      const session = await prisma.chatSession.update({
        where: { id: ctx.sessionId },
        data: { needsHuman: true, ...(name ? { customerName: name } : {}), ...(email ? { customerEmail: email } : {}) },
        select: { customerName: true, customerEmail: true },
      });
      const handoff = await prisma.handoff.create({
        data: { sessionId: ctx.sessionId, channel: ctx.channel, reason: str(input.reason) || "other", summary: str(input.summary).slice(0, 1500), contact },
      });
      ctx.out.handoff = handoff.id;
      const link = appUrl() ? `\n${appUrl()}/inbox?chat=${ctx.sessionId}` : "";
      const sentId = await notifyTeamId(
        `🛍 Магазин DEESSE · ${CHANNEL_RU[ctx.channel] ?? ctx.channel} · ${REASON_RU[str(input.reason)] ?? str(input.reason)}\n${str(input.summary)}\n👤 ${contact || [session.customerName, session.customerEmail].filter(Boolean).join(", ") || "контакта пока нет"}${link}`,
        undefined,
        [[{ text: "✅ Ответили / готово", callback_data: `hd:${handoff.id}` }]],
      );
      if (sentId) await prisma.handoff.update({ where: { id: handoff.id }, data: { notified: true, tgMessageId: sentId } });
      const hasContact = Boolean(email || session.customerEmail);
      return JSON.stringify({
        ok: true,
        note: hasContact
          ? "Saved. Tell the client a colleague will answer by e-mail, usually within one business day."
          : "Saved, but there is no e-mail yet: ask the client for their e-mail so a colleague can answer.",
      });
    }
    case "ask_team": {
      const q = str(input.question).slice(0, 800);
      if (!q) return JSON.stringify({ error: "Empty question" });
      const s = await prisma.chatSession.findUnique({ where: { id: ctx.sessionId }, select: { customerName: true, customerEmail: true, title: true } });
      const open = await prisma.staffQuestion.findFirst({ where: { sessionId: ctx.sessionId, status: "asked", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
      if (open) await prisma.staffQuestion.update({ where: { id: open.id }, data: { status: "superseded" } });
      const msgId = await notifyTeamId(
        `❓ Дейси спрашивает (${CHANNEL_RU[ctx.channel] ?? ctx.channel} · ${s?.customerName || s?.customerEmail || s?.title?.slice(0, 40) || "клиент"}):\n${q}\n\n↩️ Ответьте ОТВЕТОМ (reply) на это сообщение — Дейси сама напишет клиенту.`,
      );
      await prisma.staffQuestion.create({ data: { sessionId: ctx.sessionId, question: q, tgMessageId: msgId } });
      return JSON.stringify({ ok: Boolean(msgId), note: msgId ? "Asked. Tell the client in one short line that you are checking with a colleague and will write back here soon." : "Telegram is not reachable: use handoff_to_human instead." });
    }
    case "add_team_task": {
      const text = str(input.text).slice(0, 500);
      if (!text) return JSON.stringify({ error: "Empty task" });
      const task = await prisma.teamTask.create({ data: { text, sessionId: ctx.sessionId === "team" ? null : ctx.sessionId, by: "Дейси" } });
      const tgId = await notifyTeamId(`📝 Новая задача от Дейси: ${text}\n(готово — кнопка ниже или 👍 на это сообщение)`, undefined, [[{ text: "✅ Готово", callback_data: `td:${task.id}` }]]);
      if (tgId) await prisma.teamTask.update({ where: { id: task.id }, data: { tgMessageId: tgId } });
      return JSON.stringify({ ok: true, note: "Saved for the team (shift list at 15:00). Tell the client what happens next, without promising an exact time the team did not confirm." });
    }
    case "skip_email": {
      const category = str(input.category);
      ctx.out.skip = { category, reason: str(input.reason) };
      const topic = topicFor(category);
      if (topic) await setTopic(ctx, topic, str(input.reason));
      return JSON.stringify({ ok: true, note: "No reply will be drafted. Answer with one short line: SKIP." });
    }
    case "mark_conversation": {
      const type = str(input.type) === "collaboration" ? "collab" : "spam";
      await setTopic(ctx, type, str(input.summary));
      if (type === "spam") {
        ctx.out.skip = { category: "spam", reason: str(input.summary) };
        return JSON.stringify({ ok: true, note: "Marked as spam. Do not answer: write only SKIP." });
      }
      return JSON.stringify({ ok: true, note: "Saved for the owner. Reply with ONE short polite line in the client's language: thank you, the team will look at the offer and answer. No promises." });
    }
    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}
