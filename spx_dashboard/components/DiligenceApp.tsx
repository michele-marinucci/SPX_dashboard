"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { DiligenceLink, logoCandidates, normTicker } from "@/lib/diligence";

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
// The team's content (which lists exist) is shared via the DB, but each user's
// preferred ordering is kept locally — there's no order column on the shared
// table — as an array of tickers in display order.
const ORDER_KEY = "diligence:order";

// Arrange links by the saved manual order: tickers present in `order` come
// first in that order; anything new (added since the order was saved) falls to
// the end, alphabetically. With no saved order we sort alphabetically by ticker.
function arrangeLinks(list: DiligenceLink[], order: string[] | null): DiligenceLink[] {
  if (!order || order.length === 0) {
    return [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  const rank = new Map(order.map((t, i) => [t, i] as const));
  return [...list].sort((a, b) => {
    const ra = rank.has(a.ticker) ? rank.get(a.ticker)! : Infinity;
    const rb = rank.has(b.ticker) ? rank.get(b.ticker)! : Infinity;
    if (ra !== rb) return ra - rb;
    return a.ticker.localeCompare(b.ticker);
  });
}

function loadOrder(): string[] | null {
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : null;
  } catch {
    return null;
  }
}

function saveOrder(tickers: string[]) {
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(tickers));
  } catch {
    /* ignore */
  }
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

// A burger handle (three horizontal lines) shown at the left of each row. It's
// the drag affordance: users grab it to reorder positions above/below others.
function DragHandle() {
  return (
    <svg
      className="dil-grip-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="3.5" width="12" height="1.6" rx="0.8" />
      <rect x="2" y="7.2" width="12" height="1.6" rx="0.8" />
      <rect x="2" y="10.9" width="12" height="1.6" rx="0.8" />
    </svg>
  );
}

// A square stock logo with a graceful monogram fallback. We walk a list of
// logo sources (domain-keyed first for symbols a CDN gets wrong, then the
// symbol CDN); only after every source errors do we show the symbol's
// initials, so a missing logo never leaves a broken-image icon in the table.
function LogoMark({ ticker }: { ticker: string }) {
  const candidates = useMemo(() => logoCandidates(ticker), [ticker]);
  const [idx, setIdx] = useState(0);
  const mono = ticker.slice(0, 2);
  // Reset to the first source if the ticker changes (row reused across renders).
  useEffect(() => setIdx(0), [ticker]);
  if (idx >= candidates.length) {
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
      src={candidates[idx]}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
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
  // The user's saved manual ordering (tickers in display order), or null for the
  // default alphabetical sort. Held in a ref so the async add/remove callbacks
  // always arrange against the latest order without re-binding.
  const orderRef = useRef<string[] | null>(null);
  // Index of the row currently being dragged, for the drop-target styling.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const arrange = useCallback(
    (list: DiligenceLink[]) => arrangeLinks(list, orderRef.current),
    [],
  );

  useEffect(() => {
    let active = true;
    orderRef.current = loadOrder();
    fetch("/api/diligence")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d?.enabled && Array.isArray(d.links)) {
          setDbEnabled(true);
          setLinks(arrange(d.links));
        } else {
          setDbEnabled(false);
          const local = loadLocal();
          if (local) setLinks(arrange(local));
        }
      })
      .catch(() => {
        if (!active) return;
        setDbEnabled(false);
        const local = loadLocal();
        if (local) setLinks(arrange(local));
      });
    return () => {
      active = false;
    };
  }, [arrange]);

  // Persist the current sequence as the manual order, and remember it so future
  // arranges (after add/remove or a reload) keep what the user dragged into place.
  const commitOrder = useCallback((list: DiligenceLink[]) => {
    const tickers = list.map((l) => l.ticker);
    orderRef.current = tickers;
    saveOrder(tickers);
  }, []);

  // Move the dragged row to where it was dropped and persist the new order.
  const reorder = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      setLinks((prev) => {
        if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        commitOrder(next);
        return next;
      });
    },
    [commitOrder],
  );

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
          if (d?.links) setLinks(arrange(d.links));
          else setError(d?.error || "Could not save.");
        } catch {
          setError("Network error.");
        } finally {
          setBusy(false);
        }
      } else {
        const next = arrange([...links.filter((l) => l.ticker !== t), entry]);
        setLinks(next);
        persistLocal(next);
      }
      setTicker("");
      setUrl("");
      setName("");
    },
    [ticker, url, name, dbEnabled, links, names, arrange],
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
          if (d?.links) setLinks(arrange(d.links));
        } finally {
          setBusy(false);
        }
      } else {
        const next = links.filter((l) => l.ticker !== t);
        setLinks(next);
        persistLocal(next);
      }
    },
    [dbEnabled, links, arrange],
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
            {links.map((l, i) => (
              <li
                key={l.ticker}
                className={`dil-row${dragIdx === i ? " dil-row-dragging" : ""}`}
                onDragOver={(e) => {
                  if (dragIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null) reorder(dragIdx, i);
                  setDragIdx(null);
                }}
                onDragEnd={() => setDragIdx(null)}
              >
                <button
                  type="button"
                  className="dil-grip"
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = "move";
                    // Firefox requires data to be set for a drag to start.
                    e.dataTransfer.setData("text/plain", l.ticker);
                  }}
                  aria-label={`Drag to reorder ${l.ticker}`}
                  title="Drag to reorder"
                >
                  <DragHandle />
                </button>
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
