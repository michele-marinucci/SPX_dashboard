"use client";

import { useMemo, useState } from "react";
import { CategoryStock } from "@/lib/data";
import { cellStyle, computeScale } from "@/lib/heatmap";
import { fmtMoney, fmtNum } from "@/lib/format";
import { NO_SORT, nextSort, sortGlyph, sortRows } from "@/lib/sort";
import { Sparkline } from "./Sparkline";

const LABEL_KEY = "__label__";

function accessor(s: CategoryStock, key: string): number | string | null {
  if (key === LABEL_KEY) return s.name;
  if (key === "mkt_cap") return s.pe.mkt_cap;
  if (key === "ntm_ni") return s.pe.ntm_ni;
  if (key === "ntm_pe") return s.pe.ntm_pe;
  return null;
}

// Per-stock NTM P/E table (current level + quarterly history sparkline).
export function StockPeTable({ stocks }: { stocks: CategoryStock[] }) {
  const [sort, setSort] = useState(NO_SORT);
  const peScale = useMemo(() => computeScale(stocks.map((s) => s.pe.ntm_pe)), [stocks]);
  const rows = useMemo(() => sortRows(stocks, sort, accessor), [stocks, sort]);

  const th = (key: string, label: string) => (
    <th
      className="num-th sortable"
      onClick={() => setSort((s) => nextSort(s, key))}
      title="Sort by this column"
    >
      {label}
      {sortGlyph(sort, key)}
    </th>
  );

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th
              className="row-head sortable"
              onClick={() => setSort((s) => nextSort(s, LABEL_KEY))}
              title="Sort by name"
            >
              {sortGlyph(sort, LABEL_KEY)}
            </th>
            {th("mkt_cap", "Mkt cap ($b)")}
            {th("ntm_ni", "NTM NI ($b)")}
            {th("ntm_pe", "NTM P/E")}
            <th className="num-th">History since &apos;20</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.name}>
              <th scope="row" className="row-head">
                {s.name}
              </th>
              <td className="num-td">{fmtMoney(s.pe.mkt_cap, 0)}</td>
              <td className="num-td">{fmtNum(s.pe.ntm_ni, 1)}</td>
              <td className="num-td" style={cellStyle(s.pe.ntm_pe, "blue", peScale)}>
                {fmtNum(s.pe.ntm_pe, 1)}
              </td>
              <td className="num-td spark-td">
                <Sparkline values={s.pe.series} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
