/**
 * Shopify Admin API for Deisi: delivery prices, orders (draft order + payment link) and order status.
 * Access: SHOPIFY_STORE_DOMAIN (xxx.myshopify.com) and either SHOPIFY_ADMIN_TOKEN, or
 * SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET of a Dev Dashboard app (client credentials grant, token renewed every day).
 */

const API_VERSION = "2025-10";
let cached: { token: string; until: number } | null = null;

export function adminReady() {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      (process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)),
  );
}

async function adminToken(): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cached && Date.now() < cached.until) return cached.token;
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID!,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Shopify token: HTTP ${res.status} ${data.error ?? ""}`);
  cached = { token: data.access_token, until: Date.now() + Math.max(600, (data.expires_in ?? 86400) - 600) * 1000 };
  return data.access_token;
}

export async function admin<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await adminToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) cached = null;
  const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
  if (!res.ok || data.errors) throw new Error(`Shopify Admin ${res.status}: ${JSON.stringify(data.errors ?? "").slice(0, 300)}`);
  return data.data as T;
}

export type OrderItem = { variant_id: string; quantity?: number };
export type Address = {
  country: string;
  city?: string;
  zip?: string;
  address1?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
};

type Rate = { handle: string; title: string; price: { amount: string } };

function lineItems(items: OrderItem[]) {
  return items.map((i) => ({
    variantId: `gid://shopify/ProductVariant/${String(i.variant_id).replace(/\D/g, "")}`,
    quantity: Math.min(10, Math.max(1, Number(i.quantity) || 1)),
  }));
}

function mailing(a: Address) {
  return {
    countryCode: a.country.toUpperCase().slice(0, 2),
    ...(a.city ? { city: a.city } : {}),
    ...(a.zip ? { zip: a.zip } : {}),
    ...(a.address1 ? { address1: a.address1 } : {}),
    ...(a.first_name ? { firstName: a.first_name } : {}),
    ...(a.last_name ? { lastName: a.last_name } : {}),
    ...(a.phone ? { phone: a.phone } : {}),
  };
}

const CALC = `mutation Calc($input: DraftOrderInput!) { draftOrderCalculate(input: $input) {
  calculatedDraftOrder { subtotalPriceSet { shopMoney { amount } } availableShippingRates { handle title price { amount } } }
  userErrors { field message } } }`;

async function calculate(items: OrderItem[], address: Address, discountCodes: string[] = []) {
  const data = await admin<{
    draftOrderCalculate: {
      calculatedDraftOrder: { subtotalPriceSet: { shopMoney: { amount: string } }; availableShippingRates: Rate[] } | null;
      userErrors: { message: string }[];
    };
  }>(CALC, { input: { lineItems: lineItems(items), shippingAddress: mailing(address), ...(discountCodes.length ? { discountCodes } : {}) } });
  const r = data.draftOrderCalculate;
  if (!r.calculatedDraftOrder) throw new Error(r.userErrors.map((e) => e.message).join("; ") || "calculate failed");
  return r.calculatedDraftOrder;
}

/** Delivery options with real prices for these items and this address (pickup, parcel lockers near the address, couriers). */
export async function deliveryOptions(items: OrderItem[], address: Address) {
  const calc = await calculate(items, address);
  const options = calc.availableShippingRates.map((r) => {
    const t = r.title;
    const kind = /pickup/i.test(t) ? "pickup" : /parcel locker|pakiautomaat|pakipunkt/i.test(t) ? "parcel_locker" : "courier";
    return { title: t, price: `${Number(r.price.amount).toFixed(2)} EUR`, kind };
  });
  return { subtotal: `${Number(calc.subtotalPriceSet.shopMoney.amount).toFixed(2)} EUR`, options };
}

/**
 * Creates the order as a Shopify draft order with the chosen delivery and returns the payment link (Shopify checkout).
 * The order becomes a real order when the client pays.
 */
export async function createOrder(opts: {
  items: OrderItem[];
  address: Address;
  deliveryTitle: string;
  email: string;
  phone?: string;
  note?: string;
  discountCode?: string;
  tags: string[];
}) {
  const calc = await calculate(opts.items, opts.address);
  const wanted = opts.deliveryTitle.trim().toLowerCase();
  const rate =
    calc.availableShippingRates.find((r) => r.title.toLowerCase() === wanted) ??
    calc.availableShippingRates.find((r) => r.title.toLowerCase().includes(wanted) || wanted.includes(r.title.toLowerCase()));
  if (!rate)
    return { error: "This delivery option is not available for this address. Call delivery_options again and use an exact title.", options: calc.availableShippingRates.map((r) => r.title) };

  const data = await admin<{
    draftOrderCreate: {
      draftOrder: { id: string; name: string; invoiceUrl: string; totalPriceSet: { shopMoney: { amount: string } } } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation Create($input: DraftOrderInput!) { draftOrderCreate(input: $input) {
      draftOrder { id name invoiceUrl totalPriceSet { shopMoney { amount } } }
      userErrors { field message } } }`,
    {
      input: {
        lineItems: lineItems(opts.items),
        email: opts.email,
        ...(opts.phone ? { phone: opts.phone } : {}),
        shippingAddress: mailing({ ...opts.address, phone: opts.phone ?? opts.address.phone }),
        shippingLine: { shippingRateHandle: rate.handle },
        ...(opts.discountCode ? { discountCodes: [opts.discountCode] } : {}),
        note: opts.note ? opts.note.slice(0, 500) : "Order made by Deisi (AI assistant)",
        tags: opts.tags,
        sourceName: "deisi",
      },
    },
  );
  const r = data.draftOrderCreate;
  if (!r.draftOrder) return { error: r.userErrors.map((e) => e.message).join("; ") || "draft order failed" };
  return {
    name: r.draftOrder.name,
    paymentUrl: r.draftOrder.invoiceUrl,
    total: `${Number(r.draftOrder.totalPriceSet.shopMoney.amount).toFixed(2)} EUR`,
    delivery: `${rate.title} (${Number(rate.price.amount).toFixed(2)} EUR)`,
  };
}

type OrderNode = {
  name: string;
  email: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  cancelledAt: string | null;
  shippingLine: { title: string } | null;
  fulfillments: { status: string; createdAt: string; trackingInfo: { number: string | null; url: string | null; company: string | null }[] }[];
  lineItems: { nodes: { title: string; quantity: number }[] };
};

const ORDER_FIELDS = `name email createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt shippingLine { title }
  fulfillments(first: 5) { status createdAt trackingInfo(first: 3) { number url company } }
  lineItems(first: 15) { nodes { title quantity } }`;

function view(o: OrderNode) {
  return {
    order: o.name,
    created: o.createdAt.slice(0, 10),
    payment: o.displayFinancialStatus,
    fulfillment: o.displayFulfillmentStatus,
    cancelled: Boolean(o.cancelledAt),
    delivery: o.shippingLine?.title ?? null,
    shipments: o.fulfillments.map((f) => ({ status: f.status, date: f.createdAt.slice(0, 10), tracking: f.trackingInfo })),
    items: o.lineItems.nodes.map((l) => `${l.quantity} × ${l.title}`),
  };
}

/** Order by number; details only when the e-mail matches the order. */
export async function orderByNumber(number: string, email: string) {
  const n = number.replace(/[^0-9A-Za-z-]/g, "");
  const data = await admin<{ orders: { nodes: OrderNode[] } }>(
    `query($q: String!) { orders(first: 3, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: `name:#${n} OR name:${n}` },
  );
  const o = data.orders.nodes.find((x) => x.name.replace("#", "") === n.replace("#", ""));
  if (!o || (o.email ?? "").toLowerCase() !== email.toLowerCase()) return null;
  return view(o);
}

/** Latest orders of a verified e-mail (used on the e-mail channel, where Gmail confirmed the sender). */
export async function ordersByEmail(email: string) {
  const data = await admin<{ orders: { nodes: OrderNode[] } }>(
    `query($q: String!) { orders(first: 3, sortKey: CREATED_AT, reverse: true, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: `email:${email}` },
  );
  return data.orders.nodes.filter((o) => (o.email ?? "").toLowerCase() === email.toLowerCase()).map(view);
}
