"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import type { MorningNote } from "./page";

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
  if (!domain) return null;
  return (
    <Image
      src={`https://logo.clearbit.com/${domain}`}
      alt={ticker}
      width={20}
      height={20}
      className="news-position-logo"
      unoptimized
    />
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

  return (
    <div className="news-page">
      <header className="news-page-header">
        <div>
          <h1>Morning Note</h1>
          <p className="subtitle">Daily newsletter digest · AI-generated</p>
        </div>
        <div className="news-page-actions">
          <Link href="/" className="btn-back" title="Back to all views">
            ← All views
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="news-toolbar">
        <div className="news-date-picker-wrap">
          <button className="news-date-btn" onClick={() => setCalOpen((o) => !o)}>
            <span>📅</span>
            <span>{formattedDate}</span>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>▾</span>
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
      </div>

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
            <>
              <p className="news-section-title">Portfolio Mentions</p>
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
            </>
          )}

          {selected.top_themes.length > 0 && (
            <>
              <p className="news-section-title">Top Themes</p>
              <div className="news-themes">
                {selected.top_themes.map((theme, i) => (
                  <div key={i} className="news-theme-card">
                    <p className="news-theme-headline">{theme.headline}</p>
                    <p className="news-theme-detail">{theme.detail}</p>
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
                ))}
              </div>
            </>
          )}
        </>
      )}

      <footer className="news-page-foot">MERITAGE · INTERNAL</footer>
    </div>
  );
}
