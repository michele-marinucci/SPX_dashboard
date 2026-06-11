"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

// A small Excel-like grid for the Edit-model modal. It edits a flat string map
// (`values`, keyed `${rowKey}.${col}`) and reports edits back through `onCommit`
// — so the parent's draft state and save logic stay exactly as they were. The
// point is purely the interaction: cell selection, keyboard nav, and copy/paste
// that behave the way an analyst expects coming straight from Excel.
//
// Keys: arrows move · shift+arrows extend the selection · Tab/Enter advance ·
// type or F2 to edit a cell · Esc leaves edit mode · Delete clears the
// selection · Ctrl/Cmd+C copies (dashed "marching ants") · Ctrl/Cmd+V pastes a
// block · Ctrl/Cmd+A selects all.

export interface GridRow {
  key: string;
  label: string;
}

interface Pos {
  r: number;
  c: number;
}
interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function ModelGrid({
  rows,
  cols,
  values,
  onCommit,
  cleanCell,
}: {
  rows: GridRow[];
  cols: number[];
  values: Record<string, string>;
  // Apply a batch of cell writes. key is `${rowKey}.${col}`.
  onCommit: (updates: { key: string; value: string }[]) => void;
  // Normalize one pasted/typed cell the way Excel copies it ("1,234.5", "80%"…).
  cleanCell: (raw: string) => string;
}) {
  const nR = rows.length;
  const nC = cols.length;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [active, setActive] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState<Rect | null>(null);

  const cellKey = useCallback(
    (r: number, c: number) => `${rows[r].key}.${cols[c]}`,
    [rows, cols],
  );
  const valAt = useCallback(
    (r: number, c: number) => values[cellKey(r, c)] ?? "",
    [values, cellKey],
  );

  const rect: Rect = {
    r0: Math.min(anchor.r, active.r),
    r1: Math.max(anchor.r, active.r),
    c0: Math.min(anchor.c, active.c),
    c1: Math.max(anchor.c, active.c),
  };
  const inRect = (r: number, c: number, x: Rect) =>
    r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1;

  // After leaving edit mode the <input> unmounts, so hand focus back to the
  // grid container or the keyboard stops working.
  const refocus = () => requestAnimationFrame(() => wrapRef.current?.focus());

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    }
  }, [editing]);

  const move = (r: number, c: number, extend: boolean) => {
    const nr = Math.max(0, Math.min(nR - 1, r));
    const nc = Math.max(0, Math.min(nC - 1, c));
    setActive({ r: nr, c: nc });
    if (!extend) setAnchor({ r: nr, c: nc });
  };

  const startEdit = (initial?: string) => {
    setEditValue(initial != null ? initial : valAt(active.r, active.c));
    setEditing(true);
  };
  const commitEdit = (move_?: Pos) => {
    onCommit([{ key: cellKey(active.r, active.c), value: cleanCell(editValue) }]);
    setEditing(false);
    if (move_) move(move_.r, move_.c, false);
    refocus();
  };
  const cancelEdit = () => {
    setEditing(false);
    refocus();
  };

  const clearSelection = () => {
    const ups: { key: string; value: string }[] = [];
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++) ups.push({ key: cellKey(r, c), value: "" });
    onCommit(ups);
  };

  const copySelection = async () => {
    const lines: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const cells: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) cells.push(valAt(r, c));
      lines.push(cells.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* clipboard blocked — selection still shows the marching ants */
    }
    setCopied({ ...rect });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit({ r: active.r + 1, c: active.c });
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit({ r: active.r, c: active.c + (e.shiftKey ? -1 : 1) });
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
      return; // everything else flows into the <input>
    }

    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "c" || k === "C")) {
      e.preventDefault();
      void copySelection();
    } else if (mod && (k === "a" || k === "A")) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setActive({ r: nR - 1, c: nC - 1 });
    } else if (mod) {
      // let Ctrl/Cmd+V reach the paste handler; ignore other shortcuts
      return;
    } else if (k === "ArrowUp") {
      e.preventDefault();
      move(active.r - 1, active.c, e.shiftKey);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      move(active.r + 1, active.c, e.shiftKey);
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      move(active.r, active.c - 1, e.shiftKey);
    } else if (k === "ArrowRight") {
      e.preventDefault();
      move(active.r, active.c + 1, e.shiftKey);
    } else if (k === "Tab") {
      e.preventDefault();
      move(active.r, active.c + (e.shiftKey ? -1 : 1), false);
    } else if (k === "Enter") {
      e.preventDefault();
      move(active.r + 1, active.c, false);
    } else if (k === "F2") {
      e.preventDefault();
      startEdit();
    } else if (k === "Backspace") {
      e.preventDefault();
      startEdit(""); // Excel: backspace edits the active cell, cleared
    } else if (k === "Delete") {
      e.preventDefault();
      clearSelection();
    } else if (k === "Escape") {
      setCopied(null);
    } else if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(k); // type to replace
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    if (!/[\t\n]/.test(text)) {
      onCommit([{ key: cellKey(active.r, active.c), value: cleanCell(text) }]);
      setEditing(false);
      return;
    }
    const grid = text.replace(/\r/g, "").split("\n");
    if (grid.length && grid[grid.length - 1] === "") grid.pop();
    const ups: { key: string; value: string }[] = [];
    grid.forEach((line, ri) => {
      line.split("\t").forEach((cell, ci) => {
        const r = active.r + ri;
        const c = active.c + ci;
        if (r < nR && c < nC) ups.push({ key: cellKey(r, c), value: cleanCell(cell) });
      });
    });
    onCommit(ups);
    setEditing(false);
    setCopied(null);
  };

  const selectCell = (r: number, c: number, extend: boolean) => {
    if (editing) commitEdit();
    setActive({ r, c });
    if (!extend) setAnchor({ r, c });
    wrapRef.current?.focus();
  };

  return (
    <div
      className="eq-grid-wrap"
      tabIndex={0}
      ref={wrapRef}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      role="grid"
      aria-label="Model inputs"
    >
      <table className="eq-grid">
        <thead>
          <tr>
            <th aria-hidden="true" />
            {cols.map((y) => (
              <th key={y}>{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {cols.map((_, c) => {
                const isActive = active.r === r && active.c === c;
                const selected = inRect(r, c, rect);
                const isCopied = copied != null && inRect(r, c, copied);
                return (
                  <td
                    key={c}
                    className={cx(
                      "eq-cell",
                      selected && "is-sel",
                      isActive && "is-active",
                      isCopied && "is-copied",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectCell(r, c, e.shiftKey);
                    }}
                    onDoubleClick={() => {
                      setActive({ r, c });
                      setAnchor({ r, c });
                      startEdit();
                    }}
                  >
                    {isActive && editing ? (
                      <input
                        ref={inputRef}
                        className="eq-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        inputMode="decimal"
                      />
                    ) : (
                      <span className="eq-cell-val">{valAt(r, c)}</span>
                    )}
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
