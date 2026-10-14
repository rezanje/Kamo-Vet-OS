"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Realtime is the fast path. Periodic server reads recover missed events and
// unavailable sockets without widening the active branch's database access.
export function LiveRefresh({ branchId }: { branchId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let pending: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      if (disposed || pending || document.visibilityState !== "visible" || !navigator.onLine) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (!disposed && document.visibilityState === "visible" && navigator.onLine) router.refresh();
      }, 250);
    };
    const channel = supabase
      .channel(`antrian-live-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `branch_id=eq.${branchId}` }, refresh)
      .subscribe((status) => {
        // Catch a registration committed between the initial read and subscribe.
        if (status === "SUBSCRIBED") refresh();
      });
    const interval = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(interval);
      if (pending) clearTimeout(pending);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [router, branchId]);
  return null;
}
