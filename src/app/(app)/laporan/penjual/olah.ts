// Pengolahan bersama laporan Penjualan per Tenaga Penjual: dipakai halaman DAN
// unduhan Excel/CSV (A3, meeting 12 Nov 2026), supaya angka di layar dan di berkas
// selalu dari saringan & rumus yang sama.
import {
  atribusiPenjual, rekapPerItem, rekapTenagaPenjual, saringAtribusi,
  JENIS_PENJUAL, KANAL_PENJUAL, LABEL_KANAL_PENJUAL, LABEL_PERAN, PERAN_SEMUA,
  type AtribusiPenjual, type KanalPenjual, type PeranPenjual, type RekapItemPenjual, type RekapPenjual, type TotalPerusahaan,
} from "@/lib/laporan-tenaga-penjual";
import type { JenisBarisPenjualan } from "@/lib/laporan-penjualan-barang";
import type { DataTenagaPenjual, FakturBelumLunas } from "./data";

export type TampilanPenjual = "rekap-item" | "rincian";
export const TAMPILAN_PENJUAL: TampilanPenjual[] = ["rekap-item", "rincian"];
export const LABEL_TAMPILAN: Record<TampilanPenjual, string> = {
  "rekap-item": "Rekap per item (qty)",
  rincian: "Rincian per transaksi",
};

export type ParamPenjual = {
  dari?: string; sampai?: string; cabang_id?: string; kanal?: string; peran?: string;
  karyawan?: string; jenis?: string; tampilan?: string; tampil?: string;
};

const satuDari = <T extends string>(nilai: string | undefined, pilihan: readonly T[]): T | "" =>
  (pilihan as readonly string[]).includes(nilai ?? "") ? (nilai as T) : "";

/** Saringan yang sudah divalidasi terhadap pilihan yang sah. */
export type SaringanTerpakai = {
  kanal: KanalPenjual | "";
  peran: PeranPenjual | "";
  jenis: JenisBarisPenjualan | "";
  tampilan: TampilanPenjual;
};

export function bacaSaringan(sp: ParamPenjual): SaringanTerpakai {
  return {
    kanal: satuDari<KanalPenjual>(sp.kanal, KANAL_PENJUAL),
    peran: satuDari<PeranPenjual>(sp.peran, PERAN_SEMUA),
    jenis: satuDari<JenisBarisPenjualan>(sp.jenis, JENIS_PENJUAL),
    // Bawaan tetap tampilan lama (rincian) supaya kebiasaan pengguna tidak berubah.
    tampilan: satuDari<TampilanPenjual>(sp.tampilan, TAMPILAN_PENJUAL) || "rincian",
  };
}

export type LaporanPenjualSiap = {
  terpilih: AtribusiPenjual[];
  orang: RekapPenjual[];
  tanpaPenjual: RekapPenjual | null;
  total: TotalPerusahaan;
  barisRekap: RekapPenjual[];
  perItem: RekapItemPenjual[];
  fakturTerpilih: FakturBelumLunas[];
  labelOrang: (employeeId: string | null) => string;
};

export function olahLaporanPenjual(
  data: Pick<DataTenagaPenjual, "rows" | "faktur" | "namaKaryawan">,
  saringan: SaringanTerpakai & { cabangId: string; karyawanId: string },
): LaporanPenjualSiap {
  const terpilih = saringAtribusi(atribusiPenjual(data.rows), saringan);
  const { orang, tanpaPenjual, total } = rekapTenagaPenjual(terpilih);

  const jumlahNama = new Map<string, number>();
  for (const nama of data.namaKaryawan.values()) jumlahNama.set(nama, (jumlahNama.get(nama) ?? 0) + 1);
  const labelOrang = (employeeId: string | null): string => {
    if (!employeeId) return "Tanpa tenaga penjual";
    const nama = data.namaKaryawan.get(employeeId);
    if (!nama) return `Karyawan terhapus (ID ${employeeId.slice(-8)})`;
    return (jumlahNama.get(nama) ?? 0) > 1 ? `${nama} (ID ${employeeId.slice(-8)})` : nama;
  };

  // Rekap per item: dikelompokkan per orang mengikuti urutan rekap per orang (netto terbesar dulu).
  const urutanOrang = new Map([...orang.map((r) => r.employeeId), null].map((id, index) => [id, index]));
  const perItem = rekapPerItem(terpilih)
    .sort((a, b) => (urutanOrang.get(a.employeeId) ?? 0) - (urutanOrang.get(b.employeeId) ?? 0));

  return {
    terpilih, orang, tanpaPenjual, total,
    barisRekap: [...orang, ...(tanpaPenjual ? [tanpaPenjual] : [])],
    perItem,
    fakturTerpilih: data.faktur.filter((f) => !saringan.karyawanId || f.penjualId === saringan.karyawanId),
    labelOrang,
  };
}

export const labelPeran = (peran: readonly PeranPenjual[]) => peran.length ? peran.map((p) => LABEL_PERAN[p]).join(" · ") : "—";
export { LABEL_KANAL_PENJUAL };
