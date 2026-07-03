"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Addendum §4: realtime subscription (bukan polling) — perubahan visits me-refresh
// server component antrian. ponytail: dashboard ini lintas cabang, jadi subscribe
// tabel penuh; kalau nanti ada layar tunggu per cabang, tambahkan filter branch_id.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("antrian-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
