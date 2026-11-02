import { describe, expect, it } from "vitest";
import {
  jumlahHariBulan, namaPeriode, rincianPembayaran, ringkasTarget, tanggalPanjang, targetBulananCabang,
  type BarisTarget,
} from "../rincian-tutup-shift";

// Angka contoh dari pemilik toko (VN + gambar 2 Nov 2026).
describe("rincianPembayaran", () => {
  it("memecah omset shift jadi tunai dan non-tunai per metode", () => {
    const r = rincianPembayaran({ Tunai: 4_000_000, Transfer: 0, Debit: 200_000, Kredit: 0, QRIS: 800_000, "E-Wallet": 0 });
    expect(r.omset).toBe(5_000_000);
    expect(r.tunai).toBe(4_000_000);
    expect(r.nonTunai).toBe(1_000_000);
    expect(r.nonTunaiRincian).toEqual([{ metode: "Debit", jumlah: 200_000 }, { metode: "QRIS", jumlah: 800_000 }]);
  });

  it("tetap aman untuk shift tanpa rekap (lama / tutup paksa) dan metode di luar daftar", () => {
    expect(rincianPembayaran(null)).toEqual({ omset: 0, tunai: 0, nonTunai: 0, nonTunaiRincian: [] });
    const r = rincianPembayaran({ Tunai: 100, Voucher: 50 });
    expect(r.omset).toBe(150);
    expect(r.nonTunaiRincian).toEqual([{ metode: "Voucher", jumlah: 50 }]);
  });
});

describe("targetBulananCabang", () => {
  const baris = (o: Partial<BarisTarget>): BarisTarget => ({
    periode: "2026-11", target: 50_000_000, basis: "omzet", branch_id: "cab-a", employee_id: null, category_id: null, ...o,
  });

  it("hanya memakai target omzet yang cakupannya persis cabang itu", () => {
    const rows = [
      baris({}),
      baris({ target: 9, employee_id: "emp" }),
      baris({ target: 9, category_id: "kat" }),
      baris({ target: 9, basis: "laba" }),
      baris({ target: 9, branch_id: null }),
      baris({ target: 9, branch_id: "cab-b" }),
      baris({ target: 9, periode: "2026-10" }),
    ];
    expect(targetBulananCabang(rows, "cab-a", "2026-11")).toBe(50_000_000);
  });

  it("null kalau target cabang bulan itu belum diatur", () => {
    expect(targetBulananCabang([baris({ branch_id: "cab-b" })], "cab-a", "2026-11")).toBeNull();
  });
});

describe("ringkasTarget", () => {
  it("menghitung pencapaian bulanan dan harian seperti contoh", () => {
    const t = ringkasTarget({ periode: "2026-11", omsetBulan: 5_000_000, penjualanHari: 5_000_000, target: 50_000_000 });
    expect(t.jumlahHari).toBe(30);
    expect(t.persenBulan).toBe(10);
    expect(t.sisaTarget).toBe(45_000_000);
    expect(Math.round(t.targetHarian!)).toBe(1_666_667);
    expect(Math.round(t.persenHarian!)).toBe(300);
  });

  it("sisa target tidak minus kalau target sudah lewat", () => {
    expect(ringkasTarget({ periode: "2026-11", omsetBulan: 60, penjualanHari: 0, target: 50 }).sisaTarget).toBe(0);
  });

  it("tanpa target: omset tetap tampil, persen kosong", () => {
    const t = ringkasTarget({ periode: "2026-02", omsetBulan: 7, penjualanHari: 3, target: null });
    expect(t).toMatchObject({ jumlahHari: 28, omsetBulan: 7, penjualanHari: 3, persenBulan: null, targetHarian: null, persenHarian: null });
  });
});

it("format tanggal & periode Indonesia", () => {
  expect(tanggalPanjang("2026-11-01")).toBe("1 November 2026");
  expect(namaPeriode("2026-11")).toBe("November 2026");
  expect(jumlahHariBulan("2028-02")).toBe(29);
});
