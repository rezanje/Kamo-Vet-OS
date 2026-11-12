import { describe, expect, it } from "vitest";
import {
  atribusiPenjual, barisPerOrang, rekapPerItem, rekapTenagaPenjual, saringAtribusi,
  type BarisPenjual,
} from "../laporan-tenaga-penjual";
import { alokasiPotonganDokumen, selisihKepalaDokumen } from "../alokasi-potongan";

function baris(over: Partial<BarisPenjual> & { id: string }): BarisPenjual {
  return {
    dokumenId: "dok-1", dokumen: "INV-1", href: "/dokumen", waktu: "2026-10-20T03:00:00Z",
    tanggal: "2026-10-20", kanal: "Klinik", jenis: "Jasa", cabangId: "cabang-1", cabang: "Pusat",
    pelanggan: "Pemilik", pasien: "Milo", item: "Vaksin", qty: 1, bruto: 100, netto: 100,
    dokterId: null, stafId: null, penjualId: null, retur: false, ...over,
  };
}

describe("atribusi baris", () => {
  it("menghitung baris berdua untuk dokter dan non-dokter di perannya masing-masing", () => {
    const rows = [baris({ id: "a", dokterId: "dok", stafId: "perawat", netto: 200, bruto: 200 })];
    const { orang, total } = rekapTenagaPenjual(atribusiPenjual(rows));

    expect(orang.map((r) => [r.employeeId, r.netto, r.peran])).toEqual([
      ["dok", 200, ["Dokter"]],
      ["perawat", 200, ["Non-dokter"]],
    ]);
    // Total perusahaan tidak boleh ikut berlipat.
    expect(total.netto).toBe(200);
    expect(total.baris).toBe(1);
  });

  it("memakai penjual lama hanya ketika baris belum punya pelaksana", () => {
    const rows = [
      baris({ id: "a", dokterId: "dok", penjualId: "lama" }),
      baris({ id: "b", penjualId: "lama" }),
    ];
    const { orang } = rekapTenagaPenjual(atribusiPenjual(rows));
    expect(orang.find((r) => r.employeeId === "lama")?.baris).toBe(1);
    expect(orang.find((r) => r.employeeId === "lama")?.peran).toEqual(["Penjual"]);
    expect(orang.find((r) => r.employeeId === "dok")?.baris).toBe(1);
  });

  it("mengumpulkan baris tanpa siapa pun ke ember tanpa tenaga penjual", () => {
    const { orang, tanpaPenjual, total } = rekapTenagaPenjual(atribusiPenjual([
      baris({ id: "a", dokterId: "dok", netto: 50, bruto: 50 }),
      baris({ id: "b", netto: 30, bruto: 30 }),
    ]));
    expect(orang).toHaveLength(1);
    expect(tanpaPenjual?.netto).toBe(30);
    expect(total.netto).toBe(80);
  });

  it("tidak membuat ember tanpa tenaga penjual ketika semua baris sudah bertuan", () => {
    expect(rekapTenagaPenjual(atribusiPenjual([baris({ id: "a", penjualId: "lama" })])).tanpaPenjual).toBeNull();
  });
});

describe("rekap per kanal, jenis dan transaksi", () => {
  it("memecah omzet seseorang per kanal dan per jenis", () => {
    const { orang, total } = rekapTenagaPenjual(atribusiPenjual([
      baris({ id: "a", dokterId: "dok", kanal: "Klinik", jenis: "Jasa", netto: 100, bruto: 120 }),
      baris({ id: "b", dokterId: "dok", kanal: "Petshop", jenis: "Barang", netto: 40, bruto: 40, dokumenId: "dok-2" }),
      baris({ id: "c", penjualId: "sales", kanal: "Grosir", jenis: "Barang", netto: 500, bruto: 500, dokumenId: "dok-3" }),
    ]));
    const dokter = orang.find((r) => r.employeeId === "dok")!;
    expect(dokter.perKanal).toEqual({ Petshop: 40, Klinik: 100, Grosir: 0 });
    expect(dokter.perJenis.Jasa).toBe(100);
    expect(dokter.perJenis.Barang).toBe(40);
    expect(dokter.transaksi).toBe(2);
    expect(dokter.diskon).toBe(20);
    expect(total.perKanal.Grosir).toBe(500);
    expect(total.transaksi).toBe(3);
  });

  it("menghitung satu dokumen sekali walau punya banyak baris", () => {
    const { total } = rekapTenagaPenjual(atribusiPenjual([
      baris({ id: "a", dokumenId: "satu", dokterId: "dok" }),
      baris({ id: "b", dokumenId: "satu", dokterId: "dok" }),
    ]));
    expect(total.transaksi).toBe(1);
    expect(total.baris).toBe(2);
  });

  it("mengurangi retur dari omzet pemilik baris aslinya", () => {
    const { orang, total } = rekapTenagaPenjual(atribusiPenjual([
      baris({ id: "a", penjualId: "kasir", kanal: "Petshop", jenis: "Barang", netto: 100, bruto: 100 }),
      baris({ id: "r", penjualId: "kasir", kanal: "Petshop", jenis: "Barang", netto: -40, bruto: -40, qty: -1, retur: true }),
    ]));
    expect(orang[0].netto).toBe(60);
    expect(orang[0].qty).toBe(0);
    expect(total.netto).toBe(60);
  });
});

describe("saringan", () => {
  const rows = [
    baris({ id: "a", dokterId: "dok", stafId: "perawat", kanal: "Klinik", jenis: "Jasa", netto: 200, bruto: 200 }),
    baris({ id: "b", penjualId: "kasir", kanal: "Petshop", jenis: "Barang", cabangId: "cabang-2", netto: 70, bruto: 70 }),
  ];

  it("menyaring peran tanpa membuang sisi lain dari barisnya", () => {
    const hanyaDokter = saringAtribusi(atribusiPenjual(rows), { peran: "Dokter" });
    expect(hanyaDokter.map((r) => r.employeeId)).toEqual(["dok"]);
    expect(rekapTenagaPenjual(hanyaDokter).total.netto).toBe(200);
  });

  it("menyaring karyawan, kanal, jenis dan cabang", () => {
    expect(saringAtribusi(atribusiPenjual(rows), { karyawanId: "perawat" }).map((r) => r.baris.id)).toEqual(["a"]);
    expect(saringAtribusi(atribusiPenjual(rows), { kanal: "Petshop" }).map((r) => r.baris.id)).toEqual(["b"]);
    // Baris jasa dikerjakan berdua, jadi dua pasangan yang lolos — barisnya tetap satu.
    expect(saringAtribusi(atribusiPenjual(rows), { jenis: "Jasa" }).map((r) => r.baris.id)).toEqual(["a", "a"]);
    expect(saringAtribusi(atribusiPenjual(rows), { cabangId: "cabang-2" }).map((r) => r.baris.id)).toEqual(["b"]);
  });

  it("menyusun rincian satu orang dari yang terbaru", () => {
    const rincian = barisPerOrang(atribusiPenjual([
      baris({ id: "lama", dokterId: "dok", waktu: "2026-10-01T03:00:00Z" }),
      baris({ id: "baru", dokterId: "dok", waktu: "2026-10-05T03:00:00Z" }),
      baris({ id: "lain", penjualId: "kasir" }),
    ]), "dok");
    expect(rincian.map((r) => r.baris.id)).toEqual(["baru", "lama"]);
    expect(rincian[0].peran).toBe("Dokter");
  });
});

describe("alokasi potongan kepala dokumen", () => {
  it("membagi potongan proporsional dan menutup total dokumen", () => {
    const neto = alokasiPotonganDokumen([60, 40], 90);
    expect(neto).toEqual([54, 36]);
    expect(neto[0] + neto[1]).toBe(90);
  });

  it("tidak menaikkan nilai baris ketika total dokumen lebih besar dari barisnya", () => {
    expect(alokasiPotonganDokumen([60, 40], 111)).toEqual([60, 40]);
    expect(selisihKepalaDokumen([60, 40], 111)).toBe(11);
    expect(selisihKepalaDokumen([60, 40], 90)).toBe(0);
  });

  it("aman untuk dokumen tanpa nilai baris", () => {
    expect(alokasiPotonganDokumen([], 0)).toEqual([]);
    expect(alokasiPotonganDokumen([0, 0], 0)).toEqual([0, 0]);
  });
});

describe("A2: rekap per tenaga penjual → per item", () => {
  it("menjumlah qty per orang per item lintas dokumen dan menghitung transaksinya", () => {
    const rows = [
      baris({ id: "a", dokumenId: "d1", penjualId: "andi", kanal: "Petshop", jenis: "Barang", item: "Royal Canin 2kg", itemId: "rc", qty: 2, netto: 200 }),
      baris({ id: "b", dokumenId: "d2", penjualId: "andi", kanal: "Petshop", jenis: "Barang", item: "Royal Canin 2kg", itemId: "rc", qty: 3, netto: 300 }),
      baris({ id: "c", dokumenId: "d2", penjualId: "andi", kanal: "Petshop", jenis: "Barang", item: "Pasir", itemId: "pasir", qty: 1, netto: 50 }),
    ];
    const hasil = rekapPerItem(atribusiPenjual(rows));
    expect(hasil.map((r) => [r.employeeId, r.item, r.qty, r.netto, r.transaksi])).toEqual([
      ["andi", "Royal Canin 2kg", 5, 500, 2],
      ["andi", "Pasir", 1, 50, 1],
    ]);
  });

  it("retur mengurangi item asal (bukan jadi item baru) dan tidak menambah transaksi", () => {
    const rows = [
      baris({ id: "a", dokumenId: "d1", penjualId: "andi", item: "Obat X", itemId: "x", qty: 4, netto: 400 }),
      baris({ id: "r", dokumenId: "d1", penjualId: "andi", item: "Retur · Obat X", namaItem: "Obat X", itemId: "x", qty: -1, netto: -100, bruto: -100, retur: true }),
    ];
    const [r] = rekapPerItem(atribusiPenjual(rows));
    expect([r.item, r.qty, r.qtyRetur, r.netto, r.transaksi]).toEqual(["Obat X", 3, 1, 300, 1]);
  });

  it("baris berdua dihitung penuh untuk dokter dan non-dokter, dengan perannya", () => {
    const rows = [baris({ id: "a", dokterId: "dok", stafId: "perawat", item: "Vaksin", qty: 1, netto: 150 })];
    const hasil = rekapPerItem(atribusiPenjual(rows));
    expect(hasil.map((r) => [r.employeeId, r.qty, r.netto, r.peran])).toEqual([
      ["dok", 1, 150, ["Dokter"]],
      ["perawat", 1, 150, ["Non-dokter"]],
    ]);
  });

  it("memisah satuan berbeda dari item yang sama, dan mengelompokkan item tanpa master menurut nama", () => {
    const rows = [
      baris({ id: "a", penjualId: "andi", item: "Whiskas", itemId: "w", satuan: "1KG", qty: 1 }),
      baris({ id: "b", penjualId: "andi", item: "Whiskas", itemId: "w", satuan: "1/2KG", qty: 2 }),
      baris({ id: "c", penjualId: "andi", item: "Racikan Kapsul", itemId: null, qty: 1, jenis: "Racikan" }),
      baris({ id: "d", penjualId: "andi", item: "racikan kapsul", itemId: null, qty: 2, jenis: "Racikan" }),
    ];
    const hasil = rekapPerItem(atribusiPenjual(rows));
    expect(hasil.map((r) => [r.item, r.satuan, r.qty]).sort()).toEqual([
      ["Racikan Kapsul", "", 3],
      ["Whiskas", "1/2KG", 2],
      ["Whiskas", "1KG", 1],
    ].sort());
  });

  it("baris tanpa tenaga penjual dikumpulkan paling bawah, dan saringan karyawan tetap berlaku", () => {
    const rows = [
      baris({ id: "a", item: "Tanpa orang", qty: 1 }),
      baris({ id: "b", penjualId: "andi", item: "Punya Andi", qty: 1 }),
      baris({ id: "c", penjualId: "budi", item: "Punya Budi", qty: 1 }),
    ];
    const semua = rekapPerItem(atribusiPenjual(rows));
    expect(semua.at(-1)?.employeeId).toBeNull();
    const andi = rekapPerItem(saringAtribusi(atribusiPenjual(rows), { karyawanId: "andi" }));
    expect(andi.map((r) => r.item)).toEqual(["Punya Andi"]);
  });
});
