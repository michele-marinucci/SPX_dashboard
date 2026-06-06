"use client";

import { useCompounders } from "./CompoundersContext";

// The per-view title + subtitle. Reacts to the Compounders-only filter: the
// stock count switches to the compounder count and the title gains a
// "— Compounders only" tag.
export function ViewHeading({
  title,
  meta,
  stockCount,
  compounderCount,
  trailing,
}: {
  title: string;
  meta?: string;
  stockCount?: number;
  compounderCount?: number;
  trailing?: string;
}) {
  const { on } = useCompounders();

  const parts: string[] = [];
  if (meta) parts.push(meta);
  if (stockCount !== undefined) {
    const n = on ? compounderCount ?? 0 : stockCount;
    parts.push(`${n} ${n === 1 ? "stock" : "stocks"}`);
  }
  if (trailing) parts.push(trailing);

  return (
    <div>
      <h1>
        {title}
        {on && <span className="title-tag"> — Compounders only</span>}
      </h1>
      {parts.length > 0 && <p className="subtitle">{parts.join(" · ")}</p>}
    </div>
  );
}
