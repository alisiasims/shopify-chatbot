import { prisma } from "@/lib/prisma";
import { notFound, withDb } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** owner 20.11: a file a client sent in the site chat (inbox only - protected by the inbox login in middleware). */
export const GET = withDb(async (_r: Request, { params }: Ctx) => {
  const { id } = await params;
  const f = await prisma.messageFile.findUnique({ where: { id } });
  if (!f) return notFound("File not found");
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
