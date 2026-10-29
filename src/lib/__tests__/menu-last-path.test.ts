import { describe, expect, it } from "vitest";
import { LAST_PATH_KEY, isSafeModulePath, moduleHref, moduleOf, rememberPath } from "../menu-last-path";

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
