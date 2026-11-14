/**
 * D1 (meeting 12 Nov 2026): Sesuaikan poin pelanggan manual — tambah/kurangi poin dengan alasan wajib.
 *
 * Hak dibaca dari database (`customer_points_adjust_allowed`, migrasi 20261118600000_d1_poin_manual.sql): OWNER selalu; peran lain hanya
 * bila Owner mencentang izin `crm.poin_manual` di Pengaturan > Akses Grup (izin khusus, bawaan MATI). Penyesuaian dijalankan atomik oleh
 * `adjust_customer_points` (saldo tidak boleh minus, anti-dobel lewat kunci permintaan, pelaku & alasan tercatat di riwayat poin).
 * Sebelum migrasinya terpasang: fungsi tidak ada -> tombol tidak tampil, aksi menjawab "belum aktif" (aman).
 */
export const POIN_MANUAL_ACTION = "crm.poin_manual";
export const ALASAN_POIN_MIN = 3;
export const ALASAN_POIN_MAKS = 300;
export const POIN_MAKS = 10_000_000;

type RpcClient = { rpc(name: "customer_points_adjust_allowed"): PromiseLike<{ data: unknown; error: unknown }> };

/** Fail-closed: galat/fungsi belum ada = tidak boleh. Tidak pernah melempar. */
export async function poinManualAllowed(client: RpcClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("customer_points_adjust_allowed");
    return !error && data === true;
  } catch {
    return false;
  }
}

export type IsianPoin = { arah: "tambah" | "kurang"; jumlah: number; alasan: string };

/** Baca isian form; null + pesan bila tidak sah. Jumlah bilangan bulat positif (titik/koma ribuan diabaikan). */
export function bacaIsianPoin(raw: { arah?: unknown; jumlah?: unknown; alasan?: unknown }): { ok: true; isian: IsianPoin; delta: number } | { ok: false; pesan: string } {
  const arah = raw.arah === "kurang" ? "kurang" : raw.arah === "tambah" ? "tambah" : null;
  if (!arah) return { ok: false, pesan: "Pilih tambah atau kurangi poin." };
  const teks = typeof raw.jumlah === "string" ? raw.jumlah.replace(/[.,\s]/g, "") : "";
  if (!/^\d{1,9}$/.test(teks) || Number(teks) <= 0) return { ok: false, pesan: "Jumlah poin wajib angka bulat lebih dari 0." };
  const jumlah = Number(teks);
  if (jumlah > POIN_MAKS) return { ok: false, pesan: "Jumlah poin maksimal 10.000.000." };
  const alasan = typeof raw.alasan === "string" ? raw.alasan.trim().replace(/\s+/g, " ") : "";
  if (alasan.length < ALASAN_POIN_MIN || alasan.length > ALASAN_POIN_MAKS) return { ok: false, pesan: `Alasan wajib diisi ${ALASAN_POIN_MIN}–${ALASAN_POIN_MAKS} huruf.` };
  return { ok: true, isian: { arah, jumlah, alasan }, delta: arah === "tambah" ? jumlah : -jumlah };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const kunciSah = (k: unknown): k is string => typeof k === "string" && UUID.test(k);

/** Pesan database -> kalimat untuk layar (tanpa kode teknis). */
export function pesanPoinManualDb(error: { code?: string; message?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  if (error?.code === "PGRST202" || error?.code === "42883" || /adjust_customer_points/.test(msg) && /not find|does not exist/i.test(msg)) {
    return "Fitur sesuaikan poin belum aktif. Hubungi admin sistem.";
  }
  const kode = /POIN_MANUAL_[A-Z_]+:\s*(.*)$/.exec(msg);
  if (kode) return kode[1].replace(/\.$/, "") + ".";
  return "Poin belum dapat disesuaikan. Coba lagi.";
}
