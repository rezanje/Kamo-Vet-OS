import ExcelJS from "exceljs";

const HEADERS = [
  "Kategori Barang",
  "Kode Barang",
  "Nama Barang",
  "Jenis Barang",
  "Satuan",
  "Harga Beli",
  "Def. Hrg. Jual Satuan #1",
  "Satuan #2",
  "Rasio Satuan #2",
  "Def. Hrg. Jual Satuan #2",
  "Satuan #3",
  "Rasio Satuan #3",
  "Def. Hrg. Jual Satuan #3",
  "Satuan #4",
  "Rasio Satuan #4",
  "Def. Hrg. Jual Satuan #4",
  "Satuan #5",
  "Rasio Satuan #5",
  "Def. Hrg. Jual Satuan #5",
  "Batas Minimum Stok",
  "Merek Barang",
  "Pemasok Utama",
  "Satuan Beli",
  "Minimum Beli",
  "UPC/Barcode",
  "Default Diskon (%)",
  "Cabang Saldo",
  "Gudang Saldo Awal",
  "Kuantitas Saldo Awal",
  "Satuan Saldo Awal",
  "Nilai Satuan",
  "Per Tanggal",
  "Pakai tanggal kadaluarsa",
  "Non Aktif",
] as const;

const widths = [22, 18, 34, 16, 14, 16, 22, 14, 17, 22, 14, 17, 22, 14, 17, 22, 14, 17, 22, 20, 18, 22, 16, 16, 18, 18, 24, 24, 22, 22, 18, 16, 24, 14];
const CATEGORY_HEADERS = ["Nama", "Induk Kategori"] as const;

function setCellStyle(cell: ExcelJS.Cell, options: { fill?: string; bold?: boolean; color?: string } = {}) {
  cell.font = { name: "Arial", size: 10, bold: options.bold, color: options.color ? { argb: options.color } : undefined };
  if (options.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
  cell.alignment = { vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: "D9E2F3" } },
    left: { style: "thin", color: { argb: "D9E2F3" } },
    bottom: { style: "thin", color: { argb: "D9E2F3" } },
    right: { style: "thin", color: { argb: "D9E2F3" } },
  };
}

/** Format yang persis dibaca oleh impor Barang & Jasa serta saldo stok awal. */
export async function buatTemplateImporBarang() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VetOS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Barang & Jasa", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });
  sheet.columns = HEADERS.map((header, index) => ({ header, key: header, width: widths[index] }));
  sheet.addTable({
    name: "TemplateImporBarang",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: HEADERS.map((name) => ({ name, filterButton: true })),
    // Satu baris kosong membuat tabel siap langsung diisi tanpa ikut diimpor.
    rows: [HEADERS.map(() => "")],
  });
  sheet.autoFilter = `A1:AH1`;
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 22;
  HEADERS.forEach((_, index) => {
    setCellStyle(sheet.getCell(1, index + 1), { fill: "17365D", bold: true, color: "FFFFFFFF" });
    setCellStyle(sheet.getCell(2, index + 1), { fill: "FFFDE9", color: "FF0000FF" });
  });
  [6, 7, 10, 13, 16, 19, 31].forEach((column) => { sheet.getColumn(column).numFmt = "#,##0.00"; });
  [9, 12, 15, 18, 29].forEach((column) => { sheet.getColumn(column).numFmt = "#,##0.####"; });
  sheet.getColumn(32).numFmt = "yyyy-mm-dd";

  const guide = workbook.addWorksheet("Petunjuk", { properties: { defaultRowHeight: 20 } });
  guide.columns = [{ width: 28 }, { width: 88 }];
  guide.mergeCells("A1:B1");
  guide.getCell("A1").value = "FORMAT IMPOR BARANG, JASA & SALDO STOK AWAL";
  setCellStyle(guide.getCell("A1"), { fill: "17365D", bold: true, color: "FFFFFFFF" });
  guide.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  const instructions = [
    ["Cara pakai", "Isi hanya sheet Barang & Jasa. Baris kosong aman dan tidak akan diimpor."],
    ["Kolom wajib", "Kategori Barang, Kode Barang, Nama Barang, Jenis Barang, dan Satuan."],
    ["Jenis barang", "INV untuk barang persediaan; SVC untuk jasa; NON untuk non-persediaan."],
    ["Harga", "Isi angka biasa. Jangan gunakan rumus atau mengetik tanda Rp."],
    ["Satuan bertingkat", "Satuan adalah satuan dasar. Untuk DUS isi Satuan #2 = DUS, Rasio Satuan #2 = jumlah PCS per DUS, dan harga jual DUS di Def. Hrg. Jual Satuan #2. Ulangi pola yang sama sampai Satuan #5 bila diperlukan."],
    ["Contoh bertingkat", "PCS | harga jual #1: 35000 | Satuan #2: DUS | Rasio #2: 24 | harga jual #2: 800000. Kolom satuan #3 sampai #5 dikosongkan bila tidak dipakai."],
    ["Subkategori", "Download Format Kategori & Subkategori terpisah. Di file barang, isi Kategori Barang dengan kategori paling bawah; misalnya ALAT GROOMING."],
    ["Saldo awal", "Untuk stok, isi Cabang Saldo, Gudang Saldo Awal, Kuantitas Saldo Awal, Satuan Saldo Awal, Nilai Satuan, dan Per Tanggal."],
    ["Nama tujuan", "Nama cabang dan gudang harus sama persis seperti yang tersedia di VetOS."],
    ["Jasa", "Untuk SVC, kosongkan semua kolom saldo stok."],
    ["Tanggal", "Gunakan format YYYY-MM-DD, misalnya 2026-09-10."],
  ];
  instructions.forEach(([label, text], index) => {
    const row = index + 3;
    guide.getCell(row, 1).value = label;
    guide.getCell(row, 2).value = text;
    setCellStyle(guide.getCell(row, 1), { fill: "D9EAF7", bold: true });
    setCellStyle(guide.getCell(row, 2));
  });
  guide.getCell("A16").value = "Contoh pengisian — jangan salin ke sheet Barang & Jasa sebelum disesuaikan";
  guide.mergeCells("A16:B16");
  setCellStyle(guide.getCell("A16"), { fill: "E2F0D9", bold: true });
  guide.getCell("A17").value = "Barang persediaan";
  guide.getCell("B17").value = "Kategori: MAKANAN | Kode: MAK-001 | Nama: Makanan Kucing 1 kg | Jenis: INV | Satuan: PCS | Harga beli: 25000 | Harga jual: 35000 | Stok: isi hanya bila ada saldo awal.";
  guide.getCell("A18").value = "Jasa";
  guide.getCell("B18").value = "Kategori: TINDAKAN | Kode: JAS-001 | Nama: Konsultasi dokter | Jenis: SVC | Satuan: KALI | Kolom stok dikosongkan.";
  [17, 18].forEach((row) => {
    setCellStyle(guide.getCell(row, 1), { fill: "FFFDE9", bold: true });
    setCellStyle(guide.getCell(row, 2), { fill: "FFFDE9" });
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
}

/** Format kategori terpisah agar hubungan induk/subkategori tidak tertukar dengan master barang. */
export async function buatTemplateKategoriImporBarang() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VetOS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Kategori Barang", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });
  sheet.columns = [
    { header: CATEGORY_HEADERS[0], key: CATEGORY_HEADERS[0], width: 30 },
    { header: CATEGORY_HEADERS[1], key: CATEGORY_HEADERS[1], width: 30 },
  ];
  sheet.addTable({
    name: "TemplateKategoriBarang",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: CATEGORY_HEADERS.map((name) => ({ name, filterButton: true })),
    rows: [CATEGORY_HEADERS.map(() => "")],
  });
  sheet.autoFilter = "A1:B1";
  sheet.getRow(1).height = 30;
  CATEGORY_HEADERS.forEach((_, index) => {
    setCellStyle(sheet.getCell(1, index + 1), { fill: "17365D", bold: true, color: "FFFFFFFF" });
    setCellStyle(sheet.getCell(2, index + 1), { fill: "FFFDE9", color: "FF0000FF" });
  });

  const guide = workbook.addWorksheet("Petunjuk", { properties: { defaultRowHeight: 20 } });
  guide.columns = [{ width: 28 }, { width: 88 }];
  guide.mergeCells("A1:B1");
  guide.getCell("A1").value = "FORMAT KATEGORI & SUBKATEGORI";
  setCellStyle(guide.getCell("A1"), { fill: "17365D", bold: true, color: "FFFFFFFF" });
  guide.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  const instructions = [
    ["Cara pakai", "Upload file ini di pilihan Kategori Barang .xlsx saat impor Barang & Jasa."],
    ["Nama", "Nama kategori yang akan dibuat atau diperbarui."],
    ["Induk Kategori", "Isi dengan nama kategori induk. Kosongkan bila kategori utama."],
    ["Contoh utama", "Nama: ACCESORIS | Induk Kategori: kosong."],
    ["Contoh turunan", "Nama: ALAT GROOMING | Induk Kategori: ACCESORIS."],
    ["Di file barang", "Untuk produk sisir, isi Kategori Barang = ALAT GROOMING, bukan ACCESORIS."],
  ];
  instructions.forEach(([label, text], index) => {
    const row = index + 3;
    guide.getCell(row, 1).value = label;
    guide.getCell(row, 2).value = text;
    setCellStyle(guide.getCell(row, 1), { fill: "D9EAF7", bold: true });
    setCellStyle(guide.getCell(row, 2));
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
}

export { CATEGORY_HEADERS as TEMPLATE_IMPOR_KATEGORI_HEADERS, HEADERS as TEMPLATE_IMPOR_BARANG_HEADERS };
