"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

// A single app-wide toggle: when on, every table/page filters to the stocks
// flagged "Is compounder?" in the Excel. Persisted to localStorage so the
// choice survives navigation between the aggregate and per-category pages.
const KEY = "mendo:compounders-only";

interface Ctx {
  on: boolean;
  toggle: () => void;
}

const CompoundersCtx = createContext<Ctx>({ on: false, toggle: () => {} });

export function CompoundersProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setOn((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <CompoundersCtx.Provider value={{ on, toggle }}>
      {children}
    </CompoundersCtx.Provider>
  );
}

export function useCompounders(): Ctx {
  return useContext(CompoundersCtx);
}
