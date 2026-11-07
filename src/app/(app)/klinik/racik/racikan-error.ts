import { parseClinicPostingError } from "@/lib/klinik-posting";

/** Terjemahan penolakan database untuk Kembalikan bahan / Ubah komposisi racikan.
 * Kode asli (teks database) TIDAK disembunyikan: selalu dikembalikan sebagai `detail`
 * untuk ditampilkan di kotak lipat "Detail teknis". Modul murni, bukan "use server". */
export type PesanRacikan = { pesan: string; detail: string };
type Galat = { code?: string; message: string } | null;

const HUBUNGI = "Hubungi Owner/Reza untuk koreksi tagihan.";

/** Kode yang sengaja diterjemahkan di sini (dicek tes agar tabel tidak diam-diam menyusut). */
export const KODE_RACIKAN_DITERJEMAHKAN = [
  "INVOICE_PAID", "RECIPE_LINKED", "RECIPE_INVALID", "RECORD_POSTED", "REASON_REQUIRED",
  "ACCESS_DENIED", "COST_MISSING", "STOCK_SHORT", "LAYER_SHORT", "INGREDIENT_INVALID", "WAREHOUSE_MISSING",
  "NOT_INPATIENT", "VISIT_CLOSED", "NO_CHANGE", "IDEMPOTENCY_CONFLICT",
] as const;

function bersihkan(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

export function pesanRacikanError(error: Galat): PesanRacikan {
  const raw = bersihkan(error?.message ?? "");
  const detail = raw;
  const sebut = (sisa: string | undefined) => (sisa ? ` (${sisa})` : "");
  if (error?.code === "P0001") {
    const cocok = /^([A-Z_]+):\s*(.*)$/.exec(raw);
    const kode = cocok?.[1];
    const sisa = cocok?.[2] ?? "";
    switch (kode) {
      case "INVOICE_PAID":
        return { detail, pesan: `Kunjungan ini sudah punya DP/pembayaran, jadi racikan tidak bisa dikembalikan dari sini. ${HUBUNGI}` };
      case "RECIPE_LINKED":
        if (/resep resmi/.test(sisa)) return { detail, pesan: "Racikan ini berasal dari resep resmi, jadi komposisinya tidak bisa diubah di sini. Bila racikan salah, gunakan Kembalikan bahan." };
        if (/sudah masuk invoice \(aktif atau pernah\)/.test(sisa)) return { detail, pesan: `Racikan ini sudah masuk baris invoice (aktif atau pernah), jadi komposisinya tidak bisa diubah dari sini. Koreksi lewat dokumen invoice. ${HUBUNGI}` };
        if (/histori stok/.test(sisa)) return { detail, pesan: "Riwayat stok racikan ini tidak konsisten (ada bahan yang sudah ditagih atau dikembalikan). Hubungi Reza sebelum mengubah apa pun." };
        return { detail, pesan: `Racikan ini sudah masuk tagihan (invoice aktif), jadi tidak bisa diubah atau dikembalikan dari sini. ${HUBUNGI}` };
      case "RECIPE_INVALID":
        if (/sudah diserahkan/.test(sisa)) return { detail, pesan: "Racikan sudah diserahkan ke pasien, jadi bahannya tidak bisa dikembalikan. Buat racikan baru bila resep berubah." };
        if (/tidak dapat diubah lagi/.test(sisa)) return { detail, pesan: "Racikan ini sudah void atau sudah diserahkan, jadi tidak bisa diubah lagi." };
        if (/minimal satu bahan/.test(sisa)) return { detail, pesan: "Racikan harus punya minimal satu bahan." };
        if (/pemulihan tidak konsisten/.test(sisa)) return { detail, pesan: "Riwayat pengembalian stok racikan ini tidak konsisten. Hubungi Reza sebelum mencoba lagi." };
        if (/sudah dibatalkan/.test(sisa)) return { detail, pesan: "Racikan ini sudah dibatalkan (void), jadi komposisinya tidak bisa diubah." };
        if (/ditarik dari tagihan/.test(sisa)) return { detail, pesan: "Baris racikan ini sudah ditarik dari tagihan, jadi komposisinya tidak bisa diubah. Hubungi Owner/Reza." };
        if (/bahan/.test(sisa)) return { detail, pesan: "Bahan atau jumlah racikan tidak valid. Periksa bahan dan jumlahnya lalu coba lagi." };
        return { detail, pesan: "Racikan tidak dapat diubah dalam keadaan sekarang." };
      case "RECORD_POSTED":
        return { detail, pesan: "Rekam medis kunjungan ini sudah terkunci, jadi tidak bisa diubah dari sini. Hubungi Owner/Reza." };
      case "REASON_REQUIRED":
        if (/minimal 5 huruf/.test(sisa)) return { detail, pesan: "Alasan koreksi wajib diisi (minimal 5 huruf, maksimal 500)." };
        return { detail, pesan: "Alasan wajib diisi (3–500 karakter)." };
      case "ACCESS_DENIED":
        if (/tidak terautentikasi/.test(sisa)) return { detail, pesan: "Sesi Anda berakhir. Masuk ulang lalu coba lagi." };
        if (/hanya untuk Owner/.test(sisa)) return { detail, pesan: "Koreksi komposisi setelah DP/pembayaran hanya untuk Owner. Minta Owner melakukannya." };
        if (/cabang/.test(sisa)) return { detail, pesan: "Akun Anda tidak punya akses cabang racikan ini." };
        if (/tidak ditemukan/.test(sisa)) return { detail, pesan: "Racikan tidak ditemukan atau tidak bisa Anda akses." };
        return { detail, pesan: "Akses ditolak untuk racikan ini." };
      case "COST_MISSING":
        return { detail, pesan: "Harga pokok (HPP) bahan racikan ini tidak lengkap, jadi stok tidak bisa dikembalikan otomatis. Hubungi Reza." };
      case "STOCK_SHORT":
        return { detail, pesan: `Stok tidak cukup${sebut(sisa)}. Tambah stok bahan atau kurangi jumlahnya.` };
      case "LAYER_SHORT":
        return { detail, pesan: `Lapisan stok bahan tidak cukup${sebut(sisa)}. Hubungi Reza.` };
      case "INGREDIENT_INVALID":
        return { detail, pesan: "Ada bahan yang tidak aktif atau bukan bahan racikan. Ganti bahannya lalu coba lagi." };
      case "WAREHOUSE_MISSING":
        return { detail, pesan: "Gudang klinik aktif untuk cabang ini belum ada. Hubungi Reza." };
      case "NOT_INPATIENT":
        return { detail, pesan: "Koreksi Owner ini hanya untuk racikan rawat inap. Untuk kunjungan lain pakai Ubah komposisi biasa." };
      case "VISIT_CLOSED":
        return { detail, pesan: "Kunjungan ini sudah selesai/checkout, jadi komposisi racikan tidak bisa diubah lagi. Hubungi Reza." };
      case "NO_CHANGE":
        return { detail, pesan: "Komposisi sama dengan yang sekarang, tidak ada yang diubah." };
      case "IDEMPOTENCY_CONFLICT":
        return { detail, pesan: "Permintaan ini bentrok dengan koreksi sebelumnya. Muat ulang halaman lalu coba lagi." };
      default:
        return { detail, pesan: `Penolakan dari sistem belum dikenali. Detail teknis ada di bawah; sampaikan ke Owner/Reza. (${parseClinicPostingError(error, "Belum tersimpan.")})` };
    }
  }
  return {
    detail,
    pesan: "Perubahan racikan belum tersimpan karena gangguan sistem. Detail teknis ada di bawah; muat ulang dan coba lagi, atau hubungi Reza.",
  };
}

/** Bangun query string error untuk redirect: pesan manusiawi + detail teknis terpisah. */
export function queryErrorRacikan(error: Galat): string {
  const { pesan, detail } = pesanRacikanError(error);
  return `error=${encodeURIComponent(pesan)}${detail ? `&kode=${encodeURIComponent(detail)}` : ""}`;
}
