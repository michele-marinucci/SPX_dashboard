import { NextResponse } from "next/server";
import { dbGetTwitterFeed } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: the DB-backed feed. Returns { enabled:false } when Supabase isn't
// configured or hasn't been populated yet, so the client keeps the feed it was
// server-rendered from data/tweets.json.
export async function GET() {
  try {
    const feed = await dbGetTwitterFeed();
    if (!feed) return NextResponse.json({ enabled: false });
    return NextResponse.json({ enabled: true, ...feed });
  } catch (e) {
    console.error("feed GET failed", e);
    return NextResponse.json({ enabled: false });
  }
}
