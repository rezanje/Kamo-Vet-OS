import { describe, expect, it } from "vitest";
import { parseClinicPostingError } from "../klinik-posting";

const e = (message: string) => parseClinicPostingError({ code: "P0001", message });

// Semua penolakan INVOICE_INVALID di koreksi dulu berbunyi sama ("Nilai atau rincian invoice tidak konsisten."), sehingga kasir
// tidak tahu angka mana yang salah (kasus INV-202611-1285, 17 Nov 2026). Sekarang tiap penyebab punya kalimat sendiri.
describe("pesan penolakan koreksi invoice (INVOICE_INVALID)", () => {
  it("nilai koreksi: menyebut total tidak boleh di bawah uang diterima, status & metode harus sama, tidak ada yang tersimpan", () => {
    const m = e("INVOICE_INVALID: nilai koreksi tidak konsisten");
    expect(m).not.toBe("Nilai atau rincian invoice tidak konsisten.");
    expect(m).toMatch(/lebih kecil dari uang yang sudah diterima/);
    expect(m).toMatch(/metode/i);
    expect(m).toMatch(/Belum ada yang tersimpan/);
  });
  it("subtotal berbeda dari rincian: menyuruh memuat ulang", () => {
    const m = e("INVOICE_INVALID: subtotal berbeda dari rincian");
    expect(m).toMatch(/Subtotal tidak sama dengan jumlah baris/);
    expect(m).toMatch(/Muat ulang/);
    expect(m).toMatch(/Belum ada yang tersimpan/);
  });
  it("tagihan perlu pemeriksaan keuangan: menyebut keuangan", () => {
    expect(e("INVOICE_INVALID: tagihan ini perlu pemeriksaan keuangan")).toMatch(/keuangan/);
  });
  it("penolakan INVOICE_INVALID lain tetap memakai kalimat lama", () => {
    expect(e("INVOICE_INVALID")).toBe("Nilai atau rincian invoice tidak konsisten.");
    expect(e("INVOICE_INVALID: tagihan tidak ditemukan")).toBe("Nilai atau rincian invoice tidak konsisten.");
  });
  it("penjaga nilai writer lama (nilai invoice) tetap berbunyi seperti dulu", () => {
    expect(e("INVOICE_INVALID: nilai invoice tidak konsisten")).toMatch(/^Nilai invoice ditolak karena tidak konsisten\./);
  });
});

import { pesanKoreksiDiBawahUangDiterima, uangSudahDiterima } from "../koreksi-di-bawah-bayar";

describe("pesanKoreksiDiBawahUangDiterima (aturan sama dengan clinic_edit_invoice_core: total < dp + pembayaran)", () => {
  it("total lebih kecil -> pesan dengan total baru, uang diterima, dan selisih", () => {
    const m = pesanKoreksiDiBawahUangDiterima(45000, 90000)!;
    expect(m).toContain("Rp 45.000"); expect(m).toContain("Rp 90.000");
    expect(m).toMatch(/selisih Rp 45\.000 harus dikembalikan ke pelanggan/);
  });
  it("total sama atau lebih besar -> null (aman diteruskan ke database)", () => {
    expect(pesanKoreksiDiBawahUangDiterima(90000, 90000)).toBeNull();
    expect(pesanKoreksiDiBawahUangDiterima(100000, 90000)).toBeNull();
    expect(pesanKoreksiDiBawahUangDiterima(0, 0)).toBeNull();
  });
  it("selisih satu sen tetap ditolak", () => {
    expect(pesanKoreksiDiBawahUangDiterima(89999.99, 90000)).not.toBeNull();
  });
  it("uang diterima = DP kepala tagihan + semua baris pembayaran (pembalikan negatif ikut)", () => {
    expect(uangSudahDiterima(20000, [{ amount: 50000 }, { amount: "30000" }])).toBe(100000);
    expect(uangSudahDiterima(0, [{ amount: 90000 }, { amount: -90000 }])).toBe(0);
    expect(uangSudahDiterima(0, [{ amount: null }])).toBe(0);
  });
});
