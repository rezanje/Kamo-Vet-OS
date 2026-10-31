import { describe, expect, it } from "vitest";
import {
  akunHpp, akunSistem, alasanTakBolehNonaktif, tipeDariKode, validasiAkunBaru, validasiSisiSaldo, validasiUbahAkun,
} from "../coa-sistem";

const baru = (o: Partial<Parameters<typeof validasiAkunBaru>[0]> = {}) =>
  validasiAkunBaru({ code: "730003", name: "Beban Pemasaran", type: "BEBAN", normal_balance: "D", ...o });

describe("validasiAkunBaru", () => {
  it("akun beban yang wajar diterima", () => {
    expect(baru()).toBeNull();
  });

  it("akun baru wajib 6 angka sesuai bagan akun", () => {
    expect(baru({ code: "730003" })).toBeNull();
    expect(baru({ code: "5403" })).toMatch(/6 angka/);
    expect(baru({ code: "54031" })).toMatch(/6 angka/);
    expect(baru({ code: "5403001" })).toMatch(/6 angka/);
    expect(baru({ code: "73O003" })).toMatch(/6 angka/);
    expect(baru({ code: "930001" })).toMatch(/6 angka/);
  });

  it("kelompok harus cocok dengan awalan kodenya", () => {
    // 7xxxxx = BEBAN; dipasang sebagai ASET → semua laporan akan salah kelompok.
    expect(baru({ type: "ASET" })).toMatch(/kelompok BEBAN/);
    expect(baru({ code: "200017", type: "ASET" })).toBeNull(); // 2xxxxx = aset tetap, bukan liabilitas
    expect(baru({ code: "330001", type: "LIABILITAS", normal_balance: "K" })).toBeNull();
    expect(baru({ code: "440001", type: "EKUITAS", normal_balance: "K" })).toBeNull();
    expect(baru({ code: "540001", type: "PENDAPATAN", normal_balance: "K" })).toBeNull();
    expect(baru({ code: "600003" })).toBeNull();
    expect(baru({ code: "810005", type: "PENDAPATAN", normal_balance: "K" })).toBeNull();
    expect(baru({ code: "820007" })).toBeNull();
  });

  it("jatah kode rekening kas/bank dilarang", () => {
    expect(baru({ code: "115000", type: "ASET" })).toMatch(/110023–119999/);
    expect(baru({ code: "120007", type: "ASET" })).toMatch(/120007–129999/);
    expect(baru({ code: "110022", type: "ASET" })).toBeNull(); // bagian bagan akun, bukan jatah otomatis
  });

  it("kode yang dipakai sistem ditolak", () => {
    // Menimpa 600001 berarti mematikan penanda HPP di Laba Rugi & dashboard.
    expect(baru({ code: "600001" })).toMatch(/dipakai sistem/);
  });

  it("retur/diskon penjualan 52xxxx sah bersaldo Debit, pendapatan lain tidak", () => {
    expect(baru({ code: "520005", type: "PENDAPATAN", normal_balance: "D" })).toBeNull();
    expect(baru({ code: "510005", type: "PENDAPATAN", normal_balance: "D" })).toMatch(/harus bersaldo normal Kredit/);
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
  const lama = { code: "730003", type: "BEBAN", normal_balance: "D" };
  const draft = { code: "730003", name: "Beban Pemasaran Digital", type: "BEBAN", normal_balance: "D" };

  it("ganti nama selalu boleh, walau sudah ada jurnal", () => {
    expect(validasiUbahAkun(draft, lama, true)).toBeNull();
  });

  it("kode tidak pernah bisa diubah", () => {
    expect(validasiUbahAkun({ ...draft, code: "730004" }, lama, false)).toMatch(/tidak bisa diubah/);
  });

  it("kelompok & saldo normal terkunci begitu ada jurnal", () => {
    expect(validasiUbahAkun({ ...draft, type: "ASET" }, lama, true)).toMatch(/sudah punya jurnal/);
    expect(validasiUbahAkun({ ...draft, normal_balance: "K" }, lama, true)).toMatch(/sudah punya jurnal/);
  });

  it("tanpa jurnal, kelompok tetap harus cocok dengan kodenya", () => {
    expect(validasiUbahAkun({ ...draft, type: "ASET" }, lama, false)).toMatch(/tidak boleh berbeda dari kodenya/);
  });

  it("akun lama 4 angka yang tersisa tetap dibaca dengan pola lama", () => {
    const lama4 = { code: "5403", type: "BEBAN", normal_balance: "D" };
    expect(validasiUbahAkun({ ...draft, code: "5403" }, lama4, true)).toBeNull();
    expect(validasiUbahAkun({ ...draft, code: "5403", type: "PENDAPATAN", normal_balance: "K" }, lama4, false)).toMatch(/tidak boleh berbeda/);
  });

  it("ganti nama diskon penjualan 520002 tetap sah walau bersaldo Debit", () => {
    const diskon = { code: "520002", type: "PENDAPATAN", normal_balance: "D" };
    expect(validasiUbahAkun({ code: "520002", name: "Diskon Penjualan Toko", type: "PENDAPATAN", normal_balance: "D" }, diskon, true)).toBeNull();
  });
});

describe("alasanTakBolehNonaktif", () => {
  const kosong = { jurnal: 0, rekeningKas: false, kategoriAset: false, jurnalBerulang: false };

  it("akun sistem tidak boleh dinonaktifkan", () => {
    expect(alasanTakBolehNonaktif("170001", kosong)).toMatch(/dipakai sistem/);
  });

  it("akun rekening kas/bank ditolak dengan arahan yang benar", () => {
    expect(alasanTakBolehNonaktif("110024", { ...kosong, rekeningKas: true })).toMatch(/Kas & Bank/);
  });

  it("akun yang dipakai kategori aset / jurnal berulang ditolak", () => {
    expect(alasanTakBolehNonaktif("730003", { ...kosong, kategoriAset: true })).toMatch(/kategori aset/);
    expect(alasanTakBolehNonaktif("730003", { ...kosong, jurnalBerulang: true })).toMatch(/jurnal berulang/);
  });

  it("akun biasa yang tidak dipakai boleh dinonaktifkan", () => {
    expect(alasanTakBolehNonaktif("730003", kosong)).toBeNull();
  });

  it("punya jurnal saja tidak menghalangi — riwayatnya tetap utuh", () => {
    expect(alasanTakBolehNonaktif("730003", { ...kosong, jurnal: 12 })).toBeNull();
  });
});

describe("akunSistem", () => {
  it("mengenali kode terkunci dan melepas yang bebas", () => {
    expect(akunSistem("600001")).toBe(true);
    expect(akunSistem("5101")).toBe(false); // kode lama sudah dipindah ke bagan akun baru
    expect(akunSistem("181001")).toBe(false); // Perlengkapan Kantor: tidak dirujuk kode mana pun
  });
});

describe("tipeDariKode", () => {
  it("pola 6 digit bagan akun baru", () => {
    expect(["110003", "200015", "312005", "410001", "510001", "520002", "600001", "720010", "810001", "820004"].map(tipeDariKode))
      .toEqual(["ASET", "ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "PENDAPATAN", "BEBAN", "BEBAN", "PENDAPATAN", "BEBAN"]);
    expect(tipeDariKode("900001")).toBeNull();
    expect(tipeDariKode("830001")).toBeNull();
  });

  it("kode lama 4–5 angka memakai pola lama", () => {
    expect(["1720", "2301", "3101", "4401", "5403", "54031"].map(tipeDariKode))
      .toEqual(["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN", "BEBAN"]);
  });
});

describe("akunHpp", () => {
  it("seluruh kelompok 6xxxxx adalah HPP, beban operasional bukan", () => {
    expect(["600001", "600002"].map(akunHpp)).toEqual([true, true]);
    expect(["710001", "720010", "5101"].map(akunHpp)).toEqual([false, false, false]);
  });
});
