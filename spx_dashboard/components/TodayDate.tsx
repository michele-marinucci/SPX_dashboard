"use client";

import { useEffect, useState } from "react";

// Renders today's date in the viewer's own timezone. Client-only so it reflects
// the user's "today", not the build/server time.
export function TodayDate() {
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
  }, []);

  return <span className="hub-date">{today}</span>;
}
