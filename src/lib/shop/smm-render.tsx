/** @jsxRuntime automatic */
/* eslint-disable @next/next/no-img-element -- satori (next/og) draws plain <img> */
/** Renders a story frame of @deesse_style (owner 14.11) as a 1080x1920 JPEG - Instagram publishes JPEG only. See smm.ts. */
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { StoryData } from "./smm";
import { prisma } from "@/lib/prisma";


const W = 1080;
const H = 1920;
type Pal = { night: string; ivory: string; gold: string; gold2: string; muted: string; rose: string; text: string; bg: string; pill: string; pillText: string; veil: string };
// owner 14.11 («чёрный фон верный выбор?»): dark for heels / night / offers, warm light for clothing, packaging, tips - the planner mixes both
const DARK: Pal = { night: "#0d0b0a", ivory: "#f6efe4", gold: "#c9a96e", gold2: "#e6cf98", muted: "#bfb2a0", rose: "#e7b9b3", text: "#f6efe4", bg: "radial-gradient(circle at 50% 0%, #2a211a 0%, #0d0b0a 60%)", pill: "#e6cf98", pillText: "#0d0b0a", veil: "rgba(13,11,10,0.55)" };
const LIGHT: Pal = { night: "#f4ece1", ivory: "#1c1613", gold: "#9c7a3f", gold2: "#1c1613", muted: "#8f7f70", rose: "#7d5b52", text: "#1c1613", bg: "radial-gradient(circle at 50% 0%, #fbf7f1 0%, #efe3d3 70%)", pill: "#1c1613", pillText: "#f6efe4", veil: "rgba(250,245,238,0.75)" };
let C: Pal = DARK;

let fonts: { name: string; data: Buffer; weight: 400 | 600; style: "normal" }[] | null = null;
async function loadFonts() {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const f = async (file: string, name: string, weight: 400 | 600) => ({ name, data: await readFile(path.join(dir, file)), weight, style: "normal" as const });
  fonts = await Promise.all([
    f("playfair-display-latin-600-normal.woff", "Playfair", 600), f("playfair-display-latin-ext-600-normal.woff", "PlayfairExt", 600), f("playfair-display-cyrillic-600-normal.woff", "PlayfairCyr", 600),
    f("montserrat-latin-400-normal.woff", "Montserrat", 400), f("montserrat-latin-ext-400-normal.woff", "MontserratExt", 400), f("montserrat-cyrillic-400-normal.woff", "MontserratCyr", 400),
    f("montserrat-latin-600-normal.woff", "Montserrat", 600), f("montserrat-latin-ext-600-normal.woff", "MontserratExt", 600), f("montserrat-cyrillic-600-normal.woff", "MontserratCyr", 600),
  ]);
  return fonts;
}

/** A product photo as a JPEG data URL (Shopify may serve WebP; satori needs PNG / JPEG). */
async function photo(url: string | null, width = 1080) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("width", String(width));
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return null;
  }
}

const SANS = "Montserrat, MontserratExt, MontserratCyr";
const SERIF = "Playfair, PlayfairExt, PlayfairCyr";
const eur = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")} €`;

function Price({ p }: { p: StoryData["products"][number] }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
      <div style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: 52, color: C.pillText, background: C.pill, padding: "10px 28px", borderRadius: 999 }}>{eur(p.price)}</div>
      {p.compareAt ? <div style={{ display: "flex", fontFamily: SANS, fontSize: 38, color: C.muted, textDecoration: "line-through" }}>{eur(p.compareAt)}</div> : null}
    </div>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
      <div style={{ display: "flex", fontFamily: SERIF, fontSize: 44, letterSpacing: 10, color: C.ivory }}>DEESSE</div>
      <div style={{ display: "flex", fontFamily: SANS, fontSize: 26, letterSpacing: 6, color: C.gold }}>@DEESSE_STYLE</div>
    </div>
  );
}

function Texts({ d, big = 96 }: { d: StoryData; big?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {d.kicker ? <div style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: 30, letterSpacing: 8, color: C.gold, textTransform: "uppercase" }}>{d.kicker}</div> : null}
      <div style={{ display: "flex", fontFamily: SERIF, fontSize: big, lineHeight: 1.05, color: C.ivory }}>{d.headline}</div>
      {d.sub ? <div style={{ display: "flex", fontFamily: SANS, fontSize: 40, lineHeight: 1.3, color: C.rose }}>{d.sub}</div> : null}
    </div>
  );
}

function Cta({ d }: { d: StoryData }) {
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", fontFamily: SANS, fontWeight: 600, fontSize: 36, letterSpacing: 2, color: C.ivory, border: `3px solid ${C.gold}`, padding: "18px 36px", borderRadius: 999 }}>
      {d.cta || "deesse.ee"}
    </div>
  );
}

/** A photo the owner sent to the bot (StoryAsset), as a JPEG data URL. */
async function assetPhoto(id?: string) {
  if (!id) return null;
  const a = await prisma.storyAsset.findUnique({ where: { id } }).catch(() => null);
  if (!a) return null;
  const jpg = await sharp(Buffer.from(a.data)).rotate().resize(1080, 1920, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

async function frame(d: StoryData) {
  C = d.theme === "light" && d.layout !== "photo" ? LIGHT : DARK;
  const bg = { display: "flex", width: W, height: H, background: C.bg, position: "relative" as const };
  if (d.layout === "photo") {   // owner 14.11: her own photos (packaging, jumpsuits on a model) full screen
    const img = await assetPhoto(d.assetId);
    return (
      <div style={{ ...bg, flexDirection: "column" }}>
        {img ? <img src={img} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" /> : null}
        <div style={{ display: "flex", position: "absolute", top: 1000, left: 0, width: W, height: 920, background: "linear-gradient(180deg, rgba(13,11,10,0) 0%, rgba(13,11,10,0.88) 70%)" }} />
        <div style={{ display: "flex", position: "absolute", top: 60, left: 64, right: 64, padding: "18px 28px", background: C.veil, borderRadius: 24 }}><Brand /></div>
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 72, right: 72, bottom: 120, gap: 34 }}>
          <Texts d={d} big={92} />
          {d.showPrice && d.products[0] ? <Price p={d.products[0]} /> : null}
          <Cta d={d} />
        </div>
      </div>
    );
  }
  if (d.layout === "product") {
    const p = d.products[0];
    const img = await photo(p?.image ?? null, 1200);
    return (
      <div style={{ ...bg, flexDirection: "column" }}>
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: W, height: 1340, background: "#ffffff" }}>
          {img ? <img src={img} width={W} height={1340} style={{ objectFit: "cover" }} alt="" /> : null}
        </div>
        <div style={{ display: "flex", position: "absolute", top: 940, left: 0, width: W, height: 420, background: d.theme === "light" ? "linear-gradient(180deg, rgba(244,236,225,0) 0%, #f4ece1 92%)" : "linear-gradient(180deg, rgba(13,11,10,0) 0%, #0d0b0a 92%)" }} />
        <div style={{ display: "flex", position: "absolute", top: 60, left: 64, right: 64, padding: "18px 28px", background: C.veil, borderRadius: 24 }}><Brand /></div>
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 72, right: 72, bottom: 120, gap: 34 }}>
          <Texts d={d} big={92} />
          {d.showPrice && p ? <Price p={p} /> : null}
          <Cta d={d} />
        </div>
      </div>
    );
  }
  if (d.layout === "collage") {
    const imgs = await Promise.all(d.products.slice(0, 3).map((p) => photo(p.image, 700)));
    const n = imgs.length;
    const w = n === 2 ? 452 : 296;
    return (
      <div style={{ ...bg, flexDirection: "column", padding: "80px 72px 110px", justifyContent: "space-between" }}>
        <Brand />
        <Texts d={d} big={96} />
        <div style={{ display: "flex", gap: 32, justifyContent: "center" }}>
          {d.products.slice(0, 3).map((p, i) => (
            <div key={p.handle} style={{ display: "flex", flexDirection: "column", gap: 18, width: w }}>
              <div style={{ display: "flex", padding: 10, background: `linear-gradient(135deg, #7a5c2e, ${C.gold2} 30%, #9a7638 60%, #f0dca8)` }}>
                <div style={{ display: "flex", width: w - 20, height: Math.round((w - 20) * 1.33), background: "#ffffff" }}>
                  {imgs[i] ? <img src={imgs[i]!} width={w - 20} height={Math.round((w - 20) * 1.33)} style={{ objectFit: "cover" }} alt="" /> : null}
                </div>
              </div>
              {d.showPrice ? <div style={{ display: "flex", justifyContent: "center", fontFamily: SANS, fontWeight: 600, fontSize: 38, color: C.gold2 }}>{eur(p.price)}{p.compareAt ? <span style={{ marginLeft: 12, fontSize: 28, color: C.muted, textDecoration: "line-through" }}>{eur(p.compareAt)}</span> : null}</div> : null}
            </div>
          ))}
        </div>
        <Cta d={d} />
      </div>
    );
  }
  // text: a tip / message in a gold frame, an optional small product picture
  const img = d.products[0] ? await photo(d.products[0].image, 600) : null;
  return (
    <div style={{ ...bg, flexDirection: "column", padding: "80px 72px 110px", justifyContent: "space-between" }}>
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", gap: 40, padding: "70px 56px", border: `3px solid ${C.gold}` }}>
        <Texts d={d} big={100} />
        {d.body ? <div style={{ display: "flex", fontFamily: SANS, fontSize: 42, lineHeight: 1.45, color: C.text }}>{d.body}</div> : null}
      </div>
      {img ? (
        <div style={{ display: "flex", alignSelf: "center", padding: 10, background: `linear-gradient(135deg, #7a5c2e, ${C.gold2} 30%, #9a7638 60%, #f0dca8)` }}>
          <img src={img} width={420} height={420} style={{ objectFit: "cover", background: "#fff" }} alt="" />
        </div>
      ) : <div style={{ display: "flex" }} />}
      <Cta d={d} />
    </div>
  );
}

// one render at a time: the palette C is module state read while satori draws the components
let queue: Promise<unknown> = Promise.resolve();
export function renderStory(d: StoryData): Promise<Buffer> {
  const run = async () => {
    const png = await new ImageResponse(await frame(d), { width: W, height: H, fonts: await loadFonts() }).arrayBuffer();
    return sharp(Buffer.from(png)).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  };
  const next = queue.then(run, run);
  queue = next.catch(() => null);
  return next;
}
