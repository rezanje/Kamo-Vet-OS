import { describe, it, expect } from "vitest";
import { cariMenu, daftarMenu, skorCocok, amankanKueri } from "../cari-global";

describe("skorCocok", () => {
  it("awalan menang atas potongan di tengah kata", () => {
    expect(skorCocok("Pelanggan", "pel")).toBeLessThan(skorCocok("Kategori Pelanggan", "pel"));
  });

  it("cocok di awal kata mana pun", () => {
    expect(skorCocok("Stok opname", "opname")).toBeGreaterThanOrEqual(0);
  });

  it("tidak cocok mengembalikan -1", () => {
    expect(skorCocok("Pelanggan", "zzz")).toBe(-1);
  });

  it("kueri kosong tidak pernah cocok", () => {
    expect(skorCocok("Pelanggan", "  ")).toBe(-1);
  });
});

describe("daftarMenu", () => {
  it("hanya memuat menu yang punya halaman sungguhan", () => {
    const menu = daftarMenu();
    expect(menu.length).toBeGreaterThan(20);
    expect(menu.every((m) => m.href.startsWith("/"))).toBe(true);
  });
});

describe("cariMenu", () => {
  it("menemukan menu dari sebagian nama", () => {
    const hasil = cariMenu("opname", "OWNER", []);
    expect(hasil.some((m) => m.href.includes("/pos/opname"))).toBe(true);
  });

  it("nama modul ikut dicocokkan", () => {
    const hasil = cariMenu("klinik", "OWNER", []);
    expect(hasil.length).toBeGreaterThan(0);
  });

  it("kueri satu huruf diabaikan — hasilnya cuma ribut", () => {
    expect(cariMenu("k", "OWNER", [])).toEqual([]);
  });

  // Hasil pencarian yang mengantar ke halaman terlarang bikin orang mengira
  // sistemnya rusak, padahal memang tidak berhak.
  it("menu di luar hak akses peran tidak ikut muncul", () => {
    const staff = cariMenu("jurnal", "STAFF", []);
    expect(staff).toEqual([]);
    const owner = cariMenu("jurnal", "OWNER", []);
    expect(owner.length).toBeGreaterThan(0);
  });

  it("aturan Akses Grup tersimpan dipakai, bukan bawaan", () => {
    const aturan = [{ role: "FINANCE", module_id: "klinik" }];
    expect(cariMenu("registrasi", "FINANCE", aturan).length).toBeGreaterThan(0);
    expect(cariMenu("registrasi", "FINANCE", []).length).toBe(0);
  });
});

describe("amankanKueri", () => {
  it("membuang karakter yang bikin pola pencarian liar", () => {
    expect(amankanKueri("100%_(a)")).not.toMatch(/[%_()]/);
  });

  it("memotong kueri yang kepanjangan", () => {
    expect(amankanKueri("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
