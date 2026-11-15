import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { CatatanRiwayat, KartuStokDashboard } from "../KartuStok";
import type { KartuStok } from "@/lib/stok-analisis-server";
import type { BarisAnalisis, BarisOrder } from "@/lib/stok-analisis";

const slowRow = (i: number): BarisAnalisis => ({
  id: `s${i}`, kode: `K${i}`, nama: `Slow ${i}`, satuan: "PCS", kategoriId: null, aktif: true, minStock: 0, supplierId: null, buyUnit: null,
  minBuy: 0, hargaBeliDasar: 0, biayaTerakhir: 0, stok: 5, nilaiStok: 1_000_000 * (10 - i), terjualBulan: 0, terjualHari: 0, modalBulan: 0,
  coverBulan: null, coverHari: null, terakhirLaku: null, hariTanpaJual: null, status: "belum_laku", modalTertahan: 1_000_000 * (10 - i), sementara: true, alasanOrder: [],
});
const orderRow = (i: number): BarisOrder => ({
  itemId: `o${i}`, kode: `O${i}`, nama: `Order ${i}`, satuan: "PCS", stok: 0, minStock: 0, minBuy: 0, buyUnit: "DUS", faktorBeli: 12, hargaBeli: 100,
  supplierId: null, supplierNama: "Belum ada pemasok", kurang: 24, qtyPesan: 2, nilai: 200, alasan: ["cepat_habis"], coverHari: i, terjualBulan: 30, targetStok: 24, sementara: true,
});
const data = (over: Partial<Exclude<KartuStok, null | { galat: string }>> = {}): KartuStok => ({
  label: "riwayat baru 13 hari", riwayatBaru: true, riwayatHari: 13,
  portofolio: { nilaiStok: 1_594_000_000, modalBulan: 814_000_000, coverBulan: 1.96, berlebih: false },
  slow: { jumlah: 971, modalTertahan: 843_000_000, nilaiStok: 1_030_000_000, perStatus: { mati: { jumlah: 0, modalTertahan: 0 }, tidak_laku: { jumlah: 0, modalTertahan: 0 }, belum_laku: { jumlah: 662, modalTertahan: 488_000_000 }, berlebih: { jumlah: 309, modalTertahan: 355_000_000 } }, top: [0, 1, 2, 3, 4].map(slowRow) },
  order: { jumlah: 133, nilai: 15_000_000, top: [0, 1, 2, 3, 4].map(orderRow) },
  ...over,
});

describe("KartuStokDashboard", () => {
  it("dua kartu: jumlah, modal tertahan, 5 teratas, tautan Lihat semua ke halaman dengan data langsung tampil", () => {
    const html = renderToStaticMarkup(<KartuStokDashboard data={data()} />);
    expect(html).toContain("971 barang");
    expect(html).toContain("Rp 843 jt");
    expect(html).toContain("133 barang");
    expect(html).toContain("Rp 15 jt");
    expect((html.match(/Slow \d/g) ?? []).length).toBe(5);
    expect((html.match(/Order \d/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/laporan/stok-slow-moving?tampil=1"');
    expect(html).toContain('href="/laporan/stok-harus-order?tampil=1"');
    expect(html).toContain("Semua stok cukup untuk 2,0 bulan penjualan");
    expect(html).toContain("cukup 3 hari");
    expect(html).toContain("2 DUS");
  });
  it("riwayat baru selalu disebut dan angka dinyatakan sementara", () => {
    const html = renderToStaticMarkup(<KartuStokDashboard data={data()} />);
    expect((html.match(/riwayat baru 13 hari/g) ?? []).length).toBe(2);
    expect(html).toContain("masih sementara, belum pasti");
  });
  it("riwayat cukup: tanpa peringatan sementara", () => {
    const html = renderToStaticMarkup(<KartuStokDashboard data={data({ label: "riwayat 75 hari", riwayatBaru: false })} />);
    expect(html).toContain("Dihitung dari riwayat 75 hari");
    expect(html).not.toContain("sementara");
  });
  it("portofolio berlebih diberi tanda; tanpa penjualan cover tampil strip", () => {
    expect(renderToStaticMarkup(<KartuStokDashboard data={data({ portofolio: { nilaiStok: 10, modalBulan: 2, coverBulan: 5, berlebih: true } })} />)).toContain("5,0 bulan penjualan (berlebih)");
    expect(renderToStaticMarkup(<KartuStokDashboard data={data({ portofolio: { nilaiStok: 10, modalBulan: 0, coverBulan: null, berlebih: false } })} />)).toContain("untuk — bulan");
  });
  it("hanya kartu yang diizinkan; null = tidak tampil; galat = kartu peringatan", () => {
    const hanyaSlow = renderToStaticMarkup(<KartuStokDashboard data={data({ order: null })} />);
    expect(hanyaSlow).toContain("Slow moving");
    expect(hanyaSlow).not.toContain("Harus order");
    expect(renderToStaticMarkup(<KartuStokDashboard data={null} />)).toBe("");
    const galat = renderToStaticMarkup(<KartuStokDashboard data={{ galat: "Data stok belum dapat dihitung." }} />);
    expect(galat).toContain("Data stok belum dapat dihitung.");
    expect(galat).toContain('role="alert"');
  });
  it("daftar kosong menampilkan 'Tidak ada'", () => {
    const html = renderToStaticMarkup(<KartuStokDashboard data={data({ order: { jumlah: 0, nilai: 0, top: [] } })} />);
    expect(html).toContain("0 barang");
    expect(html).toContain("Tidak ada.");
  });
});

describe("CatatanRiwayat", () => {
  it("memuat label riwayat", () => {
    expect(renderToStaticMarkup(<CatatanRiwayat label="riwayat baru 5 hari" baru />)).toContain("riwayat baru 5 hari");
  });
});
