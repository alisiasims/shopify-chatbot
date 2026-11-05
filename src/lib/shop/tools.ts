import { prisma } from "@/lib/prisma";
import { appUrl, notifyTeam } from "@/lib/notify";
import type { ToolDef } from "@/lib/llm";
import { brief, findVariant, getProduct, searchProducts } from "./catalog";
import { SHOP_URL, type Channel } from "./knowledge";

export type ToolContext = {
  sessionId: string;
  channel: Channel;
  discountGiven: boolean;
  /** collected while the agent runs; saved in Message.meta */
  out: {
    products: string[];
    cartUrl?: string;
    discount?: string;
    handoff?: string;
    skip?: { category: string; reason: string };
    tools: string[];
  };
};

export const discountCode = () => process.env.DISCOUNT_CODE?.trim() || "";
export const discountLabel = () => process.env.DISCOUNT_LABEL?.trim() || "10%";
export const orderLookupReady = () => Boolean(process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE_DOMAIN);

export function toolDefs(channel: Channel): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "search_products",
      description:
        "Search the live DEESSE catalog. Write the query in ENGLISH keywords as products are named in English (e.g. 'pleaser platform sandal black 20cm', 'knee pads', 'shoe protector', 'grip', 'bodysuit glitter'). Returns up to 8 products with price, stock and available sizes.",
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
    {
      name: "handoff_to_human",
      description:
        "Pass the conversation to a DEESSE colleague (complaint, defect, return/exchange of an order, wholesale, custom order, unknown answer, the client asks for a person). The team gets a message with your summary.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: ["complaint", "defect_or_wrong_item", "return_exchange", "order_question", "wholesale", "custom_order", "unknown_answer", "asks_for_human", "other"] },
          summary: { type: "string", description: "2-4 sentences for the colleague: what the client wants, products, order number. No health details." },
          client_name: { type: "string" },
          client_email: { type: "string" },
          order_number: { type: "string" },
        },
        required: ["reason", "summary"],
      },
    },
  ];
  if (discountCode())
    tools.push({
      name: "offer_discount",
      description: "Only when the client hesitates because of the price and is ready to buy. Returns a discount code (once per conversation).",
      input_schema: { type: "object", properties: { why: { type: "string" } }, required: ["why"] },
    });
  if (orderLookupReady())
    tools.push({
      name: "order_status",
      description: "Status and tracking of an order. Needs the order number and the e-mail used for that order; details are given only if both match.",
      input_schema: {
        type: "object",
        properties: { order_number: { type: "string" }, email: { type: "string" } },
        required: ["order_number", "email"],
      },
    });
  if (channel === "email")
    tools.push({
      name: "skip_email",
      description: "The e-mail is not from a customer who needs an answer (advert, newsletter, invoice, supplier offer, spam, automatic notification). No reply will be drafted.",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["advert", "newsletter", "invoice", "supplier", "spam", "notification", "other"] },
          reason: { type: "string" },
        },
        required: ["category", "reason"],
      },
    });
  return tools;
}

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

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
      return JSON.stringify({ found: res.total, showing: res.items.map(brief) });
    }
    case "get_product": {
      const p = await getProduct(str(input.handle));
      if (!p) return JSON.stringify({ error: "No product with this handle. Use search_products first." });
      if (!ctx.out.products.includes(p.handle)) ctx.out.products.push(p.handle);
      return JSON.stringify({
        ...brief(p),
        description: p.body.slice(0, 900),
        tags: p.tags,
        options: p.options.map((o) => `${o.name}: ${o.values.join(", ")}`),
        variants: p.variants.map((v) => ({ variant_id: v.id, title: v.title, price: v.price, available: v.available })),
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
    case "order_status":
      return orderStatus(str(input.order_number), str(input.email));
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
      const sent = await notifyTeam(
        `🛍 DEESSE shop · ${ctx.channel} · ${str(input.reason)}\n${str(input.summary)}\n👤 ${contact || [session.customerName, session.customerEmail].filter(Boolean).join(", ") || "no contact yet"}${link}`,
      );
      if (sent) await prisma.handoff.update({ where: { id: handoff.id }, data: { notified: true } });
      const hasContact = Boolean(email || session.customerEmail);
      return JSON.stringify({
        ok: true,
        note: hasContact
          ? "Saved. Tell the client a colleague will answer by e-mail, usually within one business day."
          : "Saved, but there is no e-mail yet: ask the client for their e-mail so a colleague can answer.",
      });
    }
    case "skip_email":
      ctx.out.skip = { category: str(input.category), reason: str(input.reason) };
      return JSON.stringify({ ok: true, note: "No reply will be drafted. Answer with one short line: SKIP." });
    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}

async function orderStatus(orderNumber: string, email: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const token = process.env.SHOPIFY_ADMIN_TOKEN!;
  const number = orderNumber.replace(/[^0-9A-Za-z-]/g, "");
  if (!number || !email.includes("@")) return JSON.stringify({ error: "Need both the order number and the e-mail." });
  const query = `query($q:String!){orders(first:3,query:$q){nodes{name email createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt
    fulfillments(first:5){status trackingInfo(first:3){number url company}} lineItems(first:15){nodes{title quantity}}}}}`;
  try {
    const res = await fetch(`https://${domain}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: { q: `name:#${number} OR name:${number}` } }),
    });
    const data = (await res.json()) as {
      data?: { orders?: { nodes: Array<Record<string, unknown> & { email?: string | null; name: string }> } };
    };
    const order = data.data?.orders?.nodes.find((o) => o.name.replace("#", "") === number.replace("#", ""));
    if (!order || (order.email ?? "").toLowerCase() !== email.toLowerCase())
      return JSON.stringify({ found: false, note: "No order matches this number and e-mail. Ask the client to check both, or hand over to a colleague." });
    return JSON.stringify({ found: true, order: { ...order, email: undefined } });
  } catch (e) {
    console.error("[order_status]", e);
    return JSON.stringify({ error: "Order lookup failed. Hand over to a colleague." });
  }
}
