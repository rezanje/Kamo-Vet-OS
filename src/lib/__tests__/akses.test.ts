import { describe, expect, it } from "vitest";
import {
  bolehBukaPath, modulBawaan, modulDiizinkan, pakaiAturanSendiri, tujuanSaatDiblokir,
  type AturanTersimpan,
} from "../akses";

const kosong: AturanTersimpan = [];

describe("modulDiizinkan", () => {
  it("OWNER selalu penuh, walau barisnya ada", () => {
    expect(modulDiizinkan("OWNER", kosong)).toBeNull();
    expect(modulDiizinkan("OWNER", [{ role: "OWNER", module_id: "klinik" }])).toBeNull();
  });

  it("tanpa baris tersimpan = pakai bawaan", () => {
    expect(modulDiizinkan("FINANCE", kosong)).toEqual(modulBawaan("FINANCE"));
    expect(modulDiizinkan("ADMIN", kosong)).toBeNull();
  });

  it("baris tersimpan menang atas bawaan", () => {
    const t: AturanTersimpan = [
      { role: "ADMIN", module_id: "klinik" },
      { role: "ADMIN", module_id: "crm" },
      { role: "FINANCE", module_id: "laporan" },
    ];
    expect(modulDiizinkan("ADMIN", t)).toEqual(["klinik", "crm"]);
    expect(modulDiizinkan("FINANCE", t)).toEqual(["laporan"]);
  });
});

describe("pakaiAturanSendiri", () => {
  it("OWNER tidak pernah dianggap punya aturan sendiri", () => {
    expect(pakaiAturanSendiri("OWNER", [{ role: "OWNER", module_id: "klinik" }])).toBe(false);
  });
  it("peran lain: ada barisnya berarti sudah diatur sendiri", () => {
    expect(pakaiAturanSendiri("FINANCE", kosong)).toBe(false);
    expect(pakaiAturanSendiri("FINANCE", [{ role: "FINANCE", module_id: "laporan" }])).toBe(true);
  });
});

describe("bolehBukaPath", () => {
  it("halaman login & dashboard pribadi tidak pernah diblokir", () => {
    for (const p of ["/me", "/me/kpi", "/mulai", "/login", "/auth/callback"]) {
      expect(bolehBukaPath("FINANCE", p, kosong)).toBe(true);
    }
  });

  it("OWNER & ADMIN bawaan boleh ke mana saja", () => {
    expect(bolehBukaPath("OWNER", "/hris/penggajian", kosong)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/penjualan/faktur", kosong)).toBe(true);
  });

  it("FINANCE bawaan: dunia keuangan boleh, HRIS tidak", () => {
    expect(bolehBukaPath("FINANCE", "/kas-bank/transfer", kosong)).toBe(true);
    expect(bolehBukaPath("FINANCE", "/keuangan/hutang", kosong)).toBe(true);
    expect(bolehBukaPath("FINANCE", "/hris/penggajian", kosong)).toBe(false);
    expect(bolehBukaPath("FINANCE", "/penjualan/pesanan", kosong)).toBe(false);
  });

  it("STAFF bawaan: klinik & kasir boleh, keuangan tidak", () => {
    expect(bolehBukaPath("STAFF", "/klinik/antrian", kosong)).toBe(true);
    expect(bolehBukaPath("STAFF", "/kasir", kosong)).toBe(true);
    expect(bolehBukaPath("STAFF", "/keuangan/jurnal", kosong)).toBe(false);
    expect(bolehBukaPath("STAFF", "/hris/karyawan", kosong)).toBe(false);
  });

  it("dashboard '/' tidak menjaring seluruh aplikasi", () => {
    const t: AturanTersimpan = [{ role: "STAFF", module_id: "dashboard" }];
    expect(bolehBukaPath("STAFF", "/", t)).toBe(true);
    expect(bolehBukaPath("STAFF", "/hris", t)).toBe(false);
  });

  it("modul yang berbagi /keuangan tidak saling membocorkan", () => {
    const t: AturanTersimpan = [{ role: "FINANCE", module_id: "aset-tetap" }];
    expect(bolehBukaPath("FINANCE", "/keuangan/aset", t)).toBe(true);
    expect(bolehBukaPath("FINANCE", "/keuangan/jurnal", t)).toBe(false);
    expect(bolehBukaPath("FINANCE", "/keuangan/hutang", t)).toBe(false);
  });

  it("aturan tersimpan bisa menambah modul di luar bawaan", () => {
    const t: AturanTersimpan = [
      { role: "FINANCE", module_id: "laporan" },
      { role: "FINANCE", module_id: "pembelian" },
    ];
    expect(bolehBukaPath("FINANCE", "/pembelian/faktur", t)).toBe(true);
    expect(bolehBukaPath("FINANCE", "/kas-bank", t)).toBe(false);
  });

  it("jalur kasir tetap melekat ke perannya walau modulnya dicabut", () => {
    const t: AturanTersimpan = [{ role: "STAFF", module_id: "dashboard" }];
    expect(bolehBukaPath("STAFF", "/kasir/struk/123", t)).toBe(true);
  });

  it("OWNER tetap penuh walau barisnya cuma satu modul", () => {
    const t: AturanTersimpan = [{ role: "OWNER", module_id: "dashboard" }];
    expect(bolehBukaPath("OWNER", "/pengaturan/akses-grup", t)).toBe(true);
  });

  it("prefix tidak menjaring rute lain yang namanya mirip", () => {
    const t: AturanTersimpan = [{ role: "STAFF", module_id: "pos" }];
    // /pos boleh, tapi jangan sampai /posting atau /poster ikut kebuka.
    expect(bolehBukaPath("STAFF", "/pos/sku", t)).toBe(true);
    expect(bolehBukaPath("STAFF", "/posting", t)).toBe(false);
  });
});

describe("tujuanSaatDiblokir", () => {
  it("dilempar ke dashboard kalau memang boleh membukanya", () => {
    expect(tujuanSaatDiblokir("FINANCE", kosong)).toBe("/");
  });
  it("dilempar ke pemilih shift kalau dashboard pun tidak boleh", () => {
    expect(tujuanSaatDiblokir("STAFF", kosong)).toBe("/mulai");
    expect(tujuanSaatDiblokir("ADMIN", [{ role: "ADMIN", module_id: "klinik" }])).toBe("/mulai");
  });
});
