// Pesan galat "Tarik baris dari tagihan lunas (Owner)": kode RPC -> kalimat Indonesia sederhana.
import { expect, it } from "vitest";
import { labelJurnal, pesanTarikBaris } from "../tarik-baris-pesan";

it("memetakan setiap kode penolakan database ke kalimat Indonesia tanpa kode teknis", () => {
  const kode = ["ACCESS_DENIED", "REASON_REQUIRED", "LINE_INVALID", "PARTIAL_NOT_ALLOWED", "RECIPE_LINKED", "COST_MISMATCH", "STOCK_MISMATCH", "LAST_LINE", "LINE_WITHDRAWN",
    "INVOICE_VOID", "INVOICE_NOT_PAID", "INVOICE_ADJUSTED", "PAYMENT_METHOD", "REFUND_EXISTS", "POINTS_PRESENT", "PERIOD_LOCKED", "AVERAGE_UNSUPPORTED", "IDEMPOTENCY_CONFLICT"];
  for (const k of kode) {
    const pesan = pesanTarikBaris(`${k}: detail teknis`);
    expect(pesan, k).not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
    expect(pesan.length, k).toBeGreaterThan(15);
  }
});

it("menampilkan rincian angka hanya untuk penolakan yang butuh angka (HPP, kartu stok, periode, jumlah)", () => {
  expect(pesanTarikBaris("COST_MISMATCH: HPP baris Injeksi (2600.74) tidak sama dengan biaya BMHP-nya (9433.69)")).toContain("2600.74");
  expect(pesanTarikBaris("PERIOD_LOCKED: periode akuntansi sampai 2026-11-03 sudah ditutup")).toContain("2026-11-03");
  expect(pesanTarikBaris("ACCESS_DENIED: rincian rahasia")).not.toContain("rahasia");
});

it("galat kunci/timeout dan galat tak dikenal tidak membocorkan pesan mentah dan tidak menyuruh mengulang otomatis", () => {
  expect(pesanTarikBaris("canceling statement due to lock timeout")).toContain("sedang dipakai kasir lain");
  const asing = pesanTarikBaris("relation \"clinic_private.x\" does not exist");
  expect(asing).toContain("belum terkonfirmasi");
  expect(asing).not.toContain("clinic_private");
  expect(pesanTarikBaris(null)).toContain("belum terkonfirmasi");
});

it("label jurnal untuk pratinjau menyebut akun yang terdampak", () => {
  expect(labelJurnal("klinik-edit")).toContain("510002");
  expect(labelJurnal("klinik-hpp-edit")).toContain("170001");
  expect(labelJurnal("klinik-ar")).toContain("314001");
  expect(labelJurnal("lain")).toBe("lain");
});
