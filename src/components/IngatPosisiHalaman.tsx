"use client";

// Rekam posisi halaman setiap kali alamat ATAU filter berubah (bukan cuma saat pindah halaman),
// supaya kembali lewat tab, menu samping, atau Daftar Laporan membuka laporan persis seperti
// terakhir ditinggal. Lihat src/lib/menu-last-path.ts.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { rememberPageUrl, rememberPath } from "@/lib/menu-last-path";

export function IngatPosisiHalaman() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    let store: Storage;
    try { store = window.sessionStorage; } catch { return; }
    rememberPath(store, pathname, search);
    rememberPageUrl(store, pathname, search);
  }, [pathname, search]);
  return null;
}
