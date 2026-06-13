// Server-only: imported solely by the /api/login route. Reads the service-role
// key from server env and is never bundled into client code.
//
// Per-IP brute-force throttle for the shared site password. Failed attempts are
// persisted in Supabase (table: login_attempts) so the limit holds across every
// serverless instance and restart — an in-memory counter resets far too often
// on Vercel-style hosting, handing an attacker many more guesses than intended.
//
// Supabase is best-effort: when it isn't configured, or a call fails, we fall
// back to a per-instance in-memory window so login never breaks. The fallback
// is weaker (per-instance) but strictly better than no limit.
const URL =
  (process.env.SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "") || undefined;
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || undefined;

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

function enabled(): boolean {
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
    cache: "no-store",
  });
}

// ---- in-memory fallback (per-instance) ------------------------------------ //
const mem = new Map<string, number[]>();

function memRecent(ip: string): number[] {
  const now = Date.now();
  const recent = (mem.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  mem.set(ip, recent);
  return recent;
}

// ---- public API ----------------------------------------------------------- //

/** True when this IP has hit the failed-attempt limit inside the window. */
export async function tooManyFailures(ip: string): Promise<boolean> {
  if (enabled()) {
    try {
      const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
      const res = await rest(
        `login_attempts?ip=eq.${encodeURIComponent(ip)}` +
          `&attempted_at=gt.${encodeURIComponent(cutoff)}&select=id&limit=${MAX_FAILURES}`,
      );
      if (res.ok) {
        const rows = (await res.json()) as unknown[];
        return rows.length >= MAX_FAILURES;
      }
    } catch {
      // fall through to the in-memory window
    }
  }
  return memRecent(ip).length >= MAX_FAILURES;
}

/** Record one failed attempt for this IP. */
export async function recordFailure(ip: string): Promise<void> {
  if (enabled()) {
    try {
      await rest("login_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ip }),
      });
      // Opportunistically prune expired rows so the table stays small.
      const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
      await rest(`login_attempts?attempted_at=lt.${encodeURIComponent(cutoff)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      return;
    } catch {
      // fall through to the in-memory window
    }
  }
  const list = mem.get(ip) ?? [];
  list.push(Date.now());
  mem.set(ip, list);
}

/** Clear an IP's failures after a successful login. Best-effort. */
export async function clearFailures(ip: string): Promise<void> {
  mem.delete(ip);
  if (enabled()) {
    try {
      await rest(`login_attempts?ip=eq.${encodeURIComponent(ip)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    } catch {
      // best-effort; the window expires on its own anyway
    }
  }
}
