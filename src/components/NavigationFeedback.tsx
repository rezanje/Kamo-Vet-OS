"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    const mulaiNavigasi = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const tujuan = new URL(anchor.href, window.location.href);
      if (tujuan.origin !== window.location.origin) return;
      if (`${tujuan.pathname}${tujuan.search}` === `${window.location.pathname}${window.location.search}`) return;
      const next = `${tujuan.pathname}?${tujuan.searchParams.toString()}`;
      setTarget(next);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setTarget(null), 15000);
    };
    document.addEventListener("click", mulaiNavigasi, true);
    return () => {
      document.removeEventListener("click", mulaiNavigasi, true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  if (!target || target === current) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", inset: "0 0 auto", zIndex: 1000, pointerEvents: "none" }}>
      <div style={{ height: 3, width: "42%", borderRadius: "0 999px 999px 0", background: "var(--acc)", animation: "nav-progress 1.1s ease-in-out infinite" }} />
      <span style={{ position: "absolute", top: 9, right: 15, borderRadius: 999, padding: "5px 9px", background: "#172446", color: "#fff", fontSize: 10.5, boxShadow: "0 3px 12px #17244633" }}>
        <i className="ti ti-loader-2 ti-spin" style={{ marginRight: 4 }} /> Membuka menu…
      </span>
      <style>{`@keyframes nav-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(240%); } }`}</style>
    </div>
  );
}
