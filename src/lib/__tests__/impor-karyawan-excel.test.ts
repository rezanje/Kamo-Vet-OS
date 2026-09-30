import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { bacaExcelKaryawan } from "../impor-karyawan-excel";

async function workbook(baris: Record<number, string | number | Date>[]) {
  const buku = new ExcelJS.Workbook();
  const sheet = buku.addWorksheet("Data Karyawan");
  sheet.getCell("B1").value = "Nama";
  for (const [kolom, judul] of [
    [3, "ID Karyawan"], [5, "Tanggal Bergabung"], [10, "Jabatan"],
    [28, "Telp"], [29, "Email"], [33, "Slip Gaji"],
    [40, "Nomor Rekening"], [41, "Status Kerja"],
  ] as const) sheet.getRow(2).getCell(kolom).value = judul;
  baris.forEach((isi, index) => {
    for (const [kolom, nilai] of Object.entries(isi)) {
      sheet.getRow(index + 3).getCell(Number(kolom)).value = nilai;
    }
  });
  return Buffer.from(await buku.xlsx.writeBuffer());
}

describe("bacaExcelKaryawan", () => {
  it("membaca format dua baris dan menyimpan rincian payroll tanpa membuat akun login", async () => {
    const hasil = await bacaExcelKaryawan(await workbook([{
      2: "Siti", 3: "EMP-001", 5: "30/09/2026", 10: "Dokter Hewan",
      28: "08123456789", 29: "siti@example.com", 33: "Ya", 40: "00123456", 41: "Aktif",
    }]));
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({
      nik: "EMP-001", nama: "Siti", jabatan: "Dokter Hewan",
      phone: "08123456789", email: "siti@example.com",
      tgl_masuk: "2026-09-30", status: "Aktif",
      details: { "Slip Gaji": "Ya", "Nomor Rekening": "00123456" },
    });
  });

  it("menolak ID yang angka dan ID ganda agar data lama tidak tertimpa", async () => {
    const hasil = await bacaExcelKaryawan(await workbook([
      { 2: "Siti", 3: 123 },
      { 2: "Ani", 3: "EMP-2" },
      { 2: "Budi", 3: "EMP-2" },
    ]));
    expect(hasil.errors.join(" ")).toContain("baris 3");
    expect(hasil.errors.join(" ")).toContain("baris 5");
    expect(hasil.rows).toHaveLength(1);
  });

  it("menolak template salah dan tanggal tidak sah", async () => {
    const buku = new ExcelJS.Workbook();
    buku.addWorksheet("Lainnya");
    expect((await bacaExcelKaryawan(Buffer.from(await buku.xlsx.writeBuffer()))).errors).toContain(
      "Sheet Data Karyawan tidak ditemukan.",
    );
    const hasil = await bacaExcelKaryawan(await workbook([{ 2: "Siti", 3: "EMP-1", 5: "31/02/2026" }]));
    expect(hasil.errors.join(" ")).toContain("Tanggal Bergabung");
  });

  it("ID pada baris gagal tidak menghalangi baris benar berikutnya", async () => {
    const hasil = await bacaExcelKaryawan(await workbook([
      { 2: "Siti", 3: "EMP-1", 5: "31/02/2026" },
      { 2: "Siti", 3: "EMP-1", 5: "30/09/2026" },
    ]));
    expect(hasil.errors).toHaveLength(1);
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.rows[0].nik).toBe("EMP-1");
  });

  it("menerima hasil rumus pada kolom noninti tanpa menjalankan rumus", async () => {
    const buku = new ExcelJS.Workbook();
    const sheet = buku.addWorksheet("Data Karyawan");
    sheet.getCell("B1").value = "Nama";
    for (const [kolom, judul] of [
      [3, "ID Karyawan"], [5, "Tanggal Bergabung"], [10, "Jabatan"],
      [28, "Telp"], [29, "Email"], [41, "Status Kerja"],
    ] as const) sheet.getRow(2).getCell(kolom).value = judul;
    sheet.getCell("F2").value = "Masa Kerja";
    sheet.getCell("B3").value = "Siti";
    sheet.getCell("C3").value = "EMP-1";
    sheet.getCell("F3").value = { formula: "1+2", result: 3 };
    const hasil = await bacaExcelKaryawan(Buffer.from(await buku.xlsx.writeBuffer()));
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows[0].details["Masa Kerja"]).toBe("3");
  });

  it("menolak file yang berisiko melebihi batas unggah formulir", async () => {
    const hasil = await bacaExcelKaryawan(Buffer.alloc(900 * 1024 + 1));
    expect(hasil.errors[0]).toContain("900 KB");
  });

  it("menolak rentang baris yang tidak wajar", async () => {
    const buku = new ExcelJS.Workbook();
    const sheet = buku.addWorksheet("Data Karyawan");
    sheet.getCell("B1").value = "Nama";
    sheet.getCell("C2").value = "ID Karyawan";
    sheet.getCell("E2").value = "Tanggal Bergabung";
    sheet.getCell("J2").value = "Jabatan";
    sheet.getCell("AB2").value = "Telp";
    sheet.getCell("AC2").value = "Email";
    sheet.getCell("AO2").value = "Status Kerja";
    sheet.getCell("B5000").value = "Siti";
    const hasil = await bacaExcelKaryawan(Buffer.from(await buku.xlsx.writeBuffer()));
    expect(hasil.errors[0]).toContain("rentang baris");
  });
});
