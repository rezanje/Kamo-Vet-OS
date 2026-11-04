import { describe, expect, it } from "vitest";
import { METODE_BAYAR as METODE_DB } from "../kas-akun";
import { METODE_BAYAR, metodeBayarSah, pulihkanMetodeDraf } from "../metode-bayar";
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
  it("draf lama dengan Kartu TIDAK diganti Tunai: metode kosong, jumlah bayar 0, ada pesan", () => {
    for (const lama of ["Kartu", "kartu", undefined, null, 3, ""]) {
      const r = pulihkanMetodeDraf(lama, 158000);
      expect(r.metode).toBe("");
      expect(r.bayar).toBe(0);
      expect(r.bayarManual).toBe(false);
      expect(r.pesan).toMatch(/tidak dipakai/);
      expect(r.pesan).toMatch(/Debit, Kredit/);
    }
    expect(pulihkanMetodeDraf("Kartu", 158000).pesan).toContain('"Kartu"');
  });
  it("draf dengan metode sah dipertahankan apa adanya (tanpa pesan)", () => {
    expect(pulihkanMetodeDraf("QRIS", 158000)).toEqual({ metode: "QRIS", bayar: 158000, bayarManual: true, pesan: null });
    expect(pulihkanMetodeDraf("Tunai", 50000)).toEqual({ metode: "Tunai", bayar: 50000, bayarManual: false, pesan: null });
    expect(pulihkanMetodeDraf("Debit", "abc")).toEqual({ metode: "Debit", bayar: 0, bayarManual: false, pesan: null });
  });
  it("PembayaranForm memakai pemulih ini (bukan memetakan diam-diam ke Tunai)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx", "utf8");
    expect(src).toContain("pulihkanMetodeDraf(value.metode, value.bayar)");
    expect(src).toContain("setBayar(metodeDraf.bayar)");
    expect(src).not.toMatch(/metodeDariDraf/);
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
