import { describe, expect, it } from "vitest";
import {
  analisisBarang, analisisSemua, bangunKonteks, daftarHarusOrder, daftarSlow, hitungPortofolio, KONFIG_STOK, kelompokOrder,
  labelRiwayat, ringkasSlow, rupiahRingkas, saring, tampilBulan, tanggalId,
  type BarisAnalisis, type BarisStokMentah, type KonfigStok, type SatuanBeli,
} from "../stok-analisis";

const HARI_INI = "2026-11-13";
const mentah = (o: Partial<BarisStokMentah> = {}): BarisStokMentah => ({
  id: "i1", kode: "K1", nama: "Barang 1", satuan: "PCS", kategori_id: null, aktif: true,
  min_stock: 0, supplier_id: null, buy_unit: null, min_buy: 0, buy_price: 0,
  stok: 0, nilai: 0, stok_sejak: null, keluar: 0, modal_keluar: 0, terakhir: null, biaya_terakhir: 0, ...o,
});
const ctxHari = (riwayat: number) => bangunKonteks({ hari_ini: HARI_INI, riwayat_hari: riwayat });
const analisis = (o: Partial<BarisStokMentah>, riwayat = 90) => analisisBarang(mentah(o), ctxHari(riwayat));
const hariLalu = (n: number) => new Date(Date.parse(`${HARI_INI}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("konteks riwayat", () => {
  it("riwayat pendek: pembagi minimal 14 hari, ditandai baru", () => {
    const c = ctxHari(13);
    expect(c.hariDipakai).toBe(14);
    expect(c.riwayatBaru).toBe(true);
    expect(labelRiwayat(c)).toBe("riwayat baru 13 hari");
  });
  it("riwayat 60 hari ke atas tidak lagi baru; di atas 90 dibatasi jendela", () => {
    expect(ctxHari(59).riwayatBaru).toBe(true);
    expect(ctxHari(60).riwayatBaru).toBe(false);
    expect(labelRiwayat(ctxHari(75))).toBe("riwayat 75 hari");
    expect(ctxHari(400).hariDipakai).toBe(90);
    expect(labelRiwayat(ctxHari(400))).toBe("riwayat 90 hari");
  });
  it("tanpa riwayat sama sekali tetap aman (pembagi 14, label baru 0 hari)", () => {
    const c = ctxHari(0);
    expect(c.hariDipakai).toBe(14);
    expect(labelRiwayat(c)).toBe("riwayat baru 0 hari");
  });
});

describe("cover dan ambang berlebih", () => {
  it("contoh Pak Andri: modal terjual Rp2 jt/bulan, nilai stok Rp10 jt => 5 bulan => berlebih", () => {
    const b = analisisBarang(mentah({ stok: 100, nilai: 10_000_000, keluar: 10, modal_keluar: 2_000_000, terakhir: hariLalu(1) }), ctxHari(30));
    expect(b.modalBulan).toBeCloseTo(2_000_000, 6);
    const p = hitungPortofolio([b]);
    expect(p.coverBulan).toBeCloseTo(5, 6);
    expect(p.berlebih).toBe(true);
    expect(b.status).toBe("berlebih");
  });
  it("cover per barang = stok / terjual per bulan; modal tertahan hanya kelebihan di atas 3 bulan", () => {
    const b = analisis({ stok: 100, nilai: 1_000_000, keluar: 90, modal_keluar: 900_000, terakhir: hariLalu(1) }); // 30/bulan
    expect(b.terjualBulan).toBeCloseTo(30, 6);
    expect(b.coverBulan).toBeCloseTo(100 / 30, 6);
    expect(b.status).toBe("berlebih");
    expect(b.modalTertahan).toBeCloseTo(1_000_000 * (1 - 3 / (100 / 30)), 4);
    expect(b.sementara).toBe(false);
  });
  it("tepat 3 bulan = aman (batas bukan 'lebih dari')", () => {
    const b = analisis({ stok: 90, nilai: 900_000, keluar: 90, modal_keluar: 900_000, terakhir: hariLalu(1) });
    expect(b.coverBulan).toBeCloseTo(3, 9);
    expect(b.status).toBe("aman");
    expect(b.modalTertahan).toBe(0);
  });
  it("berlebih dari riwayat baru ditandai sementara", () => {
    const b = analisis({ stok: 1000, nilai: 1_000_000, keluar: 14, modal_keluar: 14_000, terakhir: hariLalu(1) }, 13);
    expect(b.status).toBe("berlebih");
    expect(b.sementara).toBe(true);
  });
  it("konfigurasi bisa diganti di satu tempat", () => {
    const konfig: KonfigStok = { ...KONFIG_STOK, berlebihBulan: 6 };
    const b = analisisBarang(mentah({ stok: 100, nilai: 1_000_000, keluar: 90, terakhir: hariLalu(1) }), ctxHari(90), konfig);
    expect(b.status).toBe("aman");
  });
});

describe("tidak laku / mati / belum laku", () => {
  it("riwayat pendek, belum pernah keluar => Belum laku (sementara), seluruh nilai tertahan", () => {
    const b = analisis({ stok: 10, nilai: 500_000, stok_sejak: hariLalu(13) }, 13);
    expect(b.status).toBe("belum_laku");
    expect(b.sementara).toBe(true);
    expect(b.modalTertahan).toBe(500_000);
    expect(b.coverBulan).toBeNull();
  });
  it("riwayat cukup, stok lama tak pernah keluar => Tidak laku; 120 hari => Mati", () => {
    expect(analisis({ stok: 5, nilai: 100, stok_sejak: hariLalu(75) }, 90).status).toBe("tidak_laku");
    expect(analisis({ stok: 5, nilai: 100, stok_sejak: hariLalu(150) }, 400).status).toBe("mati");
  });
  it("stok baru masuk walau riwayat panjang: bukan tidak laku", () => {
    const b = analisis({ stok: 5, nilai: 100, stok_sejak: hariLalu(10) }, 200);
    expect(b.status).toBe("aman");
  });
  it("terakhir laku 59/60/120 hari lalu", () => {
    expect(analisis({ stok: 5, nilai: 100, terakhir: hariLalu(59) }, 200).status).toBe("aman");
    expect(analisis({ stok: 5, nilai: 100, terakhir: hariLalu(60) }, 200).status).toBe("tidak_laku");
    expect(analisis({ stok: 5, nilai: 100, terakhir: hariLalu(120) }, 200).status).toBe("mati");
  });
  it("stok nol atau minus tidak pernah masuk slow moving", () => {
    expect(analisis({ stok: 0, nilai: 0, terakhir: hariLalu(200) }, 400).status).toBe("aman");
    expect(analisis({ stok: -3, nilai: 0, terakhir: hariLalu(200) }, 400).status).toBe("aman");
    expect(analisis({ stok: 7, nilai: 0 }, 400).status).toBe("aman");
  });
  it("struk batal / retur: pemakaian bersih negatif dianggap nol, tidak menghasilkan cover negatif", () => {
    const b = analisis({ stok: 10, nilai: 100, keluar: -5, modal_keluar: -50, terakhir: hariLalu(70) }, 200);
    expect(b.terjualBulan).toBe(0);
    expect(b.modalBulan).toBe(0);
    expect(b.coverBulan).toBeNull();
    expect(b.status).toBe("tidak_laku");
  });
});

describe("daftar dan ringkasan slow moving", () => {
  const semua = [
    analisis({ id: "a", nama: "A", stok: 10, nilai: 1_000, stok_sejak: hariLalu(5) }, 13),
    analisis({ id: "b", nama: "B", stok: 10, nilai: 9_000, stok_sejak: hariLalu(5) }, 13),
    analisis({ id: "c", nama: "C", stok: 10, nilai: 5_000, keluar: 14, terakhir: hariLalu(1) }, 13),
  ];
  it("urut Modal tertahan terbesar, barang aman tidak ikut", () => {
    const d = daftarSlow(semua);
    expect(d.map((x) => x.id)).toEqual(["b", "a"]);
    const r = ringkasSlow(d);
    expect(r.jumlah).toBe(2);
    expect(r.modalTertahan).toBe(10_000);
    expect(r.perStatus.belum_laku.jumlah).toBe(2);
  });
  it("portofolio tanpa penjualan: cover kosong, bukan berlebih", () => {
    const p = hitungPortofolio(semua.slice(0, 2));
    expect(p.coverBulan).toBeNull();
    expect(p.berlebih).toBe(false);
    expect(p.nilaiStok).toBe(10_000);
  });
  it("cari kode/nama dan kategori induk", () => {
    const baris: BarisAnalisis[] = [analisis({ id: "x", kode: "RC-01", nama: "Royal Canin", kategori_id: "k1" }), analisis({ id: "y", kode: "ZZ", nama: "Pasir" })];
    const dari = (b: BarisAnalisis) => (b.id === "x" ? "MAKANAN" : "LAIN");
    expect(saring(baris, { q: "royal" }).map((b) => b.id)).toEqual(["x"]);
    expect(saring(baris, { q: "zz" }).map((b) => b.id)).toEqual(["y"]);
    expect(saring(baris, { kategori: "makanan", kategoriDari: dari }).map((b) => b.id)).toEqual(["x"]);
    expect(saring(baris, { q: "", kategori: "" }).length).toBe(2);
  });
});

describe("harus order", () => {
  const ctx = ctxHari(90);
  const satuan = new Map<string, SatuanBeli>();
  const pemasok = new Map([["s1", { nama: "PT Sehat" }]]);
  const order = (rows: BarisStokMentah[], c = ctx, sb = satuan) => daftarHarusOrder(rows.map((r) => analisisBarang(r, c)), sb, pemasok, c);

  it("aturan lama: aktif dan stok <= minimum (menyentuh minimum ikut), tetap dipesan minimal satu satuan beli", () => {
    const hasil = order([mentah({ id: "m", min_stock: 10, stok: 10 }), mentah({ id: "n", min_stock: 10, stok: 11 })]);
    expect(hasil.map((h) => h.itemId)).toEqual(["m"]);
    expect(hasil[0].alasan).toEqual(["min"]);
    expect(hasil[0].qtyPesan).toBe(1);
    expect(hasil[0].sementara).toBe(false);
  });
  it("cover < lead time 14 hari => harus order; tepat 14 hari tidak", () => {
    // 1 per hari; stok 5 => 5 hari; stok 14 => 14 hari (tidak); stok 13 => ya
    const rows = [mentah({ id: "a", stok: 5, keluar: 90 }), mentah({ id: "b", stok: 14, keluar: 90 }), mentah({ id: "c", stok: 13, keluar: 90 })];
    expect(order(rows).map((h) => h.itemId).sort()).toEqual(["a", "c"]);
  });
  it("saran = isi sampai 30 hari penjualan dikurangi stok, dibulatkan ke atas ke satuan beli", () => {
    const sb = new Map<string, SatuanBeli>([["a", { unit: "DUS", faktor: 12, hargaBeli: 120_000 }]]);
    const [h] = order([mentah({ id: "a", stok: 10, keluar: 90, supplier_id: "s1" })], ctx, sb); // 1/hari => target 30, kurang 20 => 2 dus
    expect(h.targetStok).toBe(30);
    expect(h.kurang).toBe(20);
    expect(h.qtyPesan).toBe(2);
    expect(h.buyUnit).toBe("DUS");
    expect(h.nilai).toBe(240_000);
    expect(h.supplierNama).toBe("PT Sehat");
  });
  it("minimum beli pemasok jadi lantai; minimum barang lebih besar dari 30 hari penjualan dipakai sebagai sasaran", () => {
    const [a] = order([mentah({ id: "a", stok: 13, keluar: 90, min_buy: 20 })]); // kurang 17 < min beli 20
    expect(a.kurang).toBe(17);
    expect(a.qtyPesan).toBe(20);
    const [c] = order([mentah({ id: "c", stok: 1, keluar: 90, min_buy: 10 })]); // kurang 29 > min beli 10
    expect(c.qtyPesan).toBe(29);
    const [b] = order([mentah({ id: "b", stok: 1, keluar: 9, min_stock: 50 })]);
    expect(b.targetStok).toBe(50);
    expect(b.qtyPesan).toBe(49);
  });
  it("tanpa penjualan DAN tanpa minimum tidak ikut; nonaktif tidak ikut", () => {
    expect(order([mentah({ id: "a", stok: 0 }), mentah({ id: "b", stok: 0, aktif: false, min_stock: 5 }), mentah({ id: "c", stok: 0, aktif: false, keluar: 90 })])).toEqual([]);
  });
  it("stok kosong dengan penjualan => cover 0 hari => ikut", () => {
    const [h] = order([mentah({ id: "a", stok: 0, keluar: 30 })]);
    expect(h.coverHari).toBe(0);
    expect(h.alasan).toEqual(["cepat_habis"]);
  });
  it("riwayat baru: alasan 'segera habis' ditandai sementara, alasan minimum tidak", () => {
    const c = ctxHari(13);
    const hasil = order([mentah({ id: "a", stok: 0, keluar: 14 }), mentah({ id: "b", stok: 1, min_stock: 5 })], c);
    expect(hasil.find((h) => h.itemId === "a")!.sementara).toBe(true);
    expect(hasil.find((h) => h.itemId === "b")!.sementara).toBe(false);
  });
  it("harga beli master kosong: perkiraan memakai biaya masuk terakhir x isi satuan beli", () => {
    const sb = new Map<string, SatuanBeli>([["a", { unit: "DUS", faktor: 10, hargaBeli: 0 }]]);
    const [h] = order([mentah({ id: "a", stok: 0, keluar: 90, biaya_terakhir: 1_000 })], ctx, sb); // target 30 => 3 dus
    expect(h.qtyPesan).toBe(3);
    expect(h.nilai).toBe(30_000);
  });
  it("kelompok per pemasok: tanpa pemasok paling akhir, paling mendesak di atas", () => {
    const hasil = order([
      mentah({ id: "a", nama: "A", stok: 5, keluar: 90 }),
      mentah({ id: "b", nama: "B", stok: 1, keluar: 90, supplier_id: "s1" }),
      mentah({ id: "c", nama: "C", stok: 2, keluar: 90, supplier_id: "s1" }),
    ]);
    const grup = kelompokOrder(hasil);
    expect(grup.map((g) => g.supplierNama)).toEqual(["PT Sehat", "Belum ada pemasok"]);
    expect(grup[0].rows.map((r) => r.itemId)).toEqual(["b", "c"]);
  });
});

describe("analisisSemua dan format", () => {
  it("memakai meta fungsi SQL", () => {
    const { ctx, baris } = analisisSemua({ hari_ini: HARI_INI, riwayat_hari: 13, baris: [mentah({ stok: 1, nilai: 10, stok_sejak: hariLalu(13) })] });
    expect(ctx.riwayatBaru).toBe(true);
    expect(baris[0].status).toBe("belum_laku");
  });
  it("format singkat", () => {
    expect(tampilBulan(null)).toBe("—");
    expect(tampilBulan(5)).toBe("5,0");
    expect(tampilBulan(40)).toBe("> 24");
    expect(rupiahRingkas(843_000_000)).toBe("Rp 843 jt");
    expect(rupiahRingkas(1_594_323_465)).toBe("Rp 1,59 M");
    expect(tanggalId("2026-11-01")).toBe("01/11/2026");
    expect(tanggalId(null)).toBe("belum ada");
  });
});
