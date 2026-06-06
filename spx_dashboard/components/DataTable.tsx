"use client";

import { useMemo, useState } from "react";
import { cellStyle, computeScale, HeatMode } from "@/lib/heatmap";
import { cx, fmtMoney, fmtNum, fmtPct, fmtSignedMoney } from "@/lib/format";
import { NO_SORT, nextSort, sortGlyph, sortRows } from "@/lib/sort";

export type CellFormat = "money" | "signedMoney" | "pct" | "num";

export interface Column {
  key: string;
  label: string;
  groupLabel?: string;
  format: CellFormat;
  heat: HeatMode;
  digits?: number;
}

export interface TableRow {
  label: string;
  isTotal?: boolean;
  cells: (number | null)[];
}

function formatCell(v: number | null, fmt: CellFormat, digits?: number): string {
  switch (fmt) {
    case "money":
      return fmtMoney(v, digits ?? 0);
    case "signedMoney":
      return fmtSignedMoney(v, digits ?? 0);
    case "pct":
      return fmtPct(v, digits ?? 1);
    case "num":
      return fmtNum(v, digits ?? 1);
  }
}

// Build the spans for the top (grouped) header row.
function groupSpans(columns: Column[]) {
  const spans: { label: string; span: number }[] = [];
  for (const col of columns) {
    const label = col.groupLabel ?? "";
    const last = spans[spans.length - 1];
    if (last && last.label === label) last.span += 1;
    else spans.push({ label, span: 1 });
  }
  return spans;
}

// Sort key for the row-label column.
const LABEL_KEY = "__label__";

export function DataTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: TableRow[];
}) {
  const [sort, setSort] = useState(NO_SORT);

  // Per-column heat scale from category rows only (totals excluded so they
  // don't dominate the gradient). Independent of sort order.
  const scales = useMemo(() => {
    const scaleRows = rows.filter((r) => !r.isTotal);
    return columns.map((_, ci) =>
      computeScale(scaleRows.map((r) => r.cells[ci] ?? null)),
    );
  }, [columns, rows]);

  const hasGroups = columns.some((c) => c.groupLabel);

  // Totals stay pinned to the bottom; only the category rows reorder.
  const displayRows = useMemo(() => {
    const normal = rows.filter((r) => !r.isTotal);
    const totals = rows.filter((r) => r.isTotal);
    const sorted = sortRows(normal, sort, (row, key) =>
      key === LABEL_KEY ? row.label : row.cells[Number(key)] ?? null,
    );
    return sort.key ? [...sorted, ...totals] : rows;
  }, [rows, sort]);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          {hasGroups && (
            <tr className="group-row">
              <th className="row-head" />
              {groupSpans(columns).map((g, i) => (
                <th key={i} colSpan={g.span} className="group-th">
                  {g.label}
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th
              className="row-head sortable"
              onClick={() => setSort((s) => nextSort(s, LABEL_KEY))}
              title="Sort by name"
            >
              {sortGlyph(sort, LABEL_KEY)}
            </th>
            {columns.map((c, ci) => (
              <th
                key={c.key}
                className="num-th sortable"
                onClick={() => setSort((s) => nextSort(s, String(ci)))}
                title="Sort by this column"
              >
                {c.label}
                {sortGlyph(sort, String(ci))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((r, ri) => (
            <tr key={ri} className={cx(r.isTotal && "total-row")}>
              <th scope="row" className="row-head">
                {r.label}
              </th>
              {r.cells.map((v, ci) => {
                const col = columns[ci];
                const style = r.isTotal
                  ? {}
                  : cellStyle(v, col.heat, scales[ci]);
                return (
                  <td key={ci} className="num-td" style={style}>
                    {formatCell(v, col.format, col.digits)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
