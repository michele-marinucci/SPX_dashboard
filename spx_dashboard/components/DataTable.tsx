import { cellStyle, computeScale, HeatMode } from "@/lib/heatmap";
import { cx, fmtMoney, fmtNum, fmtPct, fmtSignedMoney } from "@/lib/format";

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

export function DataTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: TableRow[];
}) {
  // Per-column heat scale from category rows only (totals excluded so they
  // don't dominate the gradient).
  const scaleRows = rows.filter((r) => !r.isTotal);
  const scales = columns.map((_, ci) =>
    computeScale(scaleRows.map((r) => r.cells[ci] ?? null)),
  );

  const hasGroups = columns.some((c) => c.groupLabel);

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
            <th className="row-head" />
            {columns.map((c) => (
              <th key={c.key} className="num-th">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
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
