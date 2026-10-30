// Daftar Faktur Penjualan gabungan tidak boleh pernah menyajikan angka separuh.
// Dua jebakannya: batas 1.000 baris per permintaan API, dan sumber yang gagal
// dibaca di tengah jalan. Keduanya harus berakhir sebagai jumlah yang benar
// atau peringatan yang terlihat — bukan daftar pendek yang tampak wajar.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { buatDbPalsu, type JejakBaca, type Row } from "@/lib/__tests__/helpers/faktur-db";

const s = vi.hoisted(() => ({ gagal: "", tanpaCount: false, jejak: [] as unknown[] }));
vi.mock("next/link", () => ({ default: ({ children, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a> }));
vi.mock("@/components/MasterPage", () => ({ MasterPage: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => true }));
vi.mock("@/app/(app)/penjualan/faktur/actions", () => ({ terimaPembayaranJual: vi.fn() }));

const BANYAK = 1001;
const tanggal = (i: number) => `2026-10-${String((i % 28) + 1).padStart(2, "0")}`;

const grosir = Array.from({ length: BANYAK }, (_, i) => ({
  id: `w${i}`, no_faktur: `INV-W-${String(i).padStart(4, "0")}`, tanggal: tanggal(i),
  jatuh_tempo: "2026-11-23", total: 2000, carried_paid: 0, status: "berjalan", voided_on: null,
  branch_id: "branch", customer_id: null, replaces_invoice_id: null, catatan: null,
  kategori: null, opening_batch_id: null, customers: null, branches: { name: "Cabang rekaan" }, sales_orders: null,
}));
const klinik = Array.from({ length: BANYAK }, (_, i) => ({
  id: `c${i}`, visit_id: `visit${i}`, invoice_no: `INV-C-${String(i).padStart(4, "0")}`,
  created_at: `${tanggal(i)}T05:00:00+00:00`, total: 2000, voided_at: null,
  paid_status: i === 0 ? "Lunas" : i === 1 ? "DP" : "Belum Lunas",
  visits: { branch_id: "branch", customer_id: null, pets: null, customers: { name: "Pelanggan rekaan" }, branches: { name: "Cabang rekaan" } },
}));

const sumber = (tabel: string): Row[] => ({
  profiles: [{ id: "user-1", role: "OWNER", is_active: true }],
  branches: [{ id: "branch", code: "RK", name: "Cabang rekaan", type: "PETSHOP", is_active: true }],
  customers: [], sales: [], user_branches: [],
  invoices: klinik, sales_invoices: grosir,
  sales_receipts: [], invoice_payments: [], sales_advances: [], wholesale_invoice_corrections: [],
}[tabel] ?? []);

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => buatDbPalsu(
  (tabel) => sumber(tabel),
  { jejak: s.jejak as JejakBaca[], gagal: () => s.gagal, tanpaCount: () => s.tanpaCount },
) }));

import Page from "@/app/(app)/penjualan/faktur/page";
const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", ...sp }) }));

beforeEach(() => { s.gagal = ""; s.tanpaCount = false; s.jejak = []; });

it("menghitung baris ke-1001 tiap sumber, bukan berhenti di batas bawaan API", async () => {
  const html = await render();
  expect(html).toContain((BANYAK * 2).toLocaleString("id-ID"));
  expect(html).toContain("Rp 4.004.000");
  const jejak = s.jejak as JejakBaca[];
  expect(jejak.filter(j => j.tabel === "invoices" && j.dari > 0).length).toBeGreaterThan(0);
  expect(jejak.filter(j => j.tabel === "sales_invoices" && j.dari > 0).length).toBeGreaterThan(0);
});

it("dokumen tertua tiap sumber tetap dapat dijangkau lewat halaman terakhir", async () => {
  // 1.001 dokumen per sumber = 21 halaman; yang ke-1001 ada di halaman terakhir.
  expect(await render({ sumber: "grosir", hal: "21" })).toContain("INV-W-0000");
  expect(await render({ sumber: "klinik", hal: "21" })).toContain("INV-C-0000");
  expect((await render()).includes("INV-W-0000")).toBe(false);
});

it("status tiap tagihan klinik mengikuti status tersimpannya, bukan hitungan ulang", async () => {
  const akhir = await render({ hal: "41" });
  const baris = akhir.slice(akhir.indexOf("INV-C-0000"), akhir.indexOf("</tr>", akhir.indexOf("INV-C-0000")));
  expect(baris).toContain("Lunas");
  expect(baris).not.toContain("Belum Lunas");
  // Tagihan DP dan tagihan tanpa bayar sama-sama belum lunas, dan yang berstatus
  // Lunas tidak boleh ikut terjaring walau baris penerimaannya tidak ada.
  const belum = await render({ sumber: "klinik", status: "belum" });
  expect(belum).toContain("Belum Lunas");
  expect(belum).not.toContain("INV-C-0000<");
  expect(belum).toContain((BANYAK - 1).toLocaleString("id-ID"));
});

it("rincian baris yang tampil diambil per potongan kecil, bukan sekaligus ribuan id", async () => {
  await render();
  const rincian = (s.jejak as JejakBaca[]).filter(j => j.jumlahId > 0);
  expect(rincian.length).toBeGreaterThan(0);
  expect(rincian.every(j => j.jumlahId <= 100)).toBe(true);
});

it.each(["sales", "invoices:lanjutan", "sales_invoices:lanjutan", "customers"])(
  "menolak membaca %s separuh dan memasang peringatan, bukan daftar pendek", async (tabel) => {
    s.gagal = tabel;
    const html = await render({ cari: "rekaan" });
    expect(html).toContain("Coba muat ulang");
    expect(html).not.toContain("INV-W-");
    expect(html).not.toContain("INV-C-");
  });

it("sumber tanpa jumlah baris yang dapat diverifikasi juga ditolak", async () => {
  s.tanpaCount = true;
  await expect(render()).rejects.toThrow("tidak dapat diverifikasi");
});

it.each(["sales_advances", "wholesale_invoice_corrections"])(
  "kegagalan %s menghentikan halaman, bukan menyembunyikan datanya", async (tabel) => {
    s.gagal = tabel;
    await expect(render()).rejects.toThrow(/belum|tidak dapat/);
  });
