import { describe, expect, it } from "vitest";
import {
  formatNoRetur, sisaRetur, totalRetur,
  modalPerBarang, bolehMasukStok, pisahModalRetur,
} from "../retur";

describe("formatNoRetur", () => {
  it("format RB/RJ.YYYY.MM.NNNNN", () => {
    expect(formatNoRetur("RB", new Date(2026, 6, 23), 1)).toBe("RB.2026.07.00001");
    expect(formatNoRetur("RJ", new Date(2026, 11, 3), 42)).toBe("RJ.2026.12.00042");
  });
});

describe("sisaRetur", () => {
  it("kurangi retur sebelumnya, item habis hilang", () => {
    expect(sisaRetur({ a: 10, b: 2 }, { a: 4, b: 2 })).toEqual({ a: 6 });
  });
  it("tanpa retur sebelumnya", () => {
    expect(sisaRetur({ a: 3 }, {})).toEqual({ a: 3 });
  });
});

describe("totalRetur", () => {
  it("jumlahkan qty x harga", () => {
    expect(totalRetur([{ qty: 2, harga: 5000 }, { qty: 1, harga: 2500 }])).toBe(12500);
  });
  it("baris kosong = 0", () => {
    expect(totalRetur([])).toBe(0);
  });
});

// ── Refund proporsional & modal retur (temuan simulasi 2026-08-02) ─────────
import { rasioBayar, hargaRefund, modalPerSatuan } from "../retur";

describe("rasioBayar", () => {
  it("tanpa diskon, refund penuh", () => {
    expect(rasioBayar(100_000, 100_000)).toBe(1);
  });

  it("struk berdiskon menghasilkan rasio di bawah 1", () => {
    // Kasus nyata simulasi: kotor 911.000, dibayar 735.500.
    expect(rasioBayar(911_000, 735_500)).toBeCloseTo(0.8074, 3);
  });

  it("data aneh tidak pernah bikin refund membengkak", () => {
    expect(rasioBayar(100_000, 250_000)).toBe(1);   // di-cap di 1
    expect(rasioBayar(0, 50_000)).toBe(1);
    expect(rasioBayar(100_000, -5)).toBe(1);
  });
});

describe("hargaRefund", () => {
  it("harga daftar dipotong sesuai rasio", () => {
    // Royal Canin 285.000 di struk yang dibayar ~80,7% → 230.096,
    // bukan 285.000 penuh seperti sebelum perbaikan.
    expect(hargaRefund(285_000, rasioBayar(911_000, 735_500))).toBe(230_096);
  });

  it("tidak pernah negatif", () => {
    expect(hargaRefund(-100, 1)).toBe(0);
  });
});

describe("modalPerSatuan", () => {
  it("pakai HPP saat barang terjual, bukan harga master", () => {
    // Keluar 3 pcs dengan modal total 600.000 → 200.000/pcs,
    // walau master barang menulis 210.000.
    expect(modalPerSatuan(600_000, 3, 210_000)).toBe(200_000);
  });

  it("struk lama tanpa HPP jatuh ke harga beli master", () => {
    expect(modalPerSatuan(null, 3, 210_000)).toBe(210_000);
    expect(modalPerSatuan(0, 3, 210_000)).toBe(210_000);
  });
});

// ── Kondisi barang retur (laporan tim 2026-08-12) ─────────────────────────────

describe("modalPerBarang", () => {
  it("satu barang di dua satuan dijumlahkan, bukan saling menimpa", () => {
    // 1 box isi 12 (HPP 240.000) + 3 pcs (HPP 60.000) = 15 pcs, modal 300.000
    // → modal per pcs 20.000. Kalau per baris & saling menimpa, hasilnya 60.000/3.
    const modal = modalPerBarang([
      { item_id: "a", qtyDasar: 12, hpp: 240_000 },
      { item_id: "a", qtyDasar: 3, hpp: 60_000 },
    ]);
    expect(modal.a).toBe(20_000);
  });

  it("baris tanpa item / qty nol diabaikan", () => {
    expect(modalPerBarang([{ item_id: null, qtyDasar: 5, hpp: 100 }])).toEqual({});
    expect(modalPerBarang([{ item_id: "a", qtyDasar: 0, hpp: 100 }])).toEqual({});
  });

  it("struk tanpa HPP tersimpan jatuh ke 0 (pemanggil pakai harga beli master)", () => {
    expect(modalPerBarang([{ item_id: "a", qtyDasar: 2, hpp: null }]).a).toBe(0);
  });
});

describe("bolehMasukStok", () => {
  it("hanya kondisi rusak yang ditahan", () => {
    expect(bolehMasukStok("baik")).toBe(true);
    expect(bolehMasukStok(undefined)).toBe(true);   // baris retur lama
    expect(bolehMasukStok("RUSAK")).toBe(false);
  });
});

describe("pisahModalRetur", () => {
  const modal = (id: string) => ({ a: 10_000, b: 5_000 }[id] ?? 0);
  const semuaBerstok = () => true;

  it("barang baik masuk persediaan, barang rusak jadi kerugian", () => {
    const hasil = pisahModalRetur(
      [
        { item_id: "a", qty: 2, kondisi: "baik" },
        { item_id: "b", qty: 3, kondisi: "rusak" },
      ],
      modal, semuaBerstok,
    );
    expect(hasil).toEqual({ baik: 20_000, rusak: 15_000, total: 35_000 });
  });

  it("jasa tidak punya modal persediaan sama sekali", () => {
    const hasil = pisahModalRetur(
      [{ item_id: "a", qty: 2, kondisi: "baik" }],
      modal, () => false,
    );
    expect(hasil).toEqual({ baik: 0, rusak: 0, total: 0 });
  });

  it("total selalu sama dengan HPP yang dibalik, apa pun kondisinya", () => {
    const baris = [
      { item_id: "a", qty: 1, kondisi: "baik" },
      { item_id: "a", qty: 1, kondisi: "rusak" },
    ];
    const h = pisahModalRetur(baris, modal, semuaBerstok);
    expect(h.baik + h.rusak).toBe(h.total);
    expect(h.total).toBe(20_000);
  });
});
