"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { Sheet } from "@/components/Sheet";
import { useIsMobile } from "@/components/useIsMobile";
import { logoCandidates } from "@/lib/diligence";
import { TOOL_NAMES } from "@/lib/toolMeta";
import type { MorningNote, ThemeChart } from "./page";

// Stock logo, shared with the Diligence Tracker: logoCandidates() resolves a
// ticker (including full Bloomberg symbols like "SAP GY") to an ordered list of
// logo URLs — a domain-keyed source first for symbols the CDN gets wrong or
// can't resolve, then the symbol CDN. We walk that list on each image error and
// fall back to the symbol's initial only after every source fails.
function TickerLogo({ ticker }: { ticker: string }) {
  const candidates = logoCandidates(ticker);
  const [idx, setIdx] = useState(0);

  if (idx >= candidates.length) {
    return (
      <span className="news-position-logo news-position-logo-ph" aria-hidden>
        {ticker.trim().charAt(0)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[idx]}
      alt=""
      width={20}
      height={20}
      className="news-position-logo"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

// ---------------------------------------------------------------------------
// Mini chart (no dependency — inline SVG)
// ---------------------------------------------------------------------------

function ThemeChartView({ chart }: { chart: ThemeChart }) {
  const series = chart.series ?? [];
  if (series.length === 0) return null;

  const unit = chart.unit ?? "";
  const values = series.map((s) => s.value);
  const peak = Math.max(...values.map((v) => Math.abs(v)), 0) || 1;
  const hasNegative = values.some((v) => v < 0);

  return (
    <div className="news-chart">
      <div className="news-chart-title">{chart.title}</div>
      <div className="news-chart-bars">
        {series.map((s, i) => {
          const pct = (Math.abs(s.value) / peak) * 100;
          const neg = s.value < 0;
          return (
            <div key={i} className="news-chart-row">
              <span className="news-chart-label">{s.label}</span>
              <span className="news-chart-track">
                <span
                  className={
                    "news-chart-bar" + (neg ? " neg" : " pos")
                  }
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className={"news-chart-value" + (neg ? " neg" : " pos")}>
                {s.value}
                {unit}
              </span>
            </div>
          );
        })}
      </div>
      {hasNegative && (
        <div className="news-chart-foot">Red bars are declines.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar popup
// ---------------------------------------------------------------------------

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// The month header + day grid, shared between the desktop popover and the
// mobile bottom sheet (same availability/selection rules in both shells).
function CalendarPanel({
  availableDates,
  selectedDate,
  onSelect,
  onClose,
}: {
  availableDates: Set<string>;
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const d = selectedDate ? new Date(selectedDate + "T12:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const { year, month } = cursor;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const monthLabel = new Date(year, month, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function toISO(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <>
      <div className="news-cal-header">
        <button
          className="news-cal-nav"
          onClick={() =>
            setCursor(({ year, month }) =>
              month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
            )
          }
        >
          ‹
        </button>
        <span className="news-cal-month">{monthLabel}</span>
        <button
          className="news-cal-nav"
          onClick={() =>
            setCursor(({ year, month }) =>
              month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
            )
          }
          disabled={year > new Date().getFullYear() || (year === new Date().getFullYear() && month >= new Date().getMonth())}
        >
          ›
        </button>
      </div>
      <div className="news-cal-grid">
        {DOW.map((d) => (
          <div key={d} className="news-cal-dow">
            {d}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day === null)
            return <div key={`e${idx}`} className="news-cal-day empty" />;
          const iso = toISO(day);
          const hasNote = availableDates.has(iso);
          const isSel = iso === selectedDate;
          const isFuture = iso > today;
          return (
            <button
              key={iso}
              className={[
                "news-cal-day",
                hasNote ? "has-note" : "",
                isSel ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!hasNote || isFuture}
              onClick={() => {
                onSelect(iso);
                onClose();
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
}

// Desktop shell: the panel in an anchored popover that closes on outside click.
function CalendarPopup(props: {
  availableDates: Set<string>;
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="news-cal-popup" ref={ref}>
      <CalendarPanel {...props} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MorningNewsClient({ notes }: { notes: MorningNote[] }) {
  const availableDates = new Set(notes.map((n) => n.date));
  const latestDate = notes[0]?.date ?? null;

  const [selectedDate, setSelectedDate] = useState<string>(latestDate ?? "");
  const [calOpen, setCalOpen] = useState(false);
  const isMobile = useIsMobile();

  const selected = notes.find((n) => n.date === selectedDate) ?? null;

  const formattedDate = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";
  // Compact variants for the phone: the top-bar button ("Jun 11") and the
  // mono AI-GENERATED byline ("WED, JUN 11 2026").
  const shortDate = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "—";
  const bylineDate = selectedDate
    ? new Date(selectedDate + "T12:00:00")
        .toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
        .toUpperCase()
    : "—";

  const closeCal = useCallback(() => setCalOpen(false), []);

  const howItWorks = (
    <HowItWorks title={`How ${TOOL_NAMES.morningNews} works`}>
        <p className="hiw-lead">
          A pre-market digest of overnight headlines, summarized fresh each
          morning.
        </p>
        <ul className="hiw-list">
          <li>
            <b>Pick a date</b> — the date control opens a calendar; only days
            with a note are selectable.
          </li>
          <li>
            <b>Portfolio mentions</b> — the names in the book that moved
            overnight, each with a <b>Claude&apos;s take</b> on what it means for
            our long thesis.
          </li>
          <li>
            <b>Top themes</b> — the day&apos;s big stories, with a quick chart
            and the sources behind them.
          </li>
        </ul>
      </HowItWorks>
  );

  const actions = (
    <>
      <div className="news-date-picker-wrap">
        <button
          type="button"
          className="btn"
          onClick={() => setCalOpen((o) => !o)}
          title="Pick a date"
        >
          <span className="cal-glyph" aria-hidden="true" />
          {formattedDate}
          <span className="glyph" aria-hidden="true">▾</span>
        </button>
        {calOpen && !isMobile && (
          <CalendarPopup
            availableDates={availableDates}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            onClose={closeCal}
          />
        )}
      </div>
      {howItWorks}
    </>
  );

  // Phone top bar: a compact mono date button (the calendar opens as a bottom
  // sheet) + the ? help button. No export/download affordances on mobile.
  const mobileActions = (
    <>
      <button
        type="button"
        className="mn-date-btn mono"
        onClick={() => setCalOpen((o) => !o)}
        title="Pick a date"
      >
        <span className="cal-glyph" aria-hidden="true" />
        {shortDate}
      </button>
      {howItWorks}
    </>
  );

  return (
    <AppShell
      tool={TOOL_NAMES.morningNews}
      title={TOOL_NAMES.morningNews}
      subtitle={
        <>
          Daily newsletter digest · <span className="mono">AI-generated</span>
        </>
      }
      actions={actions}
      mobileActions={mobileActions}
      footerLeft={selectedDate ? `${TOOL_NAMES.morningNews} · ${formattedDate}` : TOOL_NAMES.morningNews}
    >
      {isMobile && (
        <Sheet open={calOpen} onClose={closeCal} title="Pick a date">
          <div className="mn-cal-sheet">
            <CalendarPanel
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
              onClose={closeCal}
            />
          </div>
        </Sheet>
      )}
      {!selected ? (
        <div className="news-empty">
          {notes.length === 0
            ? "No morning notes yet — the first one will appear after the 9am run."
            : "No note found for this date."}
        </div>
      ) : (
        <>
          {selected.one_liner && (
            <p className="news-one-liner">{selected.one_liner}</p>
          )}
          {/* Mobile-only mono byline (the desktop subtitle carries this). */}
          <p className="mn-meta mono">AI-GENERATED · {bylineDate}</p>

          {selected.positions.length > 0 && (
            <section className="section">
              <div className="section-head">
                <span className="section-num">01</span>
                <h2 className="section-title">Portfolio mentions</h2>
              </div>
              <div className="news-positions">
                {selected.positions.map((p, i) => (
                  <div key={i} className="news-position-row">
                    <span className="news-position-ticker">
                      <TickerLogo ticker={p.ticker} />
                      {p.ticker}
                    </span>
                    <span className="news-position-notes">
                      {p.notes}
                      {p.claude_take && (
                        <span className="news-take">
                          <span className="news-take-label">Claude&apos;s take</span>
                          {p.claude_take}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selected.top_themes.length > 0 && (
            <section className="section">
              <div className="section-head">
                <span className="section-num">02</span>
                <h2 className="section-title">Top themes</h2>
              </div>
              <div className="news-themes">
                {selected.top_themes.map((theme, i) => {
                  // Support both the new points[] shape and legacy detail string.
                  const points =
                    theme.points && theme.points.length > 0
                      ? theme.points
                      : theme.detail
                      ? [{ text: theme.detail }]
                      : [];
                  return (
                    <div key={i} className="news-theme-card">
                      <p className="news-theme-headline">{theme.headline}</p>
                      {points.length > 0 && (
                        <ol className="news-theme-points">
                          {points.map((pt, pi) => {
                            // New notes carry plain `details`; older ones carry
                            // term/definition `jargon` pairs. Render whichever.
                            const subs =
                              pt.details && pt.details.length > 0
                                ? pt.details
                                : (pt.jargon ?? []).map((j) =>
                                    j.definition
                                      ? `${j.term} — ${j.definition}`
                                      : j.term,
                                  );
                            return (
                              <li key={pi} className="news-theme-point">
                                {pt.text}
                                {subs.length > 0 && (
                                  <ol className="news-theme-jargon">
                                    {subs.map((s, ji) => (
                                      <li key={ji}>{s}</li>
                                    ))}
                                  </ol>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                      {theme.chart && <ThemeChartView chart={theme.chart} />}
                      {theme.sources.length > 0 && (
                        <div className="news-theme-sources">
                          {theme.sources.map((s) => (
                            <span key={s} className="news-source-tag">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
