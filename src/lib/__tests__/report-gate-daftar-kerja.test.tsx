// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// A1 (meeting 12 Nov 2026): daftar kerja yang masuk Daftar Laporan dibuka KOSONG.
// Tanpa `tampil=1` tidak ada query daftar/laporan yang berat; tombol kerja
// (buat baru, form transaksi) tetap tampil. Dengan `tampil=1` datanya ditarik.

const fx = vi.hoisted(() => ({
  queries: [] as { table: string; select: string; filters: Record<string, unknown> }[],
  balances: 0, komisi: 0, faktur: 0,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/", redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/master-guard", () => ({
  bolehKelolaMaster: async () => true, bolehTransaksiKas: async () => true, bolehKelolaPayroll: async () => true,
}));
vi.mock("@/lib/branch-access", async (original) => ({ ...await original<typeof import("@/lib/branch-access")>(), allowedBranchIds: async () => null }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => { fx.balances++; return []; } }));
vi.mock("@/lib/komisi-data", () => ({
  muatKebijakanKomisiJasa: async () => ({ installed: true, policies: [] }),
  komisiPeriode: async () => { fx.komisi++; return { hasil: [], baris: [], visitDobel: [], peringatanAturan: [], omzetTanpaPenjual: 0 }; },
}));
vi.mock("@/lib/faktur-gabungan-server", async (original) => ({
  ...await original<typeof import("@/lib/faktur-gabungan-server")>(),
  bacaFakturGabungan: async () => {
    fx.faktur++;
    return { rows: [], ringkasan: { jumlah: 0, total: 0, jumlahBelum: 0, totalBelum: 0 }, pageInfo: { page: 1, totalPages: 1, from: 0, to: -1 }, cabangOptions: [], pelangganTerpotong: false };
  },
}));
vi.mock("@/app/(app)/kas-bank/rekening/actions", () => ({ tambahRekening: async () => {}, toggleRekening: async () => {} }));
vi.mock("@/app/(app)/pembelian/actions", () => ({ updatePOStatus: async () => {}, tambahSupplier: async () => {}, recoverPurchaseSubmission: async () => {} }));
vi.mock("@/app/(app)/pembelian/uang-muka/actions", () => ({ bayarUangMuka: async () => {}, periksaUangMuka: async () => {}, batalkanUangMuka: async () => {} }));
vi.mock("@/app/(app)/penjualan/faktur/actions", () => ({ terimaPembayaranJual: async () => {} }));
vi.mock("@/app/(app)/penjualan/komisi/actions", () => ({
  hapusAturanKomisi: async () => {}, simpanAturanKomisi: async () => {}, simpanKebijakanKomisiJasa: async () => {},
  simpanKelompokKomisi: async () => {}, toggleAturanKomisi: async () => {},
}));
vi.mock("@/app/(app)/pos/shift/actions", () => ({ openShift: async () => {}, closeShift: async () => {}, forceCloseShift: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  rpc: async () => ({ data: null, error: null }),
  from(table: string) {
    const entry = { table, select: "", filters: {} as Record<string, unknown> };
    fx.queries.push(entry);
    const q: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
        if (key === "maybeSingle" || key === "single") return async () => ({ data: null, error: null });
        if (key === "select") return (fields: string) => { entry.select = fields; return q; };
        if (key === "eq") return (k: string, v: unknown) => { entry.filters[k] = v; return q; };
        return () => q;
      },
    });
    return q;
  },
}) }));

import RekeningPage from "@/app/(app)/kas-bank/rekening/page";
import PembelianPage from "@/app/(app)/pembelian/page";
import FakturBeliPage from "@/app/(app)/pembelian/faktur/page";
import PenerimaanPage from "@/app/(app)/pembelian/penerimaan/page";
import UangMukaPage from "@/app/(app)/pembelian/uang-muka/page";
import FakturJualPage from "@/app/(app)/penjualan/faktur/page";
import KomisiPage from "@/app/(app)/penjualan/komisi/page";
import ShiftPage from "@/app/(app)/pos/shift/page";
import RiwayatShiftPage from "@/app/(app)/pos/shift/riwayat/page";

beforeEach(() => { fx.queries = []; fx.balances = 0; fx.komisi = 0; fx.faktur = 0; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const html = async (Page: (p: any) => Promise<React.ReactNode>, sp: Record<string, string> = {}) =>
  renderToStaticMarkup(<>{await Page({ searchParams: Promise.resolve(sp) })}</>);
const tables = () => fx.queries.map((q) => q.table);
const kosong = 'data-report-gate="true"';
const tombolTampil = 'name="tampil" value="1"';

it("Daftar Rekening: tanpa Tampilkan tidak membaca rekening & saldo jurnal; form tambah tetap ada", async () => {
  const page = await html(RekeningPage);
  expect(page).toContain(kosong);
  expect(page).toContain(tombolTampil);
  expect(page).toContain("Simpan rekening");
  expect(tables()).not.toContain("cash_accounts");
  expect(fx.balances).toBe(0);
  await html(RekeningPage, { tampil: "1" });
  expect(tables()).toContain("cash_accounts");
  expect(fx.balances).toBe(1);
});

it("Purchase Order: daftar PO tidak dibaca sebelum Tampilkan; tombol Buat PO tetap ada", async () => {
  const page = await html(PembelianPage);
  expect(page).toContain(kosong);
  expect(page).toContain('href="/pembelian/baru"');
  expect(tables()).not.toContain("purchase_orders");
  const shown = await html(PembelianPage, { tampil: "1" });
  expect(tables()).toContain("purchase_orders");
  expect(shown).toContain('href="/pembelian?tab=supplier&amp;tampil=1"');
});

it("Faktur & penerimaan pembelian: dokumen tidak dibaca sebelum Tampilkan", async () => {
  const faktur = await html(FakturBeliPage);
  const terima = await html(PenerimaanPage);
  for (const page of [faktur, terima]) { expect(page).toContain(kosong); expect(page).toContain(tombolTampil); }
  expect(faktur).toContain('href="/pembelian/faktur/baru"');
  expect(tables()).not.toContain("purchase_invoices");
  expect(tables()).not.toContain("goods_receipts");
  await html(FakturBeliPage, { tampil: "1" });
  await html(PenerimaanPage, { tampil: "1" });
  expect(tables()).toEqual(expect.arrayContaining(["purchase_invoices", "goods_receipts"]));
});

it("Uang muka pembelian: daftar lengkap tidak dibaca sebelum Tampilkan; form bayar tetap memakai DP aktif ringkas", async () => {
  const page = await html(UangMukaPage);
  expect(page).toContain(kosong);
  expect(page).toContain('name="jumlah"');
  const advances = fx.queries.filter((q) => q.table === "purchase_advances");
  expect(advances.length).toBe(1);
  expect(advances[0].select).not.toContain("no_um");
  expect(advances[0].filters.status).toBe("aktif");
  fx.queries = [];
  await html(UangMukaPage, { tampil: "1" });
  expect(fx.queries.filter((q) => q.table === "purchase_advances").map((q) => q.select).join()).toContain("no_um");
});

it("Faktur penjualan: daftar gabungan, kredit, dan uang muka tidak dibaca sebelum Tampilkan", async () => {
  const page = await html(FakturJualPage);
  expect(page).toContain(kosong);
  expect(page).toContain(tombolTampil);
  expect(page).toContain('href="/penjualan/faktur/baru"');
  expect(page).not.toContain("/penjualan/faktur/unduh");
  expect(fx.faktur).toBe(0);
  expect(tables()).toEqual(["branches"]);
  await html(FakturJualPage, { tampil: "1" });
  expect(fx.faktur).toBe(1);
  expect(tables()).toContain("sales_advances");
});

it("Komisi: hitungan periode tidak jalan sebelum Tampilkan; aturan tetap tampil", async () => {
  const page = await html(KomisiPage);
  expect(page).toContain(kosong);
  expect(page).toContain("Simpan aturan");
  expect(fx.komisi).toBe(0);
  await html(KomisiPage, { tampil: "1", periode: "2026-10" });
  expect(fx.komisi).toBe(1);
});

it("Shift kasir: riwayat shift digerbang, buka shift tetap bisa", async () => {
  const page = await html(ShiftPage);
  expect(page).toContain(kosong);
  expect(page).toContain("Mulai Shift");
  expect(fx.queries.some((q) => q.table === "cashier_shifts" && q.filters.status === "closed")).toBe(false);
  await html(ShiftPage, { tampil: "1" });
  expect(fx.queries.some((q) => q.table === "cashier_shifts" && q.filters.status === "closed")).toBe(true);
});

it("Riwayat tutup shift: tanpa Tampilkan hanya pilihan cabang yang dibaca", async () => {
  const page = await html(RiwayatShiftPage);
  expect(page).toContain(kosong);
  expect(page).toContain(tombolTampil);
  expect(tables()).not.toContain("cashier_shifts");
  await html(RiwayatShiftPage, { tampil: "1" });
  expect(tables()).toContain("cashier_shifts");
});
