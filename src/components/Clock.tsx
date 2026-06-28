"use client";

import { useEffect, useState } from "react";

// Client-only to avoid SSR/client time hydration mismatch.
export function Clock() {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " WIB";
    const update = () => setNow(fmt());
    const first = setTimeout(update, 0); // defer so it's not a sync effect setState
    const t = setInterval(update, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  return (
    <span style={{ fontSize: 10.5, color: "var(--td)" }}>{now}</span>
  );
}
