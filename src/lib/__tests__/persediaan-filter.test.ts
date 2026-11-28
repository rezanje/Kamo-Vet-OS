import { describe, expect, it } from "vitest";
import { filterDariAlamat, queryDenganFilter } from "../persediaan-filter";

const STATUS = ["Menunggu Persetujuan", "Disetujui", "Dikirim", "Selesai", "Ditolak"];

describe("filterDariAlamat", () => {
  it("membaca filter yang sah", () => {
    expect(filterDariAlamat({ status: "Dikirim", dari: "2026-11-01", sampai: "2026-11-28", cari: "gudang", hal: "3" }, STATUS))
      .toEqual({ status: "Dikirim", from: "2026-11-01", to: "2026-11-28", q: "gudang", page: 3 });
  });
  it("mengabaikan nilai tidak sah dan memakai bawaan", () => {
    expect(filterDariAlamat(undefined, STATUS)).toEqual({ status: "", from: "", to: "", q: "", page: 1 });
    expect(filterDariAlamat({ status: "Hacked", dari: "kemarin", sampai: "2026-13", hal: "-4" }, STATUS)).toEqual({ status: "", from: "", to: "", q: "", page: 1 });
    expect(filterDariAlamat({ hal: "abc" }, STATUS).page).toBe(1);
    expect(filterDariAlamat({ hal: "1" }, STATUS).page).toBe(1);
    expect(filterDariAlamat({ cari: "x".repeat(200) }, STATUS).q).toHaveLength(80);
  });
});

describe("queryDenganFilter", () => {
  it("memasang filter dan mempertahankan parameter lain (tab)", () => {
    expect(queryDenganFilter("?tab=penerimaan", { status: "Dikirim", from: "", to: "", q: " abc ", page: 2 }))
      .toBe("?tab=penerimaan&status=Dikirim&cari=abc&hal=2");
  });
  it("membuang filter yang dikosongkan; tanpa sisa mengembalikan string kosong", () => {
    expect(queryDenganFilter("?tab=penerimaan&status=Dikirim&hal=2", { status: "", from: "", to: "", q: "", page: 1 })).toBe("?tab=penerimaan");
    expect(queryDenganFilter("?status=Dikirim", { status: "", from: "", to: "", q: "", page: 1 })).toBe("");
    expect(queryDenganFilter("", { status: "", from: "", to: "", q: "", page: 1 })).toBe("");
  });
  it("hasilnya bisa dibaca kembali oleh filterDariAlamat (bolak-balik)", () => {
    const f = { status: "Selesai", from: "2026-11-01", to: "2026-11-05", q: "toko a", page: 4 };
    const p = new URLSearchParams(queryDenganFilter("?tab=permintaan", f));
    expect(filterDariAlamat({ status: p.get("status") ?? undefined, dari: p.get("dari") ?? undefined, sampai: p.get("sampai") ?? undefined, cari: p.get("cari") ?? undefined, hal: p.get("hal") ?? undefined }, STATUS)).toEqual(f);
  });
});
