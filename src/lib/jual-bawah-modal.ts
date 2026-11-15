/**
 * Jual di bawah modal (obral) — Owner, barang PERSEDIAAN saja, kasir petshop (/kasir dan /pos/transaksi).
 *
 * Permintaan Andri (14 Nov 2026): stok hampir kadaluarsa diskon 50% ditolak lantai HPP walau Owner. Aturan: "Jangan ada yang ngunci dan ga bisa
 * melakukan action untuk akun owner", "khusus produk persediaan aja", "sementara butuh untuk petshop dulu".
 *
 * Hak dibaca dari database (`below_cost_sale_allowed`, migrasi 20261118100000): OWNER selalu; peran lain hanya bila Owner mencentang izin
 * `kasir.jual_bawah_modal` di Pengaturan > Akses Grup (bawaan MATI, termasuk ADMIN). Database menegakkannya lagi saat posting; layar/server
 * hanya memberi pesan lebih awal dan tidak pernah menjadi satu-satunya penjaga.
 */
export const BELOW_COST_ACTION = "kasir.jual_bawah_modal";

export const ALASAN_BAWAH_MODAL = ["Mau kadaluarsa", "Rusak kemasan", "Cuci gudang", "Lainnya"] as const;
export const ALASAN_MIN = 3;
export const ALASAN_MAKS = 200;

export const PESAN_BAWAH_MODAL_DITOLAK =
  "Jual di bawah modal hanya untuk Owner atau peran yang diberi izin. Hapus centang \"Jual di bawah modal\" atau minta Owner mengaktifkannya di Pengaturan > Akses Grup.";

type RpcClient = { rpc(name: "below_cost_sale_allowed"): PromiseLike<{ data: unknown; error: unknown }> };

/** Fail-closed: galat/tak terbaca = tidak boleh. Tidak pernah melempar. */
export async function belowCostSaleAllowed(client: RpcClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("below_cost_sale_allowed");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Alasan bersih (3-200 huruf setelah dipangkas) atau null. Bukan string -> null. */
export function alasanBersih(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  return text.length >= ALASAN_MIN && text.length <= ALASAN_MAKS ? text : null;
}

/** Layar: pilihan + teks bebas -> alasan akhir (pilihan biasa dipakai apa adanya; "Lainnya" memakai teks yang diketik). */
export function alasanDariPilihan(pilih: string | undefined, teks: string | undefined): string {
  if (!pilih) return "";
  if (pilih === "Lainnya") return alasanBersih(teks) ?? "";
  return (ALASAN_BAWAH_MODAL as readonly string[]).includes(pilih) ? pilih : "";
}

export type BawahModalRow = { item_id?: string | null; item_type?: string; bawah_modal_alasan?: unknown };

/**
 * Server: alasan per baris dari keranjang. Hanya baris Persediaan dengan alasan sah yang dihitung. Mengembalikan alasan per baris (null = tidak)
 * dan `diminta` = ada baris yang mencoba memakainya (untuk menolak peran tanpa izin lebih awal dengan pesan jelas).
 */
export function alasanBawahModalPerBaris(rows: readonly BawahModalRow[]): { alasan: (string | null)[]; diminta: boolean; tidakSah: number } {
  let diminta = false;
  let tidakSah = 0;
  const alasan = rows.map((row) => {
    const raw = typeof row.bawah_modal_alasan === "string" ? row.bawah_modal_alasan.trim() : "";
    if (!raw) return null;
    diminta = true;
    const bersih = alasanBersih(raw);
    if (!bersih || !row.item_id || row.item_type !== "Persediaan") { tidakSah += 1; return null; }
    return bersih;
  });
  return { alasan, diminta, tidakSah };
}

/** Pesan ramah untuk penolakan penjaga database (trigger/lantai). Pesan lain dikembalikan apa adanya. */
export function pesanBawahModalDb(message: string): string {
  if (message.includes("BAWAH_MODAL_IZIN") || message.includes("jual di bawah modal ditolak: hanya Owner")) return PESAN_BAWAH_MODAL_DITOLAK;
  if (message.includes("BAWAH_MODAL_ALASAN")) return `Alasan jual di bawah modal wajib diisi (${ALASAN_MIN}-${ALASAN_MAKS} huruf).`;
  if (message.includes("BAWAH_MODAL_JENIS")) return "Jual di bawah modal hanya untuk barang persediaan (bukan jasa atau paket).";
  if (message.includes("BAWAH_MODAL_PROMO")) return "Baris promo di bawah modal tidak bisa digabung dengan jual di bawah modal.";
  return message;
}
