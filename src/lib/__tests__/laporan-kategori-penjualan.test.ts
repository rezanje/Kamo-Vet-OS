import { describe, expect, it } from "vitest";
import {
  KATEGORI_LAINNYA, KATEGORI_RACIKAN, KATEGORI_TANPA, KOLOM_ACCURATE,
  amankanSel, barisAccurate, barisTabelRingkasan, cocokKategori, klasifikasiBaris, petaKategori, resolveKategori, ringkasKategori,
} from "../laporan-kategori-penjualan";

const kategori = petaKategori([
  { id: "tindakan", name: "Tindakan", parent_id: null },
  { id: "bedah", name: "Operasi", parent_id: "tindakan" },
  { id: "bedah-besar", name: "Operasi Besar", parent_id: "bedah" },
  { id: "obat", name: " obat & vitamin ", parent_id: null },
  { id: "loop-a", name: "A", parent_id: "loop-b" },
  { id: "loop-b", name: "B", parent_id: "loop-a" },
  { id: "self", name: "Diri", parent_id: "self" },
  { id: "yatim", name: "Yatim", parent_id: "hilang" },
]);

describe("resolveKategori", () => {
  it("memberi nama kategori induk huruf besar dan sub kosong untuk kategori induk", () => {
    expect(resolveKategori("tindakan", kategori)).toEqual({ kategori: "TINDAKAN", subKategori: "" });
    expect(resolveKategori("obat", kategori)).toEqual({ kategori: "OBAT & VITAMIN", subKategori: "" });
  });
  it("memakai kategori anak sebagai sub kategori", () => {
    expect(resolveKategori("bedah", kategori)).toEqual({ kategori: "TINDAKAN", subKategori: "Operasi" });
  });
  it("cucu tetap naik ke induk dan sub kategorinya anak langsung induk", () => {
    expect(resolveKategori("bedah-besar", kategori)).toEqual({ kategori: "TINDAKAN", subKategori: "Operasi" });
  });
  it("tidak berputar selamanya pada rantai melingkar", () => {
    expect(resolveKategori("loop-a", kategori)).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
    expect(resolveKategori("self", kategori)).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
  });
  it("kategori kosong atau tidak ditemukan jatuh ke TANPA KATEGORI", () => {
    expect(resolveKategori(null, kategori)).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
    expect(resolveKategori(undefined, kategori)).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
    expect(resolveKategori("tidak-ada", kategori)).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
    expect(resolveKategori("tindakan", petaKategori([]))).toEqual({ kategori: KATEGORI_TANPA, subKategori: "" });
  });
  it("induk yang hilang: kategori teratas yang masih ada dipakai sebagai induk", () => {
    expect(resolveKategori("yatim", kategori)).toEqual({ kategori: "YATIM", subKategori: "" });
  });
});

describe("klasifikasiBaris", () => {
  const item = new Map([["i1", { code: "J0020", category_id: "bedah" }], ["i2", { code: "X", category_id: null }]]);
  it("barang dengan item mengikuti kategori itemnya dan membawa kode barang", () => {
    expect(klasifikasiBaris({ jenis: "Jasa", itemId: "i1", items: item, peta: kategori }))
      .toEqual({ kode: "J0020", kategori: "TINDAKAN", subKategori: "Operasi" });
  });
  it("racikan selalu RACIKAN walau tanpa item", () => {
    expect(klasifikasiBaris({ jenis: "Racikan", itemId: null, items: item, peta: kategori }))
      .toEqual({ kode: "", kategori: KATEGORI_RACIKAN, subKategori: "" });
  });
  it("baris tanpa item (biaya admin, jasa lepas) masuk LAINNYA", () => {
    expect(klasifikasiBaris({ jenis: "Biaya Admin", itemId: null, items: item, peta: kategori }).kategori).toBe(KATEGORI_LAINNYA);
    expect(klasifikasiBaris({ jenis: "Jasa", itemId: null, items: item, peta: kategori }).kategori).toBe(KATEGORI_LAINNYA);
  });
  it("item tanpa kategori atau item tidak terbaca jatuh ke TANPA KATEGORI", () => {
    expect(klasifikasiBaris({ jenis: "Obat", itemId: "i2", items: item, peta: kategori })).toEqual({ kode: "X", kategori: KATEGORI_TANPA, subKategori: "" });
    expect(klasifikasiBaris({ jenis: "Obat", itemId: "hilang", items: item, peta: kategori })).toEqual({ kode: "", kategori: KATEGORI_TANPA, subKategori: "" });
  });
});

const baris = (kategori: string, subKategori: string, qty: number, nilai: number, extra: object = {}) => ({ kategori, subKategori, qty, nilai, ...extra });

describe("ringkasKategori", () => {
  const rows = [
    baris("TINDAKAN", "Operasi", 1, 100000), baris("TINDAKAN", "Operasi", 2, 50000),
    baris("TINDAKAN", "", 1, 25000), baris("OBAT & VITAMIN", "", 3, 30000),
    baris("TINDAKAN", "Operasi", 3, 0, { indukId: "x" }),
  ];
  it("menjumlah per kategori dan sub kategori, jumlah akhir sama dengan rincian tanpa baris anak BMHP", () => {
    const hasil = ringkasKategori(rows);
    expect(hasil.groups.map(g => [g.kategori, g.qty, g.nilai, g.baris])).toEqual([
      ["OBAT & VITAMIN", 3, 30000, 1], ["TINDAKAN", 4, 175000, 3],
    ]);
    expect(hasil.groups[1].subs.map(s => [s.subKategori, s.qty, s.nilai, s.baris])).toEqual([["", 1, 25000, 1], ["Operasi", 3, 150000, 2]]);
    const utama = rows.filter(r => !("indukId" in r));
    expect(hasil.totalNilai).toBe(utama.reduce((s, r) => s + r.nilai, 0));
    expect(hasil.totalQty).toBe(utama.reduce((s, r) => s + r.qty, 0));
    expect(hasil.totalBaris).toBe(utama.length);
    expect(hasil.groups.reduce((s, g) => s + g.nilai, 0)).toBe(hasil.totalNilai);
    expect(hasil.groups.flatMap(g => g.subs).reduce((s, x) => s + x.nilai, 0)).toBe(hasil.totalNilai);
  });
  it("tetap eksak untuk sen pecahan", () => {
    const hasil = ringkasKategori([baris("A", "", 1, 0.1), baris("A", "", 1, 0.2), baris("B", "", 1, 0.3)]);
    expect(hasil.totalNilai).toBe(0.6);
    expect(hasil.groups[0].nilai).toBe(0.3);
  });
  it("daftar kosong menghasilkan nol", () => {
    expect(ringkasKategori([])).toEqual({ groups: [], totalQty: 0, totalNilai: 0, totalBaris: 0 });
  });
});

describe("cocokKategori", () => {
  it("Semua/kosong meloloskan semua; pilihan dibandingkan tanpa beda huruf besar", () => {
    expect(cocokKategori({ kategori: "TINDAKAN" }, "")).toBe(true);
    expect(cocokKategori({ kategori: "TINDAKAN" }, "tindakan")).toBe(true);
    expect(cocokKategori({ kategori: "TINDAKAN" }, "OBAT & VITAMIN")).toBe(false);
  });
});

describe("barisAccurate", () => {
  it("urutan kolom sama persis dengan berkas Accurate ditambah Sub kategori", () => {
    expect(KOLOM_ACCURATE).toEqual(["Nomor #", "Cabang", "Tanggal", "Kode #", "Nama Barang", "Kategori", "Sub kategori", "Kuantitas", "@Harga", "Total Harga", "Pelanggan", "Diskon", "Nama Tenaga Penjual"]);
  });
  it("memetakan satu baris laporan dengan tanggal WIB", () => {
    const hasil = barisAccurate({ dokumen: "INV-1", cabang: "Klinik A", waktu: "2026-10-31T18:00:00Z", kode: "J0020", nama: "Injeksi", kategori: "TINDAKAN", subKategori: "Operasi", qty: 2, harga: 50000, nilai: 90000, pelanggan: "Pemilik", diskon: 10000, pelaksana: "Dokter A" });
    expect(hasil.slice(0, 2)).toEqual(["INV-1", "Klinik A"]);
    expect((hasil[2] as Date).toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(hasil.slice(3)).toEqual(["J0020", "Injeksi", "TINDAKAN", "Operasi", 2, 50000, 90000, "Pemilik", 10000, "Dokter A"]);
    expect(hasil).toHaveLength(KOLOM_ACCURATE.length);
  });
  it("tenaga penjual strip diganti kosong", () => {
    expect(barisAccurate({ dokumen: "x", cabang: "c", waktu: "2026-10-04T05:00:00Z", kode: "", nama: "n", kategori: "K", subKategori: "", qty: 1, harga: 1, nilai: 1, pelanggan: "p", diskon: 0, pelaksana: "—" })[12]).toBe("");
  });
});

describe("keamanan sel Excel (rumus)", () => {
  it("teks yang diawali = + - @ (atau tab/CR) diberi tanda petik di depan; teks biasa dan angka tidak berubah", () => {
    for (const teks of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "  =1+1"]) expect(amankanSel(teks)).toBe(`'${teks}`);
    expect(amankanSel("Injeksi")).toBe("Injeksi");
    expect(amankanSel("")).toBe("");
    expect(amankanSel(5)).toBe(5);
    expect(amankanSel(-5)).toBe(-5);
  });
  it("barisAccurate menjaga semua kolom teks (nomor, kode, nama, pelanggan, tenaga penjual) tetapi tidak angka/tanggal", () => {
    const hasil = barisAccurate({ dokumen: "=A1", cabang: "+c", waktu: "2026-10-04T05:00:00Z", kode: "-K", nama: "@nama", kategori: "=K", subKategori: "-S", qty: -1, harga: 1, nilai: -1, pelanggan: "=cmd|' /C calc'!A0", diskon: 0, pelaksana: "+dr" });
    expect(hasil[0]).toBe("'=A1"); expect(hasil[1]).toBe("'+c"); expect(hasil[3]).toBe("'-K"); expect(hasil[4]).toBe("'@nama");
    expect(hasil[5]).toBe("'=K"); expect(hasil[6]).toBe("'-S"); expect(hasil[10]).toBe("'=cmd|' /C calc'!A0"); expect(hasil[12]).toBe("'+dr");
    expect(hasil[2]).toBeInstanceOf(Date); expect(hasil[7]).toBe(-1); expect(hasil[9]).toBe(-1);
  });
  it("jumlah Total Harga baris Accurate (tanpa baris anak) sama dengan total ringkasan layar", () => {
    const rows = [{ ...baris("OBAT", "", 2, 30.5), indukId: undefined }, { ...baris("TINDAKAN", "Operasi", 1, 100), indukId: undefined }, { ...baris("TINDAKAN", "Operasi", 1, 0), indukId: "x" }];
    const total = rows.filter(r => !r.indukId).reduce((s, r) => s + r.nilai, 0);
    expect(ringkasKategori(rows).totalNilai).toBe(total);
  });
});

describe("barisTabelRingkasan", () => {
  it("subtotal kategori diikuti rincian sub hanya bila kategori punya sub bernama; jumlah kategori = total", () => {
    const hasil = ringkasKategori([baris("TINDAKAN", "Operasi", 1, 100), baris("TINDAKAN", "", 1, 20), baris("OBAT", "", 2, 30)]);
    const datar = barisTabelRingkasan(hasil);
    expect(datar.map(r => [r.tingkat, r.kategori, r.subKategori, r.nilai])).toEqual([
      ["kategori", "OBAT", "", 30],
      ["kategori", "TINDAKAN", "", 120], ["sub", "TINDAKAN", "(tanpa sub kategori)", 20], ["sub", "TINDAKAN", "Operasi", 100],
    ]);
    expect(datar.filter(r => r.tingkat === "kategori").reduce((s, r) => s + r.nilai, 0)).toBe(hasil.totalNilai);
    expect(datar.filter(r => r.tingkat === "sub" && r.kategori === "TINDAKAN").reduce((s, r) => s + r.nilai, 0)).toBe(120);
  });
});
