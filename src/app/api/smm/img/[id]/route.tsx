/**
 * A story frame of @deesse_style as a 1080x1920 JPEG (owner 14.11), see src/lib/shop/smm.ts.
 * Public (Instagram and Telegram fetch it); the id is a random cuid.
 */
import { prisma } from "@/lib/prisma";
import type { StoryData } from "@/lib/shop/smm";
import { renderStory } from "@/lib/shop/smm-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.storyPost.findUnique({ where: { id: id.replace(/\.jpe?g$/i, "") } }).catch(() => null);
  if (!row) return new Response("not found", { status: 404 });
  const jpg = await renderStory(row.data as unknown as StoryData);
  return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" } });
}
