"use client";

// Equities Dashboard — the team's Excel "Detailed Dashboard" Summary tab,
// live. Model inputs are shared via Supabase; prices come from Yahoo; every
// valuation/IRR column is recomputed on the fly (lib/equities/calc.ts), so
// an analyst edit updates the whole row for everyone immediately.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { ModelGrid } from "@/components/ModelGrid";
import { compute, Decomp, Derived, displayYears } from "@/lib/equities/calc";
import { ANALYSTS } from "@/lib/equities/config";
import { Company, EditRecord, Quote, YearMap } from "@/lib/equities/types";
import { fieldLabel, fmtEditValue } from "@/lib/equities/editLog";
import { logoCandidates } from "@/lib/diligence";
import { NO_SORT, nextSort, SortState, sortRows } from "@/lib/sort";
import { SortGlyph } from "@/components/SortGlyph";

const ANALYST_KEY = "equities:analyst";

// ---- formatting ------------------------------------------------------------ //

const na = <span className="eq-na">n/a</span>;

function fx(v: number | null | undefined): React.ReactNode {
  return v == null ? na : `${v.toFixed(1)}x`;
}
function fp(v: number | null | undefined): React.ReactNode {
  return v == null ? na : `${(v * 100).toFixed(1)}%`;
}
function fpx(v: number | null | undefined, ccy: string): React.ReactNode {
  if (v == null) return na;
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: v >= 1000 ? 0 : 2,
    maximumFractionDigits: v >= 1000 ? 0 : 2,
  });
  return `${ccy}${s}`;
}

// ---- heatmaps (Excel-style 3-color scales) --------------------------------- //

type RGB = [number, number, number];
const RED: RGB = [248, 105, 107];
const YELLOW: RGB = [255, 235, 132];
const GREEN: RGB = [99, 190, 123];
const WHITE: RGB = [255, 255, 255];

function mix(a: RGB, b: RGB, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function scale3(v: number, lo: number, mid: number, hi: number, c: [RGB, RGB, RGB]): string {
  if (v <= mid) return mix(c[0], c[1], mid === lo ? 1 : (v - lo) / (mid - lo));
  return mix(c[1], c[2], hi === mid ? 0 : (v - mid) / (hi - mid));
}

function stats(values: (number | null)[]): { lo: number; mid: number; hi: number } | null {
  const xs = values.filter((v): v is number => v != null && isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  return { lo: xs[0], mid: xs[Math.floor(xs.length / 2)], hi: xs[xs.length - 1] };
}

// ---- component -------------------------------------------------------------- //

export function EquitiesApp({ initial }: { initial: Company[] }) {
  const [companies, setCompanies] = useState<Company[]>(initial);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [dataDate, setDataDate] = useState<string | null>(null);
  const [view, setView] = useState<"val" | "decomp" | "signal" | "focus">("val");
  const [focusTicker, setFocusTicker] = useState<string | null>(null);
  const [editTicker, setEditTicker] = useState<string | null>(null);
  const [logTicker, setLogTicker] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [allLogOpen, setAllLogOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(NO_SORT);

  const today = useMemo(() => new Date(), []);
  const years = useMemo(() => displayYears(today), [today]);
  const [y0, y1, y2, y3] = years;

  const load = useCallback(async (refresh: boolean) => {
    const res = await fetch(`/api/equities${refresh ? "?refresh=1" : ""}`);
    const d = await res.json();
    if (Array.isArray(d?.companies)) setCompanies(d.companies);
    if (d?.quotes) setQuotes(d.quotes);
    setEnabled(!!d?.enabled);
    setAsOf(d?.prices_as_of ?? null);
    setDataDate(d?.prices_data_date ?? null);
  }, []);

  useEffect(() => {
    load(false).catch(() => setEnabled(false));
  }, [load]);

  const derived = useMemo(() => {
    const map = new Map<string, Derived>();
    for (const c of companies) {
      const q = c.yahoo ? quotes[c.yahoo] : undefined;
      map.set(c.ticker, compute(c, q?.price ?? null, today));
    }
    return map;
  }, [companies, quotes, today]);

  const perfOf = useCallback(
    (c: Company) => {
      const q = c.yahoo ? quotes[c.yahoo] : undefined;
      return {
        m1: q?.m1 ?? c.perf.m1,
        m3: q?.m3 ?? c.perf.m3,
        m6: q?.m6 ?? c.perf.m6,
      };
    },
    [quotes],
  );

  const groups = useMemo(() => {
    const order: string[] = [];
    const by: Record<string, Company[]> = {};
    for (const c of companies) {
      if (c.is_index || c.removed) continue;
      if (!by[c.grp]) {
        by[c.grp] = [];
        order.push(c.grp);
      }
      by[c.grp].push(c);
    }
    return order.map((g) => [g, by[g]] as const);
  }, [companies]);

  const indexRows = useMemo(
    () => companies.filter((c) => c.is_index && !c.removed),
    [companies],
  );
  const stocks = useMemo(
    () => companies.filter((c) => !c.is_index && !c.removed),
    [companies],
  );
  const removedNames = useMemo(
    () => companies.filter((c) => c.removed && !c.is_index),
    [companies],
  );

  // Which feed(s) the displayed prices came from (Bloomberg push vs Yahoo).
  const priceSource = useMemo(() => {
    const s = new Set<string>();
    for (const q of Object.values(quotes)) if (q.source) s.add(q.source);
    return s.size ? Array.from(s).sort().join(" + ") : "Yahoo Finance";
  }, [quotes]);

  // Column-wide color scales, computed across all (non-index) names.
  const peStats = useMemo(
    () => stats(stocks.map((c) => derived.get(c.ticker)?.mendoPe[y1] ?? null)),
    [stocks, derived, y1],
  );
  const irrStats = useMemo(
    () => stats(stocks.map((c) => derived.get(c.ticker)?.irr[y2] ?? null)),
    [stocks, derived, y2],
  );
  const heatPe = (v: number | null) =>
    v != null && peStats ? scale3(v, peStats.lo, peStats.mid, peStats.hi, [GREEN, YELLOW, RED]) : undefined;
  const heatIrr = (v: number | null) =>
    v != null && irrStats ? scale3(v, irrStats.lo, irrStats.mid, irrStats.hi, [YELLOW, YELLOW, GREEN]) : undefined;
  // Return column on the IRR-decomp tab: same green scale as the Summary IRR,
  // computed over the decomp totals so the heat tracks what the column shows.
  const retStats = useMemo(
    () => stats(stocks.map((c) => derived.get(c.ticker)?.decomp.ret ?? null)),
    [stocks, derived],
  );
  const heatRet = (v: number | null) =>
    v != null && retStats ? scale3(v, retStats.lo, retStats.mid, retStats.hi, [YELLOW, YELLOW, GREEN]) : undefined;
  const heatPerf = (v: number | null) =>
    v == null ? undefined : scale3(v, -0.3, 0, 0.3, [RED, WHITE, GREEN]);

  // Click-to-sort across every column (lib/sort: desc → asc → unsorted).
  // While a sort is active the sector grouping is flattened so names compare
  // across the whole book; clearing the sort restores the grouped layout.
  const sortValue = useCallback(
    (c: Company, key: string): number | string | null => {
      const d = derived.get(c.ticker);
      const [head, arg] = key.split(":");
      switch (head) {
        case "ticker":
          return c.ticker;
        case "px":
          return d?.price ?? null;
        case "evgp":
          return d?.evGp[Number(arg)] ?? null;
        case "pe":
          return d?.mendoPe[Number(arg)] ?? null;
        case "mult":
          return c.model.target_mult[arg] ?? null;
        case "irr":
          return d?.irr[Number(arg)] ?? null;
        case "mom":
          return d?.mom[Number(arg)] ?? null;
        case "perf":
          return perfOf(c)[arg as "m1" | "m3" | "m6"];
        case "dec":
          return d?.decomp[arg as keyof Decomp] ?? null;
        case "gpcagr":
          return d?.gpCagr ?? null;
        case "mepscagr":
          return d?.mepsCagr ?? null;
      }
      return null;
    },
    [derived, perfOf],
  );
  const sortedStocks = useMemo(
    () => (sort.key ? sortRows(stocks, sort, sortValue) : null),
    [stocks, sort, sortValue],
  );

  const sortTh = (key: string, label: React.ReactNode, extra = "") => (
    <th
      key={key}
      className={`eq-num eq-sortable${extra}`}
      onClick={() => setSort((s) => nextSort(s, key))}
      title="Click to sort"
    >
      {label}
      <SortGlyph sort={sort} sortKey={key} />
    </th>
  );

  const valRow = (c: Company) => {
    const d = derived.get(c.ticker)!;
    const pf = perfOf(c);
    return (
      <tr key={c.ticker} className="eq-row">
        {tickCell(c)}
        {num(fpx(d.price, c.currency), undefined, "px")}
        {[y0, y1].map((y, i) => num(fx(d.evGp[y]), undefined, `g${i}`))}
        {years.map((y, i) =>
          num(fx(d.mendoPe[y]), y === y1 ? heatPe(d.mendoPe[y]) : undefined, `p${i}`),
        )}
        {[y1, y2, y3].map((y, i) =>
          num(fx(c.model.target_mult[String(y)] ?? null), undefined, `t${i}`),
        )}
        {[y1, y2, y3].map((y, i) =>
          num(fp(d.irr[y]), y === y2 ? heatIrr(d.irr[y]) : undefined, `i${i}`),
        )}
        {[y0, y1, y2, y3].map((y, i) => num(fx(d.mom[y]), undefined, `m${i}`))}
        {num(fp(pf.m1), heatPerf(pf.m1), "p1")}
        {num(fp(pf.m3), heatPerf(pf.m3), "p3")}
        {num(fp(pf.m6), heatPerf(pf.m6), "p6")}
      </tr>
    );
  };

  const decompRow = (c: Company) => {
    const d = derived.get(c.ticker)!;
    const dc = d.decomp;
    return (
      <tr key={c.ticker} className="eq-row">
        {tickCell(c)}
        {num(fpx(d.price, c.currency), undefined, "px")}
        {num(<span className="eq-blue">{fp(dc.revs)}</span>, undefined, "r")}
        {num(fp(dc.margin), undefined, "m")}
        {num(<span className="eq-blue">{fp(dc.ni)}</span>, undefined, "n")}
        {num(fp(dc.yld), undefined, "y")}
        {num(<span className="eq-blue">{fp(dc.epsDivs)}</span>, undefined, "e")}
        {num(fp(dc.multiple), undefined, "x")}
        {num(<b>{fp(dc.ret)}</b>, heatRet(dc.ret), "t", "eq-td-ret")}
        {num(fp(d.gpCagr), undefined, "cg")}
        {num(fp(d.mepsCagr), undefined, "ce")}
      </tr>
    );
  };

  const editing = editTicker ? companies.find((c) => c.ticker === editTicker) ?? null : null;

  const onSaved = useCallback((c: Company) => {
    setCompanies((prev) => prev.map((x) => (x.ticker === c.ticker ? c : x)));
  }, []);
  const onAdded = useCallback((c: Company) => {
    setCompanies((prev) =>
      prev.some((x) => x.ticker === c.ticker)
        ? prev.map((x) => (x.ticker === c.ticker ? c : x)) // re-added → restored
        : [...prev, c],
    );
    setAddOpen(false);
    setEditTicker(c.ticker); // jump straight into filling the model
  }, []);
  const onRemoved = useCallback((ticker: string) => {
    // Soft delete: the name moves to the "Removed names" list, model intact.
    setCompanies((prev) =>
      prev.map((x) => (x.ticker === ticker ? { ...x, removed: true } : x)),
    );
    setEditTicker(null);
  }, []);
  const onRestored = useCallback((ticker: string) => {
    setCompanies((prev) =>
      prev.map((x) => (x.ticker === ticker ? { ...x, removed: false } : x)),
    );
  }, []);

  const tickCell = (c: Company) => (
    <th
      scope="row"
      className={`eq-tick${c.port === 1 ? " eq-tick-own" : ""}`}
      title={
        c.update_date
          ? `Model updated ${c.update_date}${c.update_by ? ` by ${c.update_by}` : ""}`
          : undefined
      }
    >
      <span className="eq-tick-name">{c.ticker}</span>
      {!c.is_index && (
        <span className="eq-btns">
          <button
            type="button"
            className="eq-actbtn"
            onClick={() => setEditTicker(c.ticker)}
            title={`Edit the ${c.ticker} model`}
            aria-label={`Edit the ${c.ticker} model`}
          >
            ✎
          </button>
          <button
            type="button"
            className="eq-actbtn"
            onClick={() => setLogTicker(c.ticker)}
            title={`View ${c.ticker} edit history`}
            aria-label={`View ${c.ticker} edit history`}
          >
            ↺
          </button>
        </span>
      )}
      {c.is_index && (
        <span className="eq-btns">
          <button
            type="button"
            className="eq-actbtn"
            onClick={() => setEditTicker(c.ticker)}
            title="Edit index P/E"
            aria-label="Edit index P/E"
          >
            ✎
          </button>
        </span>
      )}
    </th>
  );

  const num = (v: React.ReactNode, bg?: string, key?: string | number, cls?: string) => (
    <td
      key={key}
      className={`eq-num${cls ? ` ${cls}` : ""}`}
      style={bg ? { background: bg } : undefined}
    >
      {v}
    </td>
  );

  // ---- Signal / Focus shared geometry ------------------------------------ //
  // The IRR horizon used by the bullet bars + the IRR-sorted master list is
  // YE+2 (y2) — the same horizon the heatmap and the decomposition use.
  const irrVals = stocks
    .map((c) => derived.get(c.ticker)?.irr[y2])
    .filter((v): v is number => v != null && isFinite(v));
  const irrMax = irrVals.length ? Math.max(...irrVals, 0.0001) : 1;
  const irrMed = irrStats?.mid ?? 0;
  const irrMedW = Math.max(0, Math.min(100, (irrMed / irrMax) * 100));
  const pct0 = (v: number | null | undefined) =>
    v == null ? na : `${(v * 100).toFixed(0)}%`;
  const irrSorted = [...stocks].sort(
    (a, b) => (derived.get(b.ticker)?.irr[y2] ?? -1e9) - (derived.get(a.ticker)?.irr[y2] ?? -1e9),
  );
  // Focus tab lists portfolio holdings first, then everything else — each block
  // kept in IRR order. Array.prototype.sort is stable in modern engines, so
  // partitioning by `port` preserves the IRR ranking within each group.
  const focusSorted = [...irrSorted].sort(
    (a, b) => (a.port === 1 ? 0 : 1) - (b.port === 1 ? 0 : 1),
  );

  // Signal row: NTM P/E vs target (diverging), 3-yr IRR bullet vs book median,
  // MoM, and 1/3/6M perf as sparkbars. Fewer numerals, more glance value.
  const signalRow = (c: Company) => {
    const d = derived.get(c.ticker)!;
    const pe = d.mendoPe[y1];
    const tgt = c.model.target_mult[String(y1)] ?? null;
    const prem = pe != null && tgt ? pe / tgt - 1 : null;
    const premW = prem == null ? 0 : Math.min(46, Math.abs(prem) * 150);
    const irr = d.irr[y2];
    const irrW = irr == null ? 0 : Math.max(0, Math.min(100, (irr / irrMax) * 100));
    return (
      <tr key={c.ticker} className="eq-row">
        {tickCell(c)}
        {num(fpx(d.price, c.currency), undefined, "px")}
        <td className="eq-sep">
          <div className="eq-prem">
            <span className="eq-prem-val">{fx(pe)}</span>
            <span className="eq-prem-track">
              <span className="eq-prem-mid" />
              {prem != null && (
                <span
                  className="eq-prem-fill"
                  style={{
                    left: `${prem < 0 ? 50 - premW : 50}%`,
                    width: `${premW}%`,
                    background: prem < 0 ? "var(--green)" : "var(--red)",
                  }}
                />
              )}
            </span>
            <span
              className="eq-prem-tag"
              style={{ color: prem == null ? "var(--faint)" : prem < 0 ? "#15803d" : "#b91c1c" }}
            >
              {prem == null ? "—" : `${prem >= 0 ? "+" : "−"}${Math.abs(prem * 100).toFixed(0)}% tgt`}
            </span>
          </div>
        </td>
        <td className="eq-sep">
          <div className="eq-bullet-wrap">
            <span className="eq-bullet">
              <span className="eq-bullet-fill" style={{ width: `${irrW}%` }} />
              <span className="eq-bullet-tick" style={{ left: `${irrMedW}%` }} />
            </span>
            <span className="eq-bullet-val">{pct0(irr)}</span>
          </div>
        </td>
        {num(fx(d.mom[y2]), undefined, "mom")}
      </tr>
    );
  };

  // ---- Focus: detail panel for one name ---------------------------------- //
  const focusSel =
    (focusTicker && stocks.find((c) => c.ticker === focusTicker)) || focusSorted[0] || null;

  const subtitle = (
    <>
      Detailed dashboard ·{" "}
      <span className="mono">
        {stocks.length} {stocks.length === 1 ? "name" : "names"}
      </span>{" "}
      ·{" "}
      <span className="mono">
        {dataDate
          ? `prior close · ${new Date(`${dataDate}T12:00:00`).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}`
          : "prior close"}
      </span>
    </>
  );

  const actions = (
    <>
      <HowItWorks title="How the Equities Dashboard works">
        <p className="hiw-lead">
          The team&apos;s detailed dashboard, live — recomputed on the fly from
          shared model inputs and prior-day closing prices.
        </p>
        <ul className="hiw-list">
          <li>
            <b>Two screens</b> — <b>Summary</b> shows valuation, target
            multiples, IRRs, and momentum; <b>IRR Decomp</b> breaks the
            NTM–YE{String(y2).slice(2)} IRR into revenue, margin, yield, and
            multiple.
          </li>
          <li>
            <b>Edit model</b> — click <span className="mono">✎</span> on any row,
            pick your name, and update the model. You can paste a whole block
            straight from your Excel model. Changes are shared with the team
            instantly.
          </li>
          <li>
            <b>History</b> — every edit is logged per company; click{" "}
            <span className="mono">↺</span> on a row to see who changed what,
            when.
          </li>
          <li>
            <b>Sort</b> — click any column header to rank across the whole book;
            click again for ascending, then off.
          </li>
          <li>
            <b>Prices</b> — prior-day closes from a Bloomberg terminal push
            and/or Yahoo, refreshed automatically once a new close is
            available. <b>Export Excel</b> downloads a clean snapshot: a
            formatted Summary tab plus a tab logging every edit.
          </li>
          <li>
            <b>Activity log</b> — the <span className="mono">⌃</span> Activity
            button lists every change across the whole book, newest first.
          </li>
        </ul>
      </HowItWorks>
      <button type="button" className="btn" onClick={() => setAddOpen(true)}>
        <span className="glyph" aria-hidden="true">＋</span> Add
      </button>
      <button type="button" className="btn" onClick={() => setAllLogOpen(true)}>
        <span className="glyph" aria-hidden="true">↻</span> Activity log
      </button>
      <button type="button" className="btn" onClick={() => setRemovedOpen(true)}>
        Removed{removedNames.length ? ` (${removedNames.length})` : ""}
      </button>
      <a className="btn-primary" href="/api/equities/export">
        <span className="glyph" aria-hidden="true">↓</span> Export Excel
      </a>
    </>
  );

  return (
    <AppShell
      tool="Equities Dashboard"
      title="Equities Dashboard"
      subtitle={subtitle}
      actions={actions}
      footerLeft={`Equities Dashboard · ${stocks.length} names · ${stocks.filter((c) => c.port === 1).length} owned`}
    >
      <div className="eq-toolbar">
        <div className="eq-tabs" role="tablist">
          <button
            type="button"
            className={view === "val" ? "on" : ""}
            onClick={() => {
              setView("val");
              setSort(NO_SORT);
            }}
          >
            Summary
          </button>
          <button
            type="button"
            className={view === "decomp" ? "on" : ""}
            onClick={() => {
              setView("decomp");
              setSort(NO_SORT);
            }}
          >
            IRR Decomp
          </button>
          <button
            type="button"
            className={view === "signal" ? "on" : ""}
            onClick={() => {
              setView("signal");
              setSort(NO_SORT);
            }}
          >
            Signal
          </button>
          <button
            type="button"
            className={view === "focus" ? "on" : ""}
            onClick={() => {
              setView("focus");
              setSort(NO_SORT);
            }}
          >
            Focus
          </button>
        </div>
        <span className="eq-note">
          {dataDate || asOf ? (
            <>
              Prices as of{" "}
              {dataDate
                ? new Date(`${dataDate}T12:00:00`).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : new Date(asOf as string).toLocaleDateString()}{" "}
              (prior close) · {priceSource}
            </>
          ) : (
            "Loading prices…"
          )}
          {dataDate && Date.now() - Date.parse(`${dataDate}T00:00:00Z`) > 4 * 86_400_000 && (
            <strong className="eq-stale">
              {" "}
              · price feed stale — last available close shown
            </strong>
          )}
          {enabled === false && " · edits disabled (no shared database configured)"}
        </span>
      </div>

      {view === "signal" ? (
        <div className="eq-legend">
          <span className="eq-bullet-key" aria-hidden="true">
            <span className="eq-bullet-key-fill" />
            <span className="eq-bullet-key-tick" />
          </span>{" "}
          IRR (to YE+{String(y2).slice(2)}) vs dashboard median · green ticker = portfolio
        </div>
      ) : view === "focus" ? (
        <div className="eq-legend">
          <span className="eq-legend-swatch" aria-hidden="true" /> Pick a name on
          the left to open its valuation and IRR decomposition
        </div>
      ) : view === "val" ? (
        <div className="eq-legend">
          <span className="eq-legend-swatch" aria-hidden="true" /> Highlighted
          tickers (in green) indicate names in portfolio
        </div>
      ) : (
        <div className="eq-legend eq-legend-decomp">
          <b>IRR decomp is approximate:</b>
          <ol>
            <li>
              Revenue CAGR, Mendo NI, and Total Return calculated as exact CAGRs
              from models
            </li>
            <li>
              EPS + Divs = EPS CAGR (exact) + dividend yield (approximate over
              2027/2028)
            </li>
            <li>&ldquo;Margin&rdquo; = Mendo NI CAGR − Revs CAGR</li>
            <li>&ldquo;Yield&rdquo; = EPS CAGR + Divs Yield − Mendo NI CAGR</li>
            <li>
              &ldquo;Multiple&rdquo; = Total Return IRR − EPS CAGR + Divs Yield
            </li>
          </ol>
        </div>
      )}

      {view === "focus" ? (
        <FocusLayout
          stocks={focusSorted}
          selected={focusSel}
          onSelect={(t) => setFocusTicker(t)}
          derived={derived}
          perfOf={perfOf}
          years={years}
          irrMax={irrMax}
          onEdit={(t) => setEditTicker(t)}
          onHistory={(t) => setLogTicker(t)}
          fpx={fpx}
        />
      ) : (
      <div className="eq-wrap">
        {view === "signal" ? (
          <table className="eq-table eq-signal">
            <thead>
              <tr className="eq-h2">
                <th className="eq-tick">Company</th>
                <th className="eq-num">Px</th>
                <th className="eq-sep">NTM P/E vs target</th>
                <th className="eq-sep">IRR vs median</th>
                <th className="eq-num eq-sep">MoM</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([grp, rows]) => (
                <GroupRows key={grp} label={grp} span={5}>
                  {rows.map(signalRow)}
                </GroupRows>
              ))}
            </tbody>
          </table>
        ) : view === "val" ? (
          <table className="eq-table">
            <thead>
              <tr className="eq-h1">
                <th className="eq-tick" />
                <th />
                <th colSpan={2} className="eq-sep">
                  EV / GP
                </th>
                <th colSpan={5} className="eq-sep">
                  Mendo P/E
                </th>
                <th colSpan={3} className="eq-sep">
                  Target Mult (GP or P/E)
                </th>
                <th colSpan={3} className="eq-sep">
                  IRR
                </th>
                <th colSpan={4} className="eq-sep">
                  MoM
                </th>
                <th colSpan={3} className="eq-sep">
                  Recent Performance
                </th>
              </tr>
              <tr className="eq-h2">
                <th
                  className="eq-tick eq-sortable"
                  onClick={() => setSort((s) => nextSort(s, "ticker"))}
                  title="Click to sort"
                >
                  Company
                  <SortGlyph sort={sort} sortKey="ticker" />
                </th>
                {sortTh("px", "Px")}
                {[y0, y1].map((y, i) => sortTh(`evgp:${y}`, y, i === 0 ? " eq-sep" : ""))}
                {years.map((y, i) => sortTh(`pe:${y}`, y, i === 0 ? " eq-sep" : ""))}
                {[y1, y2, y3].map((y, i) => sortTh(`mult:${y}`, y, i === 0 ? " eq-sep" : ""))}
                {[y1, y2, y3].map((y, i) => sortTh(`irr:${y}`, y, i === 0 ? " eq-sep" : ""))}
                {[y0, y1, y2, y3].map((y, i) => sortTh(`mom:${y}`, y, i === 0 ? " eq-sep" : ""))}
                {(["m1", "m3", "m6"] as const).map((k, i) =>
                  sortTh(`perf:${k}`, k.slice(1) + "M", i === 0 ? " eq-sep" : ""),
                )}
              </tr>
            </thead>
            <tbody>
              {sortedStocks ? (
                <GroupRows label="All names (sorted)" span={21}>
                  {sortedStocks.map(valRow)}
                </GroupRows>
              ) : (
                groups.map(([grp, rows]) => (
                  <GroupRows key={grp} label={grp} span={21}>
                    {rows.map(valRow)}
                  </GroupRows>
                ))
              )}
              {indexRows.length > 0 && (
                <GroupRows label="Index" span={21}>
                  {indexRows.map((c) => {
                    const d = derived.get(c.ticker)!;
                    const pf = perfOf(c);
                    return (
                      <tr key={c.ticker} className="eq-row">
                        {tickCell(c)}
                        {num(fpx(d.price, c.currency), undefined, "px")}
                        {num(null, undefined, "g0")}
                        {num(null, undefined, "g1")}
                        {years.map((y, i) =>
                          num(
                            c.best_pe?.[String(y)] != null ? fx(c.best_pe[String(y)]) : "",
                            undefined,
                            `p${i}`,
                          ),
                        )}
                        {Array.from({ length: 10 }, (_, i) => num(null, undefined, i))}
                        {num(fp(pf.m1), heatPerf(pf.m1), "p1")}
                        {num(fp(pf.m3), heatPerf(pf.m3), "p3")}
                        {num(fp(pf.m6), heatPerf(pf.m6), "p6")}
                      </tr>
                    );
                  })}
                </GroupRows>
              )}
            </tbody>
          </table>
        ) : (
          <table className="eq-table eq-decomp">
            <thead>
              <tr className="eq-h1">
                <th className="eq-tick" />
                <th />
                <th colSpan={7} className="eq-sep">
                  NTM – YE{String(y2).slice(2)} IRR Decomp
                </th>
                <th colSpan={2} className="eq-sep">
                  ’{String(y0).slice(2)}–’{String(y3).slice(2)} CAGR
                </th>
              </tr>
              <tr className="eq-h2">
                <th
                  className="eq-tick eq-sortable"
                  onClick={() => setSort((s) => nextSort(s, "ticker"))}
                  title="Click to sort"
                >
                  Company
                  <SortGlyph sort={sort} sortKey="ticker" />
                </th>
                {sortTh("px", "Px")}
                {(
                  [
                    ["revs", "Revs"],
                    ["margin", "Margin"],
                    ["ni", "Mendo NI"],
                    ["yld", "Yield"],
                    ["epsDivs", "EPS + Divs"],
                    ["multiple", "Multiple"],
                    ["ret", "Return"],
                  ] as const
                ).map(([k, l], i) =>
                  sortTh(
                    `dec:${k}`,
                    l,
                    (i === 0 ? " eq-sep" : "") + (k === "ret" ? " eq-th-ret" : ""),
                  ),
                )}
                {sortTh("gpcagr", "GP", " eq-sep")}
                {sortTh("mepscagr", "mEPS")}
              </tr>
            </thead>
            <tbody>
              {sortedStocks ? (
                <GroupRows label="All names (sorted)" span={11}>
                  {sortedStocks.map(decompRow)}
                </GroupRows>
              ) : (
                groups.map(([grp, rows]) => (
                  <GroupRows key={grp} label={grp} span={11}>
                    {rows.map(decompRow)}
                  </GroupRows>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      )}

      <p className="eq-foot-note">
        {enabled
          ? "Model edits are shared with the team and logged per company."
          : enabled === false
            ? "Read-only: showing the committed workbook snapshot."
            : ""}
      </p>

      {editing && (
        <EditModal
          company={editing}
          years={years}
          onClose={() => setEditTicker(null)}
          onSaved={onSaved}
          onRemoved={onRemoved}
          groups={groups.map(([g]) => g)}
        />
      )}
      {logTicker && <LogModal ticker={logTicker} onClose={() => setLogTicker(null)} />}
      {allLogOpen && <AllLogModal onClose={() => setAllLogOpen(false)} />}
      {removedOpen && (
        <RemovedModal
          companies={removedNames}
          onClose={() => setRemovedOpen(false)}
          onRestored={onRestored}
        />
      )}
      {addOpen && (
        <AddModal
          groups={groups.map(([g]) => g)}
          onClose={() => setAddOpen(false)}
          onAdded={onAdded}
        />
      )}
    </AppShell>
  );
}

// ---- Focus view (C · click-through detail) -------------------------------- //

const MONO_PALETTE = [
  "#1f2937", "#3730e6", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0e7490", "#4d7c0f",
];
function monoColor(ticker: string): string {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  return MONO_PALETTE[h % MONO_PALETTE.length];
}
const fFp = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);

// The Focus header logo: the real company mark, resolved through the shared
// logoCandidates() cascade (same as the Diligence Tracker and Morning Notes) —
// a domain-keyed source first for symbols the CDN gets wrong, then the symbol
// CDN. Falls back to a monogram only after every source fails, so a blocked or
// missing image never leaves a broken icon.
function FocusLogo({ ticker }: { ticker: string }) {
  const candidates = logoCandidates(ticker);
  const [idx, setIdx] = useState(0);
  if (idx >= candidates.length) {
    return (
      <span className="monotile eq-focus-tile" style={{ background: monoColor(ticker) }}>
        {ticker.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="eq-focus-tile eq-focus-logo"
      src={candidates[idx]}
      alt={`${ticker} logo`}
      width={44}
      height={44}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

// Standard finance waterfall for the IRR decomposition (Focus tab). Pure SVG —
// no chart library. Geometry follows the approved design: floats for the three
// operating components, full bars for the Operating IRR subtotal and the total,
// dashed running-level connectors between neighbours.
const WF_NAVY = "#23306b";
const WF_INC = "#5cab78";
const WF_DEC = "#d76b6b";

function DecompWaterfall({ dc, yEnd }: { dc: Decomp; yEnd: number }) {
  const { revs, margin, yld, multiple, ret } = dc;
  if (revs == null || margin == null || yld == null || multiple == null || ret == null) {
    return (
      <p className="eq-note">
        IRR decomposition unavailable for this name (incomplete model).
      </p>
    );
  }

  const opIrr = revs + margin + yld;
  type Kind = "inc" | "dec" | "sub" | "total";
  const bars: { l: string; s: number; e: number; v: number; kind: Kind }[] = [
    { l: "Revenue Growth", s: 0, e: revs, v: revs, kind: revs >= 0 ? "inc" : "dec" },
    { l: "Margin Expansion", s: revs, e: revs + margin, v: margin, kind: margin >= 0 ? "inc" : "dec" },
    { l: "Yield", s: revs + margin, e: opIrr, v: yld, kind: yld >= 0 ? "inc" : "dec" },
    { l: "Operating IRR", s: 0, e: opIrr, v: opIrr, kind: "sub" },
    { l: "Multiple Change", s: opIrr, e: opIrr + multiple, v: multiple, kind: multiple >= 0 ? "inc" : "dec" },
    { l: `Total IRR · ${String(yEnd).slice(2)}E`, s: 0, e: ret, v: ret, kind: "total" },
  ];

  // Axis: 0 → peak running level × 1.18, rounded up to the next 5%; extends
  // below zero only if a running level actually dips negative.
  const peak = Math.max(...bars.map((b) => Math.max(b.s, b.e)), 0.0001);
  const axisMax = Math.max(0.05, Math.ceil((peak * 1.18) / 0.05) * 0.05);
  const low = Math.min(...bars.map((b) => Math.min(b.s, b.e)), 0);
  const axisMin = low < 0 ? Math.floor((low * 1.18) / 0.05) * 0.05 : 0;

  const W = 920;
  const H = 300;
  const padL = 40;
  const padR = 14;
  const padT = 20;
  const plotB = 232;
  const plotH = plotB - padT;
  const span = axisMax - axisMin;
  const n = bars.length;
  const colW = (W - padL - padR) / n;
  const center = (i: number) => padL + colW * (i + 0.5);
  const barW = Math.min(62, colW * 0.5);
  const yOf = (v: number) => plotB - ((v - axisMin) / span) * plotH;
  const colorOf = (k: Kind) =>
    k === "sub" || k === "total" ? WF_NAVY : k === "inc" ? WF_INC : WF_DEC;
  const valTxt = (b: { v: number; kind: Kind }) =>
    b.kind === "dec"
      ? `(${(Math.abs(b.v) * 100).toFixed(1)}%)`
      : `${(b.v * 100).toFixed(1)}%`;

  const grid: React.ReactNode[] = [];
  for (let g = axisMin; g <= axisMax + 1e-9; g += 0.05) {
    const gy = yOf(g);
    const zero = Math.abs(g) < 1e-9;
    grid.push(
      <line
        key={`gl${g.toFixed(2)}`}
        x1={padL}
        y1={gy}
        x2={W - padR}
        y2={gy}
        stroke="#ededf3"
        strokeWidth={1}
        strokeDasharray={zero ? undefined : "3 3"}
      />,
      <text
        key={`ga${g.toFixed(2)}`}
        x={padL - 6}
        y={gy + 3}
        textAnchor="end"
        fontSize={9.5}
        fontFamily="var(--font-mono, 'JetBrains Mono', monospace)"
        fill="var(--faint)"
      >
        {(g * 100).toFixed(0)}%
      </text>,
    );
  }

  return (
    <svg
      className="eq-wf"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="IRR decomposition waterfall"
    >
      {grid}
      {bars.slice(0, -1).map((b, i) => {
        const ly = yOf(b.e);
        return (
          <line
            key={`cn${i}`}
            x1={center(i) + barW / 2}
            y1={ly}
            x2={center(i + 1) - barW / 2}
            y2={ly}
            stroke="#c7c7d4"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}
      {bars.map((b, i) => {
        const top = Math.max(b.s, b.e);
        const bot = Math.min(b.s, b.e);
        const by = yOf(top);
        const bh = Math.max(1.5, ((top - bot) / span) * plotH);
        const fill = colorOf(b.kind);
        const emph = b.kind === "sub" || b.kind === "total";
        // Wrap the category label to two lines on the space nearest the middle.
        const words = b.l.split(" ");
        const lines =
          words.length > 1
            ? [
                words.slice(0, Math.ceil(words.length / 2)).join(" "),
                words.slice(Math.ceil(words.length / 2)).join(" "),
              ]
            : [b.l];
        return (
          <g key={`b${i}`}>
            <rect x={center(i) - barW / 2} y={by} width={barW} height={bh} rx={2} fill={fill} />
            <text
              x={center(i)}
              y={by - 6}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fontFamily="var(--font-mono, 'JetBrains Mono', monospace)"
              fill={b.kind === "dec" ? "#b91c1c" : b.kind === "inc" ? "#15803d" : WF_NAVY}
            >
              {valTxt(b)}
            </text>
            {lines.map((ln, li) => (
              <text
                key={li}
                x={center(i)}
                y={plotB + 16 + li * 12}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={emph ? 700 : 500}
                fill={emph ? "var(--ink-2, #3a3a45)" : "var(--muted)"}
              >
                {ln}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function FocusLayout({
  stocks,
  selected,
  onSelect,
  derived,
  perfOf,
  years,
  irrMax,
  onEdit,
  onHistory,
  fpx,
}: {
  stocks: Company[];
  selected: Company | null;
  onSelect: (ticker: string) => void;
  derived: Map<string, Derived>;
  perfOf: (c: Company) => { m1: number | null; m3: number | null; m6: number | null };
  years: number[];
  irrMax: number;
  onEdit: (ticker: string) => void;
  onHistory: (ticker: string) => void;
  fpx: (v: number | null | undefined, ccy: string) => React.ReactNode;
}) {
  const [y0, y1, y2, y3] = years;
  const d = selected ? derived.get(selected.ticker) ?? null : null;
  const dc = d?.decomp;
  const yr = (y: number) => String(y).slice(2);
  const mv = (
    key: "revs" | "gm" | "adj_eps" | "mendo_eps" | "target_mult",
    y: number,
  ): number | null => {
    const m = selected?.model[key] as YearMap | undefined;
    const v = m?.[String(y)];
    return v == null ? null : v;
  };
  // YoY growth into `y` for a model series (needs the prior year's value),
  // read straight from the model the same way the grid does.
  const grow = (key: "revs" | "adj_eps" | "mendo_eps", y: number) => {
    const prev = mv(key, y - 1);
    const cur = mv(key, y);
    return prev != null && cur != null && prev !== 0 ? cur / prev - 1 : null;
  };
  // Model-snapshot cell formatters: grouped $M, 1-dp %, 2-dp per-share, 1-dp ×.
  const sM = (v: number | null) =>
    v == null ? "—" : Math.round(v).toLocaleString("en-US");
  const sP = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const sE = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const sX = (v: number | null) => (v == null ? "—" : v.toFixed(1));

  return (
    <div className="eq-focus">
      <div className="eq-focus-list">
        <div className="eq-focus-list-head">Names · portfolio first</div>
        {stocks.map((c) => {
          const dr = derived.get(c.ticker);
          const irr = dr?.irr[y2] ?? null;
          const w = irr == null ? 0 : Math.max(0, Math.min(100, (irr / irrMax) * 100));
          const active = selected?.ticker === c.ticker;
          return (
            <button
              type="button"
              key={c.ticker}
              className={`eq-focus-item${active ? " eq-focus-item-on" : ""}`}
              onClick={() => onSelect(c.ticker)}
            >
              <span className="eq-focus-item-main">
                <span className="eq-focus-item-top">
                  <span className={`eq-focus-tk${c.port === 1 ? " eq-focus-tk-own" : ""}`}>
                    {c.ticker}
                  </span>
                  <span className="eq-focus-grp">{c.grp}</span>
                </span>
                <span className="eq-focus-bar">
                  <span
                    className="eq-focus-bar-fill"
                    style={{ width: `${w}%`, background: active ? "var(--brand)" : "#c4c4df" }}
                  />
                </span>
              </span>
              <span className="eq-focus-irr">{fFp(irr)}</span>
            </button>
          );
        })}
      </div>

      <div className="eq-focus-detail">
        {!selected || !d ? (
          <p className="eq-note">Select a name to see its detail.</p>
        ) : (
          <>
            <div className="eq-focus-detail-head">
              <div className="eq-focus-id">
                <FocusLogo ticker={selected.ticker} />
                <div>
                  <div className="eq-focus-name-row">
                    <span className="eq-focus-name">{selected.ticker}</span>
                    {selected.port === 1 && (
                      <span className="eq-focus-tag">PORTFOLIO</span>
                    )}
                  </div>
                  <div className="eq-focus-sub">{selected.grp}</div>
                </div>
              </div>
              <div className="eq-focus-actions">
                <div className="eq-focus-btns">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onEdit(selected.ticker)}
                  >
                    <span className="glyph" aria-hidden="true">✎</span> Edit model
                  </button>
                  <button type="button" className="btn" onClick={() => onHistory(selected.ticker)}>
                    <span className="glyph" aria-hidden="true">↺</span> History
                  </button>
                </div>
                <div className="eq-focus-px">
                  <div className="eq-focus-px-val">{fpx(d.price, selected.currency)}</div>
                  {perfOf(selected).m3 != null && (
                    <div
                      className="eq-focus-px-chg"
                      style={{ color: (perfOf(selected).m3 ?? 0) >= 0 ? "#15803d" : "#b91c1c" }}
                    >
                      {fFp(perfOf(selected).m3)} · 3M
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="eq-snap">
              <div className="eq-snap-title">Model Snapshot</div>
              <table className="eq-snap-tbl">
                <thead>
                  <tr>
                    <th />
                    {years.map((y) => (
                      <th key={y}>{yr(y)}E</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Revenue ($M)</th>
                    {years.map((y) => (
                      <td key={y}>{sM(mv("revs", y))}</td>
                    ))}
                  </tr>
                  <tr className="eq-snap-sub">
                    <th>YoY growth</th>
                    {years.map((y) => (
                      <td key={y}>{sP(grow("revs", y))}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>Gross margin</th>
                    {years.map((y) => (
                      <td key={y}>{sP(mv("gm", y))}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>Adj. EPS ($)</th>
                    {years.map((y) => (
                      <td key={y}>{sE(mv("adj_eps", y))}</td>
                    ))}
                  </tr>
                  <tr className="eq-snap-sub">
                    <th>YoY growth</th>
                    {years.map((y) => (
                      <td key={y}>{sP(grow("adj_eps", y))}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>Mendo EPS ($)</th>
                    {years.map((y) => (
                      <td key={y}>{sE(mv("mendo_eps", y))}</td>
                    ))}
                  </tr>
                  <tr className="eq-snap-sub">
                    <th>YoY growth</th>
                    {years.map((y) => (
                      <td key={y}>{sP(grow("mendo_eps", y))}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>Target mult (×)</th>
                    {years.map((y) => (
                      <td key={y}>{sX(mv("target_mult", y))}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="eq-decomp-block">
              <div className="eq-decomp-head">
                <span className="eq-decomp-title">IRR Decomposition</span>
                <span className="eq-note mono">
                  TEV Decomp Metric:{" "}
                  <span className="eq-decomp-pill">
                    NTM → YE{String(y2).slice(2)}E
                  </span>
                </span>
              </div>
              {dc ? (
                <DecompWaterfall dc={dc} yEnd={y2} />
              ) : (
                <p className="eq-note">
                  IRR decomposition unavailable for this name.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GroupRows({
  label,
  span,
  children,
}: {
  label: string;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="eq-grp">
        <th colSpan={span}>{label}</th>
      </tr>
      {children}
    </>
  );
}

// ---- analyst selection ------------------------------------------------------ //

function useAnalyst(): [string, (a: string) => void] {
  const [analyst, setAnalyst] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ANALYST_KEY);
      if (saved && ANALYSTS.includes(saved)) setAnalyst(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const set = (a: string) => {
    setAnalyst(a);
    try {
      window.localStorage.setItem(ANALYST_KEY, a);
    } catch {
      /* ignore */
    }
  };
  return [analyst, set];
}

function AnalystSelect({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <label className="eq-analyst">
      Analyst
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Select…
        </option>
        {ANALYSTS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- edit modal -------------------------------------------------------------- //

// Display-only cell formatting for the Edit-model grid: the raw draft string
// is what gets edited and saved; these only shape committed values on screen
// (grouping for $M figures, fixed decimals for per-share lines).
function fmtGroup(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  return raw.trim() !== "" && isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : raw;
}
const fmtFixed = (places: number) => (raw: string): string => {
  const n = Number(raw.replace(/,/g, ""));
  return raw.trim() !== "" && isFinite(n) ? n.toFixed(places) : raw;
};

const SERIES_FIELDS: {
  key: string;
  label: string;
  pct?: boolean;
  unit?: string;
  format?: (raw: string) => string;
}[] = [
  { key: "revs", label: "Revenue", unit: "($M)", format: fmtGroup },
  { key: "gm", label: "Gross margin", pct: true, unit: "(%)", format: fmtFixed(1) },
  { key: "adj_eps", label: "Adj. EPS", unit: "($)", format: fmtFixed(2) },
  { key: "mendo_eps", label: "Mendo EPS", unit: "($)", format: fmtFixed(2) },
  { key: "dps", label: "DPS", unit: "($)", format: fmtFixed(2) },
  { key: "target_mult", label: "Target multiple", unit: "×", format: fmtFixed(1) },
  { key: "ncps", label: "Net cash / sh", unit: "($)", format: fmtFixed(2) },
  { key: "wadso", label: "WADSO", unit: "(M)", format: fmtGroup },
  { key: "net_debt", label: "Net debt", unit: "($M)", format: fmtGroup },
];
const SCALAR_FIELDS: { key: string; label: string; format?: (raw: string) => string }[] = [
  { key: "shares", label: "Shares (M)", format: fmtGroup },
  { key: "cash", label: "Cash (−) ($M)", format: fmtGroup },
  { key: "debt", label: "Debt ($M)", format: fmtGroup },
  { key: "min_int", label: "Min interest ($M)", format: fmtGroup },
];

function fmtDraft(v: number | null | undefined, pct?: boolean): string {
  if (v == null) return "";
  const x = pct ? v * 100 : v;
  return String(Math.round(x * 10000) / 10000);
}

// Excel-paste support: analysts copy a block of cells straight from their
// model and paste it into any grid input — tabs walk right across the year
// columns, newlines walk down the field rows. Each cell is normalized the way
// Excel copies it: "1,234.5", "80.50%", "$12.30", "(2.5)" for negatives, and
// "—"/"-" or blank for empty.
function cleanCell(raw: string): string {
  let s = raw.trim().replace(/[$€£,\s]/g, "");
  if (s === "" || s === "—" || s === "–" || s === "-") return "";
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()%]/g, "");
  if (neg && s && !s.startsWith("-")) s = `-${s}`;
  return s;
}

function EditModal({
  company,
  years,
  groups,
  onClose,
  onSaved,
  onRemoved,
}: {
  company: Company;
  years: number[];
  groups: string[];
  onClose: () => void;
  onSaved: (c: Company) => void;
  onRemoved: (ticker: string) => void;
}) {
  const [analyst, setAnalyst] = useAnalyst();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  // Both guards reset whenever the modal opens (it mounts per open):
  // the target-multiple row stays locked until explicitly confirmed, and
  // "Remove name" always goes through its confirm panel.
  const [confirmMult, setConfirmMult] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Draft inputs as strings, keyed by dotted path. Only touched keys are sent.
  const initialDraft = useMemo(() => {
    const d: Record<string, string> = {};
    const m = company.model as unknown as Record<string, Record<string, number>>;
    for (const f of SERIES_FIELDS) {
      for (const y of years) d[`${f.key}.${y}`] = fmtDraft(m[f.key]?.[String(y)], f.pct);
    }
    for (const f of SCALAR_FIELDS) {
      d[f.key] = fmtDraft(company.model[f.key as "shares"]);
    }
    if (company.is_index) {
      for (const y of years) d[`best_pe.${y}`] = fmtDraft(company.best_pe?.[String(y)]);
    }
    d.port = company.port == null ? "" : String(company.port);
    d.grp = company.grp;
    return d;
  }, [company, years]);
  const [draft, setDraft] = useState(initialDraft);

  // Undo/redo history of whole-draft snapshots. Every mutation (grid edit,
  // paste, delete, admin select) snapshots the prior draft first, so Ctrl/Cmd+Z
  // steps back and Ctrl/Cmd+Y (or Shift+Z) steps forward.
  const undoStack = useRef<Record<string, string>[]>([]);
  const redoStack = useRef<Record<string, string>[]>([]);
  const snapshot = (prev: Record<string, string>) => {
    undoStack.current.push(prev);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
  };

  const set = (k: string, v: string) => {
    snapshot(draft);
    setDraft((p) => ({ ...p, [k]: v }));
  };

  // Batch writes from the spreadsheet grid (paste, delete, per-cell edits).
  const applyCells = (ups: { key: string; value: string }[]) => {
    snapshot(draft);
    setDraft((p) => {
      const next = { ...p };
      for (const u of ups) next[u.key] = u.value;
      return next;
    });
  };

  const undo = () => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop() as Record<string, string>;
    redoStack.current.push(draft);
    setDraft(prev);
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop() as Record<string, string>;
    undoStack.current.push(draft);
    setDraft(next);
  };
  const onModalKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  };

  const save = async () => {
    setError("");
    if (!analyst) return setError("Pick your name first — every change is logged.");
    const changes: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v === initialDraft[k]) continue;
      if (k === "grp") {
        changes[k] = v;
        continue;
      }
      if (k === "port") {
        changes[k] = v === "" ? null : Number(v);
        continue;
      }
      if (v.trim() === "") {
        changes[k] = null;
        continue;
      }
      const n = Number(v.replace(/,/g, ""));
      if (!isFinite(n)) return setError(`"${v}" is not a number (${k}).`);
      const pct = SERIES_FIELDS.find((f) => k.startsWith(`${f.key}.`))?.pct;
      changes[k] = pct ? n / 100 : n;
    }
    if (!Object.keys(changes).length) return onClose();

    setBusy(true);
    try {
      const res = await fetch("/api/equities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", ticker: company.ticker, analyst, changes }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) {
        setError(d?.error || "Could not save.");
      } else {
        onSaved(d.company as Company);
        onClose();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!analyst) return setError("Pick your name first.");
    setBusy(true);
    try {
      const res = await fetch("/api/equities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", ticker: company.ticker, analyst }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) setError(d?.error || "Could not remove.");
      else onRemoved(company.ticker);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  // Toggle portfolio membership: port === 1 is the single source of truth the
  // whole site reads (the green dashboard highlight, Morning Notes, Twitter
  // Monitor — all via getPortfolioPositions). Persists immediately and lifts
  // the updated company into app state so every view reflects it. The modal
  // stays open so the button flips to its opposite action.
  const setPortfolio = async (on: boolean) => {
    setError("");
    if (!analyst) return setError("Pick your name first — every change is logged.");
    setBusy(true);
    try {
      const res = await fetch("/api/equities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          ticker: company.ticker,
          analyst,
          changes: { port: on ? 1 : null },
        }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) setError(d?.error || "Could not update portfolio.");
      else onSaved(d.company as Company);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal" onClick={(e) => e.stopPropagation()} onKeyDown={onModalKeyDown}>
        <div className="eq-modal-head eq-modal-head-rich">
          <div className="eq-modal-id">
            <span className="eq-modal-tile" aria-hidden="true">
              {company.ticker.slice(0, 2)}
            </span>
            <div className="eq-modal-id-text">
              <div className="eq-modal-title-row">
                <span className="eq-modal-tk">{company.ticker}</span>
                <span className="eq-modal-nm">{company.bbg}</span>
              </div>
              <div className="eq-modal-subline">
                Model inputs · {years[0]}E – {years[years.length - 1]}E · shared
                with the team
                {company.update_date
                  ? ` · last updated ${company.update_date}${company.update_by ? ` by ${company.update_by}` : ""}`
                  : ""}
              </div>
            </div>
          </div>
          <div className="eq-modal-head-r">
            <label className="eq-updatedby">
              Updated by
              <select value={analyst} onChange={(e) => setAnalyst(e.target.value)}>
                <option value="">Select…</option>
                {ANALYSTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {company.is_index ? (
          <ModelGrid
            columns={years.map((y) => `${y}E`)}
            rows={[
              {
                label: "BEst P/E",
                unit: "×",
                format: fmtFixed(1),
                keys: years.map((y) => `best_pe.${y}`),
              },
            ]}
            values={draft}
            onCommit={applyCells}
            cleanCell={cleanCell}
            ariaLabel="Index P/E inputs"
          />
        ) : (
          <>
            <div className="eq-scalars-cap">Operating model</div>
            <ModelGrid
              columns={years.map((y) => `${y}E`)}
              rows={[
                ...SERIES_FIELDS.filter((f) => f.key !== "target_mult").map((f) => ({
                  label: f.label,
                  unit: f.unit,
                  format: f.format,
                  keys: years.map((y) => `${f.key}.${y}`),
                })),
                // Target multiple drives every target price/IRR, so it sits at
                // the bottom of the same grid, visually elevated and locked
                // behind an explicit confirm.
                {
                  label: "NTM P/E",
                  unit: "×",
                  format: fmtFixed(1),
                  keys: years.map((y) => `target_mult.${y}`),
                  locked: !confirmMult,
                  rowClass: "eq-row-mult",
                  section: (
                    <div className="eq-mult-strip">
                      <div className="eq-mult-strip-l">
                        <span className="eq-mult-title">Target multiple</span>
                        <span className="eq-mult-note">(×) · drives IRR</span>
                      </div>
                      <label className="eq-mult-confirm">
                        <input
                          type="checkbox"
                          checked={confirmMult}
                          onChange={(e) => setConfirmMult(e.target.checked)}
                        />
                        Confirm before editing
                      </label>
                    </div>
                  ),
                },
              ]}
              values={draft}
              onCommit={applyCells}
              cleanCell={cleanCell}
              ariaLabel="Model inputs"
            />
            {!confirmMult && (
              <p className="eq-lock-note">
                <span aria-hidden="true">🔒</span> Tick &ldquo;Confirm before
                editing&rdquo; to change the valuation multiple.
              </p>
            )}

            <div className="eq-scalars-block">
              <div className="eq-scalars-cap">Balance sheet</div>
              <ModelGrid
                columns={SCALAR_FIELDS.map((f) => f.label)}
                rows={[
                  {
                    label: "",
                    keys: SCALAR_FIELDS.map((f) => f.key),
                    // Per-column formats live on the row in a single-row grid;
                    // group everything (these are $M / share-count scalars).
                    format: fmtGroup,
                  },
                ]}
                values={draft}
                onCommit={applyCells}
                cleanCell={cleanCell}
                ariaLabel="Balance sheet inputs"
              />
            </div>

            <button type="button" className="eq-admin-toggle" onClick={() => setAdminOpen(!adminOpen)}>
              {adminOpen ? "▾" : "▸"} Admin (portfolio flag, sector)
            </button>
            {adminOpen && (
              <div className="eq-admin">
                <label>
                  Portfolio
                  <select value={draft.port} onChange={(e) => set("port", e.target.value)}>
                    <option value="">—</option>
                    <option value="1">Owned (green)</option>
                    <option value="2">Watch</option>
                  </select>
                </label>
                <label>
                  Sector group
                  <select value={draft.grp} onChange={(e) => set("grp", e.target.value)}>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        <p className="eq-note eq-keys-note">
          <b>Works like Excel:</b> arrows to move, Shift+arrows to select,
          Ctrl/Cmd+C to copy and Ctrl/Cmd+V to paste a block, F2 to edit, Esc
          to cancel, Delete to clear. GM % in percent (e.g. 80.5).
        </p>

        {error && <p className="eq-error">{error}</p>}
        {confirmRemove && (
          <div className="eq-remove-confirm" role="alertdialog" aria-label="Confirm removal">
            <div className="eq-remove-confirm-title">
              Remove {company.ticker} from the dashboard?
            </div>
            <div className="eq-remove-confirm-body">
              This hides {company.ticker} from every view. The model is kept
              and can be restored from &ldquo;Removed&rdquo;.
            </div>
            <div className="eq-remove-confirm-btns">
              <button
                type="button"
                className="eq-act"
                onClick={() => setConfirmRemove(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eq-remove-confirm-yes"
                onClick={remove}
                disabled={busy}
              >
                {busy ? "Removing…" : "Yes, remove name"}
              </button>
            </div>
          </div>
        )}
        <div className="eq-modal-foot">
          {!company.is_index ? (
            <div className="eq-foot-left">
              <button
                type="button"
                className="eq-danger-ghost"
                onClick={() => setConfirmRemove(true)}
                disabled={busy || confirmRemove}
              >
                Remove name
              </button>
              {company.port === 1 ? (
                <button
                  type="button"
                  className="eq-portfolio-ghost is-in"
                  onClick={() => setPortfolio(false)}
                  disabled={busy}
                  title="Remove this name from the team portfolio"
                >
                  Remove from Portfolio
                </button>
              ) : (
                <button
                  type="button"
                  className="eq-portfolio-ghost"
                  onClick={() => setPortfolio(true)}
                  disabled={busy}
                  title="Add this name to the team portfolio (reflected across the site)"
                >
                  Add to Portfolio
                </button>
              )}
            </div>
          ) : (
            <span />
          )}
          <div>
            <button type="button" className="eq-act" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={`eq-act eq-act-primary${analyst ? "" : " is-dim"}`}
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save model"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- edits log modal ---------------------------------------------------------- //

function LogModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [edits, setEdits] = useState<EditRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/equities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log", ticker }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (Array.isArray(d?.edits)) setEdits(d.edits);
        else setError(d?.error || "Could not load the log.");
      })
      .catch(() => active && setError("Network error."));
    return () => {
      active = false;
    };
  }, [ticker]);

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal eq-modal-log" onClick={(e) => e.stopPropagation()}>
        <div className="eq-modal-head">
          <h2>Edits log · {ticker}</h2>
          <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="eq-error">{error}</p>}
        {!error && edits === null && <p className="eq-note">Loading…</p>}
        {edits !== null && edits.length === 0 && (
          <p className="eq-note">No logged changes yet for {ticker}.</p>
        )}
        {edits !== null && edits.length > 0 && (
          <ul className="eq-log">
            {edits.map((e) => (
              <li key={e.id}>
                <div className="eq-log-head">
                  <strong>{e.analyst}</strong>
                  <span>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <ul>
                  {e.changes.map((ch, i) => (
                    <li key={i}>
                      {fieldLabel(ch.field)}:{" "}
                      <span className="eq-old">{fmtEditValue(ch.old, ch.field)}</span>
                      {" → "}
                      <span className="eq-new">{fmtEditValue(ch.new, ch.field)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---- aggregate activity-log modal -------------------------------------------- //

// Every change across the whole dashboard, newest first — a book-wide
// companion to the per-company LogModal, opened from the toolbar.
function AllLogModal({ onClose }: { onClose: () => void }) {
  const [edits, setEdits] = useState<EditRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    fetch("/api/equities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logAll" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (Array.isArray(d?.edits)) setEdits(d.edits);
        else setError(d?.error || "Could not load the activity log.");
      })
      .catch(() => active && setError("Network error."));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal eq-modal-log" onClick={(e) => e.stopPropagation()}>
        <div className="eq-modal-head">
          <h2>
            Activity log
            <span className="eq-modal-sub"> · all changes, most recent first</span>
          </h2>
          <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="eq-error">{error}</p>}
        {!error && edits === null && <p className="eq-note">Loading…</p>}
        {edits !== null && edits.length === 0 && (
          <p className="eq-note">No logged changes yet.</p>
        )}
        {edits !== null && edits.length > 0 && (
          <ul className="eq-log">
            {edits.map((e) => (
              <li key={e.id}>
                <div className="eq-log-head">
                  <span>
                    <span className="eq-log-tk">{e.ticker}</span>
                    <strong> {e.analyst}</strong>
                  </span>
                  <span>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <ul>
                  {e.changes.map((ch, i) => (
                    <li key={i}>
                      {fieldLabel(ch.field)}:{" "}
                      <span className="eq-old">{fmtEditValue(ch.old, ch.field)}</span>
                      {" → "}
                      <span className="eq-new">{fmtEditValue(ch.new, ch.field)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---- removed-names modal ---------------------------------------------------------- //

function RemovedModal({
  companies,
  onClose,
  onRestored,
}: {
  companies: Company[];
  onClose: () => void;
  onRestored: (ticker: string) => void;
}) {
  const [analyst, setAnalyst] = useAnalyst();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const restore = async (ticker: string) => {
    setError("");
    if (!analyst) return setError("Pick your name first — restores are logged too.");
    setBusy(true);
    try {
      const res = await fetch("/api/equities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", ticker, analyst }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) setError(d?.error || "Could not restore.");
      else onRestored(ticker);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal eq-modal-log" onClick={(e) => e.stopPropagation()}>
        <div className="eq-modal-head">
          <h2>Removed names</h2>
          <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {companies.length === 0 ? (
          <p className="eq-note">
            Nothing here — names removed from the dashboard are kept in the database and
            will show up in this list, ready to be restored.
          </p>
        ) : (
          <>
            <AnalystSelect value={analyst} onChange={setAnalyst} />
            <ul className="eq-removed">
              {companies.map((c) => (
                <li key={c.ticker}>
                  <span className="eq-removed-name">
                    <strong>{c.ticker}</strong>
                    <span className="eq-note"> · {c.grp}</span>
                  </span>
                  <span className="eq-note">
                    removed {c.update_date ?? "—"}
                    {c.update_by ? ` by ${c.update_by}` : ""}
                  </span>
                  <button
                    type="button"
                    className="eq-act"
                    onClick={() => restore(c.ticker)}
                    disabled={busy}
                  >
                    ↩ Restore
                  </button>
                </li>
              ))}
            </ul>
            <p className="eq-note">
              Restored names come back with their full model and edit history.
            </p>
          </>
        )}
        {error && <p className="eq-error">{error}</p>}
      </div>
    </div>
  );
}

// ---- add-company modal ---------------------------------------------------------- //

function AddModal({
  groups,
  onClose,
  onAdded,
}: {
  groups: string[];
  onClose: () => void;
  onAdded: (c: Company) => void;
}) {
  const [analyst, setAnalyst] = useAnalyst();
  const [ticker, setTicker] = useState("");
  const [bbg, setBbg] = useState("");
  const [yahoo, setYahoo] = useState("");
  const [currency, setCurrency] = useState("$");
  const [grp, setGrp] = useState(groups[0] ?? "Other sectors");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setError("");
    const t = ticker.trim().toUpperCase();
    if (!analyst) return setError("Pick your name first.");
    if (!t) return setError("Enter a ticker.");
    setBusy(true);
    try {
      const res = await fetch("/api/equities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          ticker: t,
          analyst,
          bbg: bbg.trim(),
          yahoo: yahoo.trim() || t,
          currency,
          grp,
          port: port === "" ? null : Number(port),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) setError(d?.error || "Could not add.");
      else onAdded(d.company as Company);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal eq-modal-add" onClick={(e) => e.stopPropagation()}>
        <div className="eq-modal-head">
          <h2>Add company</h2>
          <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <AnalystSelect value={analyst} onChange={setAnalyst} />
        <div className="eq-admin eq-add-grid">
          <label>
            Ticker
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="WDAY" />
          </label>
          <label>
            Bloomberg ID
            <input
              value={bbg}
              onChange={(e) => setBbg(e.target.value)}
              placeholder="WDAY US EQUITY"
            />
          </label>
          <label>
            Yahoo symbol
            <input
              value={yahoo}
              onChange={(e) => setYahoo(e.target.value)}
              placeholder="defaults to ticker"
            />
          </label>
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="$">$</option>
              <option value="€">€</option>
              <option value="£">£</option>
              <option value="">(none)</option>
            </select>
          </label>
          <label>
            Sector group
            <select value={grp} onChange={(e) => setGrp(e.target.value)}>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Portfolio
            <select value={port} onChange={(e) => setPort(e.target.value)}>
              <option value="">—</option>
              <option value="1">Owned (green)</option>
              <option value="2">Watch</option>
            </select>
          </label>
        </div>
        <p className="eq-note">
          The model starts empty — you&apos;ll be dropped into the update form to fill it in.
          New names use the standard P/E × Mendo EPS target methodology.
        </p>
        {error && <p className="eq-error">{error}</p>}
        <div className="eq-modal-foot">
          <span />
          <div>
            <button type="button" className="eq-act" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="eq-act eq-act-primary" onClick={add} disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
