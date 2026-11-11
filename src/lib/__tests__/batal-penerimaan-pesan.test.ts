import { describe, expect, it } from "vitest";
import { PESAN_BELUM_TERKONFIRMASI, pesanBatalPenerimaan, ringkasanHasil, ringkasanPratinjau, SHIFT_TEKS, type PratinjauBatal } from "../batal-penerimaan-pesan";

const P = (o: Partial<PratinjauBatal> = {}): PratinjauBatal => ({
  refuse: null, invoice: { id: "i1", no: "INV-9", total: 220000, paid_status: "Lunas", metode_bayar: "QRIS", dp_amount: 0, shift_id: "s1", visit_id: "v1", branch_id: "b1" },
  direct: { amount: 220000, kas_code: "120002", metode: "QRIS" }, payments: [], apps: [], receipts: [], actor: "OWNER", cash_amount: 0, shift_mode: "nonkas", today: "2026-11-11", ...o,
});

describe("pesanBatalPenerimaan", () => {
  it("menampilkan kalimat penolakan database apa adanya tanpa kode teknis", () => {
    expect(pesanBatalPenerimaan("BATAL_PENERIMAAN_SUDAH_REFUND: Tagihan ini sudah/sedang direfund.")).toBe("Tagihan ini sudah/sedang direfund.");
    expect(pesanBatalPenerimaan("BATAL_PENERIMAAN_UANG_MUKA_DIPAKAI: Kwitansi KWT-1 membuat uang muka UMK-1 yang sudah dipakai.")).not.toMatch(/BATAL_PENERIMAAN|UANG_MUKA_DIPAKAI:/);
  });
  it("memetakan galat umum ke bahasa Indonesia", () => {
    expect(pesanBatalPenerimaan("ACCESS_DENIED: hanya Owner")).toMatch(/Hanya Owner/);
    expect(pesanBatalPenerimaan("RECEIPT_INVALID: alasan")).toMatch(/Alasan wajib/);
    expect(pesanBatalPenerimaan("IDEMPOTENCY_CONFLICT: x")).toMatch(/Muat ulang/);
    expect(pesanBatalPenerimaan("PERIODE_TERKUNCI: periode akuntansi sampai 2026-11-10 sudah ditutup")).toMatch(/periode akuntansi sampai 2026-11-10 sudah ditutup\. Hubungi Finance/);
    expect(pesanBatalPenerimaan("Periode s/d 2026-11-10 sudah ditutup — jurnal terkunci")).toMatch(/Periode akuntansi sudah ditutup/);
    expect(pesanBatalPenerimaan("canceling statement due to lock timeout")).toMatch(/sedang dipakai kasir lain/);
    expect(pesanBatalPenerimaan("permission denied for table x")).toMatch(/Hanya Owner/);
  });
  it("galat tak dikenal tidak membocorkan teknis dan tidak menjanjikan hasil", () => {
    expect(pesanBatalPenerimaan("FATAL xyz")).toBe(PESAN_BELUM_TERKONFIRMASI);
    expect(pesanBatalPenerimaan(null)).toBe(PESAN_BELUM_TERKONFIRMASI);
    expect(PESAN_BELUM_TERKONFIRMASI).toMatch(/tidak ada yang diulang otomatis/);
  });
});

describe("ringkasan", () => {
  it("penerimaan langsung: menyebut jumlah, rekening, tagihan kembali Belum Lunas, stok/HPP tak berubah, tanggal jurnal, shift", () => {
    const t = ringkasanPratinjau(P()).join("\n");
    expect(t).toMatch(/Rp 220\.000/); expect(t).toMatch(/Bank/); expect(t).toMatch(/Belum Lunas dengan nomor yang sama/);
    expect(t).toMatch(/stok, HPP, dan jurnal penjualan TIDAK berubah/); expect(t).toMatch(/2026-11-11/); expect(t).toContain(SHIFT_TEKS.nonkas);
  });
  it("kwitansi + tagihan lain + uang muka + pemakaian uang muka dijelaskan terpisah", () => {
    const t = ringkasanPratinjau(P({ direct: null,
      apps: [{ application_id: "a", advance_id: "x", advance_no: "UMK-1", amount: 50000 }],
      receipts: [{ id: "r", no: "KWT-1", total: 150000, tanggal: "2026-11-10", parts: [{ metode: "QRIS", amount: 150000, kas_code: "120002" }],
        other_invoices: [{ invoice_id: "o", no: "INV-8", amount: 50000 }], advance: { no: "UMK-2", amount: 50000 } }], shift_mode: "shift_berjalan" })).join("\n");
    expect(t).toMatch(/Pemakaian uang muka UMK-1 Rp 50\.000 dibatalkan: jumlahnya kembali ke saldo/);
    expect(t).toMatch(/Kwitansi KWT-1 .* dibatalkan utuh/); expect(t).toMatch(/juga melunasi tagihan INV-8/); expect(t).toMatch(/Uang muka UMK-2 .* ikut dibatalkan/);
    expect(t).toContain(SHIFT_TEKS.shift_berjalan);
  });
  it("hasil: ringkas, menyebut kwitansi, tagihan lain, uang muka dan mode shift", () => {
    const t = ringkasanHasil({ status: "CANCELLED", cancellation_id: "c", invoice_id: "i", invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 100000, direct_amount: 0, cash_amount: 0,
      shift_mode: "tanpa_shift", receipts: ["KWT-1"], other_invoices_unpaid: ["INV-8"], applications_released: 1, tanggal: "2026-11-11" }).join("\n");
    expect(t).toMatch(/Rp 100\.000 pada INV-9 dibatalkan/); expect(t).toMatch(/KWT-1/); expect(t).toMatch(/INV-8/); expect(t).toMatch(/saldo uang muka pasien/); expect(t).toContain(SHIFT_TEKS.tanpa_shift);
  });
});
