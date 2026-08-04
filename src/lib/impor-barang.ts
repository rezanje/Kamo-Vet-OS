// Impor massal Barang & Jasa dari CSV — murni, dites di __tests__/impor-barang.test.ts
//
// Kenapa CSV dan bukan .xlsx: Excel bisa "Save as CSV" sekali klik, dan parsernya
// muat di satu file tanpa menambah dependensi ke aplikasi kasir.
//
// Aturan yang dipegang di sini: master data TIDAK dibuat otomatis. Kategori, merek,
// atau satuan yang belum terdaftar ditolak per baris, bukan diam-diam dibikinkan —
// kalau tidak, satu salah ketik di file bikin master data beranak tanpa ketahuan.

import { ITEM_TYPES, type ItemType } from "./barang";
import { TINDAKAN_KATEGORI } from "./tindakan";

export const KOLOM_IMPOR = [
  "kode", "nama", "kategori", "jenis", "merek", "satuan",
  "harga_jual", "harga_beli", "stok_minimum", "upc", "kategori_tindakan",
] as const;

export const KOLOM_WAJIB = ["kode", "nama", "kategori", "harga_jual"] as const;

/** Contoh isi file, dipakai tombol "Unduh contoh" di layar impor. */
export const CONTOH_CSV = [
  KOLOM_IMPOR.join(","),
  "SNK-001,Snack Creamy Tuna 15gr,Makanan / Pakan,Persediaan,Royal Canin,pcs,8000,5500,20,,",
  "SNK-002,Snack Creamy Salmon 15gr,Makanan / Pakan,Persediaan,Royal Canin,pcs,8000,5500,20,,",
  "JSA-010,Vaksin Rabies,Jasa,Jasa,,tindakan,150000,0,0,,Vaksinasi",
].join("\n");

// ── Pembacaan CSV ─────────────────────────────────────────────────────────────

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
export function bacaCsv(isi: string): HasilBaca {
  // BOM dari Excel bikin nama kolom pertama jadi "﻿kode" dan tidak pernah cocok.
  const bersih = isi.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!bersih) return { ok: false, pesan: "File kosong." };

  const semua = bersih.split("\n").filter((b) => b.trim().length > 0);
  const pemisah = tebakPemisah(semua[0]);
  const judul = pecahBaris(semua[0], pemisah).map((h) => h.toLowerCase().trim());

  const kurang = KOLOM_WAJIB.filter((k) => !judul.includes(k));
  if (kurang.length > 0) {
    return { ok: false, pesan: `Kolom wajib belum ada di file: ${kurang.join(", ")}.` };
  }

  const dikenal = new Set<string>(KOLOM_IMPOR);
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

// ── Pemeriksaan per baris ─────────────────────────────────────────────────────

export type MasterImpor = {
  /** nama kategori (huruf kecil) → id. Nama bertingkat pakai nama anaknya saja. */
  kategori: Map<string, string>;
  merek: Map<string, string>;
  satuan: Set<string>;
  /** kode barang yang SUDAH ada di sistem, huruf kecil. */
  kodeTerpakai: Set<string>;
};

export type BarangImpor = {
  code: string; name: string; category_id: string; item_type: ItemType;
  brand_id: string | null; unit: string; sell_price: number; buy_price: number;
  min_stock: number; upc: string | null; tindakan_kategori: string | null;
};

export type BarisSalah = { no: number; kode: string; pesan: string };

export type HasilPeriksa = { siap: BarangImpor[]; salah: BarisSalah[] };

const angka = (v: string): number | null => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  // "8.000" & "8,000" dua-duanya jadi 8000 — pemisah ribuan Excel, bukan desimal.
  const n = Number(t.replace(/[.\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Periksa semua baris terhadap master data. Baris yang salah TIDAK menggugurkan
 * baris lain — pemakai lebih butuh 198 barang masuk + 2 baris dilaporkan daripada
 * seluruh file ditolak karena satu salah ketik.
 */
export function periksaBaris(baris: BarisCsv[], master: MasterImpor): HasilPeriksa {
  const siap: BarangImpor[] = [];
  const salah: BarisSalah[] = [];
  const kodeDiFile = new Set<string>();

  for (const b of baris) {
    const d = b.data;
    const kode = (d.kode ?? "").trim();
    const tolak = (pesan: string) => salah.push({ no: b.no, kode: kode || "—", pesan });

    if (!kode) { tolak("Kode barang kosong"); continue; }
    const kodeKecil = kode.toLowerCase();
    if (kodeDiFile.has(kodeKecil)) { tolak("Kode kembar di dalam file ini"); continue; }
    if (master.kodeTerpakai.has(kodeKecil)) { tolak("Kode sudah dipakai barang lain di sistem"); continue; }

    const nama = (d.nama ?? "").trim();
    if (!nama) { tolak("Nama barang kosong"); continue; }

    const jenisTeks = (d.jenis ?? "").trim();
    if (jenisTeks && !(ITEM_TYPES as readonly string[]).includes(jenisTeks)) {
      tolak(`Jenis "${jenisTeks}" tidak dikenal (isi: ${ITEM_TYPES.join(" / ")})`);
      continue;
    }
    const jenis = (jenisTeks || "Persediaan") as ItemType;
    const isJasa = jenis === "Jasa";

    const katTeks = (d.kategori ?? "").trim();
    const categoryId = master.kategori.get(katTeks.toLowerCase());
    if (!categoryId) { tolak(`Kategori "${katTeks || "(kosong)"}" belum terdaftar`); continue; }

    const merekTeks = (d.merek ?? "").trim();
    let brandId: string | null = null;
    if (merekTeks) {
      brandId = master.merek.get(merekTeks.toLowerCase()) ?? null;
      if (!brandId) { tolak(`Merek "${merekTeks}" belum terdaftar`); continue; }
    }

    const satuan = (d.satuan ?? "").trim() || (isJasa ? "tindakan" : "pcs");
    if (!master.satuan.has(satuan.toLowerCase())) {
      tolak(`Satuan "${satuan}" belum terdaftar`);
      continue;
    }

    const hargaJual = angka(d.harga_jual ?? "");
    if (hargaJual == null || hargaJual < 0) { tolak("Harga jual kosong atau tidak valid"); continue; }
    const hargaBeli = angka(d.harga_beli ?? "") ?? 0;
    if (hargaBeli < 0) { tolak("Harga beli tidak valid"); continue; }
    const stokMin = angka(d.stok_minimum ?? "") ?? 0;
    if (stokMin < 0) { tolak("Stok minimum tidak valid"); continue; }

    let tindakan: string | null = null;
    if (isJasa) {
      tindakan = (d.kategori_tindakan ?? "").trim() || "Konsultasi";
      if (!(TINDAKAN_KATEGORI as readonly string[]).includes(tindakan)) {
        tolak(`Kategori tindakan "${tindakan}" tidak dikenal (isi: ${TINDAKAN_KATEGORI.join(" / ")})`);
        continue;
      }
    }

    kodeDiFile.add(kodeKecil);
    siap.push({
      code: kode, name: nama, category_id: categoryId, item_type: jenis,
      brand_id: brandId, unit: satuan,
      sell_price: hargaJual, buy_price: hargaBeli,
      // Jasa & non-persediaan tidak dilacak stoknya — samakan dengan form manual.
      min_stock: jenis === "Persediaan" ? stokMin : 0,
      upc: (d.upc ?? "").trim() || null,
      tindakan_kategori: tindakan,
    });
  }

  return { siap, salah };
}
