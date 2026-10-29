// Audit promo Produksi — menjalankan mesin promo yang SEBENARNYA (lib/promo-hitung,
// lib/service-line-promos, lib/pos-calc) memakai salinan konfigurasi promo yang
// terpasang di Production per 2026-10-28.
//
// Tujuannya bukan menguji ulang rumusnya (itu promo-hitung.test.ts), tapi menjawab
// "promo yang hari ini terpasang, kalau dipakai di kasir, keluar angka berapa".
// Baris master di bawah adalah salinan apa adanya; tidak ada data pelanggan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPromoAktif, hitungPromoKeranjang, totalPotonganPromo } from "../promo-hitung";
import { promoDenganKode } from "../kode-kampanye";
import { serviceLinePromos } from "../service-line-promos";
import { computeTotals, lineDiscount, linePromoApplied } from "../pos-calc";

// ── Salinan master Production (2026-10-28) ────────────────────────────────────
const PANDURAYA = "29a9383b-b0e2-4356-a0b0-ca7d862d6db5";   // Kamo Petshop Panduraya
const CIOMAS = "ae809138-e8b9-4171-b669-18f4c2975681";      // Kamo Petshop Ciomas
const BOLT_IKAN = "4750ca73-68ae-43a9-879e-3abaef5ccea3";   // Bolt Ikan 800gr, Rp20.000
const BOLT_SALMON = "7908abff-3aa9-448b-af3f-138dafa8d89f"; // Bolt Ikan Salmon 800gr, Rp20.000
const LAIN = "00000000-0000-4000-8000-00000000beef";        // barang di luar daftar promo

type PromoRow = Record<string, unknown> & { id: string };

const PROMOS: PromoRow[] = [
  { id: "8ee5e96d-1802-4803-b6a5-ed0a5abe0892", name: "diskon aatas", rule: { suggest: "Ini Coba struk" },
    branch_ids: null, valid_from: "2026-10-13", valid_until: "2026-10-13", is_active: true,
    min_qty: 1, max_qty: 1, kelipatan: true, auto_apply: true, discount_type: "nominal", discount_value: 1000 },
  { id: "3334837d-974e-4a70-bbb5-0bb1fe01138b", name: "Promo heboh Panduraya",
    rule: { suggest: "Belanja 100k, diskon 10%", min_subtotal: 100000 },
    branch_ids: [PANDURAYA], valid_from: "2026-10-15", valid_until: null, is_active: true,
    min_qty: null, max_qty: null, kelipatan: false, auto_apply: false, discount_type: "percent", discount_value: 10 },
  { id: "b616aac0-c800-4d8d-924b-81e063c5e1c6", name: "PROMO LEBARAN HEMAT", rule: { suggest: "TAWARKAN PRODUK BOLT" },
    branch_ids: null, valid_from: "2026-10-15", valid_until: null, is_active: true,
    min_qty: 1, max_qty: null, kelipatan: false, auto_apply: false, discount_type: "percent", discount_value: 10 },
  { id: "eebfff9e-766f-4f3b-9e0a-57d07774c65b", name: "PROMO SUKA SUKA", rule: { suggest: "TAWARKAN PRODUK BOLT" },
    branch_ids: null, valid_from: "2026-10-15", valid_until: null, is_active: true,
    min_qty: null, max_qty: null, kelipatan: false, auto_apply: false, discount_type: "percent", discount_value: 10 },
];
const ID = Object.fromEntries(PROMOS.map((p) => [String(p.name), p.id])) as Record<string, string>;

const PROMO_ITEMS = [
  { promo_id: ID["PROMO LEBARAN HEMAT"], item_id: BOLT_IKAN },
  { promo_id: ID["PROMO LEBARAN HEMAT"], item_id: BOLT_SALMON },
];

// Klien Supabase tiruan yang menjawab persis kueri loadPromoAktif (termasuk
// `count` yang diperiksa readCompleteList), supaya jalur muat promo ikut diuji.
function masterProduksi() {
  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      let ids: string[] | undefined;
      const jawab = (from: number, to: number) => {
        const rows = table === "promos"
          ? PROMOS.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v) && (!ids || ids.includes(r.id)))
          : PROMO_ITEMS.filter((r) => !ids || ids.includes(r.promo_id))
              .map((r) => ({ ...r, id: `${r.promo_id}:${r.item_id}` }));
        return { data: rows.slice(from, to + 1), error: null, count: rows.length };
      };
      const q = {
        select: () => q, eq: (k: string, v: unknown) => { eqs[k] = v; return q; },
        in: (_k: string, v: string[]) => { ids = v; return q; }, order: () => q,
        range: (a: number, b: number) => Promise.resolve(jawab(a, b)),
        then: (resolve: (x: unknown) => unknown) => Promise.resolve(jawab(0, 9999)).then(resolve),
      };
      return q;
    },
  };
}

const HARI = (tanggal: string) => new Date(`${tanggal}T05:00:00+07:00`);
const aktifDi = (branchId: string, kodePromo: string[] = []) => loadPromoAktif(masterProduksi(), branchId, kodePromo);
const nama = (hasil: { promoName: string }[]) => [...new Set(hasil.map((h) => h.promoName))].sort();

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("keadaan promo Production hari ini", () => {
  it("tidak ada satu pun promo yang memotong otomatis pada 2026-10-28", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    for (const branchId of [PANDURAYA, CIOMAS]) {
      const promos = await aktifDi(branchId);
      expect(promos).toEqual([]);                 // 3 promo manual + 1 promo kedaluwarsa
    }
  });

  it("hanya 'diskon aatas' yang berstatus potong otomatis, dan masa berlakunya sudah lewat", async () => {
    vi.setSystemTime(HARI("2026-10-13"));
    const promos = await aktifDi(CIOMAS);
    expect(promos.map((p) => p.name)).toEqual(["diskon aatas"]);
    vi.setSystemTime(HARI("2026-10-14"));
    expect(await aktifDi(CIOMAS)).toEqual([]);
  });
});

describe("diskon aatas — nominal Rp1.000, semua barang, semua cabang, 13 Okt 2026 saja", () => {
  const keranjang = [{ item_id: BOLT_IKAN, qty: 3, harga: 20000 }, { item_id: LAIN, qty: 1, harga: 50000 }];

  it("kasus sah: tiap baris dipotong Rp1.000 (maks. qty 1 per baris)", async () => {
    vi.setSystemTime(HARI("2026-10-13"));
    const hasil = hitungPromoKeranjang(await aktifDi(CIOMAS), keranjang);
    expect(hasil.map((h) => h.potongan)).toEqual([1000, 1000]);
    expect(totalPotonganPromo(hasil)).toBe(2000);
  });

  it("batas: hari pertama = hari terakhir; sehari sesudahnya nol", async () => {
    vi.setSystemTime(HARI("2026-10-12"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(CIOMAS), keranjang))).toBe(0);
    vi.setSystemTime(HARI("2026-10-13"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(CIOMAS), keranjang))).toBe(2000);
    vi.setSystemTime(HARI("2026-10-14"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(CIOMAS), keranjang))).toBe(0);
  });

  it("nominal tidak pernah melebihi harga barang murah", async () => {
    vi.setSystemTime(HARI("2026-10-13"));
    const hasil = hitungPromoKeranjang(await aktifDi(CIOMAS), [{ item_id: LAIN, qty: 2, harga: 400 }]);
    expect(hasil[0].potongan).toBe(400);
  });

  it("baris Rp0 (racikan/BMHP nol rupiah) tidak ikut dipotong", async () => {
    vi.setSystemTime(HARI("2026-10-13"));
    expect(hitungPromoKeranjang(await aktifDi(CIOMAS), [{ item_id: LAIN, qty: 5, harga: 0 }])).toEqual([]);
  });

  it("ditumpuk diskon manual kasir: diskon manual menang, promo tidak ikut mengurangi", async () => {
    vi.setSystemTime(HARI("2026-10-13"));
    const hasil = hitungPromoKeranjang(await aktifDi(CIOMAS), keranjang);
    const baris = { qty: 3, harga: 20000, item_discount_type: "percent" as const, item_discount_value: 10,
      promo_discount: hasil[0].potongan };
    expect(lineDiscount(baris)).toBe(6000);        // 10% × 60.000, bukan 6.000 + 1.000
    expect(linePromoApplied(baris)).toBe(0);       // promo tidak terpakai di baris ini
  });
});

describe("Promo heboh Panduraya — 10%, min belanja Rp100.000, khusus 1 cabang", () => {
  const penuh = [{ item_id: BOLT_IKAN, qty: 5, harga: 20000 }];   // subtotal 100.000
  const kodePromo = [ID["Promo heboh Panduraya"]];
  const lewatKode = async (branchId: string) =>
    promoDenganKode(await aktifDi(branchId, kodePromo), kodePromo[0]);

  it("apa adanya hari ini: tidak memotong karena tidak disetel potong otomatis", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(PANDURAYA), penuh))).toBe(0);
  });

  it("lewat kode kampanye di cabangnya: 10% dari seluruh keranjang", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const hasil = hitungPromoKeranjang(await lewatKode(PANDURAYA), penuh);
    expect(nama(hasil)).toEqual(["Promo heboh Panduraya"]);
    expect(totalPotonganPromo(hasil)).toBe(10000);
  });

  it("batas min belanja: Rp99.999 belum dapat, Rp100.000 dapat", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const promos = await lewatKode(PANDURAYA);
    expect(totalPotonganPromo(hitungPromoKeranjang(promos, [{ item_id: BOLT_IKAN, qty: 1, harga: 99999 }]))).toBe(0);
    expect(totalPotonganPromo(hitungPromoKeranjang(promos, [{ item_id: BOLT_IKAN, qty: 1, harga: 100000 }]))).toBe(10000);
  });

  it("cabang lain tidak dapat, walau kodenya diketik", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    expect(await aktifDi(CIOMAS, kodePromo)).toEqual([]);
    expect(totalPotonganPromo(hitungPromoKeranjang(await lewatKode(CIOMAS), penuh))).toBe(0);
  });

  it("sebelum tanggal mulai tidak berlaku", async () => {
    vi.setSystemTime(HARI("2026-10-14"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await lewatKode(PANDURAYA), penuh))).toBe(0);
    vi.setSystemTime(HARI("2026-10-15"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await lewatKode(PANDURAYA), penuh))).toBe(10000);
  });

  it("min belanja dihitung dari harga sebelum diskon manual kasir", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const promos = await lewatKode(PANDURAYA);
    const potongan = hitungPromoKeranjang(promos, penuh);
    const baris = [{ qty: 5, harga: 20000, item_discount_type: "nominal" as const, item_discount_value: 50000,
      promo_discount: potongan[0].potongan }];
    // Syarat Rp100.000 tetap terpenuhi walau pelanggan hanya membayar Rp50.000.
    expect(potongan[0].potongan).toBe(10000);
    expect(computeTotals(baris, 0, 0, 0).total).toBe(50000);    // diskon manual menang, promo hangus
  });
});

describe("PROMO LEBARAN HEMAT — 10%, hanya 2 SKU Bolt, semua cabang", () => {
  const kodePromo = [ID["PROMO LEBARAN HEMAT"]];
  const lewatKode = async () => promoDenganKode(await aktifDi(CIOMAS, kodePromo), kodePromo[0]);

  it("apa adanya hari ini: tidak memotong karena tidak disetel potong otomatis", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(CIOMAS),
      [{ item_id: BOLT_IKAN, qty: 2, harga: 20000 }]))).toBe(0);
  });

  it("daftar barangnya ikut terbaca dan hanya SKU itu yang dipotong", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const promos = await lewatKode();
    expect(promos[0].itemIds.sort()).toEqual([BOLT_IKAN, BOLT_SALMON].sort());
    const hasil = hitungPromoKeranjang(promos, [
      { item_id: BOLT_IKAN, qty: 2, harga: 20000 },
      { item_id: BOLT_SALMON, qty: 1, harga: 20000 },
      { item_id: LAIN, qty: 1, harga: 90000 },
    ]);
    expect(hasil.map((h) => h.potongan)).toEqual([4000, 2000]);   // barang lain tidak kena
    expect(totalPotonganPromo(hasil)).toBe(6000);
  });

  it("batas min qty 1: qty 1 sudah dapat", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    expect(hitungPromoKeranjang(await lewatKode(), [{ item_id: BOLT_IKAN, qty: 1, harga: 20000 }])[0].potongan).toBe(2000);
  });

  it("ditumpuk diskon manual: hanya yang terbesar yang dipakai, tidak dijumlah", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const potongan = hitungPromoKeranjang(await lewatKode(), [{ item_id: BOLT_IKAN, qty: 2, harga: 20000 }]);
    const manualKecil = { qty: 2, harga: 20000, item_discount_type: "nominal" as const, item_discount_value: 1000,
      promo_discount: potongan[0].potongan };
    // Diskon manual MENANG walau lebih kecil dari promo — kasir menimpa dengan sengaja.
    expect(lineDiscount(manualKecil)).toBe(1000);
    expect(linePromoApplied(manualKecil)).toBe(0);
    const tanpaManual = { qty: 2, harga: 20000, promo_discount: potongan[0].potongan };
    expect(lineDiscount(tanpaManual)).toBe(4000);
    expect(linePromoApplied(tanpaManual)).toBe(4000);
  });
});

describe("PROMO SUKA SUKA — 10%, tanpa daftar barang, tanpa syarat", () => {
  const kodePromo = [ID["PROMO SUKA SUKA"]];
  const lewatKode = async () => promoDenganKode(await aktifDi(CIOMAS, kodePromo), kodePromo[0]);

  it("apa adanya hari ini: tidak memotong karena tidak disetel potong otomatis", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    expect(totalPotonganPromo(hitungPromoKeranjang(await aktifDi(CIOMAS), [{ item_id: LAIN, qty: 1, harga: 500000 }]))).toBe(0);
  });

  it("tanpa daftar barang = SELURUH katalog kena 10%, termasuk jasa dan baris ketikan manual", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const hasil = hitungPromoKeranjang(await lewatKode(), [
      { item_id: LAIN, qty: 1, harga: 500000 },
      { item_id: "", qty: 1, harga: 100000 },          // baris ketikan bebas kasir
    ]);
    expect(hasil.map((h) => h.potongan)).toEqual([50000, 10000]);
  });

  it("potongan tidak pernah membuat baris jadi minus", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const potongan = hitungPromoKeranjang(await lewatKode(), [{ item_id: LAIN, qty: 1, harga: 1 }]);
    expect(computeTotals([{ qty: 1, harga: 1, promo_discount: potongan[0]?.potongan ?? 0 }], 0, 0, 0).total).toBeGreaterThanOrEqual(0);
  });

  it("bersaing dengan PROMO LEBARAN HEMAT di SKU yang sama: satu baris hanya dapat satu promo, yang terbesar", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const dua = promoDenganKode(
      promoDenganKode(await aktifDi(CIOMAS, [ID["PROMO SUKA SUKA"], ID["PROMO LEBARAN HEMAT"]]), ID["PROMO SUKA SUKA"]),
      ID["PROMO LEBARAN HEMAT"]);
    const hasil = hitungPromoKeranjang(dua, [{ item_id: BOLT_IKAN, qty: 1, harga: 20000 }]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].potongan).toBe(2000);        // 10%, bukan 20%
  });
});

describe("jalur klinik & jasa memakai mesin yang sama", () => {
  it("baris jasa dengan SKU sama digabung dulu sebelum promo dihitung", async () => {
    vi.setSystemTime(HARI("2026-10-28"));
    const promos = promoDenganKode(await aktifDi(CIOMAS, [ID["PROMO SUKA SUKA"]]), ID["PROMO SUKA SUKA"]);
    const hasil = serviceLinePromos(promos, [
      { item_id: "jasa-1", qty: 1, harga: 100000, item_type: "Jasa" },
      { item_id: "jasa-1", qty: 1, harga: 100000, item_type: "Jasa" },
    ]);
    expect(hasil.map((h) => h.potongan)).toEqual([10000, 10000]);
    expect(hasil.map((h) => h.lineIndex)).toEqual([0, 1]);
  });
});
