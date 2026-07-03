"use client";

import { useEffect, useState } from "react";
import { msUntilMidnightWib } from "@/lib/quest-logic";

// "Reset dalam HH:MM:SS" ke tengah malam WIB (§8).
export function ResetCountdown() {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMs(msUntilMidnightWib(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (ms === null) return null;
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span style={{ fontSize: 10.5, color: "var(--tm)" }}>
      <i className="ti ti-clock" /> Reset dalam: {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}
