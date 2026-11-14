/**
 * D2 (meeting 12 Nov 2026): filter retensi — pelanggan yang tidak datang dalam N bulan (CRM › Pelanggan, `?tidak_datang=N`).
 * Database: `pelanggan_tidak_datang(p_bulan)` (dipakai seperti tabel: cari, urutan, halaman, hitung) dan
 * `pelanggan_terakhir_datang(p_ids)` (migrasi 20261118700000_d2_filter_retensi.sql). "Datang" = transaksi petshop/online yang tidak
 * dibatalkan atau kunjungan klinik yang tidak diarsipkan; pelanggan yang tidak pernah datang tidak ikut.
 */
export const PILIHAN_BULAN = [1, 2, 3, 6, 12] as const;
export const BULAN_BAWAAN = 2;
export const BULAN_MAKS = 60;

/** `?tidak_datang=` -> bulan 1..60, atau null (filter mati). */
export function bacaBulanRetensi(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= BULAN_MAKS ? n : null;
}

/** Fungsi retensi belum terpasang di database (migrasi belum dijalankan). */
export const retensiBelumAktif = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "PGRST202" || error.code === "42883" || /pelanggan_(tidak|terakhir)_datang/.test(error.message ?? ""));

type RpcClient = { rpc(name: "pelanggan_terakhir_datang", args: { p_ids: string[] }): PromiseLike<{ data: unknown; error: unknown }> };

/** Tanggal terakhir datang untuk pelanggan di layar (maks. 200). Galat = peta kosong (kolom tampil "—"). */
export async function muatTerakhirDatang(client: RpcClient, ids: readonly string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  try {
    const { data, error } = await client.rpc("pelanggan_terakhir_datang", { p_ids: ids.slice(0, 200) });
    if (error || !Array.isArray(data)) return {};
    const hasil: Record<string, string> = {};
    for (const row of data as { customer_id?: unknown; terakhir_datang?: unknown }[]) {
      if (typeof row.customer_id === "string" && typeof row.terakhir_datang === "string") hasil[row.customer_id] = row.terakhir_datang;
    }
    return hasil;
  } catch {
    return {};
  }
}

/** Batas tanggal (WIB) untuk keterangan: "terakhir datang sebelum <tanggal>". */
export function batasRetensi(bulan: number, sekarang = new Date()): string {
  const d = new Date(sekarang.getTime() + 7 * 3600_000);
  d.setUTCMonth(d.getUTCMonth() - bulan);
  return d.toISOString().slice(0, 10);
}
