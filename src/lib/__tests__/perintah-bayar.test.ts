import { describe, expect, it } from "vitest";
import { formatNoPerintahBayar, sisaFakturBayar } from "../perintah-bayar";

describe("formatNoPerintahBayar", () => {
  it("format PP.YYYY.MM.NNNNN", () => {
    expect(formatNoPerintahBayar(new Date(2026, 7, 3), 4)).toBe("PP.2026.08.00004");
  });
});

describe("sisaFakturBayar", () => {
  const faktur = [{ id: "f1", total: 1_000_000 }, { id: "f2", total: 500_000 }];

  it("kurangi pembayaran yang sudah masuk", () => {
    const s = sisaFakturBayar(faktur, [{ invoice_id: "f1", amount: 400_000 }], []);
    expect(s.get("f1")).toBe(600_000);
    expect(s.get("f2")).toBe(500_000);
  });

  it("perintah bayar yang masih menunggu ikut mengunci sisa", () => {
    const s = sisaFakturBayar(faktur, [], [{ invoice_id: "f1", jumlah: 1_000_000 }]);
    expect(s.get("f1")).toBe(0);
  });

  it("pembayaran + antrean dijumlah, tidak saling menimpa", () => {
    const s = sisaFakturBayar(faktur, [{ invoice_id: "f1", amount: 300_000 }], [{ invoice_id: "f1", jumlah: 200_000 }]);
    expect(s.get("f1")).toBe(500_000);
  });

  it("tidak pernah negatif", () => {
    const s = sisaFakturBayar(faktur, [{ invoice_id: "f2", amount: 900_000 }], []);
    expect(s.get("f2")).toBe(0);
  });

  it("faktur tanpa pembayaran tetap muncul dengan nilai penuh", () => {
    expect(sisaFakturBayar(faktur, [], []).get("f2")).toBe(500_000);
  });
});
