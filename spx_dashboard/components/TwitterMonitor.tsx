"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { cx } from "@/lib/format";
import { TOOL_NAMES } from "@/lib/toolMeta";
import {
  DailySummaryItem,
  PORTFOLIO_NAMES,
  RecurringTopic,
  Tweet,
  TwitterData,
} from "@/lib/tweets";

const ADD_KEY = "xthemes:followed:add";
const REMOVE_KEY = "xthemes:followed:remove";
// "Latest tweets" window: the runs fire Mon/Wed/Fri, so a few days covers the
// gap since the last one; the cap keeps the table to a glanceable ~20.
const RECENT_DAYS = 4;
const MAX_RECENT = 20;
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

function fmtDay(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10) || "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fmtViews(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

export function TwitterMonitor({
  data: initialData,
  canonicalFollowed,
}: {
  data: TwitterData;
  canonicalFollowed: string[];
}) {
  const [data, setData] = useState(initialData);
  const [asOf, setAsOf] = useState(fmtAsOf(initialData.generated_at));

  // DB mode: when the API reports Supabase is configured, dbFollowed is the
  // authoritative (shared) followed set. Otherwise the localStorage overlay.
  const [dbFollowed, setDbFollowed] = useState<string[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    setAdded(loadList(ADD_KEY));
    setRemoved(loadList(REMOVE_KEY));

    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => {
        if (d?.enabled && Array.isArray(d.tweets) && d.tweets.length) {
          setData((prev) => ({
            ...prev,
            ...d,
            // DB rows don't carry these; keep the server-rendered versions.
            themes: d.themes?.length ? d.themes : prev.themes,
            portfolio: d.portfolio?.length ? d.portfolio : prev.portfolio,
          }));
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

  const followed = useMemo(() => {
    if (dbFollowed !== null) return new Set(dbFollowed);
    const s = new Set(canonical);
    added.forEach((h) => s.add(h));
    removed.forEach((h) => s.delete(h));
    return s;
  }, [dbFollowed, canonical, added, removed]);

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

  const followedList = Array.from(followed).sort();
  const tweetById = useMemo(() => {
    const m = new Map<string, Tweet>();
    data.tweets.forEach((t) => m.set(t.id, t));
    return m;
  }, [data.tweets]);

  // The tweet table shows the 80 most recent posts, newest first — PLUS any
  // The tweet table shows the last few days of posts (aiming for ~20, not the
  // whole store) — PLUS any tweet referenced by the daily summary or recurring
  // topics, so every "See post" anchor below always resolves to a rendered row.
  const recentTweets = useMemo(() => {
    const stamp = (t: Tweet) => t.posted_at || t.first_seen || "";
    const byTime = (a: Tweet, b: Tweet) => stamp(b).localeCompare(stamp(a));
    const sorted = [...data.tweets].sort(byTime);

    const referenced = new Set<string>();
    (data.daily_summary.items || []).forEach((it) =>
      (it.tweet_ids || []).forEach((id) => referenced.add(id)),
    );
    (data.recurring || []).forEach((r) =>
      (r.tweet_ids || []).forEach((id) => referenced.add(id)),
    );

    // Keep posts from the trailing RECENT_DAYS window, then cap at MAX_RECENT.
    const newest = sorted[0] ? stamp(sorted[0]).slice(0, 10) : "";
    let cutoff = "";
    if (newest) {
      const d = new Date(newest);
      d.setUTCDate(d.getUTCDate() - RECENT_DAYS);
      cutoff = d.toISOString().slice(0, 10);
    }
    const windowed = cutoff
      ? sorted.filter((t) => stamp(t).slice(0, 10) >= cutoff)
      : sorted;
    const top = windowed.slice(0, MAX_RECENT);

    const shown = new Set(top.map((t) => t.id));
    const extras = sorted.filter((t) => referenced.has(t.id) && !shown.has(t.id));
    return [...top, ...extras].sort(byTime);
  }, [data.tweets, data.daily_summary, data.recurring]);

  const recentDays = useMemo(() => {
    const days = new Set(recentTweets.map((t) => (t.posted_at || t.first_seen || "").slice(0, 10)));
    days.delete("");
    return days.size;
  }, [recentTweets]);

  const renderedIds = useMemo(
    () => new Set(recentTweets.map((t) => t.id)),
    [recentTweets],
  );

  // Portfolio names mentioned in the recent batch, in portfolio order.
  const portfolioHits = useMemo(() => {
    return data.portfolio
      .map((disp) => ({
        disp,
        tweets: recentTweets.filter((t) => (t.portfolio || []).includes(disp)),
      }))
      .filter((e) => e.tweets.length > 0);
  }, [data.portfolio, recentTweets]);

  const daily = data.daily_summary;
  const hasContent = data.tweets.length > 0;

  const actions = (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setManageOpen(true)}
        title="Add or remove followed accounts"
      >
        Manage accounts <span className="mono">{followedList.length}</span>
      </button>
      <HowItWorks title={`How ${TOOL_NAMES.twitter} works`}>
        <p className="hiw-lead">
          Every <strong>Monday, Wednesday and Friday</strong> morning the monitor
          reads the latest posts from your followed accounts.
        </p>
        <ul className="hiw-list">
          <li>
            <b>Followed accounts</b> — edit the list with <b>Manage accounts</b>.
            It&apos;s shared across the team, not saved per-browser.
          </li>
          <li>
            <b>Summaries &amp; tags</b> — each tweet is summarized and tagged;
            charts get a one-line description.
          </li>
          <li>
            <b>Sentiment dots</b> — the colored dot by each author marks the
            tweet&apos;s tone: <span className="tw-sent-dot tw-sent-positive" />{" "}
            positive, <span className="tw-sent-dot tw-sent-negative" /> negative,{" "}
            <span className="tw-sent-dot tw-sent-neutral" /> neutral.
          </li>
          <li>
            <b>Digest</b> — organizes the substance by theme, flags{" "}
            <strong>portfolio mentions</strong>, and tracks topics recurring over
            the trailing month.
          </li>
        </ul>
      </HowItWorks>
    </>
  );

  return (
    <AppShell
      tool={TOOL_NAMES.twitter}
      title={TOOL_NAMES.twitter}
      subtitle={
        <>
          Digest of followed accounts ·{" "}
          <span className="mono">{asOf ? `as of ${asOf}` : "awaiting first run"}</span>{" "}
          ·{" "}
          <span className="mono">
            {recentTweets.length} {recentTweets.length === 1 ? "tweet" : "tweets"}
            {recentDays > 0 ? ` · last ${recentDays} ${recentDays === 1 ? "day" : "days"}` : ""}
          </span>
        </>
      }
      actions={actions}
      footerLeft={`${TOOL_NAMES.twitter} as of ${asOf ?? "—"}`}
    >
      {manageOpen && (
        <div className="tw-manage-overlay" onClick={() => setManageOpen(false)}>
          <div className="tw-manage" onClick={(e) => e.stopPropagation()}>
            <div className="tw-manage-head">
              <h2>
                Followed accounts{" "}
                <span className="handles-count">{followedList.length}</span>
              </h2>
              <button
                type="button"
                className="eq-x"
                onClick={() => setManageOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="tw-manage-body handles">
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
                {dbFollowed !== null
                  ? "Shared list — edits apply for everyone."
                  : "Saved in this browser."}
              </p>
            </div>
          </div>
        </div>
      )}

      {!hasContent ? (
          <section className="section">
            <p className="muted">
              No tweets collected yet. The monitor runs Monday, Wednesday and
              Friday mornings; check back after the next run.
            </p>
          </section>
        ) : (
          <>
            <section className="section">
              <div className="section-head">
                <span className="section-num">01</span>
                <h2 className="section-title">Summary of the day</h2>
                {daily.date && <span className="section-note">{fmtDay(daily.date)}</span>}
              </div>
              {daily.headline && <p className="tw-headline">{daily.headline}</p>}
              {daily.items.length === 0 ? (
                <p className="muted">No summary for the latest run.</p>
              ) : (
                <div className="tw-daily">
                  {daily.items.map((it) => (
                    <DailyItem
                      key={it.theme}
                      item={it}
                      tweetById={tweetById}
                      renderedIds={renderedIds}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <span className="section-num">02</span>
                <h2 className="section-title">Portfolio mentions</h2>
                <span className="section-note">
                  <Link href="/dashboard" className="tw-port-link">
                    holdings → Equities Dashboard
                  </Link>
                </span>
              </div>
              {portfolioHits.length === 0 ? (
                <p className="muted">No portfolio names came up in the latest batch.</p>
              ) : (
                <table className="tw-table tw-port-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Company</th>
                      <th>Mentions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioHits.map(({ disp, tweets }) => (
                      <tr key={disp}>
                        <td>
                          <Link href="/dashboard" className="tw-ticker" title="Open in Equities Dashboard">
                            {disp}
                          </Link>
                        </td>
                        <td className="tw-name">{PORTFOLIO_NAMES[disp] ?? ""}</td>
                        <td>
                          {tweets.map((t) => (
                            <a
                              key={t.id}
                              href={`#tw-${t.id}`}
                              className="tw-see-post"
                              title={t.summary || `Jump to @${t.handle}'s post`}
                            >
                              @{t.handle} ↓
                            </a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {data.recurring.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <span className="section-num">03</span>
                  <h2 className="section-title">Recurring themes</h2>
                  <span className="section-note">topics seen on 3+ days in the past month</span>
                </div>
                <div className="tw-recur-grid">
                  {data.recurring.map((r) => (
                    <RecurCard key={r.topic} r={r} />
                  ))}
                </div>
              </section>
            )}

            <section className="section">
              <div className="section-head">
                <span className="section-num">04</span>
                <h2 className="section-title">Latest tweets</h2>
                <span className="section-note">
                  {recentTweets.length} from the last {recentDays || 1}{" "}
                  {recentDays === 1 ? "day" : "days"} · hover a summary for the full text
                </span>
                <span className="tw-legend" aria-label="Sentiment legend">
                  <span className="tw-legend-item">
                    <span className="tw-sent-dot tw-sent-positive" /> positive
                  </span>
                  <span className="tw-legend-item">
                    <span className="tw-sent-dot tw-sent-negative" /> negative
                  </span>
                  <span className="tw-legend-item">
                    <span className="tw-sent-dot tw-sent-neutral" /> neutral
                  </span>
                </span>
              </div>
              <table className="tw-table tw-tweets-table">
                <thead>
                  <tr>
                    <th>Author</th>
                    <th>Summary</th>
                    <th>Tickers</th>
                    <th className="r">Views</th>
                    <th className="r">Date</th>
                    <th className="r">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTweets.map((t) => (
                    <TweetRow key={t.id} t={t} />
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
    </AppShell>
  );
}

function TickerChip({ ticker }: { ticker: string }) {
  return <span className="tw-chip">{ticker}</span>;
}

function DailyItem({
  item,
  tweetById,
  renderedIds,
}: {
  item: DailySummaryItem;
  tweetById: Map<string, Tweet>;
  renderedIds: Set<string>;
}) {
  const linkedTweets = item.tweet_ids
    .map((id) => tweetById.get(id))
    .filter((t): t is Tweet => !!t);
  // Charts from the tweets behind this theme (if any carry an image URL).
  const charts = linkedTweets
    .flatMap((t) => (t.media_urls || []).map((url) => ({ url, tweet: t })))
    .slice(0, 4);
  const jumpable = item.tweet_ids.filter((id) => renderedIds.has(id));

  return (
    <div className="tw-daily-item">
      <div className="tw-daily-label">{item.label}</div>
      <p className="tw-daily-text">{item.summary}</p>
      {charts.length > 0 && (
        <div className="tw-daily-charts">
          {charts.map(({ url, tweet }) => (
            <a
              key={url}
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tw-chart"
              title={tweet.media_summary || `Chart from @${tweet.handle}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={tweet.media_summary || "Chart from a tweet"} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <div className="tw-daily-meta">
        {item.tickers.map((tk) => (
          <TickerChip key={tk} ticker={tk} />
        ))}
        {jumpable.map((id, i) => (
          <a
            key={id}
            href={`#tw-${id}`}
            className="tw-see-post"
            title="Jump to the post below"
          >
            See post{jumpable.length > 1 ? ` ${i + 1}` : ""}
          </a>
        ))}
      </div>
    </div>
  );
}

function RecurCard({ r }: { r: RecurringTopic }) {
  return (
    <article className="tw-recur-card">
      <div className="tw-recur-head">
        <span className="tw-recur-topic">{r.topic}</span>
        <span className="tw-recur-days">{r.days_seen}d</span>
      </div>
      <p className="tw-recur-sum">{r.summary}</p>
      <div className="tw-daily-meta">
        {r.tickers.map((tk) => (
          <TickerChip key={tk} ticker={tk} />
        ))}
      </div>
    </article>
  );
}

function TweetRow({ t }: { t: Tweet }) {
  return (
    <tr id={`tw-${t.id}`} className={cx(t.portfolio.length > 0 && "tw-row-port")}>
      <td className="tw-author">
        <a href={`https://x.com/${t.handle}`} target="_blank" rel="noopener noreferrer">
          @{t.handle}
        </a>
        <span className={cx("tw-sent-dot", `tw-sent-${t.sentiment}`)} title={t.sentiment} />
      </td>
      <td className="tw-sum" title={t.text}>
        {t.summary || t.text}
        {t.has_media && (
          <span
            className="tw-media"
            title={t.media_summary || "Contains a chart/image"}
            aria-label="Contains a chart or image"
          >
            {" "}· chart
          </span>
        )}
        {t.media_summary && <span className="tw-media-sum"> {t.media_summary}</span>}
      </td>
      <td className="tw-tickers">
        {t.tickers.map((tk) => (
          <TickerChip key={tk} ticker={tk} />
        ))}
      </td>
      <td className="r mono">{fmtViews(t.views)}</td>
      <td className="r mono">{fmtDay(t.posted_at || t.first_seen)}</td>
      <td className="r">
        <a
          className="tw-x-link"
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the post on X"
          aria-label="Open the post on X"
        >
          <XLogo />
        </a>
      </td>
    </tr>
  );
}

function XLogo() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}
