"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { DiligenceLink, logoUrl, normTicker } from "@/lib/diligence";

// The Microsoft Lists app glyph: a teal rounded tile with list rows and a
// check. Inlined so the "open" affordance reads clearly instead of a faint ↗.
function MsListsIcon() {
  return (
    <svg
      className="dil-ms"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#03787C" />
      <rect x="6.5" y="7" width="11" height="1.8" rx="0.9" fill="#fff" />
      <rect x="6.5" y="11.1" width="11" height="1.8" rx="0.9" fill="#fff" />
      <rect x="6.5" y="15.2" width="7" height="1.8" rx="0.9" fill="#fff" />
      <path
        d="M15.4 15.6l1.4 1.4 2.7-2.8"
        fill="none"
        stroke="#7FE5B6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const STORE_KEY = "diligence:links";

function sortLinks(list: DiligenceLink[]): DiligenceLink[] {
  return [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function loadLocal(): DiligenceLink[] | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DiligenceLink[]) : null;
  } catch {
    return null;
  }
}

// A square stock logo with a graceful monogram fallback: if the CDN can't
// resolve the ticker (or is blocked), we show the symbol's initials instead, so
// a missing image never leaves a broken-image icon in the table.
function LogoMark({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false);
  const mono = ticker.slice(0, 2);
  if (failed) {
    return (
      <span className="dil-logo dil-logo-mono" aria-hidden="true">
        {mono}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="dil-logo"
      src={logoUrl(ticker)}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function DiligenceApp({
  initialLinks,
  names,
}: {
  initialLinks: DiligenceLink[];
  // Ticker → company name, for auto-filling the name when a known symbol is added.
  names: Record<string, string>;
}) {
  const [links, setLinks] = useState<DiligenceLink[]>(initialLinks);
  // null until we know whether Supabase is configured. When false, edits persist
  // to localStorage; when true, the DB is authoritative and shared across users.
  const [dbEnabled, setDbEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticker, setTicker] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/diligence")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d?.enabled && Array.isArray(d.links)) {
          setDbEnabled(true);
          setLinks(sortLinks(d.links));
        } else {
          setDbEnabled(false);
          const local = loadLocal();
          if (local) setLinks(sortLinks(local));
        }
      })
      .catch(() => {
        if (!active) return;
        setDbEnabled(false);
        const local = loadLocal();
        if (local) setLinks(sortLinks(local));
      });
    return () => {
      active = false;
    };
  }, []);

  const persistLocal = (list: DiligenceLink[]) => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };

  // Suggest the company name as soon as a known ticker is typed (unless the
  // user has already typed a name themselves).
  const onTickerChange = (raw: string) => {
    setTicker(raw);
    const known = names[normTicker(raw)];
    if (known && !name.trim()) setName(known);
  };

  const add = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const t = normTicker(ticker);
      const u = url.trim();
      if (!t) return setError("Enter a ticker.");
      if (!u) return setError("Paste the Microsoft List link.");
      if (!/^https?:\/\//i.test(u)) return setError("Link must start with http(s)://");
      const entry: DiligenceLink = { ticker: t, name: name.trim() || names[t] || "", url: u };

      if (dbEnabled) {
        setBusy(true);
        try {
          const res = await fetch("/api/diligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add", ...entry }),
          });
          const d = await res.json();
          if (d?.links) setLinks(sortLinks(d.links));
          else setError(d?.error || "Could not save.");
        } catch {
          setError("Network error.");
        } finally {
          setBusy(false);
        }
      } else {
        const next = sortLinks([...links.filter((l) => l.ticker !== t), entry]);
        setLinks(next);
        persistLocal(next);
      }
      setTicker("");
      setUrl("");
      setName("");
    },
    [ticker, url, name, dbEnabled, links, names],
  );

  const remove = useCallback(
    async (t: string) => {
      if (dbEnabled) {
        setBusy(true);
        try {
          const res = await fetch("/api/diligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove", ticker: t }),
          });
          const d = await res.json();
          if (d?.links) setLinks(sortLinks(d.links));
        } finally {
          setBusy(false);
        }
      } else {
        const next = links.filter((l) => l.ticker !== t);
        setLinks(next);
        persistLocal(next);
      }
    },
    [dbEnabled, links],
  );

  const note = useMemo(() => {
    if (dbEnabled === null) return "";
    return dbEnabled
      ? "Synced to your team — everyone sees the same list."
      : "Saved in this browser only (no shared database configured).";
  }, [dbEnabled]);

  const subtitle = (
    <>
      Every position&apos;s Microsoft List ·{" "}
      <span className="mono">
        {links.length} {links.length === 1 ? "name" : "names"}
      </span>{" "}
      · <span className="mono">shared with the team</span>
    </>
  );

  const actions = (
    <HowItWorks title="How the Diligence Tracker works">
      <p className="hiw-lead">
        Every position&apos;s Microsoft List, gathered in one place.
      </p>
      <ul className="hiw-list">
        <li>
          <b>Open a tracker</b> — click any row to jump straight to that
          name&apos;s Microsoft List.
        </li>
        <li>
          <b>Add a link</b> — enter a ticker and paste its Microsoft List URL.
          The company name auto-fills for tracked S&amp;P names.
        </li>
        <li>
          <b>Shared</b> — adds and removes are saved to the team database, so
          everyone sees the same list (not just your browser).
        </li>
      </ul>
    </HowItWorks>
  );

  return (
    <AppShell
      tool="Diligence Tracker"
      title="Diligence Tracker"
      subtitle={subtitle}
      actions={actions}
      footerLeft={`Diligence Tracker · ${links.length} ${links.length === 1 ? "position" : "positions"}`}
    >
      <form className="dil-add" onSubmit={add}>
        <input
          className="dil-in dil-in-ticker"
          value={ticker}
          onChange={(e) => onTickerChange(e.target.value)}
          placeholder="Ticker"
          aria-label="Ticker"
          autoCapitalize="characters"
        />
        <input
          className="dil-in dil-in-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company name (optional)"
          aria-label="Company name"
        />
        <input
          className="dil-in dil-in-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Microsoft List link (https://…)"
          aria-label="Microsoft List link"
          inputMode="url"
        />
        <button type="submit" className="dil-add-btn" disabled={busy || !ticker.trim() || !url.trim()}>
          Add
        </button>
      </form>
      {error && <p className="dil-error">{error}</p>}

      <div className="dil-wrap">
        {links.length === 0 ? (
          <div className="dil-empty">
            No diligence lists yet — add the first one above.
          </div>
        ) : (
          <ul className="dil-list">
            {links.map((l) => (
              <li key={l.ticker} className="dil-row">
                <a
                  className="dil-link"
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${l.ticker} diligence list`}
                >
                  <LogoMark ticker={l.ticker} />
                  <span className="dil-ticker">{l.ticker}</span>
                  <span className="dil-name">{l.name || names[l.ticker] || ""}</span>
                  <span className="dil-open">
                    <MsListsIcon />
                    Open list
                  </span>
                </a>
                <button
                  type="button"
                  className="dil-remove"
                  onClick={() => remove(l.ticker)}
                  disabled={busy}
                  aria-label={`Remove ${l.ticker}`}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note && <p className="dil-note">{note}</p>}
    </AppShell>
  );
}
