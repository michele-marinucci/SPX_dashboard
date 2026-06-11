"use client";

// Equities Dashboard — the team's Excel "Detailed Dashboard" Summary tab,
// live. Model inputs are shared via Supabase; prices come from Yahoo; every
// valuation/IRR column is recomputed on the fly (lib/equities/calc.ts), so
// an analyst edit updates the whole row for everyone immediately.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HowItWorks } from "@/components/HowItWorks";
import { compute, Decomp, Derived, displayYears } from "@/lib/equities/calc";
import { ANALYSTS } from "@/lib/equities/config";
import { Company, EditRecord, Quote } from "@/lib/equities/types";
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
  const [view, setView] = useState<"val" | "decomp">("val");
  const [editTicker, setEditTicker] = useState<string | null>(null);
  const [logTicker, setLogTicker] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
        {num(fp(dc.ret), undefined, "t")}
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

  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

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

  const num = (v: React.ReactNode, bg?: string, key?: string | number) => (
    <td key={key} className="eq-num" style={bg ? { background: bg } : undefined}>
      {v}
    </td>
  );

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
            and/or Yahoo. <b>Refresh</b> re-fetches; <b>Export Excel</b> exports
            the live workbook.
          </li>
        </ul>
      </HowItWorks>
      <button
        type="button"
        className="btn"
        onClick={refreshPrices}
        disabled={refreshing}
        title="Re-fetch the latest prior-day closes"
      >
        <span className="glyph" aria-hidden="true">⟳</span>{" "}
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      <button type="button" className="btn" onClick={() => setAddOpen(true)}>
        <span className="glyph" aria-hidden="true">＋</span> Add
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

      {view === "val" ? (
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

      <div className="eq-wrap">
        {view === "val" ? (
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
                ).map(([k, l], i) => sortTh(`dec:${k}`, l, i === 0 ? " eq-sep" : ""))}
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

const SERIES_FIELDS: { key: string; label: string; pct?: boolean }[] = [
  { key: "revs", label: "Revenue" },
  { key: "gm", label: "GM %", pct: true },
  { key: "adj_eps", label: "Adj EPS" },
  { key: "mendo_eps", label: "Mendo EPS" },
  { key: "dps", label: "DPS" },
  { key: "target_mult", label: "Target mult" },
  { key: "ncps", label: "Net cash/sh" },
  { key: "wadso", label: "WADSO" },
  { key: "net_debt", label: "Net debt" },
];
const SCALAR_FIELDS: { key: string; label: string }[] = [
  { key: "shares", label: "Shares" },
  { key: "cash", label: "Cash (−)" },
  { key: "debt", label: "Debt" },
  { key: "min_int", label: "Min interest" },
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

  const set = (k: string, v: string) => setDraft((p) => ({ ...p, [k]: v }));

  // Multi-cell pastes from Excel spread across the grid starting at the cell
  // pasted into; a single value falls through to the browser's normal paste.
  const pasteAt =
    (fields: string[], fieldIdx: number, yearIdx: number) =>
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (!/[\t\n]/.test(text)) return;
      e.preventDefault();
      const rows = text.replace(/\r/g, "").split("\n");
      if (rows.length && rows[rows.length - 1] === "") rows.pop(); // Excel's trailing newline
      setDraft((p) => {
        const next = { ...p };
        rows.forEach((row, ri) => {
          const key = fields[fieldIdx + ri];
          if (!key) return;
          row.split("\t").forEach((cell, ci) => {
            const y = years[yearIdx + ci];
            if (y == null) return;
            next[`${key}.${y}`] = cleanCell(cell);
          });
        });
        return next;
      });
    };
  const seriesKeys = SERIES_FIELDS.map((f) => f.key);

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
    if (!window.confirm(`Remove ${company.ticker} from the dashboard?`)) return;
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

  return (
    <div className="eq-overlay" onClick={onClose}>
      <div className="eq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eq-modal-head">
          <h2>
            Update {company.ticker}
            <span className="eq-modal-sub">
              {company.update_date
                ? ` · last updated ${company.update_date}${company.update_by ? ` by ${company.update_by}` : ""}`
                : ""}
            </span>
          </h2>
          <button type="button" className="eq-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <AnalystSelect value={analyst} onChange={setAnalyst} />

        {company.is_index ? (
          <table className="eq-grid">
            <thead>
              <tr>
                <th>Field</th>
                {years.map((y) => (
                  <th key={y}>{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>BEst P/E</th>
                {years.map((y, yi) => (
                  <td key={y}>
                    <input
                      value={draft[`best_pe.${y}`]}
                      onChange={(e) => set(`best_pe.${y}`, e.target.value)}
                      onPaste={pasteAt(["best_pe"], 0, yi)}
                      inputMode="decimal"
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : (
          <>
            <table className="eq-grid">
              <thead>
                <tr>
                  <th>Field</th>
                  {years.map((y) => (
                    <th key={y}>{y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SERIES_FIELDS.map((f, fi) => (
                  <tr key={f.key}>
                    <th>{f.label}</th>
                    {years.map((y, yi) => (
                      <td key={y}>
                        <input
                          value={draft[`${f.key}.${y}`]}
                          onChange={(e) => set(`${f.key}.${y}`, e.target.value)}
                          onPaste={pasteAt(seriesKeys, fi, yi)}
                          inputMode="decimal"
                          placeholder="—"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="eq-scalars">
              {SCALAR_FIELDS.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    value={draft[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    inputMode="decimal"
                    placeholder="—"
                  />
                </label>
              ))}
            </div>

            <button type="button" className="eq-admin-toggle" onClick={() => setAdminOpen(!adminOpen)}>
              {adminOpen ? "▾" : "▸"} Admin (portfolio flag, sector, remove)
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
                <button type="button" className="eq-danger" onClick={remove} disabled={busy}>
                  Remove {company.ticker}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className="eq-error">{error}</p>}
        <div className="eq-modal-foot">
          <span className="eq-note">
            <b>Paste from Excel:</b> copy a block of cells from your model and
            paste into any cell — values fill across years and down fields.
            GM % in percent (e.g. 80.5). Clear a cell to delete the value.
          </span>
          <div>
            <button type="button" className="eq-act" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="eq-act eq-act-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- edits log modal ---------------------------------------------------------- //

function fieldLabel(field: string): string {
  if (field === "__added__") return "Added to dashboard";
  if (field === "__removed__") return "Removed from dashboard";
  if (field === "__restored__") return "Restored to dashboard";
  const [head, year] = field.split(".");
  const labels: Record<string, string> = {
    revs: "Revenue",
    gm: "GM %",
    adj_eps: "Adj EPS",
    mendo_eps: "Mendo EPS",
    dps: "DPS",
    target_mult: "Target mult",
    ncps: "Net cash/sh",
    wadso: "WADSO",
    net_debt: "Net debt",
    best_pe: "BEst P/E",
    shares: "Shares",
    cash: "Cash",
    debt: "Debt",
    min_int: "Min interest",
    port: "Portfolio flag",
    grp: "Sector group",
    yield_input: "Yield input",
  };
  return `${labels[head] ?? head}${year ? ` ${year}` : ""}`;
}

function fmtOld(v: number | string | null, field: string): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (field.startsWith("gm.")) return `${(v * 100).toFixed(2)}%`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

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
                      <span className="eq-old">{fmtOld(ch.old, ch.field)}</span>
                      {" → "}
                      <span className="eq-new">{fmtOld(ch.new, ch.field)}</span>
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
