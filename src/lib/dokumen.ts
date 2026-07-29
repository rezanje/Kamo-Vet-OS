// Lampiran dokumen: parsing kiriman form + nama file aman untuk path storage.
// Dipakai server action — nilai dari klien tidak boleh masuk DB apa adanya.

export type LampiranDraft = { path: string; nama: string; mime: string | null; ukuran: number | null };

export const MODUL_DOKUMEN = ["pembelian", "penjualan", "pengeluaran"] as const;
export type ModulDokumen = (typeof MODUL_DOKUMEN)[number];

// Path storage: hanya huruf/angka/titik/strip, biar tidak ada karakter yang bikin
// URL bercabang (spasi, "/", "..") saat file diunduh ulang.
export function namaFileAman(nama: string): string {
  const bersih = nama.normalize("NFKD")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/\.{2,}/g, ".")     // ".." tidak boleh tersisa: itu bahan naik folder
    .replace(/^[-.]+|[-.]+$/g, "");
  return (bersih || "dokumen").slice(0, 80);
}

export function parseLampiran(raw: unknown): LampiranDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: LampiranDraft[] = [];
  for (const r of parsed) {
    const row = r as Partial<LampiranDraft>;
    const path = String(row?.path ?? "").trim();
    // Path harus di dalam bucket dokumen & tidak boleh naik folder.
    if (!path || path.includes("..") || path.startsWith("/")) continue;
    const ukuran = Number(row?.ukuran);
    out.push({
      path,
      nama: String(row?.nama ?? "").trim().slice(0, 200) || "dokumen",
      mime: String(row?.mime ?? "").trim().slice(0, 120) || null,
      ukuran: Number.isFinite(ukuran) && ukuran > 0 ? Math.round(ukuran) : null,
    });
  }
  return out;
}
