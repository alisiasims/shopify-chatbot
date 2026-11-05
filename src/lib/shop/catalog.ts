import { prisma } from "@/lib/prisma";
import { SHOP_URL } from "./knowledge";
import { admin, adminReady } from "./shopify";

/** Products are re-read from deesse.ee/products.json when the cache is older than this. */
const MAX_AGE_MS = Number(process.env.CATALOG_MAX_AGE_HOURS || 6) * 3600_000;
const MEMORY_TTL_MS = 5 * 60_000;
const MARKET_COUNTRY = process.env.SHOP_COUNTRY || "EE";

export type Variant = { id: string; title: string; available: boolean; price: number; compareAt: number | null; sku?: string | null };
/** Pieces in our own stock per location (from Shopify inventory), by variant id. */
export type LocalStock = Record<string, { showroom: number; studio: number }>;
export type CatalogProduct = {
  id: string;
  handle: string;
  title: string;
  tags: string[];
  productType: string;
  body: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
  compareAt: number | null;
  inStock: boolean;
  options: { name: string; values: string[] }[];
  variants: Variant[];
  url: string;
};

type RawProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  product_type: string | null;
  tags: string[] | string;
  options: { name: string; values: string[] }[];
  variants: { id: number; title: string; available: boolean; price: string; compare_at_price: string | null; sku?: string | null }[];
  images: { src: string }[];
};

let memory: { at: number; items: CatalogProduct[] } | null = null;
let stock: { at: number; byVariant: LocalStock } | null = null;
let stockLoading: Promise<LocalStock> | null = null;
const STOCK_TTL_MS = 15 * 60_000;

/** Where our two locations are (Shopify location names → what clients understand). */
export const LOCATIONS = { showroom: "Showroom, Tatari 64, Tallinn", studio: "DEESSE Studio, Ehitajate tee 114b, Tallinn" };

/** Reads the pieces in stock per variant and location from Shopify (only variants with stock > 0). */
async function loadStock(): Promise<LocalStock> {
  const out: LocalStock = {};
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { legacyResourceId: string; inventoryItem: { inventoryLevels: { nodes: { location: { name: string }; quantities: { quantity: number }[] }[] } } }[];
      };
    } = await admin(
      `query($after: String) { productVariants(first: 100, after: $after, query: "inventory_quantity:>0") {
        pageInfo { hasNextPage endCursor }
        nodes { legacyResourceId inventoryItem { inventoryLevels(first: 5) { nodes { location { name } quantities(names: ["available"]) { quantity } } } } } } }`,
      { after },
    );
    for (const v of data.productVariants.nodes) {
      const s = { showroom: 0, studio: 0 };
      for (const l of v.inventoryItem.inventoryLevels.nodes) {
        const q = Math.max(0, l.quantities[0]?.quantity ?? 0);
        if (/studio/i.test(l.location.name)) s.studio += q;
        else s.showroom += q;
      }
      if (s.showroom + s.studio > 0) out[v.legacyResourceId] = s;
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }
  return out;
}

/** Local stock per variant, refreshed every 15 minutes. Empty when the Admin API is not connected. */
export async function getStock(): Promise<LocalStock> {
  if (!adminReady()) return {};
  if (stock && Date.now() - stock.at < STOCK_TTL_MS) return stock.byVariant;
  if (!stockLoading)
    stockLoading = loadStock()
      .then((byVariant) => {
        stock = { at: Date.now(), byVariant };
        return byVariant;
      })
      .finally(() => {
        stockLoading = null;
      });
  try {
    return await stockLoading;
  } catch (e) {
    console.error("[catalog] stock failed", e);
    return stock?.byVariant ?? {};
  }
}

/** Heel and platform height from the product text, e.g. 8″ (203mm) Heel, 4″ (102mm) Platform. */
export function heights(p: { body: string; title: string }) {
  const t = `${p.title} ${p.body}`;
  const mm = (re: RegExp) => {
    const m = t.match(re);
    return m ? Math.round(Number(m[1]) / 10) : null;
  };
  const heel = mm(/\((\d{2,3})\s?mm\)\s*(?:stiletto\s+)?heel/i) ?? (Number(t.match(/(\d{1,2})\s?cm\s+(?:stiletto\s+)?heel/i)?.[1]) || null);
  const platform = mm(/\((\d{2,3})\s?mm\)\s*platform/i);
  return { heel, platform };
}
let syncing: Promise<number> | null = null;

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(raw: RawProduct): CatalogProduct {
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const variants: Variant[] = raw.variants.map((v) => ({
    id: String(v.id),
    title: v.title,
    available: v.available !== false,
    price: Number(v.price),
    compareAt: v.compare_at_price ? Number(v.compare_at_price) : null,
    sku: v.sku ?? null,
  }));
  const prices = variants.map((v) => v.price).filter((n) => Number.isFinite(n));
  const compare = variants.map((v) => v.compareAt ?? 0).filter((n) => n > 0);
  const lower = tags.map((t) => t.toLowerCase());
  return {
    id: String(raw.id),
    handle: raw.handle,
    title: raw.title,
    tags,
    productType: raw.product_type || "",
    body: stripHtml(raw.body_html || "").slice(0, 1500),
    image: raw.images?.[0]?.src ?? null,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    compareAt: compare.length ? Math.max(...compare) : null,
    inStock: !lower.includes("outofstock"),
    options: (raw.options || []).map((o) => ({ name: o.name, values: o.values })),
    variants,
    url: `${SHOP_URL}/products/${raw.handle}`,
  };
}

async function fetchAll(): Promise<CatalogProduct[]> {
  const all: CatalogProduct[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${SHOP_URL}/products.json?limit=250&page=${page}&country=${MARKET_COUNTRY}&currency=EUR`, {
      // The server runs abroad: without the Estonian market Shopify returns converted (e.g. USD) prices.
      headers: {
        Accept: "application/json",
        "User-Agent": "DEESSE-assistant/1.0",
        Cookie: `localization=${MARKET_COUNTRY}; cart_currency=EUR`,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`products.json page ${page}: HTTP ${res.status}`);
    const data = (await res.json()) as { products: RawProduct[] };
    if (!data.products?.length) break;
    all.push(...data.products.map(normalize));
    if (data.products.length < 250) break;
  }
  return all;
}

/** Downloads the whole catalog and replaces the cache table. Returns the number of products. */
export async function syncCatalog(): Promise<number> {
  if (syncing) return syncing;
  syncing = (async () => {
    const items = await fetchAll();
    if (items.length === 0) throw new Error("The shop returned no products");
    const now = new Date();
    const rows = items.map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      tags: p.tags,
      productType: p.productType,
      body: p.body,
      image: p.image,
      priceMin: p.priceMin,
      priceMax: p.priceMax,
      compareAt: p.compareAt,
      inStock: p.inStock,
      options: p.options,
      variants: p.variants,
      url: p.url,
      syncedAt: now,
    }));
    await prisma.$transaction([
      prisma.product.deleteMany({}),
      ...chunk(rows, 300).map((part) => prisma.product.createMany({ data: part, skipDuplicates: true })),
    ]);
    await prisma.setting.upsert({
      where: { key: "catalog_synced_at" },
      update: { value: now.toISOString() },
      create: { key: "catalog_synced_at", value: now.toISOString() },
    });
    memory = { at: Date.now(), items };
    return items.length;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

function chunk<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function catalogStatus() {
  const [count, synced] = await Promise.all([
    prisma.product.count(),
    prisma.setting.findUnique({ where: { key: "catalog_synced_at" } }),
  ]);
  return { count, syncedAt: synced?.value ?? null };
}

/** Returns the catalog: memory → database → shop. A stale cache is refreshed in the background. */
export async function getCatalog(): Promise<CatalogProduct[]> {
  if (memory && Date.now() - memory.at < MEMORY_TTL_MS) return memory.items;
  const synced = await prisma.setting.findUnique({ where: { key: "catalog_synced_at" } });
  const age = synced ? Date.now() - Date.parse(synced.value) : Infinity;
  if (!synced) {
    await syncCatalog();
    return memory!.items;
  }
  const rows = await prisma.product.findMany();
  const items = rows.map((r) => ({
    ...r,
    options: r.options as CatalogProduct["options"],
    variants: r.variants as Variant[],
  })) as CatalogProduct[];
  memory = { at: Date.now(), items };
  if (age > MAX_AGE_MS) void syncCatalog().catch((e) => console.error("[catalog] background sync failed", e));
  return items;
}

const STOP = new Set(["the", "a", "an", "for", "with", "and", "or", "of", "in", "to", "size", "eu", "cm", "inch", "me", "i", "need", "want"]);

function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9а-яё]+/i)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Words clients use → words used in DEESSE product titles. */
const SYNONYMS: Record<string, string[]> = {
  shoes: ["shoe", "heels", "heel", "pleaser", "sandal", "boots"],
  heels: ["heel", "pleaser", "shoes", "sandal"],
  boots: ["boot", "boots", "bootie"],
  kneepads: ["knee", "pads", "kneepads"],
  knee: ["knee", "kneepads"],
  grip: ["grip", "kkeepgrip", "dry", "hands"],
  bodysuit: ["bodysuit", "body", "leotard"],
  catsuit: ["catsuit", "jumpsuit"],
  leggings: ["leggings", "pants", "tights"],
  protector: ["protector", "protectors", "cover", "covers"],
  bag: ["bag", "backpack"],
};

/** Ranks products by how well their title, tags and description match the query. */
export async function searchProducts(opts: {
  query: string;
  maxPrice?: number;
  minPrice?: number;
  size?: string;
  inStockOnly?: boolean;
  limit?: number;
}) {
  const [catalog, local] = await Promise.all([getCatalog(), getStock()]);
  const words = tokens(opts.query);
  const expanded = new Set<string>();
  for (const w of words) {
    expanded.add(w);
    for (const s of SYNONYMS[w] ?? []) expanded.add(s);
  }
  const sizeWanted = opts.size?.trim().toLowerCase();
  const scored = catalog
    .filter((p) => (opts.maxPrice ? p.priceMin <= opts.maxPrice : true))
    .filter((p) => (opts.minPrice ? p.priceMax >= opts.minPrice : true))
    .filter((p) => (opts.inStockOnly ? p.inStock : true))
    .map((p) => {
      const title = p.title.toLowerCase();
      const titleWords = new Set(tokens(p.title));
      const tagText = p.tags.join(" ").toLowerCase();
      const body = p.body.toLowerCase();
      let score = 0;
      for (const w of expanded) {
        const direct = words.includes(w) ? 1 : 0.5;
        if (titleWords.has(w)) score += 6 * direct;
        else if (title.includes(w)) score += 4 * direct;
        if (tagText.includes(w)) score += 2 * direct;
        if (body.includes(w)) score += 1 * direct;
      }
      if (words.length > 1 && title.includes(words.join(" "))) score += 5;
      let sizeOk = true;
      const hasSize = (x: Variant) => x.title.toLowerCase().split(/[\s/]+/).includes(sizeWanted!);
      // owner 05.11: sell first what is in our own stock (Showroom or Studio) in the client's size
      const here = (x: Variant) => (local[x.id]?.showroom ?? 0) + (local[x.id]?.studio ?? 0) > 0;
      if (sizeWanted) {
        const v = p.variants.find((x) => x.available && hasSize(x));
        sizeOk = Boolean(v);
        if (sizeOk) score += 3;
        if (p.variants.some((x) => hasSize(x) && here(x))) score += 12;
      } else if (p.variants.some(here)) score += 6;
      if (p.inStock) score += 1.5;
      if (/\bsky\b/i.test(p.title)) score -= 8; // owner 05.11: do not recommend SKY models
      if (/not recommended for walking or dancing/i.test(p.body)) score -= 8;
      return { p, score, sizeOk };
    })
    .filter((x) => (words.length ? x.score > 1.5 : true) && x.sizeOk)
    .sort((a, b) => b.score - a.score);
  return { total: scored.length, items: scored.slice(0, opts.limit ?? 8).map((x) => x.p), local };
}

export async function getProduct(handleOrUrl: string) {
  const handle = handleOrUrl.trim().replace(/^.*\/products\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  const catalog = await getCatalog();
  return catalog.find((p) => p.handle === handle) ?? catalog.find((p) => p.title.toLowerCase() === handleOrUrl.trim().toLowerCase()) ?? null;
}

export async function findVariant(variantId: string) {
  const catalog = await getCatalog();
  for (const p of catalog) {
    const v = p.variants.find((x) => x.id === String(variantId));
    if (v) return { product: p, variant: v };
  }
  return null;
}

/** Short view of a product for the model (keeps the token count low). */
export function brief(p: CatalogProduct, local: LocalStock = {}) {
  const price = p.priceMin === p.priceMax ? `${p.priceMin.toFixed(2)} EUR` : `${p.priceMin.toFixed(2)}–${p.priceMax.toFixed(2)} EUR`;
  const multi = p.variants.length > 1;
  const name = (v: Variant) => (multi ? v.title : "this item");
  const where = (v: Variant) => {
    const s = local[v.id];
    if (!s) return "";
    return [s.showroom ? "Showroom Tatari 64" : "", s.studio ? "Studio Ehitajate tee 114b" : ""].filter(Boolean).join(" + ");
  };
  const nowList = p.variants.filter((v) => where(v)).map((v) => `${name(v)} (${where(v)})`);
  const orderList = multi ? p.variants.filter((v) => v.available && !where(v)).map((v) => v.title) : [];
  const h = heights(p);
  return {
    handle: p.handle,
    title: p.title,
    price,
    ...(p.compareAt && p.compareAt > p.priceMin ? { was: `${p.compareAt.toFixed(2)} EUR` } : {}),
    ...(h.heel ? { heel_cm: h.heel } : {}),
    ...(h.platform ? { platform_cm: h.platform } : {}),
    in_our_stock_now: nowList.length ? nowList.slice(0, 20).join(", ") : "none (ships from the supplier, longer delivery)",
    ...(orderList.length ? { other_sizes_on_order: orderList.slice(0, 20).join(", ") } : {}),
    url: p.url,
  };
}
