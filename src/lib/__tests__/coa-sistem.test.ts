import { describe, expect, it } from "vitest";
import {
  akunSistem, alasanTakBolehNonaktif, validasiAkunBaru, validasiSisiSaldo, validasiUbahAkun,
} from "../coa-sistem";

const baru = (o: Partial<Parameters<typeof validasiAkunBaru>[0]> = {}) =>
  validasiAkunBaru({ code: "5403", name: "Beban Pemasaran", type: "BEBAN", normal_balance: "D", ...o });

describe("validasiAkunBaru", () => {
  it("akun beban yang wajar diterima", () => {
    expect(baru()).toBeNull();
  });

  it("kode harus 4 angka", () => {
    expect(baru({ code: "540" })).toMatch(/4 angka/);
    expect(baru({ code: "54O3" })).toMatch(/4 angka/);
  });

  it("angka pertama harus cocok dengan kelompoknya", () => {
    // 5xxx = BEBAN; dipasang sebagai ASET → semua laporan akan salah kelompok.
    expect(baru({ type: "ASET" })).toMatch(/kelompok BEBAN/);
  });

  it("jatah kode rekening kas/bank dilarang", () => {
    expect(baru({ code: "1150", type: "ASET" })).toMatch(/1103–1199/);
  });

  it("kode yang dipakai sistem ditolak", () => {
    // Menimpa 5101 berarti mematikan penanda HPP di Laba Rugi & dashboard.
    expect(baru({ code: "5101" })).toMatch(/dipakai sistem/);
  });

  it("nama wajib & maksimal 80 huruf", () => {
    expect(baru({ name: "   " })).toMatch(/Nama akun wajib/);
    expect(baru({ name: "x".repeat(81) })).toMatch(/80 huruf/);
  });
});

describe("validasiSisiSaldo", () => {
  it("sisi wajar tiap kelompok diterima", () => {
    expect(validasiSisiSaldo("ASET", "D")).toBeNull();
    expect(validasiSisiSaldo("PENDAPATAN", "K")).toBeNull();
  });

  it("akun kontra neraca sah — mis. Akumulasi Penyusutan", () => {
    expect(validasiSisiSaldo("ASET", "K")).toBeNull();
  });

  it("akun kontra pendapatan/beban ditolak", () => {
    // Laba Rugi & jurnal penutup membaca saldo mentah, jadi saldo terbalik
    // di dua kelompok ini menggandakan angkanya saat tutup buku.
    expect(validasiSisiSaldo("BEBAN", "K")).toMatch(/harus bersaldo normal Debit/);
    expect(validasiSisiSaldo("PENDAPATAN", "D")).toMatch(/harus bersaldo normal Kredit/);
  });

  it("selain D/K ditolak", () => {
    expect(validasiSisiSaldo("ASET", "X")).toMatch(/Debit atau Kredit/);
  });
});

describe("validasiUbahAkun", () => {
  const lama = { code: "5403", type: "BEBAN", normal_balance: "D" };
  const draft = { code: "5403", name: "Beban Pemasaran Digital", type: "BEBAN", normal_balance: "D" };

  it("ganti nama selalu boleh, walau sudah ada jurnal", () => {
    expect(validasiUbahAkun(draft, lama, true)).toBeNull();
  });

  it("kode tidak pernah bisa diubah", () => {
    expect(validasiUbahAkun({ ...draft, code: "5404" }, lama, false)).toMatch(/tidak bisa diubah/);
  });

  it("kelompok & saldo normal terkunci begitu ada jurnal", () => {
    expect(validasiUbahAkun({ ...draft, type: "ASET" }, lama, true)).toMatch(/sudah punya jurnal/);
    expect(validasiUbahAkun({ ...draft, normal_balance: "K" }, lama, true)).toMatch(/sudah punya jurnal/);
  });

  it("tanpa jurnal, kelompok tetap harus cocok dengan kodenya", () => {
    expect(validasiUbahAkun({ ...draft, type: "ASET" }, lama, false)).toMatch(/tidak boleh berbeda dari kodenya/);
  });
});

describe("alasanTakBolehNonaktif", () => {
  const kosong = { jurnal: 0, rekeningKas: false, kategoriAset: false, jurnalBerulang: false };

  it("akun sistem tidak boleh dinonaktifkan", () => {
    expect(alasanTakBolehNonaktif("1301", kosong)).toMatch(/dipakai sistem/);
  });

  it("akun rekening kas/bank ditolak dengan arahan yang benar", () => {
    expect(alasanTakBolehNonaktif("1150", { ...kosong, rekeningKas: true })).toMatch(/Kas & Bank/);
  });

  it("akun yang dipakai kategori aset / jurnal berulang ditolak", () => {
    expect(alasanTakBolehNonaktif("5403", { ...kosong, kategoriAset: true })).toMatch(/kategori aset/);
    expect(alasanTakBolehNonaktif("5403", { ...kosong, jurnalBerulang: true })).toMatch(/jurnal berulang/);
  });

  it("akun biasa yang tidak dipakai boleh dinonaktifkan", () => {
    expect(alasanTakBolehNonaktif("5403", kosong)).toBeNull();
  });

  it("punya jurnal saja tidak menghalangi — riwayatnya tetap utuh", () => {
    expect(alasanTakBolehNonaktif("5403", { ...kosong, jurnal: 12 })).toBeNull();
  });
});

describe("akunSistem", () => {
  it("mengenali kode terkunci dan melepas yang bebas", () => {
    expect(akunSistem("5101")).toBe(true);
    expect(akunSistem("1401")).toBe(false); // Perlengkapan Klinik: tidak dirujuk kode mana pun
  });
});
