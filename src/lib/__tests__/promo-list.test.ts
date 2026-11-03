// Daftar promo: filter status (?status=), hitungan, urutan, pencarian, dan
// format rentang tanggal satu baris. Batas harinya dibaca menurut WIB.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromoRow } from "../promo";
import { promoScheduleStatus } from "../promo";
import { hariIniWIB } from "../tanggal";
import {
  filterPromosByStatus, formatRentangTanggal, parseStatusFilter, promoMatchesQuery,
  promoMatchesBranch, promoStatusCounts, sortPromosByStatus,
} from "../promo-list";

const base: PromoRow = {
  id: "p", name: "Promo", promo_type: "diskon_produk", rule: {}, is_active: true, branch_ids: null,
  valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: false,
  auto_apply: false, discount_type: null, discount_value: null,
};
const p = (id: string, o: Partial<PromoRow>): PromoRow => ({ ...base, id, name: id, ...o });
const TODAY = "2026-11-03";

describe("batas status promo (WIB)", () => {
  it("valid_from hari ini = aktif; besok = terjadwal", () => {
    expect(promoScheduleStatus(p("a", { valid_from: TODAY }), TODAY)).toBe("aktif");
    expect(promoScheduleStatus(p("a", { valid_from: "2026-11-04" }), TODAY)).toBe("terjadwal");
  });
  it("valid_until hari ini = aktif; kemarin = kadaluarsa (menang atas is_active=false)", () => {
    expect(promoScheduleStatus(p("a", { valid_until: TODAY }), TODAY)).toBe("aktif");
    expect(promoScheduleStatus(p("a", { valid_until: "2026-11-02" }), TODAY)).toBe("kadaluarsa");
    expect(promoScheduleStatus(p("a", { valid_until: "2026-11-02", is_active: false }), TODAY)).toBe("kadaluarsa");
  });
  it("nonaktif manual yang belum lewat tanggal = nonaktif; terjadwal tapi dimatikan = nonaktif", () => {
    expect(promoScheduleStatus(p("a", { is_active: false }), TODAY)).toBe("nonaktif");
    expect(promoScheduleStatus(p("a", { is_active: false, valid_from: "2026-11-10" }), TODAY)).toBe("nonaktif");
  });
  describe("jam 00:00–07:00 WIB (tanggal UTC masih kemarin)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("02:00 WIB 4 Nov = 19:00 UTC 3 Nov → hari ini 2026-11-04", () => {
      vi.setSystemTime(new Date("2026-11-03T19:00:00Z"));
      const today = hariIniWIB();
      expect(today).toBe("2026-11-04");
      expect(promoScheduleStatus(p("a", { valid_from: "2026-11-04" }), today)).toBe("aktif");
      expect(promoScheduleStatus(p("a", { valid_until: "2026-11-03" }), today)).toBe("kadaluarsa");
    });
    it("06:59 WIB masih hari WIB yang sama; 17:00 UTC (00:00 WIB) pindah hari", () => {
      vi.setSystemTime(new Date("2026-11-03T16:59:00Z"));
      expect(hariIniWIB()).toBe("2026-11-03");
      vi.setSystemTime(new Date("2026-11-03T17:00:00Z"));
      expect(hariIniWIB()).toBe("2026-11-04");
    });
  });
});

const daftar: PromoRow[] = [
  p("kadaluarsa1", { valid_until: "2026-10-31", is_active: false }),
  p("nonaktif1", { is_active: false }),
  p("aktif1", {}),
  p("mendatang1", { valid_from: "2026-11-04" }),
  p("aktif2", { valid_from: TODAY, valid_until: TODAY }),
  p("nonaktif2", { is_active: false, valid_from: "2026-12-01" }),
  p("kadaluarsa2", { valid_until: "2026-11-02" }), // belum tersapu: masih is_active
];

describe("parseStatusFilter", () => {
  it("menerima lima nilai, selain itu 'semua'", () => {
    for (const v of ["aktif", "mendatang", "nonaktif", "kedaluwarsa", "semua"]) expect(parseStatusFilter(v)).toBe(v);
    for (const v of [undefined, "", "xyz", "AKTIF ", ["aktif", "x"]]) expect(parseStatusFilter(v as never)).toBe("semua");
  });
});

describe("promoStatusCounts & filterPromosByStatus", () => {
  it("hitungan saling lepas dan jumlahnya = semua baris (tanpa pemotongan)", () => {
    const c = promoStatusCounts(daftar, TODAY);
    expect(c).toEqual({ semua: 7, aktif: 2, mendatang: 1, nonaktif: 2, kedaluwarsa: 2 });
    expect(c.aktif + c.mendatang + c.nonaktif + c.kedaluwarsa).toBe(c.semua);
  });
  it("filter mengembalikan baris yang sesuai persis", () => {
    const ids = (f: Parameters<typeof filterPromosByStatus>[1]) => filterPromosByStatus(daftar, f, TODAY).map(x => x.id).sort();
    expect(ids("aktif")).toEqual(["aktif1", "aktif2"]);
    expect(ids("mendatang")).toEqual(["mendatang1"]);
    expect(ids("nonaktif")).toEqual(["nonaktif1", "nonaktif2"]);
    expect(ids("kedaluwarsa")).toEqual(["kadaluarsa1", "kadaluarsa2"]);
    expect(ids("semua")).toHaveLength(7);
  });
  it("daftar >1000 baris dihitung lengkap", () => {
    const besar = Array.from({ length: 2503 }, (_, i) => p(`x${i}`, i % 2 ? { is_active: false } : {}));
    expect(promoStatusCounts(besar, TODAY).semua).toBe(2503);
    expect(filterPromosByStatus(besar, "nonaktif", TODAY)).toHaveLength(1251);
  });
});

describe("sortPromosByStatus", () => {
  it("aktif → mendatang → nonaktif → kedaluwarsa, urutan asal dipertahankan di dalam kelompok, input tidak diubah", () => {
    const salinan = [...daftar];
    const out = sortPromosByStatus(daftar, TODAY).map(x => x.id);
    expect(out).toEqual(["aktif1", "aktif2", "mendatang1", "nonaktif1", "nonaktif2", "kadaluarsa1", "kadaluarsa2"]);
    expect(daftar).toEqual(salinan);
  });
});

describe("promoMatchesQuery", () => {
  it("nama atau nama barang, tanpa peduli huruf besar/kecil & spasi pinggir; kosong = cocok", () => {
    expect(promoMatchesQuery("V GROOMING 50% CS", [], " grooming ")).toBe(true);
    expect(promoMatchesQuery("Diskon", ["Royal Canin Kitten"], "canin")).toBe(true);
    expect(promoMatchesQuery("Diskon", ["Whiskas"], "canin")).toBe(false);
    expect(promoMatchesQuery("Diskon", [], "")).toBe(true);
    expect(promoMatchesQuery("Diskon", [], "   ")).toBe(true);
  });
});

describe("formatRentangTanggal", () => {
  it("satu tahun: tahun hanya di ujung", () => expect(formatRentangTanggal("2026-11-02", "2026-12-31")).toBe("02 Nov – 31 Des 2026"));
  it("beda tahun: tahun di kedua ujung", () => expect(formatRentangTanggal("2026-12-20", "2027-01-15")).toBe("20 Des 2026 – 15 Jan 2027"));
  it("hari yang sama", () => expect(formatRentangTanggal("2026-11-03", "2026-11-03")).toBe("03 Nov 2026"));
  it("tanpa batas awal / akhir / keduanya", () => {
    expect(formatRentangTanggal(null, "2026-12-31")).toBe("s/d 31 Des 2026");
    expect(formatRentangTanggal("2026-11-02", null)).toBe("mulai 02 Nov 2026");
    expect(formatRentangTanggal(null, null)).toBe("Tanpa batas");
  });
  it("format tak dikenal ditampilkan apa adanya, bukan dibuang", () => expect(formatRentangTanggal("aneh", null)).toBe("mulai aneh"));
});

describe("promoMatchesBranch", () => {
  it("tanpa pilihan cabang = semua cocok", () => expect(promoMatchesBranch({ ...base, branch_ids: ["b1"] }, "")).toBe(true));
  it("promo semua cabang (null / kosong) cocok di cabang mana pun", () => {
    expect(promoMatchesBranch({ ...base, branch_ids: null }, "b9")).toBe(true);
    expect(promoMatchesBranch({ ...base, branch_ids: [] }, "b9")).toBe(true);
  });
  it("promo cabang tertentu hanya cocok di cabang itu", () => {
    expect(promoMatchesBranch({ ...base, branch_ids: ["b1", "b2"] }, "b2")).toBe(true);
    expect(promoMatchesBranch({ ...base, branch_ids: ["b1"] }, "b2")).toBe(false);
  });
});
