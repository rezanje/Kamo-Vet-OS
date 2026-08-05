import { describe, it, expect } from "vitest";
import {
  berikutnyaBelumSelesai, labelStatus, ringkasTagihanRombongan,
  type KunjunganSerombongan,
} from "../rombongan-tagihan";

const b = (o: Partial<KunjunganSerombongan> = {}): KunjunganSerombongan => ({
  visitId: "v1", hewan: "Michi", invoiceNo: "INV-202608-0001",
  total: 150_000, paidStatus: "Lunas", dibayar: 150_000, ...o,
});

describe("ringkasTagihanRombongan", () => {
  it("menjumlahkan tagihan & pembayaran seluruh hewan", () => {
    const r = ringkasTagihanRombongan([
      b({ visitId: "v1", total: 150_000, dibayar: 150_000 }),
      b({ visitId: "v2", hewan: "Iju", total: 200_000, dibayar: 50_000, paidStatus: "DP" }),
    ]);
    expect(r.jumlahPasien).toBe(2);
    expect(r.totalTagihan).toBe(350_000);
    expect(r.totalDibayar).toBe(200_000);
    expect(r.sisa).toBe(150_000);
    expect(r.semuaLunas).toBe(false);
  });

  it("semua lunas hanya kalau benar-benar semua", () => {
    expect(ringkasTagihanRombongan([b(), b({ visitId: "v2" })]).semuaLunas).toBe(true);
    expect(ringkasTagihanRombongan([b(), b({ visitId: "v2", paidStatus: "DP" })]).semuaLunas).toBe(false);
  });

  it("kunjungan tanpa tagihan tidak dihitung lunas", () => {
    // Kalau ini lolos sebagai "lunas", kasir mengira rombongannya beres padahal
    // ada hewan yang tagihannya belum pernah dibuat.
    const r = ringkasTagihanRombongan([
      b(),
      b({ visitId: "v2", invoiceNo: null, paidStatus: null, total: 0, dibayar: 0 }),
    ]);
    expect(r.semuaLunas).toBe(false);
    expect(r.adaBelumDitagih).toBe(true);
  });

  it("bayar lebih tidak bikin sisa negatif", () => {
    expect(ringkasTagihanRombongan([b({ total: 100_000, dibayar: 150_000 })]).sisa).toBe(0);
  });

  it("rombongan kosong bukan berarti lunas", () => {
    expect(ringkasTagihanRombongan([]).semuaLunas).toBe(false);
  });
});

describe("labelStatus", () => {
  it("membedakan belum ditagih dari belum lunas", () => {
    expect(labelStatus(b({ invoiceNo: null, paidStatus: null }))).toBe("Belum ditagih");
    expect(labelStatus(b({ paidStatus: "Belum Lunas" }))).toBe("Belum lunas");
    expect(labelStatus(b({ paidStatus: "DP" }))).toBe("DP");
    expect(labelStatus(b())).toBe("Lunas");
  });
});

describe("berikutnyaBelumSelesai", () => {
  it("menunjuk pasien berikutnya yang belum lunas", () => {
    const daftar = [
      b({ visitId: "v1", paidStatus: "Lunas" }),
      b({ visitId: "v2", hewan: "Iju", paidStatus: "Belum Lunas" }),
    ];
    expect(berikutnyaBelumSelesai(daftar, "v1")?.hewan).toBe("Iju");
  });

  it("kunjungan yang sedang dibuka tidak menunjuk dirinya sendiri", () => {
    expect(berikutnyaBelumSelesai([b({ visitId: "v1", paidStatus: "Belum Lunas" })], "v1")).toBeNull();
  });

  it("semua sudah lunas = tidak ada tujuan berikutnya", () => {
    expect(berikutnyaBelumSelesai([b({ visitId: "v1" }), b({ visitId: "v2" })], "v1")).toBeNull();
  });
});
