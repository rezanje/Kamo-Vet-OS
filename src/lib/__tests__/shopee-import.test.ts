import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { bacaShopeeXlsx, parseShopeeNumber, statusImpor } from "../shopee-import";

const FIXTURE = join(__dirname, "fixtures", "shopee-order-toship-sample.xlsx");

const HEADERS = [
  "No. Pesanan", "Status Pesanan", "Status Pembatalan/ Pengembalian", "Waktu Pesanan Dibuat", "Metode Pembayaran",
  "SKU Induk", "Nama Produk", "Nomor Referensi SKU", "Nama Variasi", "Harga Awal", "Harga Setelah Diskon", "Jumlah",
  "Subtotal Pesanan", "Voucher Ditanggung Penjual", "Voucher Ditanggung Shopee", "Potongan Koin Shopee", "Diskon Kartu Kredit",
  "Ongkos Kirim Dibayar oleh Pembeli", "Estimasi Potongan Biaya Pengiriman", "Total Pembayaran", "Perkiraan Ongkos Kirim",
  "Username (Pembeli)", "Nama Penerima", "No. Telepon", "Alamat Pengiriman",
];

type Cell = string | number;
const baris = (o: Record<string, Cell>): Record<string, Cell> => ({
  "No. Pesanan": "FIKTIF-A", "Status Pesanan": "Perlu Dikirim", "Status Pembatalan/ Pengembalian": "", "Waktu Pesanan Dibuat": "2026-11-05 10:00",
  "Metode Pembayaran": "COD (Bayar di Tempat)", "SKU Induk": "", "Nama Produk": "Barang Fiktif", "Nomor Referensi SKU": "", "Nama Variasi": "",
  "Harga Awal": "10.000", "Harga Setelah Diskon": "10.000", Jumlah: "1", "Subtotal Pesanan": "10.000", "Voucher Ditanggung Penjual": "0",
  "Voucher Ditanggung Shopee": "0", "Potongan Koin Shopee": "0", "Diskon Kartu Kredit": "0", "Ongkos Kirim Dibayar oleh Pembeli": "0",
  "Estimasi Potongan Biaya Pengiriman": "0", "Total Pembayaran": "10.000", "Perkiraan Ongkos Kirim": "0", "Username (Pembeli)": "pembeli_fiktif",
  "Nama Penerima": "N*****a", "No. Telepon": "******99", "Alamat Pengiriman": "ALAMAT-RAHASIA Jl. Fiktif 1", ...o,
});

async function xlsx(rows: Record<string, Cell>[], headers: string[] = HEADERS, sheet = "orders"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map(h => r[h] ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseShopeeNumber", () => {
  it.each([
    ["20.912", 20912], ["3.500", 3500], ["1.234.567", 1234567], ["0", 0], ["", 0], ["  16.349 ", 16349],
    ["Rp 78.663", 78663], ["12,5", 12.5], ["1.234,50", 1234.5], ["1000", 1000], ["16.349,000", 16349], ["78.663", 78663],
  ])("%s -> %s", (raw, out) => expect(parseShopeeNumber(raw)).toBe(out));
  it("angka asli dari sel Excel dipakai apa adanya", () => {
    expect(parseShopeeNumber(20912)).toBe(20912);
    expect(parseShopeeNumber(3.5)).toBe(3.5);
  });
  it.each(["1,000", "12,500", "16.5", "12.5", "1.5", "0.5", "1.234.56", "1,2,3", "1.00"])("bentuk ambigu/janggal %s ditolak (NaN), bukan ditebak", raw => {
    expect(parseShopeeNumber(raw)).toBeNaN();
  });
  it("teks bukan angka = NaN (tidak diam-diam 0)", () => {
    expect(parseShopeeNumber("abc")).toBeNaN();
    expect(parseShopeeNumber("1.2.3x")).toBeNaN();
  });
});

describe("statusImpor", () => {
  it.each(["Pembatalan diajukan", "Dibatalkan", "Belum Bayar", "pembatalan DIAJUKAN"])("%s dilewati dengan alasan", status => {
    const r = statusImpor(status, "");
    expect(r.importable).toBe(false);
    expect(r.reason).toMatch(/dilewati|tidak diimpor/i);
  });
  it.each(["Perlu Dikirim", "Siap Dikirim", "Dikirim", "Selesai"])("%s boleh diimpor", status => {
    expect(statusImpor(status, "")).toEqual({ importable: true, reason: null });
  });
  it("status tidak dikenal dilewati (aman secara bawaan)", () => {
    expect(statusImpor("Status Aneh Baru", "").importable).toBe(false);
  });
  it("kolom status pembatalan/pengembalian terisi = dilewati walau status pesanan tampak normal", () => {
    expect(statusImpor("Selesai", "Pengembalian diajukan").importable).toBe(false);
  });
});

describe("bacaShopeeXlsx: fixture contoh (data fiktif)", () => {
  it("3 pesanan dari 4 baris; baris pesanan sama digabung", async () => {
    const { orders, error } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    expect(error).toBeNull();
    expect(orders.map(o => o.orderNo)).toEqual(["2611050FIKTIF1", "2611050FIKTIF2", "2611050FIKTIF3"]);
    expect(orders.map(o => o.lines.length)).toEqual([1, 1, 2]);
  });

  it("pembatalan diajukan tidak diimpor secara bawaan, ada alasan terlihat", async () => {
    const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    expect(orders[0]).toMatchObject({ status: "Pembatalan diajukan", importable: false, dataValid: true });
    expect(orders[0].skipReason).toMatch(/Pembatalan diajukan/);
    expect(orders[1].importable).toBe(true);
    expect(orders[2].importable).toBe(true);
  });

  it("pesanan 2: 2 x 16.349, Saldo ShopeePay; total pembayaran + selisih dijelaskan", async () => {
    const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    const o = orders[1];
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ qty: 2, harga: 16349, hargaAwal: 16349, subtotal: 32698, skuInduk: "", skuRef: "" });
    expect(o.lines[0].namaProduk).toMatch(/^jio makanan kucing dryfood repack 500gr/);
    expect(o.metodeBayar).toBe("Saldo ShopeePay");
    expect(o.tanggal).toBe("2026-11-05");
    expect(o.subtotalBarang).toBe(32698);
    expect(o.totalPembayaran).toBe(29462);
    // 32.698 - voucher Shopee 4.000 - kartu kredit 273 = 28.425 -> selisih 1.037 (biaya lain yang tidak dirinci file)
    expect(o.rincian).toMatchObject({ voucherShopee: 4000, kartuKredit: 273, potonganOngkir: 6500, perkiraanOngkir: 6500, ongkirPembeli: 0 });
    expect(o.selisih).toBe(1037);
  });

  it("pesanan 3: dua baris, angka tingkat pesanan (voucher/total) tidak dijumlah dua kali", async () => {
    const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    const o = orders[2];
    expect(o.lines.map(l => [l.qty, l.harga])).toEqual([[1, 78663], [1, 78663]]);
    expect(o.lines[0].namaProduk).toMatch(/^Mr\.Vet DIGESTION CARE T1 1kg/);
    expect(o.lines[1].namaProduk).toMatch(/^Mr\.Vet HAIR & SKIN CARE T2 1kg/);
    expect(o.metodeBayar).toMatch(/^COD/);
    expect(o.subtotalBarang).toBe(157326);
    expect(o.totalPembayaran).toBe(151759);
    expect(o.rincian.voucherShopee).toBe(7867);
    expect(o.rincian.potonganOngkir).toBe(19000);
    expect(o.selisih).toBe(2300);
  });

  it("pembeli = Username saja; nama penerima, telepon, alamat tidak pernah masuk hasil", async () => {
    const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    expect(orders.map(o => o.buyer)).toEqual(["pembeli_fiktif_1", "pembeli_fiktif_2", "pembeli_fiktif_3"]);
    const json = JSON.stringify(orders);
    for (const rahasia of ["DIMASKING", "Jl. Fiktif", "KOTA FIKTIF", "PROVINSI FIKTIF", "******00", "P*****a"]) expect(json).not.toContain(rahasia);
  });
});

describe("bacaShopeeXlsx: kolom dibaca lewat NAMA header", () => {
  it("urutan kolom dibalik tetap menghasilkan data sama", async () => {
    const rows = [baris({}), baris({ "No. Pesanan": "FIKTIF-B", "Nama Produk": "Lain", Jumlah: "3", "Harga Setelah Diskon": "5.000", "Subtotal Pesanan": "15.000", "Total Pembayaran": "15.000" })];
    const normal = await bacaShopeeXlsx(await xlsx(rows));
    const dibalik = await bacaShopeeXlsx(await xlsx(rows, [...HEADERS].reverse()));
    expect(dibalik.error).toBeNull();
    expect(dibalik.orders).toEqual(normal.orders);
  });
  it("header berspasi/huruf besar-kecil berbeda tetap dikenali", async () => {
    const headers = HEADERS.map(h => h === "Jumlah" ? "  JUMLAH " : h === "No. Pesanan" ? "no. pesanan" : h);
    const { orders, error } = await bacaShopeeXlsx(await xlsx([baris({ JUMLAH: "2", "  JUMLAH ": "2", "no. pesanan": "FIKTIF-Z" })], headers));
    expect(error).toBeNull();
    expect(orders[0].lines[0].qty).toBe(2);
    expect(orders[0].orderNo).toBe("FIKTIF-Z");
  });
  it("header wajib hilang -> error jelas, tanpa pesanan", async () => {
    const { orders, error } = await bacaShopeeXlsx(await xlsx([baris({})], HEADERS.filter(h => h !== "Harga Setelah Diskon")));
    expect(orders).toEqual([]);
    expect(error).toMatch(/Harga Setelah Diskon/);
  });
  it("sheet 'orders' dipakai, sheet lain (Advance Fulfilment, berisi alamat) tidak dibaca", async () => {
    const wb = new ExcelJS.Workbook();
    const aneh = wb.addWorksheet("Advance Fulfilment");
    aneh.addRow(["Booking SN", "Alamat Pengiriman", "No. Pesanan"]);
    aneh.addRow(["X", "ALAMAT-LAIN", "FIKTIF-SALAH"]);
    const ws = wb.addWorksheet("orders");
    ws.addRow(HEADERS);
    ws.addRow(HEADERS.map(h => baris({})[h]));
    const { orders, error } = await bacaShopeeXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(error).toBeNull();
    expect(orders.map(o => o.orderNo)).toEqual(["FIKTIF-A"]);
    expect(JSON.stringify(orders)).not.toContain("ALAMAT");
  });
  it("sel angka asli (bukan teks) terbaca", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([baris({ "Harga Setelah Diskon": 20912, Jumlah: 2, "Subtotal Pesanan": 41824, "Total Pembayaran": 41824 })]));
    expect(orders[0].lines[0]).toMatchObject({ harga: 20912, qty: 2 });
    expect(orders[0].subtotalBarang).toBe(41824);
  });
});

describe("bacaShopeeXlsx: pengelompokan dan status", () => {
  it("status per pesanan: Dibatalkan & Belum Bayar dilewati, Perlu Dikirim lolos", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([
      baris({ "No. Pesanan": "A1", "Status Pesanan": "Dibatalkan" }),
      baris({ "No. Pesanan": "A2", "Status Pesanan": "Belum Bayar" }),
      baris({ "No. Pesanan": "A3", "Status Pesanan": "Perlu Dikirim" }),
    ]));
    expect(orders.map(o => o.importable)).toEqual([false, false, true]);
    expect(orders[0].skipReason).toMatch(/Dibatalkan/);
    expect(orders[1].skipReason).toMatch(/Belum Bayar/);
  });
  it("baris tersebar (tidak berurutan) dengan No. Pesanan sama tetap satu pesanan", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([
      baris({ "No. Pesanan": "A1", "Nama Produk": "P1" }), baris({ "No. Pesanan": "B1", "Nama Produk": "Q" }), baris({ "No. Pesanan": "A1", "Nama Produk": "P2" }),
    ]));
    expect(orders.map(o => [o.orderNo, o.lines.map(l => l.namaProduk)])).toEqual([["A1", ["P1", "P2"]], ["B1", ["Q"]]]);
  });
  it("baris tanpa No. Pesanan diabaikan; baris dengan jumlah/harga rusak membuat pesanan tidak bisa diimpor", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([
      baris({ "No. Pesanan": "" }), baris({ "No. Pesanan": "BAD1", Jumlah: "dua" }), baris({ "No. Pesanan": "BAD2", "Harga Setelah Diskon": "-5" }), baris({ "No. Pesanan": "BAD3", Jumlah: "0" }),
    ]));
    expect(orders.map(o => o.orderNo)).toEqual(["BAD1", "BAD2", "BAD3"]);
    for (const o of orders) { expect(o.importable).toBe(false); expect(o.dataValid).toBe(false); expect(o.skipReason).toMatch(/jumlah|harga/i); }
  });
  it("status campuran di satu pesanan: satu baris dibatalkan = seluruh pesanan dilewati", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([
      baris({ "No. Pesanan": "M1" }), baris({ "No. Pesanan": "M1", "Status Pesanan": "Dibatalkan" }),
    ]));
    expect(orders[0].importable).toBe(false);
  });
  it("tanggal tidak terbaca -> tidak bisa diimpor", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([baris({ "Waktu Pesanan Dibuat": "kemarin" })]));
    expect(orders[0].importable).toBe(false);
    expect(orders[0].skipReason).toMatch(/tanggal/i);
  });
  it("bukan xlsx -> error ramah", async () => {
    const r = await bacaShopeeXlsx(Buffer.from("bukan excel"));
    expect(r.orders).toEqual([]);
    expect(r.error).toMatch(/xlsx/i);
  });
});

describe("bacaShopeeXlsx: angka jumlah/harga ketat (format Indonesia)", () => {
  const baca = async (o: Record<string, Cell>) => (await bacaShopeeXlsx(await xlsx([baris(o)]))).orders[0];
  const rusak = (o: Awaited<ReturnType<typeof baca>>) => { expect(o.dataValid).toBe(false); expect(o.importable).toBe(false); };
  it("'1,000' / '12,500' pada harga = baris rusak dengan pesan 'angka tidak jelas: tulis 1000 atau 1.000'", async () => {
    for (const harga of ["1,000", "12,500"]) {
      const o = await baca({ "Harga Setelah Diskon": harga });
      rusak(o);
      expect(o.skipReason).toContain("angka tidak jelas: tulis 1000 atau 1.000");
      expect(o.skipReason).toMatch(/harga/i);
    }
  });
  it("'1,000' pada jumlah = baris rusak dengan pesan yang sama", async () => {
    const o = await baca({ Jumlah: "1,000" });
    rusak(o);
    expect(o.skipReason).toContain("angka tidak jelas: tulis 1000 atau 1.000");
    expect(o.skipReason).toMatch(/jumlah/i);
  });
  it("jumlah harus bilangan bulat positif: '1,5', '1.5', 1.5 (sel angka), 0 ditolak", async () => {
    for (const q of ["1,5", "1.5", 1.5, "0"] as Cell[]) {
      const o = await baca({ Jumlah: q });
      rusak(o);
      expect(o.skipReason).toMatch(/jumlah/i);
    }
  });
  it("harga kosong = baris rusak, bukan Rp 0", async () => {
    const o = await baca({ "Harga Setelah Diskon": "" });
    rusak(o);
    expect(o.skipReason).toMatch(/harga kosong/i);
  });
  it("harga kosong di baris ke-2 pesanan yang baris ke-1 berharga tetap membuat seluruh pesanan rusak", async () => {
    const { orders } = await bacaShopeeXlsx(await xlsx([baris({}), baris({ "Harga Setelah Diskon": "" })]));
    rusak(orders[0]);
  });
  it("angka sah tetap lolos: '20.912', '16.349', '78.663', '1.000', '1000', 2, harga '12,5' desimal koma", async () => {
    for (const [h, q, nilai] of [["20.912", "2", 20912], ["16.349", "1", 16349], ["78.663", "1", 78663], ["1.000", "3", 1000], ["1000", "3", 1000], [16349, 2, 16349], ["12,5", "1", 12.5]] as [Cell, Cell, number][]) {
      const o = await baca({ "Harga Setelah Diskon": h, Jumlah: q });
      expect(o.dataValid).toBe(true);
      expect(o.importable).toBe(true);
      expect(o.lines[0].harga).toBe(nilai);
    }
  });
});

describe("bacaShopeeXlsx: batas isi zip (anti zip-bomb), dicek sebelum xlsx dibuka", () => {
  const MB = 1024 * 1024;
  const zipDari = async (entri: Record<string, number>) => {
    const z = new JSZip();
    for (const [nama, ukuran] of Object.entries(entri)) z.file(nama, Buffer.alloc(ukuran, 65));
    return Buffer.from(await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
  };
  it("file kecil berisi satu entri 16 MB (rasio tinggi) ditolak", async () => {
    const f = await zipDari({ "xl/worksheets/sheet1.xml": 16 * MB });
    expect(f.length).toBeLessThan(200 * 1024);
    const r = await bacaShopeeXlsx(f);
    expect(r.orders).toEqual([]);
    expect(r.error).toMatch(/terlalu besar|15 MB/i);
  });
  it("total isi 26 MB (dua entri 13 MB) ditolak", async () => {
    const r = await bacaShopeeXlsx(await zipDari({ "a.xml": 13 * MB, "b.xml": 13 * MB }));
    expect(r.error).toMatch(/25 MB/);
  });
  it("201 entri ditolak", async () => {
    const entri: Record<string, number> = {};
    for (let i = 0; i < 201; i++) entri[`e${i}.xml`] = 10;
    expect((await bacaShopeeXlsx(await zipDari(entri))).error).toMatch(/200/);
  });
  it("tepat di batas lolos pemeriksaan zip (2 entri 12 MB = 24 MB, 200 entri) lalu ditolak karena bukan xlsx, bukan karena ukuran", async () => {
    const entri: Record<string, number> = {};
    for (let i = 0; i < 200; i++) entri[`e${i}.xml`] = 10;
    expect((await bacaShopeeXlsx(await zipDari(entri))).error).not.toMatch(/200|MB/);
    expect((await bacaShopeeXlsx(await zipDari({ "a.xml": 12 * MB, "b.xml": 12 * MB }))).error).not.toMatch(/MB/);
  });
  it("ukuran yang tertulis di central directory yang dipakai (ukuran dipalsukan 0xFFFFFFFF/zip64 ditolak)", async () => {
    const f = await zipDari({ "a.xml": 10 });
    const i = f.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    f.writeUInt32LE(0xffffffff, i + 24);
    expect((await bacaShopeeXlsx(f)).error).toMatch(/MB/);
  });
  it("fixture asli dan file xlsx normal tetap terbaca", async () => {
    expect((await bacaShopeeXlsx(readFileSync(FIXTURE))).error).toBeNull();
    expect((await bacaShopeeXlsx(await xlsx([baris({})]))).error).toBeNull();
  });
  it("ZIP terpotong/rusak tetap pesan 'File tidak bisa dibaca'", async () => {
    expect((await bacaShopeeXlsx((await zipDari({ "a.xml": 10 })).subarray(0, 30))).error).toMatch(/tidak bisa dibaca/);
  });
});
