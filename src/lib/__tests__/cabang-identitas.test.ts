import { describe, expect, it } from "vitest";
import {
  ALAMAT_MAX, LOGO_MAKS_BYTE, TELEPON_MAX, barisKontakKop, ekstensiLogo, jalurLogoBaru, jalurLogoSah, rapikanTeks, validasiAlamat, validasiBerkasLogo, validasiTelepon,
} from "@/lib/cabang-identitas";

const ID = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const LAIN = "73218196-99b8-4e2a-81dc-ecc6851cdbf6";

describe("rapikanTeks", () => {
  it("merapikan spasi dan baris baru; kosong menjadi null", () => {
    expect(rapikanTeks("  Jl.   Raya \n Cimanggu  ")).toBe("Jl. Raya Cimanggu");
    expect(rapikanTeks("   ")).toBeNull();
    expect(rapikanTeks(null)).toBeNull();
    expect(rapikanTeks(undefined)).toBeNull();
  });
});

describe("validasi alamat dan telepon (sama dengan batasan database)", () => {
  it("alamat 3..200 karakter tanpa karakter kontrol; kosong boleh", () => {
    expect(validasiAlamat(null)).toBeNull();
    expect(validasiAlamat("abc")).toBeNull();
    expect(validasiAlamat("a".repeat(ALAMAT_MAX))).toBeNull();
    expect(validasiAlamat("ab")).toMatch(/3 sampai 200/);
    expect(validasiAlamat("a".repeat(ALAMAT_MAX + 1))).toMatch(/3 sampai 200/);
    expect(validasiAlamat("Jl. Raya\u00071")).toMatch(/3 sampai 200/);
  });
  it("telepon 3..30 karakter, hanya angka/spasi/+()./,-", () => {
    expect(validasiTelepon(null)).toBeNull();
    expect(validasiTelepon("+62 251-8888 (1)")).toBeNull();
    expect(validasiTelepon("0251/8888, 8889.1")).toBeNull();
    expect(validasiTelepon("1".repeat(TELEPON_MAX))).toBeNull();
    expect(validasiTelepon("12")).toMatch(/3 sampai 30/);
    expect(validasiTelepon("1".repeat(TELEPON_MAX + 1))).toMatch(/3 sampai 30/);
    expect(validasiTelepon("telp 0251")).toMatch(/3 sampai 30/);
    expect(validasiTelepon("0251;8888")).toMatch(/3 sampai 30/);
  });
});

describe("validasi berkas logo", () => {
  it("PNG/JPG/WEBP sampai tepat 1 MB diterima", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(validasiBerkasLogo({ type, size: 1000 })).toBeNull();
    expect(validasiBerkasLogo({ type: "image/png", size: LOGO_MAKS_BYTE })).toBeNull();
  });
  it("tipe lain, kosong, dan lebih dari 1 MB ditolak", () => {
    expect(validasiBerkasLogo({ type: "image/gif", size: 10 })).toMatch(/PNG, JPG, atau WEBP/);
    expect(validasiBerkasLogo({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPG, atau WEBP/);
    expect(validasiBerkasLogo({ type: "application/pdf", size: 10 })).toMatch(/PNG, JPG, atau WEBP/);
    expect(validasiBerkasLogo({ type: "", size: 10 })).toMatch(/PNG, JPG, atau WEBP/);
    expect(validasiBerkasLogo({ type: "image/png", size: 0 })).toMatch(/kosong/);
    expect(validasiBerkasLogo({ type: "image/png", size: LOGO_MAKS_BYTE + 1 })).toMatch(/1 MB/);
  });
  it("ekstensi mengikuti tipe", () => {
    expect(ekstensiLogo("image/jpeg")).toBe("jpg");
    expect(ekstensiLogo("image/png")).toBe("png");
    expect(ekstensiLogo("image/webp")).toBe("webp");
    expect(ekstensiLogo("image/gif")).toBeNull();
  });
});

describe("jalur logo", () => {
  it("jalur baru: cabang-logo/<id>/<stempel>-<acak>.<ext> dan lolos pemeriksaan jalur sah", () => {
    const p = jalurLogoBaru(ID, "image/png", 1700000000000, "ab3Zx!!9");
    expect(p).toBe(`cabang-logo/${ID}/1700000000000-ab3zx9.png`);
    expect(jalurLogoSah(ID, p as string)).toBe(true);
  });
  it("tipe tidak didukung atau id bukan uuid: tidak ada jalur", () => {
    expect(jalurLogoBaru(ID, "image/gif", 1, "a")).toBeNull();
    expect(jalurLogoBaru("../x", "image/png", 1, "a")).toBeNull();
  });
  it("jalur sah hanya milik cabang itu sendiri, satu tingkat, ekstensi gambar", () => {
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/a.png`)).toBe(true);
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/A.JPEG`)).toBe(true);
    expect(jalurLogoSah(ID, `cabang-logo/${LAIN}/a.png`)).toBe(false);
    expect(jalurLogoSah(ID, `pengeluaran/${ID}/a.png`)).toBe(false);
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/a.gif`)).toBe(false);
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/sub/a.png`)).toBe(false);
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/../a.png`)).toBe(false);
    expect(jalurLogoSah(ID, `cabang-logo/${ID}/a.png/`)).toBe(false);
    expect(jalurLogoSah("bukan-uuid", `cabang-logo/bukan-uuid/a.png`)).toBe(false);
    expect(jalurLogoSah(ID, "")).toBe(false);
  });
});

describe("barisKontakKop", () => {
  it("alamat dan telepon digabung; salah satu atau kosong tetap rapi", () => {
    expect(barisKontakKop({ alamat: "Jl. Raya 1", telepon: "0251 8888" })).toBe("Jl. Raya 1 · Telp. 0251 8888");
    expect(barisKontakKop({ alamat: "Jl. Raya 1", telepon: null })).toBe("Jl. Raya 1");
    expect(barisKontakKop({ alamat: null, telepon: "0251 8888" })).toBe("Telp. 0251 8888");
    expect(barisKontakKop({ alamat: " ", telepon: "" })).toBe("");
    expect(barisKontakKop(null)).toBe("");
  });
});
