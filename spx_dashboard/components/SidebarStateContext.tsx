"use client";

import { createContext, useContext, useState } from "react";

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
}

const SidebarCtx = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

export function SidebarStateProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed((c) => !c);
  return (
    <SidebarCtx.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebarState(): SidebarCtx {
  return useContext(SidebarCtx);
}
