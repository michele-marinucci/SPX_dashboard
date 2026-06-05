import { NtmPeTableData } from "@/lib/data";
import { cellStyle, computeScale } from "@/lib/heatmap";
import { cx, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { Sparkline } from "./Sparkline";

export function NtmPeTable({ data }: { data: NtmPeTableData }) {
  const catRows = data.rows.filter((r) => !r.is_total);

  const peScale = computeScale(catRows.map((r) => r.ntm_pe));
  const avgScales = data.avg_dates.map((_, i) =>
    computeScale(catRows.map((r) => r.avg_since[i] ?? null)),
  );
  const deltaScales = data.avg_dates.map((_, i) =>
    computeScale(catRows.map((r) => r.delta_vs_avg[i] ?? null)),
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
            <th className="group-th" colSpan={data.avg_dates.length}>
              Avg P/E since
            </th>
            <th className="group-th" colSpan={data.avg_dates.length}>
              Current vs avg since
            </th>
            <th className="group-th">History</th>
          </tr>
          <tr>
            <th className="row-head" />
            <th className="num-th">$b</th>
            <th className="num-th">$b</th>
            <th className="num-th">{data.current_label.replace(/[()]/g, "")}</th>
            {data.avg_dates.map((d) => (
              <th key={`a-${d}`} className="num-th">
                {d}
              </th>
            ))}
            {data.avg_dates.map((d) => (
              <th key={`d-${d}`} className="num-th">
                {d}
              </th>
            ))}
            <th className="num-th">since &apos;20</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
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
