import ExcelJS from "exceljs";

/** Header persis seperti yang dibaca bacaWorkbookKomponenGrup (sheet "Rincian Grup"). */
export const TEMPLATE_RINCIAN_GRUP_HEADERS = ["Kode Grup", "Kode Komponen", "Kuantitas", "Satuan", "Urutan"] as const;

/** Nama sheet wajib; pembaca impor mencari sheet dengan nama ini. */
export const TEMPLATE_RINCIAN_GRUP_SHEET = "Rincian Grup";

// Semua kode di bawah ini fiktif; ganti dengan kode asli dari Accurate.
const CONTOH: ReadonlyArray<readonly [string, string, number, string, number]> = [
  ["GRP-CONTOH-001", "BRG-CONTOH-001", 1, "PCS", 1],
  ["GRP-CONTOH-001", "BRG-CONTOH-002", 2, "PCS", 2],
  ["GRP-CONTOH-002", "BRG-CONTOH-003", 1, "PCS", 1],
];

const PETUNJUK: ReadonlyArray<readonly [string, string]> = [
  ["Gunanya", "File ini mengisi isi (komponen) tiap barang Grup. Export Excel Accurate hanya membawa barang Grup-nya, tanpa daftar komponen."],
  ["Langkah 1", "Impor dulu barang Grup dari Excel Accurate (Jenis Barang GROUP) lewat 'Mode impor: Perbarui master dan kategori'. Kode Grup di file ini harus sudah ada di VetOS."],
  ["Langkah 2", "Isi sheet 'Rincian Grup': satu baris per komponen. Grup dengan 3 komponen berarti 3 baris dengan Kode Grup yang sama."],
  ["Langkah 3", "Pilih file di layar impor, lalu tekan 'Cek rincian'. Tombol abu-abu berarti file belum dipilih."],
  ["Langkah 4", "Periksa hasilnya. Bila semua benar, tekan 'Konfirmasi rincian Grup'. Grup baru aktif setelah semua komponennya valid."],
  ["Kode Grup", "Kode barang Grup yang sudah diimpor (Jenis Barang GROUP)."],
  ["Kode Komponen", "Kode barang biasa yang sudah ada di VetOS dan aktif. Komponen tidak boleh berupa Grup lain dan tidak boleh sama dengan Grup-nya."],
  ["Kuantitas", "Jumlah komponen dalam satu Grup. Harus lebih dari 0."],
  ["Satuan", "Satuan dasar barang komponen atau salah satu satuan tambahannya, misalnya PCS."],
  ["Urutan", "Angka urutan tampil komponen dalam Grup: 1, 2, 3, dan seterusnya."],
  ["Penting", "Jangan ubah nama sheet 'Rincian Grup' dan judul kolom di baris pertama. Baris contoh bersifat fiktif; hapus atau ganti dengan data asli. Satu baris yang salah menahan seluruh impor, jadi perbaiki dulu lalu upload ulang."],
  ["Mengisi ulang", "Rincian Grup yang diupload menggantikan rincian lama Grup itu, jadi tulis semua komponen Grup tersebut."],
];

export async function buatTemplateRincianGrup() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VetOS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(TEMPLATE_RINCIAN_GRUP_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = TEMPLATE_RINCIAN_GRUP_HEADERS.map((header, index) => ({ header, key: header, width: [20, 22, 12, 12, 10][index] }));
  CONTOH.forEach((row) => sheet.addRow([...row]));
  sheet.getRow(1).font = { bold: true };

  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [{ width: 18 }, { width: 100 }];
  guide.getCell("A1").value = "CARA MENGISI RINCIAN GRUP";
  guide.getCell("A1").font = { bold: true, size: 13 };
  PETUNJUK.forEach(([label, text], index) => {
    guide.getCell(index + 3, 1).value = label;
    guide.getCell(index + 3, 1).font = { bold: true };
    guide.getCell(index + 3, 2).value = text;
    guide.getCell(index + 3, 2).alignment = { wrapText: true, vertical: "top" };
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
}
