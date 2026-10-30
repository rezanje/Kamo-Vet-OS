import { describe, expect, it } from "vitest";
import { bacaMaster, periksaZip } from "@/lib/migrasi-kartu-medis/baca-master";
import { VERSI_LEGACY_MASTER_V0 } from "@/lib/migrasi-kartu-medis/kontrak";
import { buatMaster, masterDasar, tgl } from "./fixtures/master-kartu-medis";

const gagal = async (bytes: Uint8Array) => {
  const hasil = await bacaMaster(bytes);
  expect(hasil.ok).toBe(false);
  return hasil.ok ? [] : hasil.galat;
};

describe("kontrak master v0", () => {
  it("accepts an unmarked master only as legacy-master-v0 with a version warning", async () => {
    const hasil = await bacaMaster(await buatMaster(masterDasar()));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.versi).toBe(VERSI_LEGACY_MASTER_V0);
    expect(hasil.peringatan.join(" ")).toContain("tanpa penanda versi");
    expect(hasil.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hasil.blok.riwayat.baris).toHaveLength(2);
    expect(hasil.blok.mapping_file.baris).toHaveLength(1);
    expect(hasil.blok.mapping_sheet.baris).toHaveLength(2);
    expect(hasil.blok.pemilik.barisHeader).toBe(5);
    expect(hasil.blok.mapping_file.barisHeader).toBe(29);
    expect(hasil.blok.mapping_sheet.barisHeader).toBe(35);
    expect(hasil.blok.mapping_file.catatanDilewati).toBe(1);
  });
  it("accepts a known explicit marker without warning and rejects an unknown one", async () => {
    const dikenal = await bacaMaster(await buatMaster({ ...masterDasar(), versi: VERSI_LEGACY_MASTER_V0 }));
    expect(dikenal.ok && dikenal.peringatan.some((p) => p.includes("tanpa penanda"))).toBe(false);
    expect((await gagal(await buatMaster({ ...masterDasar(), versi: "v9" }))).join(" ")).toContain('Versi kontrak "v9" tidak dikenal');
  });
  it("reads columns by label regardless of order and header row position (rows 5/29/35 are hints)", async () => {
    const hasil = await bacaMaster(await buatMaster({ ...masterDasar(), balikKolom: true, barisHeader: 8 }));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.blok.pemilik.barisHeader).toBe(8);
    const r = hasil.blok.riwayat.baris[0].sel;
    expect(r.diagnosis).toEqual({ jenis: "teks", teks: "UJI DIAGNOSIS 1" });
    expect(r.record_date).toEqual({ jenis: "tanggal", tanggal: tgl("2026-01-15") });
  });
  it("does not read schema notes above the header, nor notes between the two Mapping blocks, as records", async () => {
    const hasil = await bacaMaster(await buatMaster(masterDasar(1)));
    expect(hasil.ok && hasil.blok.pemilik.baris.map((b) => b.baris)).toEqual([6]);
    expect(hasil.ok && hasil.blok.mapping_file.baris.map((b) => b.baris)).toEqual([30]);
    expect(hasil.ok && hasil.blok.mapping_sheet.baris.map((b) => b.baris)).toEqual([36]);
  });
  it.each([
    ["a missing required sheet", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => wb.removeWorksheet(wb.getWorksheet("Hewan")!.id) }), 'Sheet wajib "Hewan" tidak ada'],
    ["a missing header label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("C5").value = "Telepon"; } }), "header pemilik tidak lengkap"],
    ["an English alias instead of the exact label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("B5").value = "name"; } }), "header pemilik tidak lengkap"],
    ["a duplicated label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("J5").value = "Alamat | address"; } }), "header pemilik tidak lengkap atau ganda"],
    ["the same Mapping block twice", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("Mapping")!;
      ["sample_id", "File asli", "Path components asli (JSON)", "SHA-256 file", "Drive file URL", "Jumlah sheet", "Foto medis dikecualikan", "Perubahan asli"].forEach((t, i) => { ws.getRow(50).getCell(i + 1).value = t; });
    } }), "header mapping_file muncul 2 kali"],
    ["a blank row inside record data", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("RiwayatMedis")!;
      ws.getCell("A9").value = "R9"; ws.getCell("B9").value = "H1";
    } }), "ada isi setelah akhir tabel riwayat"],
    ["a data-like row between the two Mapping blocks", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("Mapping")!;
      ws.getCell("A32").value = "S2"; ws.getCell("B32").value = "lain.xlsx";
    } }), "ada isi setelah akhir tabel mapping_file"],
    ["a 1904 date system workbook", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { (wb.properties as { date1904?: boolean }).date1904 = true; } }), "Sistem tanggal 1904"],
  ])("fails the whole file for %s", async (_label, ubah, pesan) => {
    expect((await gagal(await buatMaster(ubah(masterDasar())))).join(" ")).toContain(pesan);
  });
  it("rejects non-zip bytes and inconsistent zip directories without parsing", () => {
    expect(periksaZip(new TextEncoder().encode("bukan zip"))).toContain("zip tidak dikenali");
  });
  it("rejects a file above the byte bound before reading", async () => {
    expect((await gagal(new Uint8Array(20 * 1024 * 1024 + 1))).join(" ")).toContain("melebihi 20 MB");
  });
  it("keeps formula cells as formulas (cached result not trusted as data or approval)", async () => {
    const f = masterDasar(1);
    f.riwayat[0].decision = { formula: '"SETUJU"', result: "SETUJU" } as never;
    const hasil = await bacaMaster(await buatMaster(f));
    expect(hasil.ok && hasil.blok.riwayat.baris[0].sel.decision.jenis).toBe("rumus");
  });
});
