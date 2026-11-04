import { describe, expect, it } from "vitest";
import { METODE_BAYAR as METODE_DB } from "../kas-akun";
import { METODE_BAYAR, metodeBayarSah, metodeDariDraf } from "../metode-bayar";
import { parseClinicPostingError } from "../klinik-posting";

// Kasir klinik (layar bayar per hewan + bayar rombongan) dan RPC posting harus memakai SATU kosakata.
// Dulu layar menawarkan "Kartu" sedangkan clinic_post_invoice hanya menerima Debit/Kredit, sehingga
// "Kartu" selalu ditolak dengan pesan umum "nilai invoice tidak konsisten".
describe("kosakata metode bayar kasir klinik = kosakata database", () => {
  it("setiap tombol yang ditawarkan layar diterima database", () => {
    for (const { m } of METODE_BAYAR) expect(METODE_DB as readonly string[]).toContain(m);
  });
  it("kartu debit dan kredit ditawarkan sebagai Debit dan Kredit, bukan satu tombol Kartu", () => {
    const nama = METODE_BAYAR.map(o => o.m) as string[];
    expect(nama).toEqual(expect.arrayContaining(["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"]));
    expect(nama).not.toContain("Kartu");
  });
  it("metodeBayarSah hanya meloloskan nilai persis dari database", () => {
    for (const m of METODE_DB) expect(metodeBayarSah(m)).toBe(true);
    for (const x of ["Kartu", "kartu", "debit", " Debit", "", null, undefined, 3]) expect(metodeBayarSah(x)).toBe(false);
  });
  it("draf lama yang menyimpan Kartu/ngawur kembali ke Tunai, metode sah dipertahankan", () => {
    expect(metodeDariDraf("Kartu")).toBe("Tunai");
    expect(metodeDariDraf(undefined)).toBe("Tunai");
    expect(metodeDariDraf("QRIS")).toBe("QRIS");
  });
});

describe("pesan kasir untuk INVOICE_INVALID nilai tidak konsisten", () => {
  it("tidak lagi bilang 'tidak ada yang salah': menyebut metode/diskon/jumlah dan bahwa belum ada yang tersimpan", () => {
    const pesan = parseClinicPostingError({ code: "P0001", message: "INVOICE_INVALID: nilai invoice tidak konsisten" });
    expect(pesan).toContain("metode pembayaran");
    expect(pesan).toContain("belum ada yang tersimpan");
  });
  it("sub-pesan INVOICE_INVALID lain tetap memakai pesan umum", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "INVOICE_INVALID: data invoice tidak lengkap" })).toBe("Nilai atau rincian invoice tidak konsisten.");
  });
});
