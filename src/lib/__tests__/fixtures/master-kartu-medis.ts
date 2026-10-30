/**
 * Pembuat master kartu medis SINTETIS untuk tes. Mengikuti tanda tangan header kontrak (kontrak.ts) dengan tata letak
 * yang diceritakan tim (catatan skema di atas, header baris 5; Mapping: blok FILE baris 29, PER-SHEET baris 35).
 * Bukan salinan workbook asli; semua isi fiktif.
 */
import ExcelJS from "exceljs";
import { TANDA_TANGAN, type NamaBlok } from "@/lib/migrasi-kartu-medis/kontrak";

type Nilai = ExcelJS.CellValue;
export type BarisFixture = Record<string, Nilai>;

export type FixtureMaster = {
  pemilik: BarisFixture[];
  hewan: BarisFixture[];
  riwayat: BarisFixture[];
  file?: BarisFixture[];
  perSheet: BarisFixture[];
  /** Penanda versi eksplisit; undefined = tanpa penanda. */
  versi?: string;
  /** Ubah workbook sebelum ditulis (kasus khusus). */
  ubah?: (wb: ExcelJS.Workbook) => void;
  /** Urutan kolom dibalik untuk membuktikan pembacaan tidak bergantung urutan. */
  balikKolom?: boolean;
  barisHeader?: number;
};

export const tgl = (iso: string) => new Date(`${iso}T00:00:00Z`);

function tulisBlok(ws: ExcelJS.Worksheet, nama: NamaBlok, barisHeader: number, rows: BarisFixture[], balik: boolean) {
  const label = TANDA_TANGAN[nama].label as Record<string, string>;
  const fields = Object.keys(label);
  const urut = balik ? [...fields].reverse() : fields;
  urut.forEach((field, i) => { ws.getRow(barisHeader).getCell(i + 1).value = label[field]; });
  rows.forEach((row, r) => {
    urut.forEach((field, i) => {
      if (field in row) ws.getRow(barisHeader + 1 + r).getCell(i + 1).value = row[field];
    });
  });
}

export async function buatMaster(f: FixtureMaster): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const h = f.barisHeader ?? 5;
  const catatan = (ws: ExcelJS.Worksheet) => {
    ws.getCell("A1").value = "MASTER SINTETIS — catatan skema (bukan data)";
    ws.getCell("A2").value = "Kolom (staging) tidak masuk database.";
  };
  const pemilik = wb.addWorksheet("Pemilik"); catatan(pemilik); tulisBlok(pemilik, "pemilik", h, f.pemilik, !!f.balikKolom);
  const hewan = wb.addWorksheet("Hewan"); catatan(hewan); tulisBlok(hewan, "hewan", h, f.hewan, !!f.balikKolom);
  const riwayat = wb.addWorksheet("RiwayatMedis"); catatan(riwayat); tulisBlok(riwayat, "riwayat", h, f.riwayat, !!f.balikKolom);
  const mapping = wb.addWorksheet("Mapping");
  mapping.getCell("A1").value = "Mapping schema section (catatan)";
  mapping.getCell("A5").value = "kolom → tabel";
  if (f.versi !== undefined) { mapping.getCell("D2").value = "contract_version"; mapping.getCell("E2").value = f.versi; }
  tulisBlok(mapping, "mapping_file", 29, f.file ?? [{ sample_id: "S1", file: "fiktif.xlsx", sheet_count: 2 }], false);
  mapping.getCell("A33").value = "PER-SHEET";
  tulisBlok(mapping, "mapping_sheet", 35, f.perSheet, false);
  wb.addWorksheet("Panduan").getCell("A1").value = "SETUJU berarti boleh (ini bukan otorisasi)";
  f.ubah?.(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Satu pemilik → satu hewan → n riwayat, semua SETUJU dan konsisten. */
export function masterDasar(n = 2): FixtureMaster {
  const riwayat: BarisFixture[] = [];
  const perSheet: BarisFixture[] = [];
  for (let i = 1; i <= n; i += 1) {
    const tanggal = `2026-01-${String(14 + i).padStart(2, "0")}`;
    riwayat.push({
      local_record_id: `R${i}`, local_pet_id: "H1", record_date: tgl(tanggal), record_no: `RM-00${i}`,
      doctor: "drh. Fiktif", note: `Keluhan uji ${i}`, anamnesis: `Anamnesis uji ${i}`,
      clinical_findings: `Gejala uji ${i}`, diagnosis: `UJI DIAGNOSIS ${i}`, therapy: `UJI TERAPI ${i}`,
      review_status: "OK", source_sheet: `${String(14 + i).padStart(2, "0")}012026`, decision: "SETUJU",
    });
    perSheet.push({
      local_ref: `R${i}`, file: "UJI KUCING.xlsx", sheet: `${String(14 + i).padStart(2, "0")}012026`,
      source_key: `uji pemilik::081234567890::uji kucing::${String(14 + i).padStart(2, "0")}012026`,
      tab_date: tgl(tanggal), cell_date: tgl(tanggal),
    });
  }
  return {
    pemilik: [{ local_owner_id: "P1", name: "UJI PEMILIK", phone: "081234567890", address: "Jl. Fiktif 1", review_status: "OK", decision: "SETUJU" }],
    hewan: [{ local_pet_id: "H1", local_owner_id: "P1", name: "UJI KUCING", species: "Kucing", breed: "Domestik", gender: "Betina", dob: tgl("2023-05-01"), review_status: "OK", decision: "SETUJU" }],
    riwayat, perSheet,
  };
}
