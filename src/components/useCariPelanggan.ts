"use client";
import { useEffect, useState } from "react";
import { MIN_KETIK_PELANGGAN, bersihkanKueriPelanggan, type PelangganDasar } from "@/lib/pelanggan-cari";

export type UntukPelanggan = "dasar" | "kasir" | "pos";

async function bacaJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null) as { data?: T; error?: string } | null;
  if (!res.ok || !body || !("data" in body)) throw new Error(body?.error ?? "Data pelanggan belum dapat dimuat. Coba lagi.");
  return body.data as T;
}

/** Muat satu pelanggan (mis. setelah dipilih, atau untuk memulihkan draf). */
export async function muatPelanggan<T = PelangganDasar>(id: string, untuk: UntukPelanggan = "dasar", signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(`/api/pelanggan?id=${encodeURIComponent(id)}&untuk=${untuk}`, { signal, cache: "no-store" });
  return bacaJson<T | null>(res);
}

export async function cariPelanggan(kueri: string, signal?: AbortSignal): Promise<PelangganDasar[]> {
  const res = await fetch(`/api/pelanggan?q=${encodeURIComponent(kueri)}`, { signal, cache: "no-store" });
  return bacaJson<PelangganDasar[]>(res);
}

/**
 * Cari pelanggan di server sambil mengetik (jeda 250 ms, permintaan lama dibatalkan).
 * `aktif=false` (mis. pelanggan sudah dipilih) menghentikan pencarian.
 */
export function useCariPelanggan(kueri: string, aktif = true) {
  const [hasil, setHasil] = useState<{ kueri: string; data: PelangganDasar[]; gagal: string | null }>({ kueri: "", data: [], gagal: null });
  const bersih = bersihkanKueriPelanggan(kueri);
  const cukup = aktif && bersih.length >= MIN_KETIK_PELANGGAN;

  useEffect(() => {
    if (!cukup) return;
    const batal = new AbortController();
    const jeda = setTimeout(() => {
      cariPelanggan(kueri.trim(), batal.signal)
        .then((data) => setHasil({ kueri, data, gagal: null }))
        .catch((e: unknown) => {
          if (batal.signal.aborted) return;
          setHasil({ kueri, data: [], gagal: e instanceof Error ? e.message : "Pencarian pelanggan gagal. Coba lagi." });
        });
    }, 250);
    return () => { clearTimeout(jeda); batal.abort(); };
  }, [kueri, cukup]);

  const siap = cukup && hasil.kueri === kueri;
  return {
    hits: siap ? hasil.data : [],
    /** true saat ketikan cukup panjang tetapi hasil untuk ketikan ini belum datang. */
    memuat: cukup && !siap,
    gagal: siap ? hasil.gagal : null,
    /** Ketikan masih terlalu pendek untuk dicari. */
    terlaluPendek: aktif && bersih.length > 0 && bersih.length < MIN_KETIK_PELANGGAN,
  };
}
