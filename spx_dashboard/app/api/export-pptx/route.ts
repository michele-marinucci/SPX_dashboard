import { buildHubDeck } from "@/lib/pptx/buildDeck";

// Node runtime: pptxgenjs (via jszip) needs Node APIs, not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const buf = await buildHubDeck();
  const today = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="Mendo-Hub-${today}.pptx"`,
      "Cache-Control": "no-store",
    },
  });
}
