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

  // Lead parts render as plain text; the "Bloomberg data as of …" trailing
  // segment renders in the mono face per the Ledger spec.
  const lead: string[] = [];
  if (meta) lead.push(meta);
  if (stockCount !== undefined) {
    const n = on ? compounderCount ?? 0 : stockCount;
    lead.push(`${n} ${n === 1 ? "stock" : "stocks"}`);
  }

  return (
    <div>
      <h1>
        {title}
        {on && <span className="title-tag">Compounders only</span>}
      </h1>
      {(lead.length > 0 || trailing) && (
        <p className="subtitle">
          {lead.join(" · ")}
          {lead.length > 0 && trailing ? " · " : ""}
          {trailing && <span className="mono">{trailing}</span>}
        </p>
      )}
    </div>
  );
}
