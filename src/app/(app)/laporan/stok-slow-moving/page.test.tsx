import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analisisSemua, type BarisStokMentah } from "@/lib/stok-analisis";

const mock = vi.hoisted(() => ({ akses: true, ringkas: vi.fn(), pilihan: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ siap, filter, ringkasan, children }: { siap: boolean; filter?: React.ReactNode; ringkasan?: React.ReactNode; children?: React.ReactNode }) =>
    <div><form>{filter}</form>{siap ? <>{ringkasan}{children}</> : <p>BELUM-TAMPIL</p>}</div>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <div>{items.map((i) => <span key={i.label}>{i.label}:{i.nilai}</span>)}</div>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
vi.mock("@/lib/stok-analisis-server", () => ({
  StokAnalisisError: class extends Error {},
  periksaAksesStok: async () => ({ ok: mock.akses, role: "OWNER", aturan: [] }),
  muatPilihanStok: (...a: unknown[]) => mock.pilihan(...a),
  muatRingkasStok: (...a: unknown[]) => mock.ringkas(...a),
}));
import Page from "./page";

const m = (o: Partial<BarisStokMentah>): BarisStokMentah => ({
  id: "i", kode: "K", nama: "Barang", satuan: "PCS", kategori_id: null, aktif: true, min_stock: 0, supplier_id: null, buy_unit: null,
  min_buy: 0, buy_price: 0, stok: 5, nilai: 1000, stok_sejak: "2026-11-01", keluar: 0, modal_keluar: 0, terakhir: null, biaya_terakhir: 0, ...o,
});
const hasil = (baris: BarisStokMentah[]) => analisisSemua({ hari_ini: "2026-11-13", riwayat_hari: 13, baris });
const render = async (sp: Record<string, string>) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  mock.akses = true;
  mock.pilihan.mockReset(); mock.ringkas.mockReset();
  mock.pilihan.mockResolvedValue({
    gudang: [
      { id: "g1", code: "G1", name: "Gudang Satu", type: "RETAIL" }, { id: "g2", code: "G2", name: "Gudang Dua", type: "RETAIL" },
      { id: "v1", code: "V1", name: "Gudang Klinik", type: "VET" }, { id: "dc", code: "DC", name: "Gudang DC", type: "DC" },
    ], kategori: [], kategoriOpsi: ["MAKANAN", "OBAT"],
    kategoriDari: (b: { id: string }) => (b.id === "a" ? "MAKANAN" : "OBAT"),
  });
  mock.ringkas.mockResolvedValue(hasil([
    m({ id: "a", kode: "RC", nama: "Royal Canin", nilai: 9_000_000 }),
    m({ id: "b", kode: "OB", nama: "Obat Cacing", nilai: 2_000_000 }),
    m({ id: "c", kode: "OK", nama: "Laris", nilai: 100, keluar: 14, terakhir: "2026-11-12" }),
  ]));
});

describe("halaman Stok Slow Moving", () => {
  it("akses ditolak: tidak membaca data apa pun", async () => {
    mock.akses = false;
    const html = await render({ tampil: "1" });
    expect(html).toContain("belum diizinkan");
    expect(mock.ringkas).not.toHaveBeenCalled();
  });
  it("sebelum Tampilkan data tidak ditarik", async () => {
    const html = await render({});
    expect(html).toContain("BELUM-TAMPIL");
    expect(mock.ringkas).not.toHaveBeenCalled();
  });
  it("daftar urut Modal tertahan, kolom singkat, riwayat baru, hanya barang slow", async () => {
    const html = await render({ tampil: "1" });
    for (const k of ["Terjual/bulan", "Cukup untuk (bulan)", "Terakhir laku", "Nilai stok", "Modal tertahan", "Status"]) expect(html).toContain(k);
    expect(html.indexOf("Royal Canin")).toBeLessThan(html.indexOf("Obat Cacing"));
    expect(html).not.toContain("Laris");
    expect(html).toContain("Belum laku (sementara)");
    expect(html).toContain("riwayat baru 13 hari");
    expect(html).toContain("Rp 11.000.000");
    expect(html).toContain("Semua gudang digabung");
    expect(html).toContain("Dihitung bersih setelah pembatalan");
    expect(html).toContain("pesanan selesai");
  });
  it("cari, kategori dan gudang menyaring; gudang tidak dikenal = semua gudang", async () => {
    expect(await render({ tampil: "1", q: "cacing" })).not.toContain("Royal Canin");
    const kat = await render({ tampil: "1", kategori: "makanan" });
    expect(kat).toContain("Royal Canin");
    expect(kat).not.toContain("Obat Cacing");
    await render({ tampil: "1", gudang: "g1" });
    expect(mock.ringkas).toHaveBeenLastCalledWith(expect.anything(), "g1", null);
    await render({ tampil: "1", gudang: "bukan-gudang" });
    expect(mock.ringkas).toHaveBeenLastCalledWith(expect.anything(), "", null);
  });
  it("gabungan Semua petshop / Semua klinik: hanya gudang toko / gudang klinik yang dihitung, DC tidak ikut", async () => {
    const awal = await render({});
    expect(awal).toContain('<option value="petshop">Semua petshop (2 gudang toko)</option>');
    expect(awal).toContain('<option value="klinik">Semua klinik (1 gudang klinik)</option>');
    const ps = await render({ tampil: "1", gudang: "petshop" });
    expect(mock.ringkas).toHaveBeenLastCalledWith(expect.anything(), "", ["g1", "g2"]);
    expect(ps).toContain('<option value="petshop" selected="">');
    expect(ps).toContain("/laporan/stok-slow-moving/unduh?gudang=petshop&amp;");
    await render({ tampil: "1", gudang: "klinik" });
    expect(mock.ringkas).toHaveBeenLastCalledWith(expect.anything(), "", ["v1"]);
  });
  it("tautan unduh Excel membawa filter", async () => {
    const html = await render({ tampil: "1", q: "royal", kategori: "makanan" });
    expect(html).toContain("/laporan/stok-slow-moving/unduh?gudang=&amp;kategori=MAKANAN&amp;q=royal");
  });
  it("galat pembacaan tampil sebagai peringatan, bukan layar kosong", async () => {
    mock.ringkas.mockRejectedValue(new Error("db"));
    expect(await render({ tampil: "1" })).toContain("belum dapat dihitung");
  });
});
