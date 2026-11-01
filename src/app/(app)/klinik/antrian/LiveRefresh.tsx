"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Antrian klinik diperbarui berkala dari server (plus saat tab kembali aktif/online).
 *
 * Dulu memakai Supabase Realtime `postgres_changes` pada tabel visits. Selama ada satu
 * saja layar antrian terbuka, server Realtime terus-menerus menjalankan
 * `realtime.list_changes` (±3 kali per detik) — penyumbang beban terbesar database
 * kelas Micro yang tumbang 1 Nov 2026 (±16% waktu database). Polling ringan ini
 * hanya membaca saat layar terlihat.
 */
export const ANTRIAN_REFRESH_MS = 20_000;

export function LiveRefresh({ branchId }: { branchId: string }) {
  const router = useRouter();
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      if (disposed || pending || document.visibilityState !== "visible" || !navigator.onLine) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (!disposed && document.visibilityState === "visible" && navigator.onLine) router.refresh();
      }, 250);
    };
    const interval = setInterval(refresh, ANTRIAN_REFRESH_MS);
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
    };
  }, [router, branchId]);
  return null;
}
