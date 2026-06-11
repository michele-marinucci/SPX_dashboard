"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import type { MorningNote, ThemeChart } from "./page";

// Map ticker → Clearbit logo domain
const TICKER_DOMAIN: Record<string, string> = {
  MSFT: "microsoft.com",
  AMZN: "amazon.com",
  TRU: "transunion.com",
  COF: "capitalone.com",
  AON: "aon.com",
  WDAY: "workday.com",
  SPGI: "spglobal.com",
  "LSEG LN": "lseg.com",
  CSGP: "costargroup.com",
  "DSV DC": "dsv.com",
  MSCI: "msci.com",
  META: "meta.com",
  "SAP GY": "sap.com",
  TOST: "toasttab.com",
  EFX: "equifax.com",
  VSAT: "viasat.com",
};

function TickerLogo({ ticker }: { ticker: string }) {
  const domain = TICKER_DOMAIN[ticker];
  const [failed, setFailed] = useState(false);

  if (!domain || failed) {
    // Placeholder: first letter of the ticker on a neutral chip.
    return (
      <span className="news-position-logo news-position-logo-ph" aria-hidden>
        {ticker.charAt(0)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt=""
      width={20}
      height={20}
      className="news-position-logo"
      onError={() => setFailed(true)}
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
              <span className="news-chart-value">
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

function CalendarPopup({
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

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="news-cal-popup" ref={ref}>
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

  const selected = notes.find((n) => n.date === selectedDate) ?? null;

  const formattedDate = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  const closeCal = useCallback(() => setCalOpen(false), []);

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
        {calOpen && (
          <CalendarPopup
            availableDates={availableDates}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            onClose={closeCal}
          />
        )}
      </div>
      <HowItWorks title="How Morning Notes works">
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
            overnight, with a one-line read.
          </li>
          <li>
            <b>Top themes</b> — the day&apos;s big stories, with a quick chart
            and the sources behind them.
          </li>
        </ul>
      </HowItWorks>
    </>
  );

  return (
    <AppShell
      tool="Morning Notes"
      title="Morning Notes"
      subtitle={
        <>
          Daily newsletter digest · <span className="mono">AI-generated</span>
        </>
      }
      actions={actions}
      footerLeft={selectedDate ? `Morning Notes · ${formattedDate}` : "Morning Notes"}
    >
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
                    <span className="news-position-notes">{p.notes}</span>
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
                          {points.map((pt, pi) => (
                            <li key={pi} className="news-theme-point">
                              {pt.text}
                              {pt.jargon && pt.jargon.length > 0 && (
                                <ol className="news-theme-jargon">
                                  {pt.jargon.map((j, ji) => (
                                    <li key={ji}>
                                      <span className="news-jargon-term">
                                        {j.term}
                                      </span>
                                      {" — "}
                                      {j.definition}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </li>
                          ))}
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
