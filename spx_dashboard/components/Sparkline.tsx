// Tiny inline-SVG sparkline for the NTM P/E history. Server-rendered, no JS.
export function Sparkline({
  values,
  width = 116,
  height = 24,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  // The series is stored newest-first; show oldest→newest left→right.
  const pts = [...values].reverse();
  const nums = pts.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (nums.length < 2) return <span className="muted">—</span>;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 2;
  const n = pts.length;

  const coords = pts
    .map((v, i) => {
      if (v === null || Number.isNaN(v)) return null;
      const x = pad + (i / (n - 1)) * (width - 2 * pad);
      const y = height - pad - ((v - min) / range) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");

  const last = nums[nums.length - 1];
  const first = nums[0];
  const stroke = last >= first ? "#16a34a" : "#dc2626";

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="P/E history"
    >
      <polyline
        points={coords}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
