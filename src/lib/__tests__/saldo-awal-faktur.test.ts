import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  bacaWorkbookSaldoAwalFaktur, buatTemplateSaldoAwalFaktur, KOLOM_SALDO_AWAL_FAKTUR, ringkasFile, rupiahBulat, tanggalSel,
} from "../saldo-awal-faktur";

async function buku(sheets: Record<string, unknown[][]>) {
  const book = new ExcelJS.Workbook();
  for (const [nama, baris] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(nama);
    baris.forEach((isi) => sheet.addRow(isi));
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("rupiahBulat", () => {
  it("menerima pemisah ribuan titik/koma, Rp, dan ekor sen nol", () => {
    expect(rupiahBulat("1.500.000")).toBe(1500000);
    expect(rupiahBulat("1,500,000")).toBe(1500000);
    expect(rupiahBulat("Rp 1.500.000,00")).toBe(1500000);
    expect(rupiahBulat("1500000.00")).toBe(1500000);
    expect(rupiahBulat("1.500")).toBe(1500);
    expect(rupiahBulat(2500000)).toBe(2500000);
  });

  it("menolak sen bukan nol, negatif, pemisah campur, dan teks", () => {
    expect(rupiahBulat("1.500.000,50")).toBeNull();
    expect(rupiahBulat("1,5")).toBeNull();
    expect(rupiahBulat(1500.5)).toBeNull();
    expect(rupiahBulat("-5000")).toBeNull();
    expect(rupiahBulat(-5000)).toBeNull();
    expect(rupiahBulat("1.500,000")).toBeNull();
    expect(rupiahBulat("15.00.000")).toBeNull();
    expect(rupiahBulat("satu juta")).toBeNull();
    expect(rupiahBulat("")).toBeNull();
  });
});

describe("tanggalSel", () => {
  it("membaca tanggal Excel, nomor seri, ISO, dan DD/MM/YYYY tanpa geser zona", () => {
    expect(tanggalSel(new Date(Date.UTC(2026, 9, 31)))).toBe("2026-10-31");
    expect(tanggalSel(46326)).toBe("2026-10-31");
    expect(tanggalSel("2026-10-31")).toBe("2026-10-31");
    expect(tanggalSel("31/10/2026")).toBe("2026-10-31");
    expect(tanggalSel("1-9-2026")).toBe("2026-09-01");
  });

  it("menolak tanggal yang tidak ada", () => {
    expect(tanggalSel("31/02/2026")).toBeNull();
    expect(tanggalSel("2026-13-01")).toBeNull();
    expect(tanggalSel("besok")).toBeNull();
    expect(tanggalSel(1.5)).toBeNull();
  });
});

describe("bacaWorkbookSaldoAwalFaktur", () => {
  const judul = [...KOLOM_SALDO_AWAL_FAKTUR];

  it("satu pemasok dengan tiga faktur terbuka terbaca sebagai tiga baris, total cocok", async () => {
    const hasil = await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [
      judul,
      ["Hutang", "S-1", "PT Fiksi Satu", "INV-1", new Date(Date.UTC(2026, 7, 1)), "31/08/2026", "1.000.000", "1.500.000", "Sisa cicilan"],
      ["HUTANG", "S-1", "PT Fiksi Satu", "INV-2", "2026-09-01", "2026-10-01", 2000000, null, null],
      [],
      ["HUTANG", null, "PT Fiksi Satu", "INV-3", "15/09/2026", "15/10/2026", "Rp 3.000.000,00", null, null],
      ["PIUTANG", "C-1", "Toko Fiksi", "FJ-77", "10/09/2026", "10/10/2026", "250,000", null, null],
    ] }));
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows).toHaveLength(4);
    expect(hasil.rows[0]).toEqual({
      baris: 2, jenis: "HUTANG", kode_pihak: "S-1", nama_pihak: "PT Fiksi Satu", no_faktur: "INV-1",
      tanggal: "2026-08-01", jatuh_tempo: "2026-08-31", sisa: "1000000", total_asli: "1500000", keterangan: "Sisa cicilan",
    });
    expect(hasil.rows.map((r) => r.baris)).toEqual([2, 3, 5, 6]);
    expect(ringkasFile(hasil.rows)).toEqual({ HUTANG: { jumlah: 3, total: 6000000 }, PIUTANG: { jumlah: 1, total: 250000 } });
  });

  it("nilai yang gagal dibaca dikirim mentah supaya ditandai, bukan diam-diam jadi nol", async () => {
    const hasil = await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [
      judul,
      ["HUTANG", null, "PT Fiksi", "X-1", "31/02/2026", "kemarin", "1.500,50", "abc", null],
    ] }));
    expect(hasil.rows[0]).toMatchObject({ tanggal: "31/02/2026", jatuh_tempo: "kemarin", sisa: "1.500,50", total_asli: "abc" });
    expect(ringkasFile(hasil.rows).HUTANG).toEqual({ jumlah: 1, total: 0 });
  });

  it("menerima dua sheet Hutang/Piutang tanpa kolom Jenis, nomor baris tetap unik", async () => {
    const tanpaJenis = judul.filter((j) => j !== "Jenis");
    const hasil = await bacaWorkbookSaldoAwalFaktur(await buku({
      Hutang: [tanpaJenis, ["S-1", "PT Fiksi", "INV-1", "01/09/2026", "01/10/2026", 100, null, null]],
      Piutang: [tanpaJenis, ["C-1", "Toko Fiksi", "FJ-1", "01/09/2026", "01/10/2026", 200, null, null]],
    }));
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows.map((r) => [r.jenis, r.baris])).toEqual([["HUTANG", 2], ["PIUTANG", 100002]]);
  });

  it("judul kolom boleh beda tanda baca, kolom wajib yang hilang ditolak", async () => {
    const ok = await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [
      ["JENIS", "Nama Pihak", "No. Faktur", "Tgl Faktur", "Jatuh  Tempo", "Sisa Tagihan"],
      ["PIUTANG", "Toko Fiksi", "FJ-1", "01/09/2026", "01/10/2026", "5.000"],
    ] }));
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0]).toMatchObject({ no_faktur: "FJ-1", sisa: "5000", kode_pihak: null, total_asli: null });
    const kurang = await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [["Jenis", "Nama Pihak", "No Faktur"], ["HUTANG", "A", "1"]] }));
    expect(kurang.rows).toEqual([]);
    expect(kurang.errors[0]).toContain("Tanggal Faktur, Jatuh Tempo, Sisa Tagihan");
  });

  it("menolak file tanpa sheet yang dikenal, file kosong, dan file bukan Excel", async () => {
    expect((await bacaWorkbookSaldoAwalFaktur(await buku({ Lain: [["A"]] }))).errors[0]).toContain("tidak ditemukan");
    expect((await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [judul] }))).errors[0]).toContain("belum berisi");
    expect((await bacaWorkbookSaldoAwalFaktur(new TextEncoder().encode("bukan excel"))).errors[0]).toContain("bukan Excel");
    expect((await bacaWorkbookSaldoAwalFaktur(new Uint8Array())).errors[0]).toContain("2 MB");
  });

  it("membatasi 2.000 baris per file", async () => {
    const baris = Array.from({ length: 2001 }, (_, i) => ["HUTANG", null, "PT Fiksi", `INV-${i}`, "01/09/2026", "01/10/2026", 1, null, null]);
    const hasil = await bacaWorkbookSaldoAwalFaktur(await buku({ "Saldo Awal Faktur": [judul, ...baris] }));
    expect(hasil.rows).toEqual([]);
    expect(hasil.errors[0]).toContain("2.000");
  });

  it("template dari aplikasi terbaca ulang dengan kolom yang sama", async () => {
    const hasil = await bacaWorkbookSaldoAwalFaktur(await buatTemplateSaldoAwalFaktur());
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows.map((r) => [r.jenis, r.tanggal, r.jatuh_tempo, r.sisa])).toEqual([
      ["HUTANG", "2026-09-01", "2026-10-01", "1500000"],
      ["PIUTANG", "2026-09-15", "2026-10-15", "750000"],
    ]);
  });
});
