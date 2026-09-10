import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { klarifikasiIdentitasRekamMedis } from "../impor-rekam-medis";

async function kartu(rows: Array<[number, number, unknown]>, name = "KARTU MEDIS PASIEN") {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name);
  rows.forEach(([row, column, value]) => sheet.getRow(row).getCell(column).value = value as ExcelJS.CellValue);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function kartuDenganMergeKosong() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("01012025");
  sheet.getCell("A1").value = "KARTU MEDIS PASIEN";
  lengkap.forEach(([row, column, value]) => sheet.getRow(row + 1).getCell(column).value = value as ExcelJS.CellValue);
  sheet.mergeCells("C20:E20");
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function beberapaKartu(cards: Array<{ name: string; rows: Array<[number, number, unknown]> }>) {
  const book = new ExcelJS.Workbook();
  cards.forEach(({ name, rows }) => {
    const sheet = book.addWorksheet(name);
    sheet.getCell("A1").value = "KARTU MEDIS PASIEN";
    rows.forEach(([row, column, value]) => sheet.getRow(row + 1).getCell(column).value = value as ExcelJS.CellValue);
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function baca(bytes: Uint8Array, fileName = "Rani.xlsx", sourcePath?: string) {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("bacaWorkbookRekamMedis");
  return (loaded as { bacaWorkbookRekamMedis: (b: Uint8Array, f: string, p?: string) => unknown })
    .bacaWorkbookRekamMedis(bytes, fileName, sourcePath) as Promise<{
      rows: Array<Record<string, unknown>>;
      held: Array<Record<string, unknown>>;
    }>;
}

async function bacaBanyak(files: Array<{ fileName: string; sourcePath?: string; bytes: Uint8Array }>) {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("bacaWorkbooksRekamMedis");
  return (loaded as { bacaWorkbooksRekamMedis: (f: typeof files) => unknown })
    .bacaWorkbooksRekamMedis(files) as Promise<{
      rows: Array<Record<string, unknown>>;
      held: Array<Record<string, unknown>>;
      ignored_sheets: number;
    }>;
}

async function pilah(rows: Array<Record<string, unknown>>, existingKeys: string[]) {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("pilahRiwayatTersimpan");
  return (loaded as { pilahRiwayatTersimpan: (r: typeof rows, e: string[]) => unknown })
    .pilahRiwayatTersimpan(rows, existingKeys) as { baru: Array<Record<string, unknown>>; sudah_ada: number };
}

async function bolehKonfirmasi(riwayatSiap: number, disetujui: boolean) {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("bolehKonfirmasiImporRekamMedis");
  return (loaded as { bolehKonfirmasiImporRekamMedis: (siap: number, setuju: boolean) => boolean })
    .bolehKonfirmasiImporRekamMedis(riwayatSiap, disetujui);
}

async function progres(tahap: "baca" | "simpan") {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("infoProgresImporRekamMedis");
  return (loaded as { infoProgresImporRekamMedis: (t: "baca" | "simpan") => { label: string } })
    .infoProgresImporRekamMedis(tahap);
}

const lengkap = [
  [2, 1, "No. Rek Med"], [2, 2, "RM-100"], [2, 4, "Tanggal Rek"], [2, 5, "2025-03-04"],
  [3, 1, "Nama Pasien"], [3, 2, "Mochi"], [3, 4, "Nama Pemilik"], [3, 5, "Rani"],
  [4, 1, "No Telepon"], [4, 2, "081234567890"], [4, 4, "Alamat"], [4, 5, "Cimanggu"],
  [5, 1, "Jenis Hewan"], [5, 2, "Kucing"], [5, 4, "Ras"], [5, 5, "Domestic"],
  [7, 1, "Anamnesa"], [7, 2, "Muntah dua hari"], [7, 3, "Gambaran Klinis"], [7, 4, "Dehidrasi ringan"],
  [7, 5, "Diagnosa"], [7, 6, "Gastritis"], [7, 7, "Terapi"], [7, 8, "Infus dan obat"],
] as Array<[number, number, unknown]>;

describe("bacaWorkbookRekamMedis", () => {
  it("membaca satu kartu medis lengkap", async () => {
    const hasil = await baca(await kartu(lengkap));
    expect(hasil.held).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({
      source_key: "Rani.xlsx::KARTU MEDIS PASIEN",
      record_no: "RM-100",
      record_date: "2025-03-04",
      patient_name: "Mochi",
      owner_name: "Rani",
      phone: "081234567890",
      diagnosis: "Gastritis",
      anamnesis: "Muntah dua hari",
      clinical_findings: "Dehidrasi ringan",
      therapy: "Infus dan obat",
    });
  });

  it("mengikat kartu tanpa telepon ke owner dari folder", async () => {
    const tanpaTelepon = lengkap.filter(([row, column]) => !(row === 4 && column === 2));
    const hasil = await baca(
      await kartu(tanpaTelepon),
      "Mochi.xlsx",
      "Data/0001 - Resti Khalillah R - 081384467002/Mochi.xlsx",
    );

    expect(hasil.held).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({
      owner_name: "Resti Khalillah R",
      phone: "081384467002",
      patient_name: "Mochi",
    });
  });

  it("memakai tanggal nama tab saat berbeda dengan tanggal kartu", async () => {
    const tanggalLama = [[1, 1, "KARTU MEDIS PASIEN"], ...lengkap.map(([row, column, value]) => (
      row === 2 && column === 5 ? [row, column, "16/12/2024"] : [row, column, value]
    ))] as Array<[number, number, unknown]>;
    const hasil = await baca(await kartu(tanggalLama, "270925"));

    expect(hasil.rows[0]).toMatchObject({ record_date: "2025-09-27" });
    expect(hasil.rows[0].warning).toContain("Tanggal kartu berbeda; memakai tanggal nama tab");
  });

  it("menggabungkan semua baris pada setiap bagian medis", async () => {
    const banyakBaris = [
      [1, 1, "KARTU MEDIS PASIEN"],
      [2, 1, "Tanggal Rek"], [2, 2, "29/09/2024"],
      [3, 1, "Nama Pasien"], [3, 2, "Oreo"],
      [4, 1, "Nama Pemilik"], [4, 2, "Resti"],
      [5, 1, "No Telepon"], [5, 2, "081234567890"],
      [7, 3, "Anamnesa"], [7, 4, "Gambaran Klinis"], [7, 5, "Diagnosa"], [7, 6, "Terapi"],
      [8, 3, "makan minum normal"], [8, 4, "BB 4,4 kg"], [8, 5, "mycosis"], [8, 6, "miconazole"],
      [9, 3, "aktif"], [9, 4, "T 39,4"], [9, 6, "oles 2 kali sehari"],
      [10, 4, "kemerahan di tengkuk"],
    ] as Array<[number, number, unknown]>;
    const hasil = await baca(await kartu(banyakBaris, "29092024"), "Oreo.xlsx");

    expect(hasil.rows[0]).toMatchObject({
      anamnesis: "makan minum normal\naktif",
      clinical_findings: "BB 4,4 kg\nT 39,4\nkemerahan di tengkuk",
      diagnosis: "mycosis",
      therapy: "miconazole\noles 2 kali sehari",
    });
  });

  it("menahan kartu tanpa tanggal, pasien, atau pemilik", async () => {
    const rusak = lengkap.filter(([row, column]) => !(
      (row === 2 && column === 5) || (row === 3 && column === 2) || (row === 3 && column === 5)
    ));
    const hasil = await baca(await kartu(rusak), "Template Rek Med.xlsx");
    expect(hasil.rows).toEqual([]);
    expect(hasil.held[0].reason).toContain("Tanggal");
    expect(hasil.held[0].reason).toContain("nama pasien");
    expect(hasil.held[0].reason).toContain("nama pemilik");
  });

  it("membiarkan diagnosis kosong sebagai peringatan, bukan menahan riwayat", async () => {
    const tanpaDiagnosis = lengkap.filter(([row, column]) => !(row === 7 && column === 6));
    const hasil = await baca(await kartu(tanpaDiagnosis));
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.rows[0].warning).toContain("Diagnosis kosong");
  });

  it("menandai tab kosong sebagai bukan kartu yang bisa diimpor", async () => {
    const hasil = await baca(await kartu([], "KARTU MEDIS PASIEN"), "Template Rek Med.xlsx");
    expect(hasil.rows).toEqual([]);
    expect(hasil.held[0].reason).toContain("kosong");
  });

  it("menahan kemungkinan riwayat ganda walau nomor rekamnya beda", async () => {
    const kedua = lengkap.map(([row, column, value]) => (
      row === 2 && column === 2 ? [row, column, "RM-101"] : [row, column, value]
    )) as Array<[number, number, unknown]>;
    const hasil = await bacaBanyak([
      { fileName: "Rani-1.xlsx", bytes: await kartu(lengkap) },
      { fileName: "Rani-2.xlsx", bytes: await kartu(kedua) },
    ]);
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.held[0].reason).toContain("ganda");
  });

  it("melewati salinan riwayat yang isinya sama", async () => {
    const bytes = await kartu(lengkap);
    const hasil = await bacaBanyak([
      { fileName: "Mochi.xlsx", bytes },
      { fileName: "Salinan Mochi.xlsx", bytes },
    ]);

    expect(hasil.rows).toHaveLength(1);
    expect(hasil.held).toEqual([]);
    expect(hasil.ignored_sheets).toBe(1);
  });

  it("tetap membaca kartu yang memiliki gabungan sel kosong", async () => {
    await expect(baca(await kartuDenganMergeKosong())).resolves.toMatchObject({
      rows: [expect.objectContaining({ patient_name: "Mochi" })],
    });
  });

  it("tidak mencampur owner berbeda yang memakai nomor telepon sama", async () => {
    const bytes = await kartu(lengkap);
    const hasil = await bacaBanyak([
      { fileName: "Mochi.xlsx", sourcePath: "Data/0006 - Yuni - 0817752230/Mochi.xlsx", bytes },
      { fileName: "Mochi.xlsx", sourcePath: "Data/0008 - Tanti Rachmawati - 0817752230/Mochi.xlsx", bytes },
    ]);

    expect(hasil.rows).toHaveLength(2);
    expect(hasil.held).toEqual([]);
  });

  it("mengikat kartu tanpa nama pasien ke nama file hewan", async () => {
    const tanpaPasien = lengkap.filter(([row, column]) => !(row === 3 && column === 2));
    const hasil = await baca(
      await kartu(tanpaPasien),
      "Oreo.xlsx",
      "Data/0001 - Resti Khalillah R - 081384467002/Oreo.xlsx",
    );

    expect(hasil.held).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({ patient_name: "Oreo" });
  });

  it("menahan sheet milik hewan lain dalam satu file", async () => {
    const namaBerbeda = lengkap.map(([row, column, value]) => (
      row === 3 && column === 2 ? [row, column, "Moci"] : [row, column, value]
    )) as Array<[number, number, unknown]>;
    const hasil = await baca(await beberapaKartu([
      { name: "01012025", rows: lengkap },
      { name: "02012025", rows: namaBerbeda },
    ]), "Mochi.xlsx");

    expect(hasil.rows).toHaveLength(1);
    expect(hasil.rows[0]).toMatchObject({ patient_name: "Mochi" });
    expect(hasil.held[0].reason).toContain("tidak konsisten");
  });

  it("memakai jejak sumber stabil walau nama folder utama berubah", async () => {
    const bytes = await kartu(lengkap);
    const pertama = await baca(bytes, "Mochi.xlsx", "Unduhan Lama/0001 - Rani - 081234567890/Mochi.xlsx");
    const kedua = await baca(bytes, "Mochi.xlsx", "Unduhan Baru/0001 - Rani - 081234567890/Mochi.xlsx");

    expect(pertama.rows[0].source_key).toBe(kedua.rows[0].source_key);
  });

  it("menahan tanggal kartu yang tidak mungkin", async () => {
    const tanggalRusak = [[1, 1, "KARTU MEDIS PASIEN"], ...lengkap.map(([row, column, value]) => (
      row === 2 && column === 5 ? [row, column, "2025-02-31"] : [row, column, value]
    ))] as Array<[number, number, unknown]>;
    const hasil = await baca(await kartu(tanggalRusak, "Next Rekmed"));

    expect(hasil.rows).toEqual([]);
    expect(hasil.held[0].reason).toContain("Tanggal");
  });

  it("membaca catatan kunjungan dari kartu", async () => {
    const denganCatatan = [...lengkap, [6, 1, "Note"], [6, 2, "Promo vaksin kedua"]] as Array<[number, number, unknown]>;
    const hasil = await baca(await kartu(denganCatatan));

    expect(hasil.rows[0]).toMatchObject({ note: "Promo vaksin kedua" });
  });

  it("melanjutkan hanya riwayat yang belum tersimpan saat impor diulang", async () => {
    const hasil = await baca(await beberapaKartu([
      { name: "01012025", rows: lengkap },
      { name: "02012025", rows: lengkap },
    ]), "Mochi.xlsx");
    const dipilah = await pilah(hasil.rows, [String(hasil.rows[0].source_key)]);

    expect(dipilah.baru).toHaveLength(1);
    expect(dipilah.sudah_ada).toBe(1);
  });

  it("melengkapi profil hewan dari sheet histori yang lebih lengkap", async () => {
    const denganKelamin = [...lengkap, [6, 4, "Jenis Kelamin"], [6, 5, "Jantan"]] as Array<[number, number, unknown]>;
    const bytes = await beberapaKartu([
      { name: "01012025", rows: lengkap },
      { name: "02012025", rows: denganKelamin },
    ]);
    const hasil = await bacaBanyak([{ fileName: "Mochi.xlsx", bytes }]);

    expect(hasil.rows[0]).toMatchObject({ gender: "Jantan" });
  });
});

describe("bolehKonfirmasiImporRekamMedis", () => {
  it("tetap mengizinkan riwayat aman disimpan saat ada riwayat lain yang ditahan", async () => {
    await expect(bolehKonfirmasi(14, true)).resolves.toBe(true);
  });
});

describe("klarifikasiIdentitasRekamMedis", () => {
  const row = {
    source_key: "rek-1", source_file: "Mochi.xlsx", source_sheet: "01012025", record_no: null, record_date: "2025-01-01",
    patient_name: "Mochi", owner_name: "Rani", phone: "081234567890", address: null, species: null, breed: null,
    gender: null, dob: null, doctor: null, note: null, anamnesis: null, clinical_findings: null, diagnosis: null, therapy: null, warning: [],
  };

  it("menahan pilihan ketika nomor sama tetapi nama pemilik berbeda", () => {
    expect(klarifikasiIdentitasRekamMedis([row], [{ id: "owner-1", name: "Rani Putri", phone: "081234567890" }], []))
      .toMatchObject([{ source_key: "rek-1", candidates: [{ customer_id: "owner-1", pet_id: null }] }]);
  });

  it("tidak meminta keputusan saat pemilik dan anabul sudah cocok persis", () => {
    expect(klarifikasiIdentitasRekamMedis([row], [{ id: "owner-1", name: "Rani", phone: "081234567890" }], [
      { id: "pet-1", customer_id: "owner-1", name: "Mochi" },
    ])).toEqual([]);
  });
});

describe("infoProgresImporRekamMedis", () => {
  it("membedakan progres saat membaca dan menyimpan", async () => {
    await expect(progres("baca")).resolves.toMatchObject({ label: "Membaca kartu medis…" });
    await expect(progres("simpan")).resolves.toMatchObject({ label: "Menyimpan riwayat aman…" });
  });
});
