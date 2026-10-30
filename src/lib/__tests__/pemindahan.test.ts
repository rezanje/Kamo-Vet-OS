import { describe, expect, it } from "vitest";
import { bolehBatalKirim, formatNoPemindahan, hitungStatusKirim, kendalaBatalKirim, kurangStokPemindahan as barisKurangPemindahan, sisaTransit } from "../pemindahan";
import { labelSource } from "../kartu-stok";
import { formatKekuranganStok } from "../stok-kurang";

// Hasil `kurangStokPemindahan` sekarang baris terstruktur untuk popup; kalimat
// yang dibaca petugas dibentuk `formatKekuranganStok`.
const kurangStokPemindahan = (...args: Parameters<typeof barisKurangPemindahan>) => {
  const baris = barisKurangPemindahan(...args);
  return baris.length ? formatKekuranganStok(baris) : null;
};

describe("formatNoPemindahan", () => {
  it("format IT.YYYY.MM.NNNNN", () => {
    expect(formatNoPemindahan(new Date(2026, 6, 22), 542)).toBe("IT.2026.07.00542");
    expect(formatNoPemindahan(new Date(2026, 11, 1), 1)).toBe("IT.2026.12.00001");
  });
});

describe("hitungStatusKirim", () => {
  it("belum ada penerimaan -> Sedang dikirim", () => {
    expect(hitungStatusKirim(100, 0)).toBe("Sedang dikirim");
  });
  it("sebagian diterima -> Diterima Sebagian", () => {
    expect(hitungStatusKirim(100, 40)).toBe("Diterima Sebagian");
  });
  it("semua diterima -> Diterima Seluruhnya", () => {
    expect(hitungStatusKirim(100, 100)).toBe("Diterima Seluruhnya");
    expect(hitungStatusKirim(100, 120)).toBe("Diterima Seluruhnya");
  });
});

describe("sisaTransit", () => {
  it("hitung sisa per item, item habis tidak muncul", () => {
    expect(
      sisaTransit({ a: 10, b: 5 }, { a: 4, b: 5 }),
    ).toEqual({ a: 6 });
  });
  it("tanpa penerimaan -> semua sisa", () => {
    expect(sisaTransit({ a: 3 }, {})).toEqual({ a: 3 });
  });
});

describe("kekurangan stok gudang asal ketahuan sebelum form dikirim", () => {
  const stok = new Map([["itm-a", 250]]);
  it("menyebut barang, jumlah perlu, dan jumlah tersedia", () => {
    expect(kurangStokPemindahan(
      [{ item_id: "itm-a", nama: "Obat A", qty: 500, faktor: 1, satuan: "pcs" }], stok,
    )).toBe("Obat A butuh 500 pcs, tersedia 250 pcs");
  });
  it("satuan besar dihitung ke satuan dasar dulu, lalu ditampilkan kembali", () => {
    expect(kurangStokPemindahan(
      [{ item_id: "itm-a", nama: "Obat A", qty: 30, faktor: 10, satuan: "box" }], stok,
    )).toBe("Obat A butuh 30 box, tersedia 25 box");
  });
  it("dua baris barang sama dijumlahkan, bukan dibandingkan sendiri-sendiri", () => {
    expect(kurangStokPemindahan([
      { item_id: "itm-a", nama: "Obat A", qty: 150, faktor: 1, satuan: "pcs" },
      { item_id: "itm-a", nama: "Obat A", qty: 150, faktor: 1, satuan: "pcs" },
    ], stok)).toBe("Obat A butuh 300 pcs, tersedia 250 pcs");
  });
  it("stok cukup, baris kosong, dan stok minus", () => {
    expect(kurangStokPemindahan([{ item_id: "itm-a", nama: "Obat A", qty: 250, faktor: 1, satuan: "pcs" }], stok)).toBeNull();
    expect(kurangStokPemindahan([{ item_id: "", nama: "", qty: 5, faktor: 1, satuan: "pcs" }], stok)).toBeNull();
    expect(kurangStokPemindahan(
      [{ item_id: "itm-b", nama: "Obat B", qty: 1, faktor: 1, satuan: "pcs" }], new Map([["itm-b", -8]]),
    )).toBe("Obat B butuh 1 pcs, tersedia 0 pcs");
  });
});

describe("batal pengiriman hanya selama belum ada yang diterima", () => {
  const kirim = (status: string | null, penerimaan = 0) => ({ proses: "Kirim Barang", status, penerimaan });

  it("dokumen Sedang dikirim tanpa penerimaan boleh dibatalkan", () => {
    expect(kendalaBatalKirim(kirim("Sedang dikirim"))).toBeNull();
    expect(bolehBatalKirim(kirim("Sedang dikirim"))).toBe(true);
  });

  it("satu dokumen Terima Barang saja sudah menutup pembatalan", () => {
    expect(kendalaBatalKirim(kirim("Sedang dikirim", 1))).toContain("sudah diterima gudang tujuan");
    expect(bolehBatalKirim(kirim("Sedang dikirim", 1))).toBe(false);
  });

  it("status Diterima Sebagian/Seluruhnya juga ditolak, tanpa menunggu hitungan dokumen", () => {
    expect(kendalaBatalKirim(kirim("Diterima Sebagian"))).toContain("sudah diterima gudang tujuan");
    expect(kendalaBatalKirim(kirim("Diterima Seluruhnya"))).toContain("sudah diterima gudang tujuan");
  });

  it("dokumen yang sudah dibatalkan tidak bisa dibatalkan dua kali", () => {
    expect(kendalaBatalKirim(kirim("Dibatalkan"))).toBe("Pengiriman ini sudah dibatalkan.");
  });

  it("dokumen Terima Barang bukan sasaran pembatalan", () => {
    expect(kendalaBatalKirim({ proses: "Terima Barang", status: null }))
      .toContain("Hanya dokumen Kirim Barang");
  });

  it("status kosong (dokumen Terima) tidak pernah dianggap boleh", () => {
    expect(bolehBatalKirim({ proses: "Kirim Barang", status: null })).toBe(false);
  });
});

describe("kartu stok menamai mutasi pembatalan", () => {
  it("pembalikan pemindahan dan pembalikan kiriman permintaan punya label sendiri", () => {
    expect(labelSource("transfer-batal")).toBe("Pembatalan Pemindahan Barang");
    expect(labelSource("batal-kirim-permintaan")).toBe("Pembatalan Pengiriman Permintaan Barang");
  });
});
