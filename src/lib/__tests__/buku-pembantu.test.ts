import { describe, it, expect } from "vitest";
import { bukuPembantu, totalPembantu, selisihBukuBesar, type Mutasi } from "../buku-pembantu";

const m = (p: Partial<Mutasi> & { tanggal: string }): Mutasi => ({
  pihakId: "c1", pihak: "Budi", nomor: "INV-1", jenis: "Faktur",
  keterangan: "", naik: 0, turun: 0, ...p,
});

describe("bukuPembantu", () => {
  it("mutasi sebelum rentang jadi saldo awal, bukan baris", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-07-10", naik: 500_000 }),
      m({ tanggal: "2026-08-05", naik: 200_000, nomor: "INV-2" }),
    ], "2026-08-01", "2026-08-31");
    expect(r[0].saldoAwal).toBe(500_000);
    expect(r[0].mutasi).toHaveLength(1);
    expect(r[0].saldoAkhir).toBe(700_000);
  });

  it("saldo berjalan menumpuk dari saldo awal", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-07-01", naik: 100_000 }),
      m({ tanggal: "2026-08-02", naik: 50_000, nomor: "INV-2" }),
      m({ tanggal: "2026-08-03", turun: 120_000, jenis: "Pembayaran", nomor: "BYR-1" }),
    ], "2026-08-01", "2026-08-31");
    expect(r[0].mutasi.map((x) => x.saldo)).toEqual([150_000, 30_000]);
  });

  it("mutasi setelah rentang tidak ikut — laporan ini posisi per tanggal", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-08-02", naik: 50_000 }),
      m({ tanggal: "2026-09-01", naik: 999_000, nomor: "INV-9" }),
    ], "2026-08-01", "2026-08-31");
    expect(r[0].saldoAkhir).toBe(50_000);
  });

  it("faktur didahulukan dari pembayaran di tanggal yang sama", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-08-02", turun: 50_000, jenis: "Pembayaran", nomor: "BYR-1" }),
      m({ tanggal: "2026-08-02", naik: 50_000, nomor: "INV-2" }),
    ], "2026-08-01", "2026-08-31");
    expect(r[0].mutasi.map((x) => x.jenis)).toEqual(["Faktur", "Pembayaran"]);
    expect(r[0].mutasi.map((x) => x.saldo)).toEqual([50_000, 0]);
  });

  it("pihak yang tidak bergerak dan saldo awalnya nol tidak ditampilkan", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-09-05", naik: 10_000, pihakId: "c2", pihak: "Sinta" }),
      m({ tanggal: "2026-08-02", naik: 50_000 }),
    ], "2026-08-01", "2026-08-31");
    expect(r.map((x) => x.pihak)).toEqual(["Budi"]);
  });

  it("faktur yang sudah lunas tetap terlihat walau saldo akhirnya nol", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-08-02", naik: 50_000 }),
      m({ tanggal: "2026-08-04", turun: 50_000, jenis: "Pembayaran", nomor: "BYR-1" }),
    ], "2026-08-01", "2026-08-31");
    expect(r).toHaveLength(1);
    expect(r[0].saldoAkhir).toBe(0);
    expect(r[0].mutasi).toHaveLength(2);
  });

  it("saldo akhir terbesar di atas", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-08-02", naik: 10_000, pihakId: "c1", pihak: "Budi" }),
      m({ tanggal: "2026-08-02", naik: 90_000, pihakId: "c2", pihak: "Sinta" }),
    ], "2026-08-01", "2026-08-31");
    expect(r.map((x) => x.pihak)).toEqual(["Sinta", "Budi"]);
  });
});

describe("totalPembantu", () => {
  it("menjumlah semua pihak", () => {
    const r = bukuPembantu([
      m({ tanggal: "2026-08-02", naik: 10_000, pihakId: "c1", pihak: "Budi" }),
      m({ tanggal: "2026-08-02", naik: 90_000, pihakId: "c2", pihak: "Sinta" }),
      m({ tanggal: "2026-08-03", turun: 40_000, jenis: "Pembayaran", nomor: "B1", pihakId: "c2", pihak: "Sinta" }),
    ], "2026-08-01", "2026-08-31");
    expect(totalPembantu(r)).toEqual({ saldoAwal: 0, naik: 100_000, turun: 40_000, saldoAkhir: 60_000 });
  });
});

describe("selisihBukuBesar", () => {
  it("pecahan sen tidak dianggap selisih", () => {
    expect(selisihBukuBesar(1_000_000.4, 1_000_000)).toBe(0);
  });
  it("selisih nyata terbaca", () => {
    expect(selisihBukuBesar(1_000_000, 900_000)).toBe(100_000);
  });
});
