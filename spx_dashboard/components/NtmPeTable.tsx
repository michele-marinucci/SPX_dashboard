"use client";

import { useMemo, useState } from "react";
import { NtmPeRow, NtmPeTableData } from "@/lib/data";
import { cellStyle, computeScale } from "@/lib/heatmap";
import { cx, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { NO_SORT, nextSort, sortGlyph, sortRows } from "@/lib/sort";
import { useCompounders } from "./CompoundersContext";
import { Sparkline } from "./Sparkline";

const LABEL_KEY = "__label__";

function accessor(r: NtmPeRow, key: string): number | string | null {
  if (key === LABEL_KEY) return r.label;
  if (key === "mkt_cap") return r.mkt_cap;
  if (key === "ntm_ni") return r.ntm_ni;
  if (key === "ntm_pe") return r.ntm_pe;
  if (key.startsWith("avg")) return r.avg_since[Number(key.slice(3))] ?? null;
  if (key.startsWith("delta")) return r.delta_vs_avg[Number(key.slice(5))] ?? null;
  return null;
}

export function NtmPeTable({
  data,
  altData,
}: {
  data: NtmPeTableData;
  altData?: NtmPeTableData;
}) {
  const [sort, setSort] = useState(NO_SORT);
  const { on: compoundersOnly } = useCompounders();
  const eff = compoundersOnly && altData ? altData : data;

  const catRows = useMemo(() => eff.rows.filter((r) => !r.is_total), [eff.rows]);

  const peScale = useMemo(() => computeScale(catRows.map((r) => r.ntm_pe)), [catRows]);
  const avgScales = useMemo(
    () => eff.avg_dates.map((_, i) => computeScale(catRows.map((r) => r.avg_since[i] ?? null))),
    [catRows, eff.avg_dates],
  );
  const deltaScales = useMemo(
    () => eff.avg_dates.map((_, i) => computeScale(catRows.map((r) => r.delta_vs_avg[i] ?? null))),
    [catRows, eff.avg_dates],
  );

  // Only the rows above the first subtotal ("Total AI Capex Beneficiaries")
  // reorder; everything from that subtotal down keeps its original position.
  const displayRows = useMemo(() => {
    if (!sort.key) return eff.rows;
    const firstTotalIdx = eff.rows.findIndex((r) => r.is_total);
    const splitAt = firstTotalIdx === -1 ? eff.rows.length : firstTotalIdx;
    const head = sortRows(eff.rows.slice(0, splitAt), sort, accessor);
    return [...head, ...eff.rows.slice(splitAt)];
  }, [eff.rows, sort]);

  const sortableTh = (key: string, label: React.ReactNode) => (
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
          <tr className="group-row">
            <th className="row-head" />
            <th className="group-th">Mkt cap</th>
            <th className="group-th">NTM NI</th>
            <th className="group-th">NTM P/E</th>
            <th className="group-th" colSpan={eff.avg_dates.length}>
              Avg P/E since
            </th>
            <th className="group-th" colSpan={eff.avg_dates.length}>
              Current vs avg since
            </th>
            <th className="group-th">History</th>
          </tr>
          <tr>
            <th
              className="row-head sortable"
              onClick={() => setSort((s) => nextSort(s, LABEL_KEY))}
              title="Sort by name"
            >
              {sortGlyph(sort, LABEL_KEY)}
            </th>
            {sortableTh("mkt_cap", "$b")}
            {sortableTh("ntm_ni", "$b")}
            {sortableTh("ntm_pe", eff.current_label.replace(/[()]/g, ""))}
            {eff.avg_dates.map((d, i) => sortableTh(`avg${i}`, d))}
            {eff.avg_dates.map((d, i) => sortableTh(`delta${i}`, d))}
            <th className="num-th">since &apos;20</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((r, ri) => (
            <tr key={ri} className={cx(r.is_total && "total-row")}>
              <th scope="row" className="row-head">
                {r.label}
              </th>
              <td className="num-td">{fmtMoney(r.mkt_cap, 0)}</td>
              <td className="num-td">{fmtNum(r.ntm_ni, 1)}</td>
              <td
                className="num-td"
                style={r.is_total ? {} : cellStyle(r.ntm_pe, "blue", peScale)}
              >
                {fmtNum(r.ntm_pe, 1)}
              </td>
              {r.avg_since.map((v, i) => (
                <td
                  key={`av-${i}`}
                  className="num-td"
                  style={r.is_total ? {} : cellStyle(v, "blue", avgScales[i])}
                >
                  {fmtNum(v, 1)}
                </td>
              ))}
              {r.delta_vs_avg.map((v, i) => (
                <td
                  key={`dv-${i}`}
                  className="num-td"
                  style={r.is_total ? {} : cellStyle(v, "rg", deltaScales[i])}
                >
                  {fmtPct(v, 1)}
                </td>
              ))}
              <td className="num-td spark-td">
                <Sparkline values={r.series} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
