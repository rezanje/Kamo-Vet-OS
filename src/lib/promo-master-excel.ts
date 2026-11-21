import { makeTemplateWorkbook, readSheetRows } from "./excel-sheet";

// Format "Daftar Promo" — satu berkas boleh memuat beberapa promo diskon produk.
// Barisnya dikelompokkan oleh kolom Nama Promo: semua baris dengan nama sama
// menjadi SATU promo dengan banyak barang. Kolom selain Kode SKU karena itu
// wajib sama persis di seluruh baris satu promo.

export const PROMO_MASTER_SHEET = "Daftar Promo";

export const PROMO_MASTER_HEADERS = [
  "Nama Promo", "Kode SKU", "Jenis Diskon", "Nilai", "Potong Otomatis", "Cabang",
  "Tanggal Mulai", "Tanggal Berakhir", "Min Qty", "Maks Qty", "Kelipatan", "Min Belanja", "Teks Saran",
] as const;

export type PromoMasterHeader = (typeof PROMO_MASTER_HEADERS)[number];
export type PromoMasterExcelRow = { line: number } & Record<PromoMasterHeader, string>;

export const PROMO_MASTER_MAX_ROWS = 500;

export async function readPromoMasterExcel(bytes: Uint8Array): Promise<PromoMasterExcelRow[]> {
  const rows = await readSheetRows(bytes, {
    sheet: PROMO_MASTER_SHEET, headers: PROMO_MASTER_HEADERS, maxRows: PROMO_MASTER_MAX_ROWS,
  });
  return rows.map(row => ({ line: row.line, ...(row.values as Record<PromoMasterHeader, string>) }));
}

const PETUNJUK: [string, string][] = [
  ["Satu baris", "Satu barang di dalam satu promo. Ulangi Nama Promo yang sama untuk menambah barang ke promo itu."],
  ["Nama Promo", "Wajib, maksimal 120 karakter. Nama yang sudah ada di VetOS akan DIPERBARUI, bukan digandakan."],
  ["Kode SKU", "Kode barang/jasa/tindakan persis seperti di master VetOS. Simpan kode berawalan nol sebagai teks."],
  ["Jenis Diskon", "Isi Persen atau Nominal. Harus sama untuk semua baris dalam satu promo."],
  ["Nilai", "Angka positif, maksimal dua desimal. Persen maksimal 100; Nominal adalah rupiah per satuan."],
  ["Potong Otomatis", "Ya = langsung memotong di kasir/klinik. Tidak = hanya jalan bila dipanggil kode kampanye."],
  ["Cabang", "Kosong = semua cabang. Isi kode cabang; beberapa cabang dipisah koma, contoh: BDG,JKT."],
  ["Tanggal Mulai / Berakhir", "Format YYYY-MM-DD, contoh 2026-11-01. Tanggal berakhir tidak boleh mendahului mulai."],
  ["Min Qty", "Kosong = tanpa syarat. Isi angka bulat lebih dari 0 bila promo butuh pembelian minimal."],
  ["Maks Qty", "Kosong = tanpa batas. Bila diisi, tidak boleh lebih kecil dari Min Qty."],
  ["Kelipatan", "Ya = potongan berulang tiap kelipatan Min Qty (min 2, beli 5 → yang dapat 4). Butuh Min Qty terisi."],
  ["Min Belanja", "Kosong atau 0 = tanpa syarat belanja. Isi rupiah minimal satu transaksi."],
  ["Teks Saran", "Kalimat yang muncul sebagai saran di layar. Kosong = dipakai Nama Promo."],
  ["Sebelum simpan", "Periksa preview. Baris merah wajib diperbaiki di Excel; tidak ada yang tersimpan sampai bersih."],
  ["Mengubah promo lama", "Unggah ulang dengan Nama Promo yang sama. Preview memperlihatkan barang yang ditambah, dihapus, dan nilai yang berubah."],
];

export async function makePromoMasterTemplate(branches: { code: string | null; name: string }[] = []): Promise<Uint8Array> {
  const daftarCabang = branches.filter(branch => branch.code).map(branch => `${branch.code} = ${branch.name}`).join(" · ");
  return makeTemplateWorkbook({
    sheet: PROMO_MASTER_SHEET,
    columns: [
      { header: "Nama Promo", width: 30 }, { header: "Kode SKU", width: 20, numFmt: "@" },
      { header: "Jenis Diskon", width: 15 }, { header: "Nilai", width: 14, numFmt: "#,##0.00" },
      { header: "Potong Otomatis", width: 16 }, { header: "Cabang", width: 18, numFmt: "@" },
      { header: "Tanggal Mulai", width: 16, numFmt: "@" }, { header: "Tanggal Berakhir", width: 17, numFmt: "@" },
      { header: "Min Qty", width: 10 }, { header: "Maks Qty", width: 11 },
      { header: "Kelipatan", width: 12 }, { header: "Min Belanja", width: 15, numFmt: "#,##0.00" },
      { header: "Teks Saran", width: 36 },
    ],
    guide: [...PETUNJUK, ["Kode cabang tersedia", daftarCabang || "Belum ada cabang aktif berkode."]],
  });
}
