import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analisisSemua, type BarisStokMentah } from "@/lib/stok-analisis";

const mock = vi.hoisted(() => ({ akses: true, role: "OWNER", ringkas: vi.fn(), pilihan: vi.fn(), pend: vi.fn() }));
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
  periksaAksesStok: async () => ({ ok: mock.akses, role: mock.role, aturan: [] }),
  muatPilihanStok: (...a: unknown[]) => mock.pilihan(...a),
  muatRingkasStok: (...a: unknown[]) => mock.ringkas(...a),
  muatPendukungOrder: (...a: unknown[]) => mock.pend(...a),
}));
import Page from "./page";

const m = (o: Partial<BarisStokMentah>): BarisStokMentah => ({
  id: "i", kode: "K", nama: "Barang", satuan: "PCS", kategori_id: null, aktif: true, min_stock: 0, supplier_id: null, buy_unit: null,
  min_buy: 0, buy_price: 0, stok: 0, nilai: 0, stok_sejak: "2026-11-01", keluar: 0, modal_keluar: 0, terakhir: null, biaya_terakhir: 1000, ...o,
});
const render = async (sp: Record<string, string>) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  mock.akses = true; mock.role = "OWNER";
  mock.pilihan.mockReset(); mock.ringkas.mockReset(); mock.pend.mockReset();
  mock.pilihan.mockResolvedValue({ gudang: [], kategori: [], kategoriOpsi: ["MAKANAN"], kategoriDari: (b: { id: string }) => (b.id === "a" ? "MAKANAN" : "OBAT") });
  mock.ringkas.mockResolvedValue(analisisSemua({ hari_ini: "2026-11-13", riwayat_hari: 13, baris: [
    m({ id: "a", kode: "PSR", nama: "Pasir", stok: 0, keluar: 28, supplier_id: "s1" }),
    m({ id: "b", kode: "OBT", nama: "Obat Habis", stok: 2, min_stock: 10 }),
    m({ id: "c", kode: "AMN", nama: "Aman", stok: 500, keluar: 14 }),
    m({ id: "d", kode: "NON", nama: "Nonaktif", stok: 0, keluar: 28, aktif: false }),
    m({ id: "e", kode: "NOL", nama: "Tanpa Jual", stok: 0 }),
  ] }));
  mock.pend.mockResolvedValue({ satuanBeli: new Map(), pemasok: new Map([["s1", { nama: "PT Pasir" }]]), tidakValid: [] });
});

describe("halaman Stok Harus Order", () => {
  it("akses ditolak / belum Tampilkan: tidak membaca data", async () => {
    expect(await render({})).toContain("BELUM-TAMPIL");
    mock.akses = false;
    expect(await render({ tampil: "1" })).toContain("belum diizinkan");
    expect(mock.ringkas).not.toHaveBeenCalled();
  });
  it("hanya barang aktif yang harus dipesan, dikelompokkan per pemasok, pemasok kosong paling akhir", async () => {
    const html = await render({ tampil: "1" });
    expect(html).toContain("Pasir");
    expect(html).toContain("Obat Habis");
    for (const bukan of ["Aman", "Nonaktif", "Tanpa Jual"]) expect(html).not.toContain(bukan);
    expect(html.indexOf("PT Pasir")).toBeLessThan(html.indexOf("Belum ada pemasok"));
    for (const k of ["Saran order", "Cukup untuk (hari)", "Terjual/bulan", "Perkiraan"]) expect(html).toContain(k);
    expect(html).toContain("Di bawah minimum");
    expect(html).toContain("Segera habis (sementara)");
    expect(html).toContain("riwayat baru 13 hari");
    expect(html).toContain("2 barang");
  });
  it("Buat PO memakai halaman yang sudah ada, tanpa membuat PO baru di sini", async () => {
    const html = await render({ tampil: "1" });
    expect(html).toContain('href="/pos/stok-minimum"');
    expect(html).toContain('href="/pembelian"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("buatPOdariUsulan");
  });
  it("peran tanpa akses ke halaman PO tidak melihat tautannya", async () => {
    mock.role = "STAFF";
    const html = await render({ tampil: "1" });
    expect(html).not.toContain('href="/pos/stok-minimum"');
  });
  it("tidak ada yang harus dipesan: pesan kosong", async () => {
    mock.ringkas.mockResolvedValue(analisisSemua({ hari_ini: "2026-11-13", riwayat_hari: 13, baris: [m({ id: "c", stok: 500, keluar: 14 })] }));
    expect(await render({ tampil: "1" })).toContain("Tidak ada barang yang harus dipesan");
  });
});
