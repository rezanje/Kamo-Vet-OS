import { describe, expect, it } from "vitest";
import { LAST_PAGE_URL_KEY, LAST_PATH_KEY, isSafeModulePath, lastPageUrl, moduleHref, moduleOf, rememberPageUrl, rememberPath } from "../menu-last-path";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    data,
  };
}

describe("menu ingat halaman terakhir per modul", () => {
  it("kembali ke laporan yang terakhir dibuka beserta filternya", () => {
    const s = memory();
    rememberPath(s, "/laporan/penjualan-rinci", "?dari=2026-10-01&sampai=2026-10-29");
    rememberPath(s, "/pos/sku", "");
    expect(moduleHref(s, "laporan", "/laporan", "pos")).toBe("/laporan/penjualan-rinci?dari=2026-10-01&sampai=2026-10-29");
  });

  it("klik modul yang sedang aktif tetap ke halaman utamanya", () => {
    const s = memory();
    rememberPath(s, "/laporan/penjualan-rinci", "");
    expect(moduleHref(s, "laporan", "/laporan", "laporan")).toBe("/laporan");
  });

  it("tanpa riwayat atau penyimpanan memakai halaman utama", () => {
    expect(moduleHref(memory(), "laporan", "/laporan", "pos")).toBe("/laporan");
    expect(moduleHref(null, "laporan", "/laporan", "pos")).toBe("/laporan");
  });

  it("menolak path di luar modulnya atau isi rusak", () => {
    const s = memory();
    s.setItem(LAST_PATH_KEY, JSON.stringify({ laporan: "//evil.example/x", pos: "/laporanx" }));
    expect(moduleHref(s, "laporan", "/laporan", "pos")).toBe("/laporan");
    expect(moduleHref(s, "pos", "/pos", "laporan")).toBe("/pos");
    s.setItem(LAST_PATH_KEY, "bukan json");
    expect(moduleHref(s, "laporan", "/laporan", "pos")).toBe("/laporan");
    expect(isSafeModulePath("laporan", "/laporan?x=1")).toBe(true);
    expect(isSafeModulePath("laporan", "/laporan-lain")).toBe(false);
  });

  it("dashboard tidak diingat dan penyimpanan yang menolak tidak memutus navigasi", () => {
    expect(moduleOf("/")).toBeNull();
    const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => rememberPath(broken, "/laporan/x", "")).not.toThrow();
  });
});

describe("laporan dibekukan di posisi terakhir (tab, menu, Daftar Laporan)", () => {
  it("kembali ke laporan yang sudah ditampilkan membawa filter dan halaman tabelnya", () => {
    const s = memory();
    rememberPageUrl(s, "/laporan/penjualan-rinci", "?cabang=KMO&dari=2026-11-01&sampai=2026-11-19&tampil=1&halaman=3");
    rememberPageUrl(s, "/keuangan/laba-rugi", "dari=2026-10-01&tampil=1");
    expect(lastPageUrl(s, "/laporan/penjualan-rinci")).toBe("/laporan/penjualan-rinci?cabang=KMO&dari=2026-11-01&sampai=2026-11-19&tampil=1&halaman=3");
    expect(lastPageUrl(s, "/keuangan/laba-rugi")).toBe("/keuangan/laba-rugi?dari=2026-10-01&tampil=1");
    expect(lastPageUrl(s, "/laporan/visit")).toBe("/laporan/visit");
  });

  it("tautan yang sudah membawa filter sendiri tidak diubah", () => {
    const s = memory();
    rememberPageUrl(s, "/laporan/visit", "?dari=2026-11-01&tampil=1");
    expect(lastPageUrl(s, "/laporan/visit?dokter=x&tampil=1")).toBe("/laporan/visit?dokter=x&tampil=1");
    expect(lastPageUrl(s, "/laporan/visit#a")).toBe("/laporan/visit#a");
  });

  it("filter yang belum ditampilkan atau kunjungan polos tidak menimpa posisi terakhir", () => {
    const s = memory();
    rememberPageUrl(s, "/laporan/visit", "?dari=2026-11-01&tampil=1");
    rememberPageUrl(s, "/laporan/visit", "");
    rememberPageUrl(s, "/laporan/visit", "?dari=2026-01-01");
    expect(lastPageUrl(s, "/laporan/visit")).toBe("/laporan/visit?dari=2026-11-01&tampil=1");
  });

  it("pesan sukses/galat dan tanda sekali pakai tidak ikut diingat", () => {
    const s = memory();
    rememberPageUrl(s, "/pembelian", "?success=1&request_done=k&request_scope=po&status=draft&tampil=1&draft_done=x&draft_scope=y");
    expect(lastPageUrl(s, "/pembelian")).toBe("/pembelian?status=draft&tampil=1");
    rememberPath(s, "/penjualan/faktur", "?error=Gagal&tampil=1&status=belum");
    expect(moduleHref(s, "penjualan", "/penjualan", "laporan")).toBe("/penjualan/faktur?tampil=1&status=belum");
  });

  it("isi rusak, alamat asing, dan penyimpanan yang menolak tidak memutus navigasi", () => {
    const s = memory();
    s.setItem(LAST_PAGE_URL_KEY, JSON.stringify({ "/laporan/visit": "//evil.example/laporan/visit?tampil=1", "/laporan/promo": "/laporan/promolain?tampil=1" }));
    expect(lastPageUrl(s, "/laporan/visit")).toBe("/laporan/visit");
    expect(lastPageUrl(s, "/laporan/promo")).toBe("/laporan/promo");
    s.setItem(LAST_PAGE_URL_KEY, "bukan json");
    expect(lastPageUrl(s, "/laporan/visit")).toBe("/laporan/visit");
    expect(lastPageUrl(null, "/laporan/visit")).toBe("/laporan/visit");
    const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => rememberPageUrl(broken, "/laporan/x", "?tampil=1")).not.toThrow();
    expect(() => rememberPageUrl(s, "//evil", "?tampil=1")).not.toThrow();
    expect(lastPageUrl(s, "//evil")).toBe("//evil");
  });
});
