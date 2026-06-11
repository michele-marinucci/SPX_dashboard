// Server-only: imported solely by API route handlers; reads the service-role
// key from server env and is never bundled into client code.
import type {
  DailySummary,
  RecurringTopic,
  ThemeRef,
  Tweet,
  TwitterData,
} from "@/lib/tweets";

// Server-only Supabase access via PostgREST using the service-role key. The key
// never reaches the browser; all calls happen in API routes / server code.
// Tolerate the common paste mistakes: trailing slashes and a "/rest/v1" suffix
// (the URL should be the bare project origin; rest() appends the path itself).
const URL =
  (process.env.SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "") || undefined;
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

// ---- Twitter Monitor feed -------------------------------------------------- //
// Returns the DB-backed feed, or null if Supabase isn't configured/empty so
// callers can fall back to the committed data/tweets.json.
export async function dbGetTwitterFeed(): Promise<TwitterData | null> {
  if (!supabaseEnabled()) return null;
  const [tweetsRes, themesRes, dailyRes, recurRes] = await Promise.all([
    rest("tweets?select=*&order=posted_at.desc.nullslast&limit=500"),
    rest("themes?select=key,label"),
    rest("daily_summary?select=generated_at,summary&order=generated_at.desc&limit=1"),
    rest("recurring_themes?select=generated_at,data&order=generated_at.desc&limit=1"),
  ]);
  if (!tweetsRes.ok || !themesRes.ok) return null;

  const rows = (await tweetsRes.json()) as Record<string, unknown>[];
  if (!rows.length) return null; // not populated yet → use the JSON fallback

  const themes = (await themesRes.json()) as ThemeRef[];
  const dailyRows = dailyRes.ok
    ? ((await dailyRes.json()) as {
        generated_at: string;
        summary: DailySummary & {
          ticker_moves?: Record<string, number | null>;
          portfolio?: string[];
        };
      }[])
    : [];
  const recurRows = recurRes.ok
    ? ((await recurRes.json()) as { data: RecurringTopic[] }[])
    : [];

  const tweets = rows.map(
    (r): Tweet => ({
      id: r.id as string,
      url: (r.url as string) ?? "",
      handle: (r.handle as string) ?? "",
      author_name: (r.author_name as string) ?? "",
      posted_at: (r.posted_at as string) ?? "",
      text: (r.text as string) ?? "",
      summary: (r.summary as string) ?? "",
      sentiment: (r.sentiment as Tweet["sentiment"]) ?? "neutral",
      themes: (r.themes as string[]) ?? [],
      tickers: (r.tickers as string[]) ?? [],
      portfolio: (r.portfolio as string[]) ?? [],
      views: (r.views as number | null) ?? null,
      has_media: (r.has_media as boolean) ?? false,
      media_summary: (r.media_summary as string) ?? "",
      media_urls: (r.media_urls as string[]) ?? [],
      first_seen: (r.first_seen as string) ?? "",
      last_seen: (r.last_seen as string) ?? "",
      seen_count: (r.seen_count as number) ?? 1,
    }),
  );

  const latest = dailyRows[0];
  const { ticker_moves = {}, portfolio = [], ...daily } = latest?.summary ?? {
    date: null,
    headline: "",
    items: [],
  };

  return {
    generated_at: latest?.generated_at ?? null,
    themes,
    followed_handles: [],
    portfolio,
    daily_summary: daily as DailySummary,
    recurring: recurRows[0]?.data ?? [],
    ticker_moves,
    tweets,
  };
}
