// Menyimpan dokumen bernomor saat dua orang menekan "simpan" pada detik yang sama.
//
// Nomor berikutnya dibaca dari nomor tertinggi yang sudah ada (lib/no-dokumen),
// jadi dua kasir yang membayar bersamaan bisa memegang angka yang sama persis.
// Yang kedua ditolak unique constraint — dan sebelum ini kasirnya melihat pesan
// mentah dari database, padahal transaksinya cuma perlu diberi nomor lain.
//
// Pengulangan di sini aman karena yang diulang HANYA baris kepala dokumen:
// saat kepala ditolak, belum ada baris, stok, jurnal, atau pembayaran tersentuh.

import { acakSuffix, kandidatNomor, nomorBerikutnya } from "./no-dokumen";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type GalatDb = { code?: string; message?: string } | null | undefined;
export type HasilSisip<T> = { data: T | null; error: GalatDb };

/**
 * Benar hanya kalau penolakannya tabrakan nomor dokumen pada kolom ini
 * (mis. `sales_no_struk_key` untuk kolom `no_struk`).
 *
 * Tabrakan unik lain sengaja TIDAK dihitung. Yang paling penting: `checkout_key`
 * yang sama berarti pembayaran ini sudah pernah tersimpan — mengulangnya dengan
 * nomor baru akan membuat satu pembayaran tercatat dua kali. Kasus itu tetap
 * ditangani jalur "sudah diproses" yang lama.
 */
export function tabrakanNomor(error: GalatDb, column: string): boolean {
  return error?.code === "23505" && String(error.message ?? "").includes(column);
}

export type OpsiSimpan = {
  /** Jenis dokumen di master penomoran, mis. "POS". */
  jenis: string;
  /** Tanggal dokumen "YYYY-MM-DD" — menentukan awalan bernomor tanggal. */
  tanggal: string;
  table: string;
  column: string;
  /** Jumlah percobaan maksimum; bawaan 5. */
  percobaan?: number;
};

/**
 * Sisipkan satu baris kepala dokumen dengan nomor yang dijamin belum dipakai,
 * mengulang percobaan selama yang menolak adalah tabrakan nomor.
 *
 * `bentrok` bernilai benar hanya kalau SEMUA percobaan ditolak karena nomor —
 * pemanggil menampilkan pesan "coba simpan lagi", bukan error database.
 * Error lain dikembalikan apa adanya tanpa diulang.
 */
export async function simpanBernomor<T>(
  supabase: AnyClient,
  o: OpsiSimpan,
  sisip: (nomor: string) => PromiseLike<HasilSisip<T>>,
): Promise<{ data: T | null; error: GalatDb; nomor: string; bentrok: boolean }> {
  const maks = Math.max(1, o.percobaan ?? 5);
  const sudahDicoba = new Set<string>();
  let hasil: HasilSisip<T> = { data: null, error: null };
  let nomor = "";

  for (let ke = 0; ke < maks; ke++) {
    const baca = await nomorBerikutnya(supabase, o.jenis, o.tanggal, { table: o.table, column: o.column });
    // Membaca ulang biasanya sudah cukup: dokumen yang menang tadi sekarang ikut
    // terbaca, jadi angkanya naik sendiri. Kalau pembacaan masih memberi angka
    // yang barusan ditolak (baris lawan belum terlihat saat dibaca), lanjut ke
    // nomor berikutnya, lalu ke nomor bersuffix acak sebagai jalan terakhir.
    nomor = sudahDicoba.has(baca.nomor)
      ? kandidatNomor(baca.prefix, baca.seq, baca.digit, acakSuffix()).find((k) => !sudahDicoba.has(k))
        ?? `${baca.nomor}-${acakSuffix()}`
      : baca.nomor;
    sudahDicoba.add(nomor);

    hasil = await sisip(nomor);
    if (!tabrakanNomor(hasil.error, o.column)) return { data: hasil.data, error: hasil.error, nomor, bentrok: false };
  }

  return { data: hasil.data, error: hasil.error, nomor, bentrok: true };
}
