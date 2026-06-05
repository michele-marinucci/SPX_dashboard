// Conditional-formatting heatmaps that mirror the source slide:
//   - "rg"  : diverging red→green for performance / growth deltas
//   - "blue": sequential blue for absolute levels (market cap, NI, P/E)

export type HeatMode = "rg" | "blue" | "none";

export interface ColScale {
  min: number;
  max: number;
  maxAbs: number;
}

export function computeScale(values: (number | null)[]): ColScale {
  const nums = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (nums.length === 0) return { min: 0, max: 0, maxAbs: 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const maxAbs = Math.max(Math.abs(min), Math.abs(max)) || 1;
  return { min, max, maxAbs };
}

export interface CellStyle {
  backgroundColor?: string;
  color?: string;
}

// Diverging red/green. Intensity scales with |value| / column maxAbs.
function divergingRG(v: number, scale: ColScale): CellStyle {
  const t = Math.min(1, Math.abs(v) / (scale.maxAbs || 1));
  const alpha = 0.12 + 0.6 * t;
  if (v > 0) return { backgroundColor: `rgba(22, 163, 74, ${alpha.toFixed(3)})` };
  if (v < 0) return { backgroundColor: `rgba(220, 38, 38, ${alpha.toFixed(3)})` };
  return {};
}

// Sequential blue. Intensity scales with (value - min) / (max - min).
function sequentialBlue(v: number, scale: ColScale): CellStyle {
  const range = scale.max - scale.min || 1;
  const t = Math.min(1, Math.max(0, (v - scale.min) / range));
  const alpha = 0.08 + 0.62 * t;
  const style: CellStyle = {
    backgroundColor: `rgba(37, 99, 235, ${alpha.toFixed(3)})`,
  };
  if (alpha > 0.5) style.color = "#f8fafc";
  return style;
}

export function cellStyle(
  v: number | null,
  mode: HeatMode,
  scale: ColScale,
): CellStyle {
  if (mode === "none" || v === null || Number.isNaN(v)) return {};
  return mode === "rg" ? divergingRG(v, scale) : sequentialBlue(v, scale);
}
