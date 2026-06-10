import { NextRequest, NextResponse } from "next/server";
import {
  dbAddFollowed,
  dbGetFollowed,
  dbRemoveFollowed,
  dbSeedFollowed,
  supabaseEnabled,
} from "@/lib/supabase";
import { DEFAULT_FOLLOWED_HANDLES } from "@/lib/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: the followed handles from the DB. On first use (empty table) it seeds
// from the curated defaults. Returns { enabled:false } when Supabase isn't
// configured so the client falls back to its localStorage overlay.
export async function GET() {
  if (!supabaseEnabled()) return NextResponse.json({ enabled: false });
  try {
    let handles = await dbGetFollowed();
    if (handles.length === 0) {
      await dbSeedFollowed(DEFAULT_FOLLOWED_HANDLES);
      handles = await dbGetFollowed();
    }
    return NextResponse.json({ enabled: true, handles });
  } catch (e) {
    console.error("followed GET failed", e);
    return NextResponse.json({ enabled: false });
  }
}

// POST { action: "add" | "remove", handle: string }
export async function POST(req: NextRequest) {
  if (!supabaseEnabled()) return NextResponse.json({ enabled: false });
  try {
    const { action, handle } = await req.json();
    if (typeof handle !== "string" || !handle.trim()) {
      return NextResponse.json({ error: "handle required" }, { status: 400 });
    }
    if (action === "add") await dbAddFollowed(handle);
    else if (action === "remove") await dbRemoveFollowed(handle);
    else return NextResponse.json({ error: "bad action" }, { status: 400 });
    return NextResponse.json({ enabled: true, handles: await dbGetFollowed() });
  } catch (e) {
    console.error("followed POST failed", e);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
