/** @jsxRuntime automatic */
/* eslint-disable @next/next/no-img-element -- satori (next/og) draws plain <img> */
/** Renders a story frame of @deesse_style (owner 14.11) as a 1080x1920 JPEG - Instagram publishes JPEG only. See smm.ts. */
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { StoryData } from "./smm";


const W = 1080;
const H = 1920;
const C = { night: "#0d0b0a", wall: "#16120f", gold: "#c9a96e", gold2: "#e6cf98", ivory: "#f6efe4", muted: "#bfb2a0", rose: "#e7b9b3" };

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
      <div style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: 52, color: C.night, background: C.gold2, padding: "10px 28px", borderRadius: 999 }}>{eur(p.price)}</div>
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

async function frame(d: StoryData) {
  const bg = { display: "flex", width: W, height: H, background: `radial-gradient(circle at 50% 0%, #2a211a 0%, ${C.night} 60%)`, position: "relative" as const };
  if (d.layout === "product") {
    const p = d.products[0];
    const img = await photo(p?.image ?? null, 1200);
    return (
      <div style={{ ...bg, flexDirection: "column" }}>
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: W, height: 1340, background: "#ffffff" }}>
          {img ? <img src={img} width={W} height={1340} style={{ objectFit: "cover" }} alt="" /> : null}
        </div>
        <div style={{ display: "flex", position: "absolute", top: 940, left: 0, width: W, height: 420, background: `linear-gradient(180deg, rgba(13,11,10,0) 0%, ${C.night} 92%)` }} />
        <div style={{ display: "flex", position: "absolute", top: 60, left: 64, right: 64, padding: "18px 28px", background: "rgba(13,11,10,0.55)", borderRadius: 24 }}><Brand /></div>
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
        {d.body ? <div style={{ display: "flex", fontFamily: SANS, fontSize: 42, lineHeight: 1.45, color: C.ivory }}>{d.body}</div> : null}
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

export async function renderStory(d: StoryData): Promise<Buffer> {
  const png = await new ImageResponse(await frame(d), { width: W, height: H, fonts: await loadFonts() }).arrayBuffer();
  return sharp(Buffer.from(png)).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
}
