import { describe, expect, it } from "vitest";
import {
  ALASAN_HAPUS_DIPAKAI, ALASAN_HAPUS_OWNER, PESAN_UMUM, bacaPetaPemakaian, gudangDipakai, keputusanHapusGudang, kodeCabangTerkunci,
  namaKembar, pesanGalat, rapikanNama, validasiAlasanHapus, validasiNamaCabang, validasiNamaGudang,
} from "../cabang-gudang-edit";

describe("validasi nama cabang / gudang", () => {
  it("merapikan spasi tepi dan ganda", () => {
    expect(rapikanNama("  Kamo   Pets  Clinic Lengkong ")).toBe("Kamo Pets Clinic Lengkong");
    expect(rapikanNama(null)).toBe("");
  });
  it("kosong, satu huruf, terlalu panjang, dan karakter kontrol ditolak", () => {
    expect(validasiNamaCabang("")).toBe("Nama cabang wajib diisi");
    expect(validasiNamaCabang("   ")).toBe("Nama cabang wajib diisi");
    expect(validasiNamaCabang("x")).toMatch(/2 sampai 80/);
    expect(validasiNamaCabang("x".repeat(81))).toMatch(/2 sampai 80/);
    expect(validasiNamaCabang("Uji\u0001Kontrol")).toMatch(/2 sampai 80/);
    expect(validasiNamaCabang("x".repeat(80))).toBeNull();
    expect(validasiNamaCabang("Kamo Pets Clinic Lengkong")).toBeNull();
  });
  it("gudang boleh sampai 100 karakter", () => {
    expect(validasiNamaGudang("g".repeat(100))).toBeNull();
    expect(validasiNamaGudang("g".repeat(101))).toMatch(/2 sampai 100/);
    expect(validasiNamaGudang("")).toBe("Nama gudang wajib diisi");
  });
  it("nama kembar tanpa membedakan huruf besar/kecil dan spasi ganda; nama kosong bukan kembar", () => {
    expect(namaKembar("kamo  pets clinic CIAWI", ["Kamo Pets Clinic Ciawi", "Lain"])).toBe(true);
    expect(namaKembar("Kamo Pets Clinic Lengkong", ["Kamo Pets Clinic Ciawi"])).toBe(false);
    expect(namaKembar("  ", [""])).toBe(false);
  });
  it("alasan hapus wajib 5 sampai 300 karakter", () => {
    expect(validasiAlasanHapus("")).toMatch(/wajib/);
    expect(validasiAlasanHapus("abcd")).toMatch(/wajib/);
    expect(validasiAlasanHapus("x".repeat(301))).toMatch(/wajib/);
    expect(validasiAlasanHapus("  Salah buat  ")).toBeNull();
  });
});

describe("kunci kode dan hapus", () => {
  it("kode cabang terkunci bila ada transaksi, terbuka bila tidak ada, terkunci bila pemakaian tidak terbaca", () => {
    expect(kodeCabangTerkunci({ b1: ["public.sales"] }, "b1")).toBe(true);
    expect(kodeCabangTerkunci({ b1: ["public.sales"] }, "b2")).toBe(false);
    expect(kodeCabangTerkunci({}, "b2")).toBe(false);
    expect(kodeCabangTerkunci(null, "b2")).toBe(true);
  });
  it("gudang dipakai bila ada rujukan; tak terbaca dianggap dipakai", () => {
    expect(gudangDipakai({ w1: ["public.stock"] }, "w1")).toBe(true);
    expect(gudangDipakai({ w1: ["public.stock"] }, "w2")).toBe(false);
    expect(gudangDipakai(null, "w2")).toBe(true);
  });
  it("hapus: OWNER dan belum dipakai saja; ADMIN dan STAFF ditolak dengan alasan; dipakai = 'Sudah dipakai, nonaktifkan saja'", () => {
    expect(keputusanHapusGudang("OWNER", false)).toEqual({ boleh: true, alasan: null });
    expect(keputusanHapusGudang("OWNER", true)).toEqual({ boleh: false, alasan: ALASAN_HAPUS_DIPAKAI });
    expect(ALASAN_HAPUS_DIPAKAI).toBe("Sudah dipakai, nonaktifkan saja");
    for (const role of ["ADMIN", "STAFF", "FINANCE", null, undefined]) {
      expect(keputusanHapusGudang(role, false)).toEqual({ boleh: false, alasan: ALASAN_HAPUS_OWNER });
    }
  });
  it("peta pemakaian: bentuk salah dibaca null", () => {
    expect(bacaPetaPemakaian({ a: ["public.sales"] })).toEqual({ a: ["public.sales"] });
    expect(bacaPetaPemakaian({})).toEqual({});
    expect(bacaPetaPemakaian(null)).toBeNull();
    expect(bacaPetaPemakaian([])).toBeNull();
    expect(bacaPetaPemakaian({ a: "x" })).toBeNull();
  });
});

describe("pesan galat dari database", () => {
  it("kode yang aman menampilkan pesan Indonesia dari fungsi database", () => {
    for (const code of ["42501", "22023", "23505", "CG001", "CG002"]) {
      expect(pesanGalat({ code, message: "Kode cabang terkunci: sudah ada transaksi" })).toBe("Kode cabang terkunci: sudah ada transaksi");
    }
  });
  it("galat lain (mis. teks mentah database) tidak ditampilkan", () => {
    expect(pesanGalat({ code: "XX000", message: "relation \"sales\" does not exist" })).toBe(PESAN_UMUM);
    expect(pesanGalat({ message: "boom" })).toBe(PESAN_UMUM);
    expect(pesanGalat(null)).toBe(PESAN_UMUM);
    expect(pesanGalat({ code: "42501", message: "  " })).toBe(PESAN_UMUM);
  });
});
