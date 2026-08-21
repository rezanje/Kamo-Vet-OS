// Inti pembacaan CSV — dipakai semua layar impor (barang, pelanggan, pemasok,
// bagan akun). Murni, dites di __tests__/impor-csv.test.ts.
//
// Kenapa CSV dan bukan .xlsx: Excel bisa "Save as CSV" sekali klik, dan parsernya
// muat di satu file tanpa menambah dependensi ke aplikasi.

/**
 * Excel berbahasa Indonesia menyimpan CSV dengan titik koma, bukan koma. Pemisah
 * ditebak dari baris judul: yang paling banyak muncul itu yang dipakai. Tanpa ini
 * seluruh file terbaca sebagai satu kolom dan pemakai cuma lihat "kolom kurang".
 */
export function tebakPemisah(barisJudul: string): "," | ";" | "\t" {
  const hitung = (c: string) => barisJudul.split(c).length - 1;
  const kandidat: ("," | ";" | "\t")[] = [",", ";", "\t"];
  return kandidat.reduce((a, b) => (hitung(b) > hitung(a) ? b : a));
}

/** Pecah satu baris CSV; tanda kutip menjaga isi yang mengandung pemisah. */
export function pecahBaris(baris: string, pemisah: string): string[] {
  const out: string[] = [];
  let cur = "";
  let dalamKutip = false;

  for (let i = 0; i < baris.length; i++) {
    const c = baris[i];
    if (dalamKutip) {
      if (c === '"') {
        if (baris[i + 1] === '"') { cur += '"'; i++; }  // "" = satu tanda kutip
        else dalamKutip = false;
      } else cur += c;
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === pemisah) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export type BarisCsv = { no: number; data: Record<string, string> };

export type HasilBaca =
  | { ok: false; pesan: string }
  | { ok: true; baris: BarisCsv[]; kolomTakDikenal: string[] };

/** Baca seluruh isi file jadi baris berlabel kolom. Baris kosong dibuang. */
export function bacaCsvUmum(
  isi: string,
  kolomDikenal: readonly string[],
  kolomWajib: readonly string[],
): HasilBaca {
  // BOM dari Excel bikin nama kolom pertama jadi "﻿kode" dan tidak pernah cocok.
  const bersih = isi.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!bersih) return { ok: false, pesan: "File kosong." };

  const semua = bersih.split("\n").filter((b) => b.trim().length > 0);
  const pemisah = tebakPemisah(semua[0]);
  const judul = pecahBaris(semua[0], pemisah).map((h) => h.toLowerCase().trim());

  const kurang = kolomWajib.filter((k) => !judul.includes(k));
  if (kurang.length > 0) {
    return { ok: false, pesan: `Kolom wajib belum ada di file: ${kurang.join(", ")}.` };
  }

  const dikenal = new Set<string>(kolomDikenal);
  const kolomTakDikenal = judul.filter((h) => h && !dikenal.has(h));

  const baris: BarisCsv[] = [];
  for (let i = 1; i < semua.length; i++) {
    const sel = pecahBaris(semua[i], pemisah);
    const data: Record<string, string> = {};
    judul.forEach((h, k) => { if (h) data[h] = sel[k] ?? ""; });
    // Baris yang semua selnya kosong (sisa baris Excel) dilewati diam-diam.
    if (Object.values(data).every((v) => !v)) continue;
    baris.push({ no: i + 1, data });   // no = nomor baris di file, buat pesan error
  }

  if (baris.length === 0) return { ok: false, pesan: "Tidak ada baris data di bawah judul kolom." };
  return { ok: true, baris, kolomTakDikenal };
}

export type BarisSalah = { no: number; kode: string; pesan: string };

/** "8.000" & "8,000" dua-duanya jadi 8000 — pemisah ribuan Excel, bukan desimal. */
export function angka(v: string): number | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/[.\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Ringkas baris bermasalah jadi satu pesan yang muat di URL. */
export function ringkasSalah(salah: BarisSalah[]): string {
  const tampil = salah.slice(0, 8).map((s) => `baris ${s.no} (${s.kode}): ${s.pesan}`);
  const sisa = salah.length - tampil.length;
  return tampil.join(" · ") + (sisa > 0 ? ` · dan ${sisa} baris lain` : "");
}
