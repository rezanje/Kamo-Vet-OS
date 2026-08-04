import { describe, it, expect } from "vitest";
import {
  bacaCsv, pecahBaris, periksaBaris, tebakPemisah,
  type MasterImpor,
} from "../impor-barang";

const master = (): MasterImpor => ({
  kategori: new Map([["makanan / pakan", "kat-1"], ["jasa", "kat-2"]]),
  merek: new Map([["royal canin", "mrk-1"]]),
  satuan: new Set(["pcs", "box", "tindakan"]),
  kodeTerpakai: new Set(["itm-011"]),
});

const judul = "kode,nama,kategori,jenis,merek,satuan,harga_jual,harga_beli,stok_minimum,upc,kategori_tindakan";
const baris = (isi: string) => {
  const r = bacaCsv(`${judul}\n${isi}`);
  if (!r.ok) throw new Error(r.pesan);
  return r.baris;
};

describe("pembacaan CSV", () => {
  it("Excel Indonesia pakai titik koma — pemisah ditebak dari judul", () => {
    expect(tebakPemisah("kode;nama;kategori")).toBe(";");
    expect(tebakPemisah("kode,nama,kategori")).toBe(",");
  });

  it("tanda kutip menjaga koma di dalam nama barang", () => {
    expect(pecahBaris('SNK-1,"Snack Tuna, 15gr",8000', ",")).toEqual(["SNK-1", "Snack Tuna, 15gr", "8000"]);
  });

  it("BOM Excel tidak bikin kolom pertama gagal dikenali", () => {
    const r = bacaCsv(`﻿${judul}\nA1,Nama,Makanan / Pakan,,,,1000,,,,`);
    expect(r.ok).toBe(true);
  });

  it("kolom wajib yang hilang ditolak dengan sebutan namanya", () => {
    const r = bacaCsv("kode,nama\nA1,Barang");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toContain("kategori");
  });

  it("baris kosong sisa Excel dilewati", () => {
    const r = bacaCsv(`${judul}\nA1,Nama,Makanan / Pakan,,,,1000,,,,\n,,,,,,,,,,\n`);
    expect(r.ok && r.baris.length).toBe(1);
  });
});

describe("pemeriksaan baris", () => {
  it("baris benar jadi barang siap simpan", () => {
    const { siap, salah } = periksaBaris(
      baris("SNK-1,Snack Tuna,Makanan / Pakan,Persediaan,Royal Canin,pcs,8000,5500,20,,"),
      master(),
    );
    expect(salah).toHaveLength(0);
    expect(siap[0]).toMatchObject({
      code: "SNK-1", name: "Snack Tuna", category_id: "kat-1", brand_id: "mrk-1",
      unit: "pcs", sell_price: 8000, buy_price: 5500, min_stock: 20, item_type: "Persediaan",
    });
  });

  it("pemisah ribuan Excel (8.000) terbaca 8000, bukan 8", () => {
    const { siap } = periksaBaris(
      baris("SNK-2,Snack,Makanan / Pakan,,,,8.000,,,,"), master(),
    );
    expect(siap[0].sell_price).toBe(8000);
  });

  it("kode yang sudah dipakai di sistem ditolak", () => {
    const { siap, salah } = periksaBaris(
      baris("ITM-011,Tabrakan,Makanan / Pakan,,,,1000,,,,"), master(),
    );
    expect(siap).toHaveLength(0);
    expect(salah[0].pesan).toContain("sudah dipakai");
  });

  it("kode kembar di dalam satu file ditolak sekali", () => {
    const { siap, salah } = periksaBaris(
      baris("A1,Satu,Makanan / Pakan,,,,1000,,,,\nA1,Dua,Makanan / Pakan,,,,1000,,,,"),
      master(),
    );
    expect(siap).toHaveLength(1);
    expect(salah[0].pesan).toContain("kembar");
  });

  it("master data tidak dibuat otomatis — kategori/merek/satuan asing ditolak", () => {
    const m = master();
    const { salah } = periksaBaris(
      baris([
        "A1,X,Kategori Ngawur,,,,1000,,,,",
        "A2,Y,Makanan / Pakan,,Merek Ngawur,,1000,,,,",
        "A3,Z,Makanan / Pakan,,,liter,1000,,,,",
      ].join("\n")),
      m,
    );
    expect(salah.map((s) => s.pesan.split(" ")[0])).toEqual(["Kategori", "Merek", "Satuan"]);
  });

  it("satu baris salah tidak menggugurkan baris lain", () => {
    const { siap, salah } = periksaBaris(
      baris([
        "A1,Benar,Makanan / Pakan,,,,1000,,,,",
        "A2,Harga kosong,Makanan / Pakan,,,,,,,,",
        "A3,Benar juga,Makanan / Pakan,,,,2000,,,,",
      ].join("\n")),
      master(),
    );
    expect(siap.map((s) => s.code)).toEqual(["A1", "A3"]);
    expect(salah).toHaveLength(1);
    expect(salah[0].no).toBe(3); // nomor baris di file, bukan urutan hasil
  });

  it("jasa: satuan & kategori tindakan punya bawaan, stok minimum dipaksa 0", () => {
    const { siap } = periksaBaris(
      baris("JSA-9,Vaksin Rabies,Jasa,Jasa,,,150000,,99,,Vaksinasi"), master(),
    );
    expect(siap[0]).toMatchObject({
      unit: "tindakan", tindakan_kategori: "Vaksinasi", min_stock: 0, item_type: "Jasa",
    });
  });

  it("kategori tindakan karangan ditolak", () => {
    const { salah } = periksaBaris(
      baris("JSA-8,Tindakan,Jasa,Jasa,,tindakan,1000,,,,Sulap"), master(),
    );
    expect(salah[0].pesan).toContain("Sulap");
  });

  it("jenis barang karangan ditolak, bukan diam-diam jadi Persediaan", () => {
    const { salah } = periksaBaris(
      baris("A9,X,Makanan / Pakan,Barang Ajaib,,,1000,,,,"), master(),
    );
    expect(salah[0].pesan).toContain("Barang Ajaib");
  });
});
