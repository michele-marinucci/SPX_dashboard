// Server-only: imported solely by the Diligence API route. Reads the
// service-role key from server env and is never bundled into client code.
// Mirrors lib/supabase.ts; kept separate so the two features never share a file.
import { DiligenceLink, normTicker } from "@/lib/diligence";

const URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "") || undefined;
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || undefined;

export function diligenceEnabled(): boolean {
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

// Connection diagnostics for /api/diligence?debug=1 — reports whether the env
// vars are present, which Supabase role the key carries, and the HTTP status of
// a one-row probe read. Never echoes the key itself; the route sits behind the
// password gate like every other page.
export async function diligenceDebug(): Promise<Record<string, string>> {
  let urlInfo = "NOT SET";
  let restBase = "—";
  if (URL) {
    try {
      const u = new globalThis.URL(URL);
      urlInfo =
        u.pathname && u.pathname !== "/"
          ? `set but has an EXTRA PATH "${u.pathname}" — should be just https://<ref>.supabase.co`
          : `set OK (host: ${u.host})`;
    } catch {
      urlInfo = "set but MALFORMED (not a valid URL)";
    }
    restBase = `${URL}/rest/v1/diligence_links?...`;
  }

  // Classify the key by prefix WITHOUT revealing the secret, so we can tell a
  // legacy service_role JWT from the new-style keys or a wrong value pasted in.
  let keyInfo = "NOT SET";
  if (KEY) {
    if (KEY.startsWith("eyJ")) {
      try {
        const payload = JSON.parse(Buffer.from(KEY.split(".")[1], "base64").toString("utf8"));
        keyInfo = `legacy JWT (role: ${payload.role ?? "unknown"})${
          payload.role === "service_role" ? " ✓" : " ✗ wrong role — need service_role"
        }`;
      } catch {
        keyInfo = "starts like a JWT but is corrupt/truncated";
      }
    } else if (KEY.startsWith("sb_secret_")) {
      keyInfo = "new-format secret key (sb_secret_…) ✓";
    } else if (KEY.startsWith("sb_publishable_")) {
      keyInfo = "PUBLISHABLE key (sb_publishable_…) ✗ — need the SECRET key";
    } else {
      keyInfo = `unrecognized value (starts "${KEY.slice(0, 4)}…") ✗ — not a Supabase API key`;
    }
  }

  let probe = "skipped (env incomplete)";
  if (URL && KEY) {
    try {
      const res = await rest("diligence_links?select=ticker&limit=1");
      probe = res.ok
        ? `HTTP ${res.status} OK — connection works`
        : `HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`;
    } catch (e) {
      probe = `fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return { supabase_url: urlInfo, rest_base: restBase, service_role_key: keyInfo, probe };
}

export async function dbGetDiligence(): Promise<DiligenceLink[]> {
  const res = await rest("diligence_links?select=ticker,name,url&order=ticker.asc");
  if (!res.ok) throw new Error(`diligence read ${res.status}`);
  return (await res.json()) as DiligenceLink[];
}

// Seed the table from the committed JSON on first use (empty table).
export async function dbSeedDiligence(links: DiligenceLink[]): Promise<void> {
  const rows = links
    .map((l) => ({ ticker: normTicker(l.ticker), name: l.name ?? "", url: l.url }))
    .filter((r) => r.ticker && r.url);
  if (!rows.length) return;
  const res = await rest("diligence_links", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`diligence seed ${res.status}`);
}

// Upsert: adding an existing ticker updates its name/url (edit-in-place).
export async function dbUpsertDiligence(link: DiligenceLink): Promise<void> {
  const ticker = normTicker(link.ticker);
  if (!ticker || !link.url) return;
  const res = await rest("diligence_links", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      ticker,
      name: link.name ?? "",
      url: link.url,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`diligence upsert ${res.status}`);
}

export async function dbRemoveDiligence(ticker: string): Promise<void> {
  const t = normTicker(ticker);
  if (!t) return;
  const res = await rest(`diligence_links?ticker=eq.${encodeURIComponent(t)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`diligence remove ${res.status}`);
}
