import { describe, expect, it } from "vitest";
import {
  KOLOM_EKSPOR, STATUS_LABEL, SUMBER_LABEL, bandingFaktur, barisEkspor, cocokCari, cocokPelanggan,
  gabungFaktur, hrefFaktur, ringkasFaktur, saringFaktur, umurFaktur,
  type BarisFaktur, type KunciFaktur, type SumberFaktur,
} from "../faktur-gabungan";

const kunci = (over: Partial<KunciFaktur> & { id: string; sumber: SumberFaktur }): KunciFaktur => ({
  nomor: over.id, tanggal: "2026-10-10", total: 1000, status: "lunas",
  branchId: "cab-1", customerId: null, namaBebas: null, ...over,
});

const baris = (over: Partial<BarisFaktur> & { id: string; sumber: SumberFaktur }): BarisFaktur => ({
  ...kunci(over), cabang: "Pondok Aren", pelanggan: "Umum", keterangan: "", visitId: null, rincianHpp: true,
  ...over,
});

describe("urutan gabungan", () => {
  it("menggabungkan tiga sumber jadi satu daftar tanggal terbaru dulu", () => {
    const petshop = [
      kunci({ id: "s2", sumber: "petshop", nomor: "CMGG2026102908220", tanggal: "2026-10-29" }),
      kunci({ id: "s1", sumber: "petshop", nomor: "CMGG2026102708100", tanggal: "2026-10-27" }),
    ];
    const klinik = [kunci({ id: "k1", sumber: "klinik", nomor: "INV-28", tanggal: "2026-10-28" })];
    const grosir = [kunci({ id: "g1", sumber: "grosir", nomor: "SI.2026.10.02177", tanggal: "2026-10-26" })];
    expect(gabungFaktur([petshop, klinik, grosir]).map(r => r.id)).toEqual(["s2", "k1", "s1", "g1"]);
  });

  it("pada tanggal yang sama nomor terbesar dulu, lalu sumber dan id sebagai penentu tetap", () => {
    const a = kunci({ id: "a", sumber: "petshop", nomor: "CM-002" });
    const b = kunci({ id: "b", sumber: "grosir", nomor: "CM-009" });
    const c = kunci({ id: "c", sumber: "klinik", nomor: "CM-002" });
    expect(gabungFaktur([[a], [b], [c]]).map(r => r.id)).toEqual(["b", "c", "a"]);
    expect(bandingFaktur(a, a)).toBe(0);
  });

  it("tetap benar walau satu sumber datang tidak urut", () => {
    const acak = [
      kunci({ id: "x", sumber: "grosir", nomor: "FJ.1", tanggal: "2026-10-01" }),
      kunci({ id: "y", sumber: "grosir", nomor: "FJ.2", tanggal: "2026-10-20" }),
    ];
    expect(gabungFaktur([acak]).map(r => r.id)).toEqual(["y", "x"]);
  });

  it("faktur tanpa tanggal jatuh di paling bawah, bukan di paling atas", () => {
    const berTanggal = kunci({ id: "a", sumber: "grosir", tanggal: "2026-10-10" });
    const tanpa = kunci({ id: "b", sumber: "grosir", tanggal: "" });
    expect(gabungFaktur([[berTanggal, tanpa]]).map(r => r.id)).toEqual(["a", "b"]);
  });

  it("tidak kehilangan atau menggandakan baris", () => {
    const sumber = [
      Array.from({ length: 5 }, (_, i) => kunci({ id: `p${i}`, sumber: "petshop", tanggal: `2026-10-0${i + 1}` })),
      Array.from({ length: 3 }, (_, i) => kunci({ id: `k${i}`, sumber: "klinik", tanggal: `2026-10-0${i + 2}` })),
      [] as KunciFaktur[],
    ];
    const hasil = gabungFaktur(sumber);
    expect(hasil).toHaveLength(8);
    expect(new Set(hasil.map(r => r.id)).size).toBe(8);
  });
});

describe("saringan", () => {
  const rows = [
    kunci({ id: "s1", sumber: "petshop", nomor: "CMGG2026102908220", customerId: "c1" }),
    kunci({ id: "k1", sumber: "klinik", nomor: "INV-9", status: "belum", customerId: "c2" }),
    kunci({ id: "g1", sumber: "grosir", nomor: "SI.2026.10.02177", status: "batal", customerId: "c3" }),
    kunci({ id: "s2", sumber: "petshop", nomor: "CMGG2026102908221", namaBebas: "Budi Marketplace" }),
  ];

  it("menyaring status dari status tersimpan dokumennya", () => {
    expect(saringFaktur(rows, { status: "belum" }).map(r => r.id)).toEqual(["k1"]);
    expect(saringFaktur(rows, { status: "batal" }).map(r => r.id)).toEqual(["g1"]);
    expect(saringFaktur(rows, {}).map(r => r.id)).toHaveLength(4);
  });

  it("kotak cari mencocokkan nomor dokumen tanpa peduli besar kecil huruf", () => {
    expect(saringFaktur(rows, { cari: "si.2026" }).map(r => r.id)).toEqual(["g1"]);
    expect(saringFaktur(rows, { cari: "8220" }).map(r => r.id)).toEqual(["s1"]);
  });

  it("kotak cari juga mencocokkan pelanggan lewat kartu pelanggan yang sudah dicarikan", () => {
    expect(saringFaktur(rows, { cari: "bunga", idCari: new Set(["c2"]) }).map(r => r.id)).toEqual(["k1"]);
  });

  it("nama pembeli bebas di struk marketplace ikut tercari", () => {
    expect(saringFaktur(rows, { cari: "budi" }).map(r => r.id)).toEqual(["s2"]);
    expect(saringFaktur(rows, { pelanggan: "budi" }).map(r => r.id)).toEqual(["s2"]);
  });

  it("filter pelanggan tidak ikut mencocokkan nomor dokumen", () => {
    expect(saringFaktur(rows, { pelanggan: "si.2026" })).toHaveLength(0);
    expect(cocokPelanggan(rows[2], "si.2026", new Set())).toBe(false);
    expect(cocokCari(rows[2], "si.2026", new Set())).toBe(true);
  });

  it("status dan pencarian berlaku bersamaan", () => {
    expect(saringFaktur(rows, { status: "lunas", cari: "CMGG" }).map(r => r.id)).toEqual(["s1", "s2"]);
  });
});

describe("umur, tautan, dan ringkasan", () => {
  it("umur dihitung dalam hari dan tidak pernah negatif", () => {
    expect(umurFaktur("2026-10-01", "2026-10-29")).toBe(28);
    expect(umurFaktur("2026-10-29", "2026-10-29")).toBe(0);
    expect(umurFaktur("2026-11-05", "2026-10-29")).toBe(0);
    expect(umurFaktur("", "2026-10-29")).toBeNull();
  });

  it("tiap sumber mengantar ke halaman dokumen aslinya", () => {
    expect(hrefFaktur({ sumber: "petshop", id: "sale-1", visitId: null })).toBe("/penjualan/sale-1");
    expect(hrefFaktur({ sumber: "grosir", id: "inv-1", visitId: null })).toBe("/penjualan/faktur/inv-1");
    expect(hrefFaktur({ sumber: "klinik", id: "ci-1", visitId: "visit-7" })).toBe("/klinik/pembayaran/visit-7");
    expect(hrefFaktur({ sumber: "klinik", id: "ci-1", visitId: null })).toBe("/klinik/pembayaran");
  });

  it("ringkasan menghitung jumlah dokumen, total, dan sisa belum lunas", () => {
    const hasil = ringkasFaktur([
      kunci({ id: "a", sumber: "petshop", total: 150_000 }),
      kunci({ id: "b", sumber: "klinik", total: 250_000, status: "belum" }),
      kunci({ id: "c", sumber: "grosir", total: 600_000, status: "belum" }),
    ]);
    expect(hasil).toEqual({ jumlah: 3, total: 1_000_000, jumlahBelum: 2, totalBelum: 850_000 });
  });
});

describe("ekspor", () => {
  it("kolomnya sama dengan yang tampil di layar", () => {
    expect([...KOLOM_EKSPOR]).toEqual(
      ["Nomor", "Tanggal", "Cabang", "Sumber", "Pelanggan", "Keterangan", "Status", "Umur (hari)", "Total"]);
  });

  it("menulis label sumber dan status yang terbaca orang, umur hanya untuk yang belum lunas", () => {
    const rows = [
      baris({ id: "g1", sumber: "grosir", nomor: "SI.2026.10.02177", tanggal: "2026-10-02", status: "belum", total: 4_500_000, pelanggan: "Toko Hewan", keterangan: "Pesanan SO.1" }),
      baris({ id: "s1", sumber: "petshop", nomor: "CMGG2026102908220", tanggal: "2026-10-29", total: 95_000 }),
    ];
    expect(barisEkspor(rows, "2026-10-29")).toEqual([
      ["SI.2026.10.02177", "2026-10-02", "Pondok Aren", SUMBER_LABEL.grosir, "Toko Hewan", "Pesanan SO.1", STATUS_LABEL.belum, 27, 4_500_000],
      ["CMGG2026102908220", "2026-10-29", "Pondok Aren", SUMBER_LABEL.petshop, "Umum", "", STATUS_LABEL.lunas, "", 95_000],
    ]);
  });

  it("struk tanpa nomor tetap keluar dengan penanda, bukan sel kosong", () => {
    expect(barisEkspor([baris({ id: "s9", sumber: "petshop", nomor: "" })], "2026-10-29")[0][0]).toBe("(tanpa nomor)");
  });
});
