import type { Metadata } from "next";
import Script from "next/script";
import { getCatalog, type CatalogProduct } from "@/lib/shop/catalog";

export const metadata: Metadata = { title: "DEESSE · Deisi site chat demo", robots: { index: false } };
export const dynamic = "force-dynamic";

const LANGS = ["et", "ru", "en"] as const;

/** A shop-like page with the real chat window, to try Deisi before she goes on deesse.ee. */
export default async function Demo({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang: q } = await searchParams;
  const lang = (LANGS as readonly string[]).includes(q ?? "") ? (q as string) : "et";
  let products: CatalogProduct[] = [];
  try {
    products = (await getCatalog()).filter((p) => p.inStock && p.image).slice(0, 8);
  } catch {
    products = [];
  }
  return (
    <div lang={lang} className="min-h-dvh bg-white text-[#080808]" style={{ fontFamily: "Montserrat, Helvetica, Arial, sans-serif" }}>
      <header className="flex items-center justify-between bg-[#080808] px-5 py-4 text-white">
        <span className="text-xl font-semibold tracking-[0.35em]">DEESSE</span>
        <nav className="flex gap-3 text-xs">
          {LANGS.map((l) => (
            <a key={l} href={`/demo?lang=${l}`} className={l === lang ? "text-[#dfbd70] underline" : "text-white/70 hover:text-white"}>
              {l.toUpperCase()}
            </a>
          ))}
        </nav>
      </header>
      <section className="bg-gradient-to-br from-[#f6e4dc] to-white px-5 py-12 text-center">
        <p className="text-xs tracking-[0.3em] text-[#989061] uppercase">Demo page · not the real shop</p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Pole &amp; exotic dancewear</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-[#6f6a60]">
          The chat window in the corner is the same one that goes on deesse.ee. Ask Deisi about shoes, sizes, delivery or returns.
        </p>
      </section>
      <main className="mx-auto grid max-w-5xl grid-cols-2 gap-4 px-4 py-8 sm:grid-cols-4">
        {products.map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${p.image}${p.image!.includes("?") ? "&" : "?"}width=400`} alt="" className="aspect-square w-full rounded-xl bg-[#f6e4dc] object-cover" loading="lazy" />
            <p className="mt-2 line-clamp-2 text-xs font-medium group-hover:underline">{p.title}</p>
            <p className="text-xs font-semibold text-[#989061]">{p.priceMin.toFixed(2)} €</p>
          </a>
        ))}
        {products.length === 0 && <p className="col-span-full text-center text-sm text-[#6f6a60]">The catalog is loading… open the chat to try Deisi.</p>}
      </main>
      <Script src="/deesy.js" strategy="afterInteractive" data-lang={lang} />
    </div>
  );
}
