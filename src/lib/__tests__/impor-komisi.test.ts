import { describe, it, expect } from "vitest";
import {
  periksaKomisi, periksaTarget, kunciTarget, kunciNama,
  KOLOM_KOMISI, KOLOM_TARGET, CONTOH_KOMISI, CONTOH_TARGET,
  type MasterKomisi, type MasterTarget,
} from "../impor-komisi";
import { bacaCsvUmum, type BarisCsv } from "../impor-csv";

const master: MasterKomisi = {
  karyawan: new Map([["drh fanny", "emp-1"], ["siti ambar rahayu", "emp-2"]]),
  cabang: new Map([["kamo petshop loji", "br-1"]]),
  kategori: new Map([["makanan / pakan", "cat-1"]]),
  barang: new Map([["tind0005", "itm-1"], ["vaksin f4", "itm-1"]]),
};

const baris = (data: Record<string, string>, no = 2): BarisCsv[] => [{ no, data }];

describe("kunciNama", () => {
  it("tidak peduli huruf besar-kecil dan spasi berlebih", () => {
    expect(kunciNama("  Drh   Fanny ")).toBe("drh fanny");
  });
});

describe("periksaKomisi", () => {
  const dasar = { nama: "Komisi kasir", tipe: "persen", basis: "omzet", sumber: "kasir", persen: "2" };

  it("baris sederhana lolos", () => {
    const { siap, salah } = periksaKomisi(baris(dasar), master);
    expect(salah).toEqual([]);
    expect(siap[0]).toMatchObject({ nama: "Komisi kasir", tipe: "persen", persen: 2, is_active: true });
  });

  it("kolom kosong diisi bawaan: basis omzet, sumber semua", () => {
    const { siap } = periksaKomisi(baris({ nama: "A", tipe: "persen", persen: "3" }), master);
    expect(siap[0]).toMatchObject({ basis: "omzet", sumber: "semua" });
  });

  it("tipe persen tanpa angka persen ditolak — aturan mati tidak boleh lolos diam-diam", () => {
    const { siap, salah } = periksaKomisi(baris({ nama: "A", tipe: "persen" }), master);
    expect(siap).toEqual([]);
    expect(salah[0].pesan).toMatch(/persen kosong/);
  });

  it("tipe nominal tanpa angka nominal ditolak", () => {
    const { salah } = periksaKomisi(baris({ nama: "A", tipe: "nominal" }), master);
    expect(salah[0].pesan).toMatch(/nominal kosong/);
  });

  it("persen di atas 100 ditolak", () => {
    const { salah } = periksaKomisi(baris({ ...dasar, persen: "150" }), master);
    expect(salah[0].pesan).toMatch(/lebih dari 100/);
  });

  it("tipe yang tidak dikenal ditolak", () => {
    const { salah } = periksaKomisi(baris({ nama: "A", tipe: "bonus" }), master);
    expect(salah[0].pesan).toMatch(/tidak dikenal/);
  });

  it("karyawan yang tidak ada di master menolak barisnya, bukan menebak", () => {
    const { siap, salah } = periksaKomisi(baris({ ...dasar, karyawan: "Orang Baru" }), master);
    expect(siap).toEqual([]);
    expect(salah[0].pesan).toMatch(/Karyawan "Orang Baru" tidak ditemukan/);
  });

  it("nama karyawan dicocokkan tanpa peduli huruf besar-kecil", () => {
    const { siap } = periksaKomisi(baris({ ...dasar, karyawan: "  DRH   Fanny " }), master);
    expect(siap[0].employee_id).toBe("emp-1");
  });

  it("barang boleh dirujuk lewat kode maupun namanya", () => {
    expect(periksaKomisi(baris({ ...dasar, barang: "TIND0005" }), master).siap[0].item_id).toBe("itm-1");
    expect(periksaKomisi(baris({ ...dasar, barang: "Vaksin F4" }), master).siap[0].item_id).toBe("itm-1");
  });

  it("tanggal harus YYYY-MM-DD dan tidak boleh terbalik", () => {
    expect(periksaKomisi(baris({ ...dasar, dari: "01/01/2026" }), master).salah[0].pesan).toMatch(/YYYY-MM-DD/);
    expect(periksaKomisi(baris({ ...dasar, dari: "2026-03-01", sampai: "2026-01-01" }), master).salah[0].pesan)
      .toMatch(/lebih awal/);
  });

  it("nama aturan kembar di file yang sama ditolak", () => {
    const { siap, salah } = periksaKomisi(
      [{ no: 2, data: dasar }, { no: 3, data: { ...dasar, nama: "KOMISI KASIR" } }], master);
    expect(siap).toHaveLength(1);
    expect(salah[0].pesan).toMatch(/kembar/);
  });

  it("baris bermasalah tidak menggugurkan baris lain", () => {
    const { siap, salah } = periksaKomisi(
      [{ no: 2, data: { nama: "Rusak", tipe: "entah" } }, { no: 3, data: dasar }], master);
    expect(siap).toHaveLength(1);
    expect(salah).toHaveLength(1);
  });

  it("contoh bawaan bisa dibaca dan lolos semua", () => {
    const dibaca = bacaCsvUmum(CONTOH_KOMISI, KOLOM_KOMISI, ["nama", "tipe"]);
    expect(dibaca.ok).toBe(true);
    if (!dibaca.ok) return;
    const { siap, salah } = periksaKomisi(dibaca.baris, master);
    expect(salah).toEqual([]);
    expect(siap).toHaveLength(3);
  });
});

describe("periksaTarget", () => {
  const masterT: MasterTarget = {
    karyawan: master.karyawan, cabang: master.cabang, kategori: master.kategori,
    sudahAda: new Set<string>(),
  };
  const dasar = { periode: "2026-09", target: "150000000", basis: "omzet", cabang: "Kamo Petshop Loji" };

  it("baris sederhana lolos", () => {
    const { siap, salah } = periksaTarget(baris(dasar), masterT);
    expect(salah).toEqual([]);
    expect(siap[0]).toMatchObject({ periode: "2026-09", target: 150_000_000, branch_id: "br-1" });
  });

  it("periode harus YYYY-MM", () => {
    expect(periksaTarget(baris({ ...dasar, periode: "Sep 2026" }), masterT).salah[0].pesan)
      .toMatch(/YYYY-MM/);
  });

  it("target nol ditolak", () => {
    expect(periksaTarget(baris({ ...dasar, target: "0" }), masterT).salah[0].pesan).toMatch(/kosong atau nol/);
  });

  it("pemisah ribuan Excel tetap terbaca", () => {
    expect(periksaTarget(baris({ ...dasar, target: "150.000.000" }), masterT).siap[0].target).toBe(150_000_000);
  });

  it("dua target dengan cakupan sama di file yang sama ditolak", () => {
    const { siap, salah } = periksaTarget(
      [{ no: 2, data: dasar }, { no: 3, data: { ...dasar, target: "99000000" } }], masterT);
    expect(siap).toHaveLength(1);
    expect(salah[0].pesan).toMatch(/sudah ada di file ini/);
  });

  it("cakupan yang sudah tersimpan di sistem ditolak", () => {
    const sudah: MasterTarget = {
      ...masterT,
      sudahAda: new Set([kunciTarget({ periode: "2026-09", employee_id: null, branch_id: "br-1", category_id: null })]),
    };
    expect(periksaTarget(baris(dasar), sudah).salah[0].pesan).toMatch(/sudah tersimpan/);
  });

  it("cakupan berbeda di periode sama tetap boleh", () => {
    const { siap } = periksaTarget([
      { no: 2, data: dasar },
      { no: 3, data: { periode: "2026-09", target: "40000000", karyawan: "Siti Ambar Rahayu" } },
    ], masterT);
    expect(siap).toHaveLength(2);
  });

  it("contoh bawaan bisa dibaca dan lolos semua", () => {
    const dibaca = bacaCsvUmum(CONTOH_TARGET, KOLOM_TARGET, ["periode", "target"]);
    expect(dibaca.ok).toBe(true);
    if (!dibaca.ok) return;
    const { siap, salah } = periksaTarget(dibaca.baris, masterT);
    expect(salah).toEqual([]);
    expect(siap).toHaveLength(3);
  });
});
