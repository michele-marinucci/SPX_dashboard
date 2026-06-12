"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Column, DataTable, TableRow } from "@/components/DataTable";
import { NtmPeTable } from "@/components/NtmPeTable";
import { Sheet } from "@/components/Sheet";
import { Sparkline } from "@/components/Sparkline";
import { useCompounders } from "@/components/CompoundersContext";
import { NavGroup, NtmPeTableData } from "@/lib/data";
import { cx, fmtMoney, fmtNum, fmtPct, fmtSignedMoney } from "@/lib/format";
import { SPX_SECTIONS } from "@/lib/toolMeta";

// ---- mobile (phone) layer ---------------------------------------------------- //
// Category cards for glanceability, one tap to the full heatmap grid — the
// same pattern as MobileEquities. Rendered alongside the desktop sections and
// shown/hidden purely by the ≤768px CSS layer (.ms-mobile / .ms-desktop), so
// the server page stays a server component and desktop markup is untouched.

// Per-category aggregates, resolved server-side from the same table rows the
// desktop DataTable/NtmPeTable render (see app/spx/page.tsx).
export interface MsAgg {
  mktCap: number | null;
  perfYtd: number | null;
  perfQtd: number | null;
  ni: number | null; // adj. NI for the headline growth year
  niYoy1: number | null; // % Δ YoY, headline year
  niYoy2: number | null; // % Δ YoY, following year
  rev26Cur: number | null;
  rev26Abs: number | null; // YTD $ Δ
  rev26Pct: number | null; // YTD % Δ
  rev27Cur: number | null;
  rev27Abs: number | null;
  rev27Pct: number | null;
  ntmPe: number | null;
  peAvg: number | null; // avg since the earliest avg date
  peVsAvg: number | null; // current vs that avg
  peSeries: (number | null)[];
}

// Member rows for the drill-down sheet (the /category/[slug] data, compacted).
export interface MsStock {
  ticker: string;
  name: string;
  isCompounder: boolean;
  pe: number | null;
  ytd: number | null;
}

export interface MsCategory {
  slug: string;
  label: string;
  count: number;
  compounderCount: number;
  agg: MsAgg | null;
  comp: MsAgg | null; // compounders-only roll-up, when available
  stocks: MsStock[];
}

export interface MsGroup {
  group: string;
  categories: MsCategory[];
}

// Column/row props for one full-table section (built by the server page with
// the exact same builders the desktop tables use).
export interface MsTableProps {
  columns: Column[];
  rows: TableRow[];
  altRows?: TableRow[];
}

// Labels that depend on the workbook's year/date columns (computed once on
// the server so the cards never hardcode a year).
export interface MsLabels {
  ni: string; // e.g. "'26 NI"
  niYoy1: string; // e.g. "YoY '26"
  niYoy2: string; // e.g. "YoY '27"
  peAvg: string; // e.g. "AVG '21"
}

const signTone = (v: number | null) =>
  v == null ? undefined : v >= 0 ? "var(--green)" : "var(--red)";
// Cheap vs the historical average reads green.
const cheapTone = (v: number | null) =>
  v == null ? undefined : v <= 0 ? "var(--green)" : "var(--red)";
const sP = (v: number | null, d = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${fmtPct(v, d)}`;

function MsMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className="me-metric">
      <span className="me-metric-cap mono">{label}</span>
      <span className="me-metric-val mono" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </span>
  );
}

// The 3-up chip grid on a category card: which metrics show depends on the
// active section (mirrors the desktop column groups for that section).
function cardMetrics(a: MsAgg | null, section: string, labels: MsLabels) {
  if (!a)
    return (
      <>
        <MsMetric label="—" value="—" />
        <MsMetric label="—" value="—" />
        <MsMetric label="—" value="—" />
      </>
    );
  if (section === "growth")
    return (
      <>
        <MsMetric label={labels.ni} value={fmtMoney(a.ni, 1)} />
        <MsMetric label={labels.niYoy1} value={sP(a.niYoy1)} tone={signTone(a.niYoy1)} />
        <MsMetric label={labels.niYoy2} value={sP(a.niYoy2)} tone={signTone(a.niYoy2)} />
      </>
    );
  if (section === "rev2026" || section === "rev2027") {
    const [cur, abs, pct] =
      section === "rev2026"
        ? [a.rev26Cur, a.rev26Abs, a.rev26Pct]
        : [a.rev27Cur, a.rev27Abs, a.rev27Pct];
    return (
      <>
        <MsMetric label="CURRENT" value={fmtMoney(cur, 1)} />
        <MsMetric label="YTD $Δ" value={fmtSignedMoney(abs, 1)} tone={signTone(abs)} />
        <MsMetric label="YTD %" value={sP(pct)} tone={signTone(pct)} />
      </>
    );
  }
  if (section === "pe")
    return (
      <>
        <MsMetric label="NTM P/E" value={fmtNum(a.ntmPe, 1)} />
        <MsMetric label={labels.peAvg} value={fmtNum(a.peAvg, 1)} />
        <MsMetric label="VS AVG" value={sP(a.peVsAvg)} tone={cheapTone(a.peVsAvg)} />
      </>
    );
  return (
    <>
      <MsMetric label="MKT CAP" value={fmtMoney(a.mktCap, 0)} />
      <MsMetric label="YTD" value={sP(a.perfYtd)} tone={signTone(a.perfYtd)} />
      <MsMetric label="QTD" value={sP(a.perfQtd)} tone={signTone(a.perfQtd)} />
    </>
  );
}

// Shared Aggregate / Compounders segmented control (wired to the app-wide
// CompoundersContext, same as the desktop sidebar toggle).
function CompoundersSeg() {
  const { on, set } = useCompounders();
  return (
    <div className="ms-seg" role="tablist" aria-label="Aggregate or compounders">
      <button
        type="button"
        role="tab"
        aria-selected={!on}
        className={!on ? "on" : ""}
        onClick={() => set(false)}
      >
        Aggregate
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={on}
        className={on ? "on" : ""}
        onClick={() => set(true)}
      >
        Compounders
      </button>
    </div>
  );
}

export function SpxMobile({
  asOf,
  groups,
  totalCompounders,
  totalStocks,
  labels,
  sections,
  peTable,
}: {
  asOf: string;
  groups: MsGroup[];
  totalCompounders: number;
  totalStocks: number;
  labels: MsLabels;
  // Full-table props per non-P/E section id, built by the server page.
  sections: Record<string, MsTableProps>;
  peTable: { data: NtmPeTableData; altData?: NtmPeTableData };
}) {
  const [section, setSection] = useState("performance");
  const [drill, setDrill] = useState<MsCategory | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  const { on: compoundersOnly } = useCompounders();
  const meta = SPX_SECTIONS.find((s) => s.id === section) ?? SPX_SECTIONS[0];
  const catCount = groups.reduce((a, g) => a + g.categories.length, 0);

  // Same behavior as the Sheet primitive: freeze the page behind the
  // full-table overlay and let Escape close it.
  useEffect(() => {
    if (!fullOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullOpen]);

  // The drill-down metrics follow the toggle when a compounder roll-up exists.
  const drillAgg = drill ? (compoundersOnly && drill.comp ? drill.comp : drill.agg) : null;
  const drillStocks = drill
    ? compoundersOnly
      ? drill.stocks.filter((s) => s.isCompounder)
      : drill.stocks
    : [];

  return (
    <div className="ms-mobile">
      <p className="ms-intro">
        AI beneficiary &amp; software tracker ·{" "}
        <span className="mono">{compoundersOnly ? totalCompounders : totalStocks}</span>{" "}
        {compoundersOnly ? "compounders" : "names"} · Bloomberg {asOf}
      </p>

      {/* Section chips (horizontal scroll) — the SPX_SECTIONS, same ids. */}
      <div className="ms-chips" role="tablist" aria-label="Sections">
        {SPX_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={cx("ms-chip", section === s.id && "on")}
            onClick={() => setSection(s.id)}
          >
            <span className="ms-chip-num mono">{s.num}</span>
            {s.title}
          </button>
        ))}
      </div>

      {/* Aggregate/Compounders toggle + the landscape full-table button. */}
      <div className="ms-toggle-row">
        <CompoundersSeg />
        <button type="button" className="me-full-btn" onClick={() => setFullOpen(true)}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M7 9v6M17 9v6" />
          </svg>
          Full
        </button>
      </div>

      <div className="ms-head">
        <span className="ms-head-num mono">{meta.num}</span>
        <h2 className="ms-head-title">{meta.title}</h2>
        {meta.note && <span className="ms-head-note mono">{meta.note}</span>}
      </div>

      {/* Category cards, grouped by nav group. */}
      {groups.map((g) => (
        <div key={g.group} className="me-group">
          <div className="me-group-head mono">
            <span>{g.group.toUpperCase()}</span>
            <span className="me-group-count">{g.categories.length}</span>
          </div>
          {g.categories.map((c) => {
            const a = compoundersOnly && c.comp ? c.comp : c.agg;
            return (
              <button
                key={c.slug}
                type="button"
                className="ms-card"
                onClick={() => setDrill(c)}
              >
                <span className="ms-card-top">
                  <span className="ms-card-label">{c.label}</span>
                  <span className="ms-pill mono">
                    {compoundersOnly ? c.compounderCount : c.count}
                  </span>
                </span>
                <span className="me-card-metrics">{cardMetrics(a, section, labels)}</span>
                {section === "pe" && (
                  <span className="ms-spark">
                    <span className="ms-spark-cap mono">P/E SINCE &apos;20</span>
                    <Sparkline values={a?.peSeries ?? []} width={150} height={26} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <p className="me-src mono">TOTALS RECONCILE TO S&amp;P 500 · {totalStocks} NAMES</p>

      {/* Drill-down sheet: category metrics + member-stock list. */}
      <Sheet
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={drill?.label}
        footer={
          drill && (
            <Link
              href={`/category/${drill.slug}`}
              className="ms-cat-link"
              onClick={() => setDrill(null)}
            >
              Open full category →
            </Link>
          )
        }
      >
        {drill && (
          <>
            <p className="ms-drill-sub">
              <span className="mono">{drill.count} stocks</span> ·{" "}
              {drill.compounderCount} compounders
            </p>
            <div className="me-card-metrics ms-drill-metrics">
              <MsMetric label="MKT CAP" value={fmtMoney(drillAgg?.mktCap ?? null, 0)} />
              <MsMetric label="NTM P/E" value={fmtNum(drillAgg?.ntmPe ?? null, 1)} />
              <MsMetric
                label="YTD"
                value={sP(drillAgg?.perfYtd ?? null)}
                tone={signTone(drillAgg?.perfYtd ?? null)}
              />
            </div>
            <div className="ms-members-head mono">MEMBERS</div>
            {drillStocks.length === 0 && (
              <p className="ms-drill-sub">No compounders in this category.</p>
            )}
            {drillStocks.map((s) => (
              <div key={s.ticker} className="ms-member">
                <span className="ms-member-tk">
                  {s.ticker}
                  {s.isCompounder && (
                    <span className="badge-c" title="Compounder">
                      C
                    </span>
                  )}
                </span>
                <span className="ms-member-pe mono">{fmtNum(s.pe, 1)}x</span>
                <span
                  className="ms-member-ytd mono"
                  style={{ color: signTone(s.ytd) }}
                >
                  {sP(s.ytd)}
                </span>
              </div>
            ))}
          </>
        )}
      </Sheet>

      {/* Full-table overlay: the exact desktop table (heatmaps, sorting,
          grouping) full-screen, frozen first column + sticky headers. */}
      {fullOpen && (
        <div className="me-full" role="dialog" aria-modal="true" aria-label="Full table">
          <div className="me-full-head">
            <div className="me-full-title">
              <span>SPX · {meta.title}</span>
              <span className="me-full-sub mono">
                {catCount} CATEGORIES · {compoundersOnly ? "COMPOUNDERS" : "AGGREGATE"}
              </span>
            </div>
            <button
              type="button"
              className="me-full-close"
              onClick={() => setFullOpen(false)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Close
            </button>
          </div>
          <div className="me-full-scroll ms-full-scroll">
            {section === "pe" ? (
              <NtmPeTable data={peTable.data} altData={peTable.altData} />
            ) : (
              <DataTable
                columns={sections[section].columns}
                rows={sections[section].rows}
                altRows={sections[section].altRows}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Top-bar Filter action: a "Browse categories" sheet with the same toggle and
// the jump-to-category list (replaces the desktop rail's SPX·Categories
// section). Self-contained so the server DashboardFrame can just slot it in.
export function SpxFilterButton({ nav }: { nav: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const { on: compoundersOnly } = useCompounders();
  return (
    <>
      <button
        type="button"
        className="ms-filter-btn"
        onClick={() => setOpen(true)}
        aria-label="Browse categories"
        title="Browse categories"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
        </svg>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Browse categories">
        <CompoundersSeg />
        {nav.map((g) => (
          <div key={g.group}>
            <div className="ms-browse-group mono">{g.group.toUpperCase()}</div>
            {g.items.map((item) => (
              <Link
                key={item.slug}
                href={`/category/${item.slug}`}
                className="ms-browse-item"
                onClick={() => setOpen(false)}
              >
                <span>{item.label}</span>
                <span className="mono">
                  {compoundersOnly ? item.compounderCount : item.count} →
                </span>
              </Link>
            ))}
          </div>
        ))}
      </Sheet>
    </>
  );
}
