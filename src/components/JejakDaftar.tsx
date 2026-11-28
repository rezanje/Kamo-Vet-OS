"use client";

// Penjejak daftar: mencatat alamat lengkap (dengan filter/halaman) dan posisi gulir tiap halaman di
// sessionStorage, lalu memulihkan gulir saat pengguna kembali lewat tombol Kembali browser atau BackLink.
// Menu samping / tab tidak terpengaruh. Lihat src/lib/back-state.ts.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { kunciHalaman, pulihkanGulir, readScroll, rememberListUrl, rememberScroll, takePendingScroll } from "@/lib/back-state";

type Props = { /** Wadah gulir isi; bila tidak ada, dokumen itu sendiri. */ selector?: string };

export function JejakDaftar({ selector = ".ct" }: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const traversal = useRef(false);
  const memulihkan = useRef(false);

  const akar = () => document.querySelector<HTMLElement>(selector) ?? (document.scrollingElement as HTMLElement | null);

  useEffect(() => {
    let store: Storage;
    try { store = window.sessionStorage; } catch { return; }
    let menunggu: { url: string; y: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tulis = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (menunggu) rememberScroll(store, menunggu.url, menunggu.y);
      menunggu = null;
    };
    const ambil = () => {
      const el = akar();
      if (el) menunggu = { url: kunciHalaman(location.pathname, location.search), y: el.scrollTop };
    };
    const saatGulir = (event: Event) => {
      if (memulihkan.current) return;
      const el = akar();
      if (!el || (event.target !== el && event.target !== document)) return;
      ambil();
      if (timer) clearTimeout(timer);
      timer = setTimeout(tulis, 150);
    };
    // Klik apa pun yang berpindah halaman: simpan gulir sekarang sebelum isi berganti.
    const saatKlik = () => { if (!memulihkan.current) { ambil(); tulis(); } };
    let reset: ReturnType<typeof setTimeout> | undefined;
    const saatMundur = () => {
      traversal.current = true;
      if (reset) clearTimeout(reset);
      reset = setTimeout(() => { traversal.current = false; }, 5000);
    };
    document.addEventListener("scroll", saatGulir, true);
    document.addEventListener("click", saatKlik, true);
    window.addEventListener("popstate", saatMundur);
    window.addEventListener("pagehide", tulis);
    return () => {
      document.removeEventListener("scroll", saatGulir, true);
      document.removeEventListener("click", saatKlik, true);
      window.removeEventListener("popstate", saatMundur);
      window.removeEventListener("pagehide", tulis);
      if (timer) clearTimeout(timer);
      if (reset) clearTimeout(reset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `akar` hanya bergantung pada `selector`.
  }, [selector]);

  useEffect(() => {
    let store: Storage;
    try { store = window.sessionStorage; } catch { return; }
    rememberListUrl(store, pathname, search);
    const url = kunciHalaman(pathname, search);
    const dariBackLink = takePendingScroll(store, url);
    const mundur = traversal.current;
    traversal.current = false;
    if (!dariBackLink && !mundur) return;
    const y = readScroll(store, url);
    if (y === null) return;
    memulihkan.current = true;
    return pulihkanGulir(akar, y, { onDone: () => { memulihkan.current = false; } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `akar` hanya bergantung pada `selector`.
  }, [pathname, search]);

  return null;
}
