// Server-only: imported solely by API route handlers; reads the service-role
// key from server env and is never bundled into client code.
import type { ThemeIdea, ThemeRef, ThemesData } from "@/lib/themes";

// Server-only Supabase access via PostgREST using the service-role key. The key
// never reaches the browser; all calls happen in API routes / server code.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function supabaseEnabled(): boolean {
  return !!(URL && KEY);
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY as string,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    // Always hit the source of truth; never cache DB reads.
    cache: "no-store",
  });
}

// ---- Followed handles ----------------------------------------------------- //
export async function dbGetFollowed(): Promise<string[]> {
  const res = await rest("followed_handles?select=handle&order=handle.asc");
  if (!res.ok) throw new Error(`followed read ${res.status}`);
  const rows = (await res.json()) as { handle: string }[];
  return rows.map((r) => r.handle);
}

const normHandle = (h: string) => h.trim().toLowerCase().replace(/^@/, "");

export async function dbSeedFollowed(handles: string[]): Promise<void> {
  const rows = handles
    .map((h) => ({ handle: normHandle(h) }))
    .filter((r) => r.handle);
  if (!rows.length) return;
  const res = await rest("followed_handles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`followed seed ${res.status}`);
}

export async function dbAddFollowed(handle: string): Promise<void> {
  const h = normHandle(handle);
  if (!h) return;
  const res = await rest("followed_handles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ handle: h }),
  });
  if (!res.ok) throw new Error(`followed add ${res.status}`);
}

export async function dbRemoveFollowed(handle: string): Promise<void> {
  const h = normHandle(handle);
  if (!h) return;
  const res = await rest(`followed_handles?handle=eq.${encodeURIComponent(h)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`followed remove ${res.status}`);
}

// ---- Feed ----------------------------------------------------------------- //
// Returns the DB-backed feed, or null if Supabase isn't configured/empty so
// callers can fall back to the committed themes.json.
export async function dbGetFeed(): Promise<ThemesData | null> {
  if (!supabaseEnabled()) return null;
  const [ideasRes, themesRes, runsRes] = await Promise.all([
    rest("ideas?active=eq.true&select=*"),
    rest("themes?select=key,label"),
    rest("runs?select=generated_at&order=generated_at.desc&limit=1"),
  ]);
  if (!ideasRes.ok || !themesRes.ok) return null;

  const rows = (await ideasRes.json()) as Record<string, unknown>[];
  if (!rows.length) return null; // not populated yet → use the JSON fallback

  const themes = (await themesRes.json()) as ThemeRef[];
  const runs = runsRes.ok ? ((await runsRes.json()) as { generated_at: string }[]) : [];

  const ideas = rows.map(
    (r): ThemeIdea => ({
      ticker: r.ticker as string,
      direction: r.direction as ThemeIdea["direction"],
      thesis: (r.thesis as string) ?? "",
      catalyst: (r.catalyst as string) ?? "",
      sources: (r.sources as ThemeIdea["sources"]) ?? [],
      theme_keys: (r.theme_keys as string[]) ?? [],
      prices: (r.prices as ThemeIdea["prices"]) ?? null,
      citations: (r.citations as string[]) ?? [],
      first_seen: r.first_seen as string,
      last_seen: r.last_seen as string,
      seen_count: (r.seen_count as number) ?? 1,
      tier: (r.tier as ThemeIdea["tier"]) ?? "discovery",
      score: (r.score as number) ?? 0,
      conviction: (r.conviction as ThemeIdea["conviction"]) ?? "low",
      active: (r.active as boolean) ?? true,
      on_watchlist: (r.on_watchlist as boolean) ?? false,
    }),
  );

  return {
    generated_at: runs[0]?.generated_at ?? null,
    themes,
    ideas,
  };
}
