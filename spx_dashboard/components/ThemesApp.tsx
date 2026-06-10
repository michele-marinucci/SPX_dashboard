"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Sparkline } from "@/components/Sparkline";
import { cx } from "@/lib/format";
import { Direction, IdeaSource, ThemeIdea, ThemeRef } from "@/lib/themes";

const ADD_KEY = "xthemes:followed:add";
const REMOVE_KEY = "xthemes:followed:remove";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const norm = (h: string) => h.trim().toLowerCase().replace(/^@/, "");

function loadList(key: string): string[] {
  try {
    const arr = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(arr) ? arr.map(norm).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function fmtAsOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function byRecency(a: ThemeIdea, b: ThemeIdea): number {
  return (
    b.last_seen.localeCompare(a.last_seen) ||
    b.seen_count - a.seen_count ||
    a.ticker.localeCompare(b.ticker)
  );
}

export function ThemesApp({
  ideas: initialIdeas,
  canonicalFollowed,
  names,
  themes: initialThemes,
  asOf: initialAsOf,
}: {
  ideas: ThemeIdea[];
  canonicalFollowed: string[];
  names: Record<string, string>;
  themes: ThemeRef[];
  asOf: string | null;
}) {
  const [ideas, setIdeas] = useState(initialIdeas);
  const [themes, setThemes] = useState(initialThemes);
  const [asOf, setAsOf] = useState(initialAsOf);

  // DB mode: when the API reports Supabase is configured, dbFollowed is the
  // authoritative followed set. Otherwise we use the localStorage overlay.
  const [dbFollowed, setDbFollowed] = useState<string[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAdded(loadList(ADD_KEY));
    setRemoved(loadList(REMOVE_KEY));

    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => {
        if (d?.enabled && Array.isArray(d.ideas)) {
          setIdeas(d.ideas);
          if (Array.isArray(d.themes)) setThemes(d.themes);
          setAsOf(fmtAsOf(d.generated_at ?? null));
        }
      })
      .catch(() => {});

    fetch("/api/followed")
      .then((r) => r.json())
      .then((d) => {
        if (d?.enabled && Array.isArray(d.handles)) setDbFollowed(d.handles.map(norm));
      })
      .catch(() => {});
  }, []);

  const persist = (key: string, list: string[]) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };

  const canonical = useMemo(() => new Set(canonicalFollowed.map(norm)), [canonicalFollowed]);

  // Effective followed set: DB when enabled, else (canonical ∪ added) − removed.
  const followed = useMemo(() => {
    if (dbFollowed !== null) return new Set(dbFollowed);
    const s = new Set(canonical);
    added.forEach((h) => s.add(h));
    removed.forEach((h) => s.delete(h));
    return s;
  }, [dbFollowed, canonical, added, removed]);

  const labelOf = useMemo(() => {
    const m: Record<string, string> = {};
    themes.forEach((t) => (m[t.key] = t.label));
    return (k: string) => m[k] ?? k;
  }, [themes]);

  const addHandle = useCallback(
    async (raw: string) => {
      const h = norm(raw);
      if (!h) return;
      setDraft("");
      if (dbFollowed !== null) {
        setBusy(true);
        try {
          const res = await fetch("/api/followed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add", handle: h }),
          });
          const d = await res.json();
          if (d?.handles) setDbFollowed(d.handles.map(norm));
        } finally {
          setBusy(false);
        }
        return;
      }
      // localStorage fallback
      if (removed.includes(h)) {
        const next = removed.filter((x) => x !== h);
        setRemoved(next);
        persist(REMOVE_KEY, next);
      }
      if (!canonical.has(h) && !added.includes(h)) {
        const next = [...added, h];
        setAdded(next);
        persist(ADD_KEY, next);
      }
    },
    [dbFollowed, removed, canonical, added],
  );

  const removeHandle = useCallback(
    async (h: string) => {
      if (dbFollowed !== null) {
        setBusy(true);
        try {
          const res = await fetch("/api/followed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove", handle: h }),
          });
          const d = await res.json();
          if (d?.handles) setDbFollowed(d.handles.map(norm));
        } finally {
          setBusy(false);
        }
        return;
      }
      if (added.includes(h)) {
        const next = added.filter((x) => x !== h);
        setAdded(next);
        persist(ADD_KEY, next);
      } else {
        const next = Array.from(new Set([...removed, h]));
        setRemoved(next);
        persist(REMOVE_KEY, next);
      }
    },
    [dbFollowed, added, removed],
  );

  const isFollowed = (idea: ThemeIdea) =>
    idea.sources.some((s) => followed.has(norm(s.handle)));

  const active = ideas.filter((i) => i.active);
  const followedIdeas = active.filter(isFollowed).sort(byRecency);
  const discoveryIdeas = active.filter((i) => !isFollowed(i)).sort(byRecency);
  const followedList = Array.from(followed).sort();

  const themeRollup = useMemo(() => {
    const m = new Map<string, { long: Set<string>; short: Set<string>; n: number }>();
    for (const i of active) {
      for (const k of i.theme_keys.length ? i.theme_keys : ["_"]) {
        const e = m.get(k) ?? { long: new Set(), short: new Set(), n: 0 };
        e.n += 1;
        if (i.direction === "long") e.long.add(i.ticker);
        if (i.direction === "short") e.short.add(i.ticker);
        m.set(k, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas]);

  return (
    <div className="shell">
      <aside className="sidebar themes-sidebar">
        <div className="sidebar-head">
          <Link href="/" className="sidebar-brand" title="Back to all views">
            <span className="sidebar-brand-text">Mendo Monitor</span>
          </Link>
          <span className="sidebar-sys" aria-hidden="true">
            X THEMES
          </span>
        </div>
        <Link href="/" className="rail-back">
          ← All tools
        </Link>

        <details className="themes-explain" open>
          <summary>How this works</summary>
          <p>
            Every morning the scout reads X for actionable investment ideas about
            your themes. Each idea is <strong>grounded</strong> in at least one
            real post and bucketed by who posted it.
          </p>
          <ul>
            <li>
              <b>Followed accounts</b> — at least one source is a handle you
              follow (edit the list below).
            </li>
            <li>
              <b>Discovery</b> — everyone else; unvetted, treat with caution.
            </li>
          </ul>
        </details>

        <div className="handles">
          <div className="handles-head">
            Followed accounts <span className="handles-count">{followedList.length}</span>
          </div>
          <form
            className="handle-add"
            onSubmit={(e) => {
              e.preventDefault();
              addHandle(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="add @handle"
              aria-label="Add a handle"
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Add
            </button>
          </form>
          <ul className="handle-list">
            {followedList.map((h) => (
              <li key={h} className="handle-row">
                <a
                  href={`https://x.com/${h}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="handle-name"
                >
                  @{h}
                </a>
                <button
                  type="button"
                  className="handle-x"
                  onClick={() => removeHandle(h)}
                  disabled={busy}
                  aria-label={`Remove @${h}`}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="handles-note">
            {dbFollowed !== null ? "Synced to your database." : "Saved in this browser."}
          </p>
        </div>
      </aside>

      <div className="content">
        <header className="content-header">
          <div>
            <h1>X Themes</h1>
            <p className="subtitle">
              Daily idea briefing from X ·{" "}
              <span className="mono">
                {asOf ? `as of ${asOf}` : "awaiting first run"}
              </span>{" "}
              · {active.length} {active.length === 1 ? "idea" : "ideas"}
            </p>
          </div>
          <div className="header-actions">
            <LogoutButton />
          </div>
        </header>

        {active.length === 0 ? (
          <section className="section">
            <p className="muted">
              No grounded ideas yet. The daily scout surfaces ideas from X each
              morning; check back after the next run.
            </p>
          </section>
        ) : (
          <>
            <section className="section keythemes">
              <div className="section-head">
                <span className="section-num">·</span>
                <h2 className="section-title">Key themes today</h2>
                <span className="section-note">
                  {themeRollup.length} themes · ▲ long ▼ short
                </span>
              </div>
              <div className="kt-grid">
                {themeRollup.map(([k, e]) => (
                  <div key={k} className="kt-item">
                    <div className="kt-label">
                      {labelOf(k)} <span className="kt-n">{e.n}</span>
                    </div>
                    <div className="kt-tickers">
                      {[...e.long].map((t) => (
                        <span key={`l${t}`} className="kt-t kt-long">
                          ▲ {t}
                        </span>
                      ))}
                      {[...e.short].map((t) => (
                        <span key={`s${t}`} className="kt-t kt-short">
                          ▼ {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <IdeaSectionView
              title="Followed accounts"
              blurb="From handles you follow."
              ideas={followedIdeas}
              names={names}
              labelOf={labelOf}
              followed={followed}
            />
            <IdeaSectionView
              title="Discovery"
              blurb="Unvetted — surfaced from the wider firehose."
              ideas={discoveryIdeas}
              names={names}
              labelOf={labelOf}
              followed={followed}
            />
          </>
        )}

        <footer className="view-foot">
          <span>X Themes as of {asOf ?? "—"}</span>
          <span>MERITAGE · INTERNAL</span>
        </footer>
      </div>
    </div>
  );
}

function IdeaSectionView({
  title,
  blurb,
  ideas,
  names,
  labelOf,
  followed,
}: {
  title: string;
  blurb: string;
  ideas: ThemeIdea[];
  names: Record<string, string>;
  labelOf: (k: string) => string;
  followed: Set<string>;
}) {
  return (
    <section className="section">
      <div className="tier-head">
        <h2 className="section-title">
          {title}
          <span className="tier-pill">{ideas.length}</span>
        </h2>
      </div>
      <p className="tier-blurb">{blurb}</p>
      {ideas.length === 0 ? (
        <p className="muted">Nothing here today.</p>
      ) : (
        <div className="idea-grid">
          {ideas.map((idea) => (
            <IdeaCard
              key={`${idea.ticker}-${idea.direction}`}
              idea={idea}
              name={names[idea.ticker]}
              labelOf={labelOf}
              followed={followed}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const DIR_LABEL: Partial<Record<Direction, string>> = { long: "Long", short: "Short" };

function IdeaCard({
  idea,
  name,
  labelOf,
  followed,
}: {
  idea: ThemeIdea;
  name?: string;
  labelOf: (k: string) => string;
  followed: Set<string>;
}) {
  const hasChart = !!idea.prices?.series?.length;
  const dirLabel = DIR_LABEL[idea.direction];
  return (
    <article className="idea-card">
      <div className="idea-head">
        <span className="idea-ticker">{idea.ticker}</span>
        {name && <span className="idea-name">{name}</span>}
        {dirLabel && (
          <span className={cx("dir-badge", `dir-${idea.direction}`)}>{dirLabel}</span>
        )}
      </div>

      {idea.thesis && <p className="idea-thesis">{idea.thesis}</p>}
      {idea.catalyst && (
        <p className="idea-catalyst">
          <span className="idea-catalyst-tag">Catalyst</span>
          {idea.catalyst}
        </p>
      )}

      {hasChart && (
        <div className="idea-chart">
          <Sparkline values={idea.prices!.series} width={160} height={34} />
          <span className="idea-chart-cap">
            YTD{idea.prices?.as_of ? ` · as of ${idea.prices.as_of}` : ""}
          </span>
        </div>
      )}

      <div className="idea-sources">
        {idea.sources.map((s) => (
          <SourceLink key={`${s.handle}-${s.url}`} s={s} followed={followed} />
        ))}
      </div>

      <div className="idea-foot">
        {idea.theme_keys.map((k) => (
          <span key={k} className="idea-theme-chip">
            {labelOf(k)}
          </span>
        ))}
        <span className="idea-recur">
          {idea.seen_count > 1 ? `recurring ${idea.seen_count}d` : "new today"}
        </span>
      </div>
    </article>
  );
}

function SourceLink({ s, followed }: { s: IdeaSource; followed: Set<string> }) {
  const isFollowed = followed.has(s.handle.toLowerCase());
  return (
    <a
      className={cx("idea-src", isFollowed ? "tier-priority" : "tier-discovery")}
      href={s.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`View the source post on X${isFollowed ? " (followed)" : ""}`}
    >
      <span className="idea-src-dot" aria-hidden="true" />
      <span className="idea-src-handle">@{s.handle}</span>
      {s.role && <span className="idea-src-role">{s.role}</span>}
    </a>
  );
}
