// Pesan galat "Kembalikan saldo uang muka": kode RPC -> kalimat Indonesia sederhana, tanpa kode teknis atau pesan mentah.
import { expect, it } from "vitest";
import { hitungSaldoUangMuka, labelStatusRefund, pesanRefundUangMuka } from "../uang-muka-refund";

it("memetakan setiap kode penolakan database ke kalimat Indonesia tanpa kode teknis", () => {
  const kode = ["ACCESS_DENIED", "AMOUNT_INVALID", "AMOUNT_EXCEEDS", "REASON_REQUIRED", "DESTINATION_INVALID", "KEY_REQUIRED", "IDEMPOTENCY_CONFLICT", "ADVANCE_INVALID", "CLAIM_REQUIRED",
    "CLAIM_TAKEN", "CLAIM_STATE", "REFUND_NOT_FOUND", "REFUND_DONE", "REFUND_CANCELLED", "ALREADY_DONE", "REFERENCE_REQUIRED", "DATE_INVALID", "ACCOUNT_INVALID", "PERIOD_LOCKED",
    "CANCEL_CONFIRM_REQUIRED", "ADVANCE_REFUNDED", "ADVANCE_FENCE", "SOD_CLAIM", "SOD_COMPLETE"];
  for (const k of kode) {
    const pesan = pesanRefundUangMuka(`${k}: detail teknis rahasia`);
    expect(pesan, k).not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
    expect(pesan, k).not.toContain("rahasia");
    expect(pesan.length, k).toBeGreaterThan(15);
  }
});

it("jumlah melebihi saldo menyebut saldo yang tersisa, penolakan lain tidak membocorkan rincian", () => {
  expect(pesanRefundUangMuka("AMOUNT_EXCEEDS: jumlah 30001.00 melebihi saldo uang muka yang belum terpakai (30000.00)")).toContain("30.000");
  expect(pesanRefundUangMuka("PERIOD_LOCKED: periode akuntansi sampai 2026-11-03 sudah ditutup")).toContain("2026-11-03");
  expect(pesanRefundUangMuka("ACCESS_DENIED: apa saja")).not.toContain("apa saja");
});

it("galat kunci/timeout dan galat tak dikenal tidak membocorkan pesan mentah dan tidak menyuruh transfer ulang otomatis", () => {
  expect(pesanRefundUangMuka("canceling statement due to lock timeout")).toContain("sedang dipakai kasir lain");
  const asing = pesanRefundUangMuka("relation \"clinic_private.advance_refunds\" does not exist");
  expect(asing).toContain("belum terkonfirmasi");
  expect(asing).not.toContain("clinic_private");
  expect(asing).toContain("Jangan transfer ulang");
  expect(pesanRefundUangMuka(null)).toContain("belum terkonfirmasi");
  expect(pesanRefundUangMuka("permission denied for table x")).toContain("Owner atau Finance");
});

it("saldo belum terpakai = jumlah - terpakai (pengajuan yang menunggu sudah dikurangkan database); uang muka batal atau salah bentuk = 0", () => {
  expect(hitungSaldoUangMuka({ amount: 845200, applied: 845200, status: "aktif" })).toBe(0);
  expect(hitungSaldoUangMuka({ amount: 875200, applied: 845200, status: "aktif" })).toBe(30000);
  expect(hitungSaldoUangMuka({ amount: 100, applied: 0, status: "batal" })).toBe(0);
  expect(hitungSaldoUangMuka({ amount: "abc" as unknown as number, applied: 0, status: "aktif" })).toBe(0);
  expect(hitungSaldoUangMuka({ amount: 10.005, applied: 0, status: "aktif" })).toBe(10.01);
});

it("label status refund dipakai layar: menunggu, diproses Finance, selesai, dibatalkan", () => {
  expect(labelStatusRefund("pending")).toContain("Menunggu");
  expect(labelStatusRefund("diproses")).toContain("Finance");
  expect(labelStatusRefund("selesai")).toContain("selesai");
  expect(labelStatusRefund("batal")).toContain("batal");
  expect(labelStatusRefund("aneh")).toBe("aneh");
});

it("pemisahan tugas dan rekening bank dijelaskan dengan kalimat yang jelas (siapa yang boleh, rekening apa)", () => {
  expect(pesanRefundUangMuka("SOD_CLAIM: x")).toContain("Finance atau Owner lain");
  expect(pesanRefundUangMuka("SOD_COMPLETE: x")).toContain("Finance atau Owner lain");
  expect(pesanRefundUangMuka("ACCOUNT_INVALID: akun pembukuan rekening sumber (110003) bukan rekening di grup Bank (120000)")).toContain("rekening bank");
});
