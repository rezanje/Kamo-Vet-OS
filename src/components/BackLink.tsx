"use client";

// Pengganti <Link className="back-btn"> di halaman detail/turunan dari sebuah daftar.
// Server dan render pertama memakai `href` apa adanya (tautan <a> sungguhan, tanpa kedip);
// sesudah hidrasi, bila tab ini baru saja melihat daftar itu dengan filter/halaman tertentu,
// tautan menunjuk ke alamat lengkap tersebut. Lihat src/lib/back-state.ts.
import Link from "next/link";
import { useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { kunciHalaman, markPendingScroll, resolveBackHref } from "@/lib/back-state";

function simpanan(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

// Catatan hanya berubah saat halaman lain tampil, tidak saat tautan ini tampil; pendengar ini ada
// karena useSyncExternalStore mewajibkannya (tab lain tidak berbagi sessionStorage).
function langganan(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function BackLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const tujuan = useSyncExternalStore(
    langganan,
    () => resolveBackHref(simpanan(), href, window.location.pathname),
    () => href,
  );
  const tandai = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (tujuan === href) return;
    const [path, query = ""] = tujuan.split("?");
    markPendingScroll(simpanan(), kunciHalaman(path, query));
  };
  return <Link {...rest} href={tujuan} onClick={tandai} />;
}
