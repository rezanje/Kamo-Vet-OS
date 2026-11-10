import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bacaShopeeXlsx, type ShopeeLine, type ShopeeOrder } from "../shopee-import";
import { analisisImpor, cocokkanBarang, kunciBaris, normalisasiNama, pilihGudangDefault, satuanBarang, tebakSatuan, type CatalogItem } from "../shopee-import-match";

const FIXTURE = join(__dirname, "fixtures", "shopee-order-toship-sample.xlsx");
const item = (id: string, code: string, name: string, sell_price: number, stock = 10): CatalogItem => ({ id, code, name, sell_price, stock });
const CATALOG: CatalogItem[] = [
  item("i-bolt", "BOLT-800", "Bolt Ikan 800gr", 21000),
  item("i-jio", "JIO-500", "Jio Dryfood 500gr", 16500, 1),
  item("i-dig", "MRV-DIG-1KG", "Mr.Vet Digestion Care T1 1kg", 80000, 5),
  item("i-hair", "MRV-HAIR-1KG", "Mr.Vet Hair & Skin Care T2 1kg", 80000, 5),
];
const line = (o: Partial<ShopeeLine> = {}): ShopeeLine => ({ baris: 2, skuInduk: "", skuRef: "", namaProduk: "", variasi: "", qty: 1, hargaAwal: 10000, harga: 10000, subtotal: 10000, ...o });
const order = (o: Partial<ShopeeOrder> = {}): ShopeeOrder => ({
  orderNo: "FIKTIF-1", status: "Perlu Dikirim", statusPembatalan: "", importable: true, dataValid: true, skipReason: null, tanggal: "2026-11-05", buyer: "pembeli_fiktif",
  metodeBayar: "Saldo ShopeePay", lines: [line({ skuRef: "BOLT-800", harga: 21000 })], subtotalBarang: 21000, totalPembayaran: 21000,
  rincian: { voucherPenjual: 0, voucherShopee: 0, koin: 0, kartuKredit: 0, ongkirPembeli: 0, potonganOngkir: 0, perkiraanOngkir: 0 }, selisih: 0, ...o,
});
const opts = (o = {}) => ({ existing: {}, overrides: {}, konfirmasi: new Set<string>(), sertakan: new Set<string>(), ...o });

describe("normalisasiNama", () => {
  it("huruf kecil, tanda baca dibuang, angka-satuan dipisah, spasi dirapikan", () => {
    expect(normalisasiNama("  Mr.Vet  Hair & Skin Care T2 1kg ")).toBe("mr vet hair skin care t 2 1 kg");
    expect(normalisasiNama("Bolt Ikan 800gr")).toBe(normalisasiNama("bolt ikan 800 gr"));
  });
});

describe("cocokkanBarang", () => {
  it("Nomor Referensi SKU = kode barang (tanpa pedulikan besar-kecil huruf)", () => {
    expect(cocokkanBarang(line({ skuRef: "jio-500" }), CATALOG)).toEqual({ itemId: "i-jio", kind: "sku", perluPeriksa: false });
  });
  it("SKU Induk = kode barang bila Nomor Referensi kosong", () => {
    expect(cocokkanBarang(line({ skuInduk: "MRV-DIG-1KG" }), CATALOG)).toMatchObject({ itemId: "i-dig", kind: "sku" });
  });
  it("Nomor Referensi SKU didahulukan dari SKU Induk", () => {
    expect(cocokkanBarang(line({ skuRef: "JIO-500", skuInduk: "BOLT-800" }), CATALOG)).toMatchObject({ itemId: "i-jio" });
  });
  it("SKU Induk berupa nama barang persis (SKU Induk 'Bolt Ikan 800 gr' ~ 'Bolt Ikan 800gr')", () => {
    expect(cocokkanBarang(line({ skuInduk: "Bolt Ikan 800 gr" }), CATALOG)).toEqual({ itemId: "i-bolt", kind: "nama-normal", perluPeriksa: false });
    expect(cocokkanBarang(line({ skuInduk: "bolt ikan 800gr" }), CATALOG)).toMatchObject({ itemId: "i-bolt", kind: "nama" });
  });
  it("nama produk persis / ternormalisasi", () => {
    expect(cocokkanBarang(line({ namaProduk: "MR.VET DIGESTION CARE T1 1KG" }), CATALOG)).toMatchObject({ itemId: "i-dig", kind: "nama" });
    expect(cocokkanBarang(line({ namaProduk: "Mr Vet Digestion Care T1 1 kg" }), CATALOG)).toMatchObject({ itemId: "i-dig", kind: "nama-normal" });
  });
  it("nama panjang Shopee yang memuat nama master = perkiraan, WAJIB diperiksa", () => {
    const m = cocokkanBarang(line({ namaProduk: "Mr.Vet DIGESTION CARE T1 1kg freshpack - Makanan Kucing Kering premium - chicken beef formula" }), CATALOG);
    expect(m).toEqual({ itemId: "i-dig", kind: "perkiraan", perluPeriksa: true });
    const hair = cocokkanBarang(line({ namaProduk: "Mr.Vet HAIR & SKIN CARE T2 1kg freshpack - Makanan Kucing Kering premium" }), CATALOG);
    expect(hair).toMatchObject({ itemId: "i-hair", kind: "perkiraan" });
  });
  it("tidak ada yang cocok -> itemId null", () => {
    expect(cocokkanBarang(line({ namaProduk: "Pasir kucing wangi 5 liter" }), CATALOG)).toEqual({ itemId: null, kind: "tidak", perluPeriksa: true });
  });
  it("lebih dari satu kandidat setara = ambigu, tidak ditebak", () => {
    const dobel = [...CATALOG, item("i-bolt2", "BOLT-800-B", "Bolt Ikan 800gr", 22000)];
    expect(cocokkanBarang(line({ namaProduk: "Bolt Ikan 800gr" }), dobel)).toEqual({ itemId: null, kind: "ambigu", perluPeriksa: true });
    const kodeSama = [...CATALOG, item("i-x", "BOLT-800", "Lain", 1)];
    expect(cocokkanBarang(line({ skuRef: "BOLT-800" }), kodeSama).kind).toBe("ambigu");
  });
  it("perkiraan memilih nama master terpanjang yang termuat", () => {
    const cat = [item("a", "A", "Mr.Vet Care 1kg", 1), item("b", "B", "Mr.Vet Digestion Care T1 1kg", 1)];
    expect(cocokkanBarang(line({ namaProduk: "Mr.Vet DIGESTION CARE T1 1kg freshpack" }), cat)).toMatchObject({ itemId: "b", kind: "perkiraan" });
  });
  it("nama master satu kata terlalu umum untuk perkiraan", () => {
    expect(cocokkanBarang(line({ namaProduk: "Jio makanan kucing" }), [item("x", "X", "Jio", 1)])).toMatchObject({ itemId: null, kind: "tidak" });
  });
});

describe("cocokkanBarang: Nama Variasi", () => {
  const POUCH = [item("i-pouch", "POUCH-85", "Pouch Cat 85gr", 9000), item("i-pouch-12", "POUCH-85-12", "Pouch Cat 85gr Dus Isi 12", 100000)];
  const perkiraan = { kind: "perkiraan", perluPeriksa: true };
  it("nama persis + variasi terisi ('Pouch Cat 85gr' + 'dus isi 12') = perkiraan, WAJIB dicentang", () => {
    expect(cocokkanBarang(line({ namaProduk: "Pouch Cat 85gr", variasi: "dus isi 12" }), [POUCH[0]])).toEqual({ itemId: "i-pouch", ...perkiraan });
  });
  it("nama ternormalisasi + variasi terisi = perkiraan", () => {
    expect(cocokkanBarang(line({ namaProduk: "pouch cat 85 gr", variasi: "dus isi 12" }), [POUCH[0]])).toEqual({ itemId: "i-pouch", ...perkiraan });
  });
  it("SKU Induk (kode induk dipakai semua variasi) + variasi terisi = perkiraan", () => {
    expect(cocokkanBarang(line({ skuInduk: "POUCH-85", namaProduk: "Pouch Cat", variasi: "dus isi 12" }), POUCH)).toEqual({ itemId: "i-pouch", ...perkiraan });
  });
  it("SKU Induk berupa nama barang + variasi terisi = perkiraan", () => {
    expect(cocokkanBarang(line({ skuInduk: "Bolt Ikan 800 gr", variasi: "bulat, salmon 800 gr" }), CATALOG)).toEqual({ itemId: "i-bolt", ...perkiraan });
  });
  it("Nomor Referensi SKU (SKU variasi) yang cocok kode barang tetap diam-diam (tanpa centang), walau variasi terisi", () => {
    expect(cocokkanBarang(line({ skuRef: "POUCH-85-12", skuInduk: "POUCH-85", namaProduk: "Pouch Cat 85gr", variasi: "dus isi 12" }), POUCH)).toEqual({ itemId: "i-pouch-12", kind: "sku", perluPeriksa: false });
  });
  it("SKU variasi cocok ke dua barang = ambigu (bukan diam-diam)", () => {
    const dobel = [...POUCH, item("i-x", "POUCH-85-12", "Lain", 1)];
    expect(cocokkanBarang(line({ skuRef: "POUCH-85-12", variasi: "dus isi 12" }), dobel).kind).toBe("ambigu");
  });
  it("variasi kosong / hanya spasi: perilaku lama (diam-diam)", () => {
    expect(cocokkanBarang(line({ namaProduk: "Pouch Cat 85gr", variasi: "" }), [POUCH[0]])).toEqual({ itemId: "i-pouch", kind: "nama", perluPeriksa: false });
    expect(cocokkanBarang(line({ namaProduk: "Pouch Cat 85gr", variasi: "   " }), [POUCH[0]])).toMatchObject({ kind: "nama", perluPeriksa: false });
    expect(cocokkanBarang(line({ skuInduk: "POUCH-85", variasi: "" }), [POUCH[0]])).toMatchObject({ kind: "sku", perluPeriksa: false });
  });
  it("analisisImpor: baris perkiraan karena variasi tidak lolos sebelum dicentang; lolos setelah dicentang", () => {
    const o = order({ lines: [line({ namaProduk: "Pouch Cat 85gr", variasi: "dus isi 12", harga: 9000 })] });
    const cat = [POUCH[0]];
    const [a] = analisisImpor([o], cat, opts());
    expect(a.status).toBe("perlu-perbaikan");
    expect(a.saveable).toBe(false);
    const [b] = analisisImpor([o], cat, opts({ konfirmasi: new Set([kunciBaris("FIKTIF-1", 0)]) }));
    expect(b.status).toBe("siap");
  });
});

describe("pilihGudangDefault", () => {
  const w = (id: string, branch: string) => ({ id, name: `Online ${branch}`, branch_name: branch });
  it("tepat satu gudang cabang Panduraya -> terpilih", () => {
    expect(pilihGudangDefault([w("1", "Kamo Pusat"), w("2", "KAMO PANDURAYA")])).toBe("2");
  });
  it("tidak ada / lebih dari satu -> kosong (wajib pilih)", () => {
    expect(pilihGudangDefault([w("1", "Kamo Pusat")])).toBe("");
    expect(pilihGudangDefault([w("1", "Panduraya A"), w("2", "Panduraya B")])).toBe("");
    expect(pilihGudangDefault([])).toBe("");
  });
});

describe("analisisImpor", () => {
  it("fixture contoh: pembatalan dilewati; dua pesanan Perlu Dikirim siap setelah perkiraan dikonfirmasi", async () => {
    const { orders } = await bacaShopeeXlsx(readFileSync(FIXTURE));
    const awal = analisisImpor(orders, CATALOG, opts());
    expect(awal.map(a => a.status)).toEqual(["dilewati", "perlu-perbaikan", "perlu-perbaikan"]);
    expect(awal[0].alasan).toMatch(/Pembatalan diajukan/);
    expect(awal[1].lines[0].match.kind).toBe("perkiraan");
    expect(awal[1].lines[0].warnings.some(w => w.level === "blok")).toBe(true);

    const konfirmasi = new Set([kunciBaris("2611050FIKTIF2", 0), kunciBaris("2611050FIKTIF3", 0), kunciBaris("2611050FIKTIF3", 1)]);
    const siap = analisisImpor(orders, CATALOG, opts({ konfirmasi }));
    expect(siap.map(a => a.status)).toEqual(["dilewati", "siap", "siap"]);
    expect(siap[1].lines[0]).toMatchObject({ item: { id: "i-jio" } });
    expect(siap.map(a => a.saveable)).toEqual([false, true, true]);
  });

  it("harga Shopee berbeda > toleransi dari master diberi peringatan, harga TIDAK diubah", () => {
    const o = order({ lines: [line({ skuRef: "BOLT-800", harga: 16000 })] });
    const [a] = analisisImpor([o], CATALOG, opts());
    expect(a.lines[0].warnings.map(w => w.text).join(" ")).toMatch(/harga/i);
    expect(a.lines[0].harga).toBe(16000);
    expect(a.saveable).toBe(true);
    const [b] = analisisImpor([order({ lines: [line({ skuRef: "BOLT-800", harga: 20000 })] })], CATALOG, opts());
    expect(b.lines[0].warnings.filter(w => /harga/i.test(w.text))).toEqual([]);
  });

  it("qty melebihi stok gudang = peringatan, kumulatif antar-pesanan", () => {
    const o1 = order({ orderNo: "S1", lines: [line({ skuRef: "JIO-500", qty: 1, harga: 16500 })] });
    const o2 = order({ orderNo: "S2", lines: [line({ skuRef: "JIO-500", qty: 1, harga: 16500 })] });
    const [a, b] = analisisImpor([o1, o2], CATALOG, opts());
    expect(a.lines[0].warnings.filter(w => /stok/i.test(w.text))).toEqual([]);
    expect(b.lines[0].warnings.map(w => w.text).join(" ")).toMatch(/stok/i);
    expect(b.lines[0].warnings.find(w => /stok/i.test(w.text))?.level).toBe("peringatan");
  });

  it("pesanan duplikat (external_ref sudah ada) = 'sudah diimpor', tidak bisa disimpan walau disertakan", () => {
    const ex = { "FIKTIF-1": { noStruk: "ONL-20261105-0001", voided: false } };
    const [a] = analisisImpor([order()], CATALOG, opts({ existing: ex, sertakan: new Set(["FIKTIF-1"]) }));
    expect(a).toMatchObject({ status: "duplikat", saveable: false });
    expect(a.alasan).toMatch(/sudah diimpor/i);
    expect(a.alasan).toContain("ONL-20261105-0001");
    const [v] = analisisImpor([order()], CATALOG, opts({ existing: { "FIKTIF-1": { noStruk: "ONL-X", voided: true } } }));
    expect(v.alasan).toMatch(/dibatalkan/i);
    expect(v.saveable).toBe(false);
  });

  it("Owner boleh menyertakan pesanan yang dilewati karena status; data rusak tidak bisa", () => {
    const batal = order({ status: "Pembatalan diajukan", importable: false, skipReason: "Pembatalan diajukan — dilewati, tidak diimpor" });
    expect(analisisImpor([batal], CATALOG, opts())[0]).toMatchObject({ status: "dilewati", saveable: false });
    const incl = analisisImpor([batal], CATALOG, opts({ sertakan: new Set(["FIKTIF-1"]) }))[0];
    expect(incl.saveable).toBe(true);
    expect(incl.warnings.map(w => w.text).join(" ")).toMatch(/Owner|disertakan/i);
    const rusak = order({ importable: false, dataValid: false, skipReason: "Data jumlah/harga tidak valid" });
    expect(analisisImpor([rusak], CATALOG, opts({ sertakan: new Set(["FIKTIF-1"]) }))[0].saveable).toBe(false);
  });

  it("barang tak cocok memblokir seluruh pesanan; pilihan manual (override) menyelesaikannya", () => {
    const o = order({ lines: [line({ skuRef: "BOLT-800", harga: 21000 }), line({ namaProduk: "Barang tak dikenal", harga: 5000 })] });
    const [a] = analisisImpor([o], CATALOG, opts());
    expect(a).toMatchObject({ status: "perlu-perbaikan", saveable: false });
    const [b] = analisisImpor([o], CATALOG, opts({ overrides: { [kunciBaris("FIKTIF-1", 1)]: "i-jio" } }));
    expect(b.saveable).toBe(true);
    expect(b.lines[1].item?.id).toBe("i-jio");
    // pilihan ke barang yang tidak ada di katalog gudang = tidak valid
    const [c] = analisisImpor([o], CATALOG, opts({ overrides: { [kunciBaris("FIKTIF-1", 1)]: "i-hantu" } }));
    expect(c.saveable).toBe(false);
  });

  it("selisih total vs Total Pembayaran dijelaskan, tanpa mengubah harga", () => {
    const o = order({
      lines: [line({ skuRef: "BOLT-800", harga: 21000, qty: 2 })], subtotalBarang: 42000, totalPembayaran: 44300,
      rincian: { voucherPenjual: 0, voucherShopee: 0, koin: 0, kartuKredit: 0, ongkirPembeli: 0, potonganOngkir: 3500, perkiraanOngkir: 3500 }, selisih: 2300,
    });
    const [a] = analisisImpor([o], CATALOG, opts());
    const teks = a.warnings.map(w => w.text).join(" | ");
    expect(teks).toMatch(/2\.300/);
    expect(teks).toMatch(/tidak diubah/i);
    expect(a.lines[0].harga).toBe(21000);
    expect(a.totalDicatat).toBe(42000);
    expect(a.saveable).toBe(true);
  });

  it("voucher penjual diberi peringatan (tidak dialokasikan ke harga)", () => {
    const o = order({ rincian: { voucherPenjual: 5000, voucherShopee: 0, koin: 0, kartuKredit: 0, ongkirPembeli: 0, potonganOngkir: 0, perkiraanOngkir: 0 }, selisih: 5000 });
    const [a] = analisisImpor([o], CATALOG, opts());
    expect(a.warnings.map(w => w.text).join(" ")).toMatch(/voucher penjual/i);
  });

  it("pesanan tanpa baris tidak bisa disimpan", () => {
    const [a] = analisisImpor([order({ lines: [], subtotalBarang: 0 })], CATALOG, opts());
    expect(a.saveable).toBe(false);
  });
});

describe("satuan (Shopee tidak mengirim satuan; sistem wajib tahu)", () => {
  const SET = [{ unit: "1/2kg", factor: 1, sell_price: 15000 }, { unit: "1kg", factor: 2, sell_price: 29000 }, { unit: "Sak 20kg", factor: 40, sell_price: 520000 }];
  const beauty: CatalogItem = { id: "i-beauty", code: "DRC8997210900539", name: "Beauty Premium", sell_price: 15000, stock: 10, units: SET };
  const lineBeauty = (o: Partial<ShopeeLine> = {}) => line({ skuRef: "DRC8997210900539", namaProduk: "Beauty premium cat food All stage 1kg/makanan kucing murah/makanan kucing", harga: 32502, hargaAwal: 32502, ...o });

  it("tebakSatuan: hanya ukuran yang tertulis utuh; 1/2kg tidak dibaca 1kg atau 2kg; ambigu = null", () => {
    expect(tebakSatuan({ namaProduk: "Beauty premium All stage 1kg/makanan kucing", variasi: "" }, SET)).toBe("1kg");
    expect(tebakSatuan({ namaProduk: "Beauty premium 1 KG", variasi: "" }, SET)).toBe("1kg");
    expect(tebakSatuan({ namaProduk: "Beauty premium 1/2kg", variasi: "" }, SET)).toBe("1/2kg");
    expect(tebakSatuan({ namaProduk: "Beauty premium ½ kg", variasi: "" }, SET)).toBe("1/2kg");
    expect(tebakSatuan({ namaProduk: "Beauty premium 1/2kg 1kg 20kg", variasi: "1kg" }, SET)).toBe("1kg"); // variasi didahulukan
    expect(tebakSatuan({ namaProduk: "Beauty premium 1/2kg dan 1kg", variasi: "" }, SET)).toBeNull();
    expect(tebakSatuan({ namaProduk: "Beauty premium 21kg 11kg", variasi: "" }, SET)).toBeNull();
    expect(tebakSatuan({ namaProduk: "Beauty premium", variasi: "" }, SET)).toBeNull();
    expect(tebakSatuan({ namaProduk: "isi 2 pcs", variasi: "" }, [{ unit: "pcs", factor: 1, sell_price: 1 }])).toBeNull(); // satuan tanpa angka tidak ditebak
  });

  it("satuanBarang: tanpa data satuan = satu satuan dasar dengan harga master", () => {
    expect(satuanBarang({ sell_price: 5000 })).toEqual([{ unit: "", factor: 1, sell_price: 5000 }]);
    expect(satuanBarang(beauty)).toEqual(SET);
  });

  it("kasus Beauty Premium: nama Shopee '1kg' → satuan 1kg, harga dibandingkan ke harga 1kg (bukan 1/2kg), stok keluar 2 × 1/2kg", () => {
    const [a] = analisisImpor([order({ lines: [lineBeauty({ qty: 3 })], subtotalBarang: 97506, totalPembayaran: null, selisih: null })], [beauty], opts({ konfirmasi: new Set([kunciBaris("FIKTIF-1", 0)]) }));
    const l = a.lines[0];
    expect(l.satuan).toEqual(SET[1]);
    expect(l.sumberSatuan).toBe("tebakan");
    const teks = l.warnings.map(w => w.text).join(" | ");
    expect(teks).not.toMatch(/\+117%/);
    expect(teks).toMatch(/Satuan 1kg terbaca dari nama produk Shopee/);
    expect(teks).not.toMatch(/Stok gudang/); // 3 × 2 = 6 (1/2kg) ≤ stok 10
    expect(a.saveable).toBe(true);
  });

  it("pilihan manual menang atas tebakan; satuan yang tidak ada di barang diabaikan", () => {
    const key = kunciBaris("FIKTIF-1", 0);
    const o = order({ lines: [lineBeauty()], totalPembayaran: null, selisih: null });
    const [a] = analisisImpor([o], [beauty], opts({ satuan: { [key]: "1/2kg" } }));
    expect(a.lines[0].satuan?.unit).toBe("1/2kg");
    expect(a.lines[0].sumberSatuan).toBe("pilihan");
    expect(a.lines[0].warnings.map(w => w.text).join(" ")).toMatch(/\+117%.*Rp 15\.000 per 1\/2kg/);
    const [b] = analisisImpor([o], [beauty], opts({ satuan: { [key]: "dus" } }));
    expect(b.lines[0].satuan?.unit).toBe("1kg");
  });

  it("stok dihitung dalam satuan dasar (qty × isi) dan kumulatif lintas pesanan", () => {
    const key = (n: string) => kunciBaris(n, 0);
    const o1 = order({ orderNo: "A1", lines: [lineBeauty({ qty: 3 })], totalPembayaran: null, selisih: null });
    const o2 = order({ orderNo: "A2", lines: [lineBeauty({ qty: 2, namaProduk: "Beauty premium 1/2kg" , harga: 15000 })], totalPembayaran: null, selisih: null });
    const [a, b] = analisisImpor([o1, o2], [{ ...beauty, stock: 7 }], opts({ konfirmasi: new Set([key("A1"), key("A2")]) }));
    expect(a.lines[0].warnings.map(w => w.text).join(" ")).not.toMatch(/Stok gudang/); // 3 × 2 = 6 ≤ 7
    expect(b.lines[0].warnings.map(w => w.text).join(" ")).toMatch(/Stok gudang 7 1\/2kg, kebutuhan kumulatif 8 1\/2kg/); // + 2 × 1
  });

  it("barang bersatuan ganda tanpa ukuran di nama Shopee: pakai satuan dasar + info untuk dicek", () => {
    const [a] = analisisImpor([order({ lines: [lineBeauty({ namaProduk: "Beauty premium cat food", harga: 15000 })], totalPembayaran: null, selisih: null })], [beauty], opts({ konfirmasi: new Set([kunciBaris("FIKTIF-1", 0)]) }));
    expect(a.lines[0].satuan?.unit).toBe("1/2kg");
    expect(a.lines[0].sumberSatuan).toBe("dasar");
    expect(a.lines[0].warnings).toContainEqual({ level: "info", text: expect.stringMatching(/beberapa satuan \(1\/2kg, 1kg, Sak 20kg\); dipakai 1\/2kg/) });
    expect(a.saveable).toBe(true);
  });
});
