import { prisma } from "@/lib/prisma";
import { SHOP_URL } from "./knowledge";

/** Products are re-read from deesse.ee/products.json when the cache is older than this. */
const MAX_AGE_MS = Number(process.env.CATALOG_MAX_AGE_HOURS || 6) * 3600_000;
const MEMORY_TTL_MS = 5 * 60_000;

export type Variant = { id: string; title: string; available: boolean; price: number; compareAt: number | null; sku?: string | null };
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
    const res = await fetch(`${SHOP_URL}/products.json?limit=250&page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": "DEESSE-assistant/1.0" },
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
  const catalog = await getCatalog();
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
      if (sizeWanted) {
        const v = p.variants.find((x) => x.available && x.title.toLowerCase().split(/[\s/]+/).includes(sizeWanted));
        sizeOk = Boolean(v);
        if (sizeOk) score += 3;
      }
      if (p.inStock) score += 1.5;
      return { p, score, sizeOk };
    })
    .filter((x) => (words.length ? x.score > 1.5 : true) && x.sizeOk)
    .sort((a, b) => b.score - a.score);
  return { total: scored.length, items: scored.slice(0, opts.limit ?? 8).map((x) => x.p) };
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
export function brief(p: CatalogProduct) {
  const price = p.priceMin === p.priceMax ? `${p.priceMin.toFixed(2)} EUR` : `${p.priceMin.toFixed(2)}–${p.priceMax.toFixed(2)} EUR`;
  const sizes = p.variants.length > 1 ? p.variants.filter((v) => v.available).map((v) => v.title) : [];
  return {
    handle: p.handle,
    title: p.title,
    price,
    ...(p.compareAt && p.compareAt > p.priceMin ? { was: `${p.compareAt.toFixed(2)} EUR` } : {}),
    stock: p.inStock ? "in Tallinn stock" : "on order from supplier (longer delivery)",
    ...(sizes.length ? { sizes: sizes.slice(0, 20).join(", ") } : {}),
    url: p.url,
  };
}
