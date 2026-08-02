import { describe, expect, it } from "vitest";
import { hitungGaji, jurnalPenggajian, type InputGaji } from "../payroll";
import { AKUN_PIUTANG_KARYAWAN } from "../kasbon";
import type { AturanGaji } from "../payroll-aturan";

const aturan: AturanGaji = {
  telat_mulai_menit: 1,
  telat_blok_menit: 5,
  telat_nominal_per_blok: 10_000,
  telat_maks: 50_000,
  bolos_per_hari: 150_000,
  lembur_per_jam: 20_000,
};

// 5 hari kerja + 1 hari libur terjadwal.
const jadwal = [
  { tanggal: "2026-08-03", isLibur: false, jamMasuk: "08:00" },
  { tanggal: "2026-08-04", isLibur: false, jamMasuk: "08:00" },
  { tanggal: "2026-08-05", isLibur: false, jamMasuk: "08:00" },
  { tanggal: "2026-08-06", isLibur: false, jamMasuk: "08:00" },
  { tanggal: "2026-08-07", isLibur: false, jamMasuk: "08:00" },
  { tanggal: "2026-08-08", isLibur: true, jamMasuk: null },
];

const dasar: InputGaji = {
  gajiPokok: 4_200_000,
  jadwal,
  absen: jadwal.filter((h) => !h.isLibur).map((h) => ({ tanggal: h.tanggal, jamMasuk: "07:55" })),
  tanggalCuti: [],
  jamLembur: 0,
  komponen: [],
  reimburse: 0,
  komisi: 0,
  kasbon: null,
  penyesuaian: 0,
  aturan,
};

describe("hitungGaji", () => {
  it("hadir penuh tanpa telat = gaji pokok utuh", () => {
    const r = hitungGaji(dasar);
    expect(r.hariKerja).toBe(5);
    expect(r.hariHadir).toBe(5);
    expect(r.hariBolos).toBe(0);
    expect(r.total).toBe(4_200_000);
  });

  it("hari libur terjadwal tidak pernah dihitung bolos", () => {
    const r = hitungGaji({ ...dasar, absen: [] });
    expect(r.hariKerja).toBe(5);
    expect(r.hariBolos).toBe(5);
    expect(r.potonganBolos).toBe(750_000);
  });

  it("cuti disetujui bukan bolos", () => {
    const r = hitungGaji({ ...dasar, absen: [], tanggalCuti: jadwal.slice(0, 5).map((h) => h.tanggal) });
    expect(r.hariBolos).toBe(0);
    expect(r.potonganBolos).toBe(0);
  });

  it("telat dihitung per hari, batas atas berlaku harian", () => {
    const r = hitungGaji({
      ...dasar,
      absen: [
        { tanggal: "2026-08-03", jamMasuk: "08:06" },  // 6 mnt → 2 blok = 20rb
        { tanggal: "2026-08-04", jamMasuk: "11:00" },  // 180 mnt → kena batas 50rb
        { tanggal: "2026-08-05", jamMasuk: "08:00" },  // tepat waktu
        { tanggal: "2026-08-06", jamMasuk: "07:50" },  // lebih awal
        { tanggal: "2026-08-07", jamMasuk: "08:01" },  // 1 mnt → 1 blok = 10rb
      ],
    });
    expect(r.menitTelat).toBe(6 + 180 + 0 + 0 + 1);
    expect(r.potonganTelat).toBe(20_000 + 50_000 + 10_000);
    expect(r.total).toBe(4_200_000 - 80_000);
  });

  it("komisi penjualan menambah gaji bersih", () => {
    expect(hitungGaji({ ...dasar, komisi: 350_000 }).total).toBe(4_550_000);
  });

  it("lembur, tunjangan, potongan tetap, reimburse, dan cicilan kasbon", () => {
    const r = hitungGaji({
      ...dasar,
      jamLembur: 3,
      komponen: [
        { tipe: "tunjangan", nominal: 500_000 },
        { tipe: "potongan", nominal: 50_000 },
      ],
      reimburse: 75_000,
      kasbon: { jumlah: 3_000_000, tenor: 3, sudahDibayar: 0 },
    });
    expect(r.upahLembur).toBe(60_000);
    expect(r.tunjangan).toBe(500_000);
    expect(r.potonganTetap).toBe(50_000);
    expect(r.cicilanKasbon).toBe(1_000_000);
    expect(r.total).toBe(4_200_000 + 500_000 + 60_000 + 75_000 - 50_000 - 1_000_000);
  });

  it("koreksi manual bisa menambah maupun mengurangi", () => {
    expect(hitungGaji({ ...dasar, penyesuaian: 250_000 }).total).toBe(4_450_000);
    expect(hitungGaji({ ...dasar, penyesuaian: -200_000 }).total).toBe(4_000_000);
  });

  it("gaji bersih tidak pernah negatif", () => {
    const r = hitungGaji({ ...dasar, gajiPokok: 500_000, kasbon: { jumlah: 3_000_000, tenor: 1, sudahDibayar: 0 } });
    expect(r.total).toBe(0);
  });
});

describe("jurnalPenggajian", () => {
  it("seimbang tanpa kasbon", () => {
    const l = jurnalPenggajian("1102", AKUN_PIUTANG_KARYAWAN, 4_200_000, 0);
    expect(l).toEqual([
      { code: "5201", debit: 4_200_000, credit: 0 },
      { code: "1102", debit: 0, credit: 4_200_000 },
    ]);
  });

  it("cicilan kasbon mengurangi piutang karyawan, bukan menambah beban kas", () => {
    const l = jurnalPenggajian("1101", AKUN_PIUTANG_KARYAWAN, 3_200_000, 1_000_000);
    const debit = l.reduce((a, x) => a + x.debit, 0);
    const credit = l.reduce((a, x) => a + x.credit, 0);
    expect(debit).toBe(credit);
    expect(l.find((x) => x.code === AKUN_PIUTANG_KARYAWAN)?.credit).toBe(1_000_000);
    expect(l.find((x) => x.code === "1101")?.credit).toBe(3_200_000);
  });
});
