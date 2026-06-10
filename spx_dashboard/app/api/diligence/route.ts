import { NextRequest, NextResponse } from "next/server";
import {
  dbGetDiligence,
  dbRemoveDiligence,
  dbSeedDiligence,
  dbUpsertDiligence,
  diligenceEnabled,
} from "@/lib/diligenceDb";
import { getDiligenceLinks, normTicker } from "@/lib/diligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: the diligence links from the DB. On first use (empty table) it seeds from
// the committed data/diligence.json. Returns { enabled:false } when Supabase
// isn't configured so the client falls back to its localStorage overlay.
export async function GET() {
  if (!diligenceEnabled()) return NextResponse.json({ enabled: false });
  try {
    let links = await dbGetDiligence();
    if (links.length === 0) {
      await dbSeedDiligence(getDiligenceLinks());
      links = await dbGetDiligence();
    }
    return NextResponse.json({ enabled: true, links });
  } catch (e) {
    console.error("diligence GET failed", e);
    return NextResponse.json({ enabled: false });
  }
}

// POST { action: "add", ticker, url, name? } | { action: "remove", ticker }
// "add" upserts, so it doubles as edit-in-place for an existing ticker.
export async function POST(req: NextRequest) {
  if (!diligenceEnabled()) return NextResponse.json({ enabled: false });
  try {
    const { action, ticker, url, name } = await req.json();
    const t = normTicker(typeof ticker === "string" ? ticker : "");
    if (!t) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    if (action === "add") {
      if (typeof url !== "string" || !url.trim()) {
        return NextResponse.json({ error: "url required" }, { status: 400 });
      }
      await dbUpsertDiligence({ ticker: t, name: typeof name === "string" ? name : "", url: url.trim() });
    } else if (action === "remove") {
      await dbRemoveDiligence(t);
    } else {
      return NextResponse.json({ error: "bad action" }, { status: 400 });
    }
    return NextResponse.json({ enabled: true, links: await dbGetDiligence() });
  } catch (e) {
    console.error("diligence POST failed", e);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
