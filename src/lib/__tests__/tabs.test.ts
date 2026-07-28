import { describe, it, expect } from "vitest";
import {
  tabLabel, openTab, closeTab, nextActive, HOME_TAB, type PageTab,
} from "../tabs";

const t = (href: string): PageTab => ({ href, label: tabLabel(href) });

describe("tabLabel", () => {
  it("pakai label tile kalau href-nya terdaftar di nav", () => {
    expect(tabLabel("/keuangan/laba-rugi")).toBe("Laba Rugi");
    expect(tabLabel("/pos/sku")).toBe("Barang & Jasa");
  });

  it("query string diabaikan saat mencocokkan", () => {
    expect(tabLabel("/pembelian?tab=supplier")).toBe("Pembelian");
    expect(tabLabel("/keuangan/laba-rugi?dari=2026-01-01")).toBe("Laba Rugi");
  });

  it("halaman tanpa tile ditebak dari URL", () => {
    expect(tabLabel("/pembelian/baru")).toBe("Pembelian baru");
    expect(tabLabel("/klinik/rekam-medis")).toBe("Rekam medis");
  });

  it("halaman baru di bawah tile pakai nama tile, bukan slug mentah", () => {
    expect(tabLabel("/pos/sku/baru")).toBe("Barang & Jasa baru");
  });

  it("segmen id dibuang supaya label tidak jadi uuid", () => {
    expect(tabLabel("/klinik/antrian/8c494ccc-fb04-4068-861a-0e5e2e0ff082")).toBe("Antrian digital");
    expect(tabLabel("/pos/opname/12")).toBe("Perintah Stok Opname");
  });

  it("halaman modul pakai nama modul, bukan tebakan slug", () => {
    expect(tabLabel("/kas-bank")).toBe("Kas & Bank");
    expect(tabLabel("/aset-tetap")).toBe("Aset Tetap");
    expect(tabLabel("/pos")).toBe("Persediaan");
  });

  it("root selalu Dashboard", () => {
    expect(tabLabel("/")).toBe("Dashboard");
  });
});

describe("openTab", () => {
  it("menambah tab baru", () => {
    expect(openTab([], t("/penjualan")).map((x) => x.href)).toEqual(["/penjualan"]);
  });

  it("idempoten — buka halaman yang sama tidak menggandakan tab", () => {
    const tabs = openTab([], t("/penjualan"));
    expect(openTab(tabs, t("/penjualan"))).toBe(tabs);
  });

  it("Dashboard tidak pernah masuk daftar (sudah dipin di komponen)", () => {
    expect(openTab([], HOME_TAB)).toEqual([]);
  });

  it("saat penuh, tab terlama dibuang dan yang baru tetap ada", () => {
    let tabs: PageTab[] = [];
    for (let i = 0; i < 4; i++) tabs = openTab(tabs, t(`/m${i}`), 3);
    expect(tabs.map((x) => x.href)).toEqual(["/m1", "/m2", "/m3"]);
  });
});

describe("closeTab", () => {
  it("membuang tab yang diminta", () => {
    const tabs = [t("/a"), t("/b")];
    expect(closeTab(tabs, "/a").map((x) => x.href)).toEqual(["/b"]);
  });

  it("Dashboard tidak bisa ditutup", () => {
    const tabs = [HOME_TAB, t("/a")];
    expect(closeTab(tabs, "/").map((x) => x.href)).toEqual(["/", "/a"]);
  });
});

describe("nextActive", () => {
  const tabs = [t("/a"), t("/b"), t("/c")];

  it("pindah ke tetangga kanan", () => {
    expect(nextActive(tabs, "/b")).toBe("/c");
  });

  it("tab terakhir jatuh ke kiri", () => {
    expect(nextActive(tabs, "/c")).toBe("/b");
  });

  it("tab satu-satunya jatuh ke Dashboard", () => {
    expect(nextActive([t("/a")], "/a")).toBe("/");
  });

  it("href asing tidak bikin crash", () => {
    expect(nextActive(tabs, "/entah")).toBe("/");
  });
});
