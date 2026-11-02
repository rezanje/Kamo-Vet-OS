// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Rincian Tutup Shift (VN pemilik toko, 2 Nov 2026): layar sesudah tutup shift
// memuat omset, tunai/non-tunai, pengeluaran, kas, selisih, plus omset bulan vs
// target dan pencapaian harian; atasan bisa membukanya lagi dari Riwayat Tutup Shift.

type Row = Record<string, unknown>;
const fx = vi.hoisted(() => ({
  user: "kasir-a",
  allowed: null as string[] | null,
  shift: null as Row | null,
  expenses: [] as Row[],
  sales: [] as Row[],
  targets: [] as Row[],
  history: [] as Row[],
  calls: [] as { table: string; filters: [string, string, unknown][] }[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => fx.allowed }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: fx.user } } }) },
  from(table: string) {
    const call = { table, filters: [] as [string, string, unknown][] };
    fx.calls.push(call);
    const rows = (): Row[] => {
      if (table === "expenses") return fx.expenses;
      if (table === "sales_targets") return fx.targets;
      if (table === "branches") return [{ id: "cab-a", name: "Toko A" }, { id: "cab-b", name: "Toko B" }];
      if (table === "sales") {
        const gte = call.filters.find(([op, col]) => op === "gte" && col === "created_at")?.[2] as string;
        const lte = call.filters.find(([op, col]) => op === "lte" && col === "created_at")?.[2] as string;
        const branch = call.filters.find(([op, col]) => op === "eq" && col === "branch_id")?.[2];
        return fx.sales.filter((s) => s.branch_id === branch
          && Date.parse(String(s.created_at)) >= Date.parse(gte) && Date.parse(String(s.created_at)) <= Date.parse(lte));
      }
      if (table === "cashier_shifts") return fx.history;
      return [];
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { call.filters.push(["eq", c, v]); return q; },
      in: (c: string, v: unknown) => { call.filters.push(["in", c, v]); return q; },
      gte: (c: string, v: unknown) => { call.filters.push(["gte", c, v]); return q; },
      lte: (c: string, v: unknown) => { call.filters.push(["lte", c, v]); return q; },
      lt: (c: string, v: unknown) => { call.filters.push(["lt", c, v]); return q; },
      order: () => q,
      range: async (from: number, to: number) => { const all = rows(); return { data: all.slice(from, to + 1), error: null, count: all.length }; },
      maybeSingle: async () => ({ data: table === "cashier_shifts" ? fx.shift : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return q;
  },
}) }));

import KasirRingkasan from "@/app/kasir/tutup/[shiftId]/page";
import LaporanShift from "@/app/(app)/pos/shift/[id]/page";
import Riwayat from "@/app/(app)/pos/shift/riwayat/page";

const shiftContoh = (): Row => ({
  id: "shift-1", shift_type: "petshop", status: "closed", branch_id: "cab-a", opened_by: "kasir-a",
  opening_balance: 0, closing_balance: 3_500_000, expected_cash: 3_500_000, selisih: 0,
  closing_breakdown: { Tunai: 4_000_000, Transfer: 0, Debit: 200_000, Kredit: 0, QRIS: 800_000, "E-Wallet": 0 },
  opened_at: "2026-11-01T01:00:00Z", closed_at: "2026-11-01T14:00:00Z",
  branches: { name: "Toko A" }, profiles: { full_name: "Kasir A" },
});
const jual = (id: string, total: number, created_at: string, extra: Row = {}): Row =>
  ({ id, total, created_at, branch_id: "cab-a", payment_plan: null, payments_finalized_at: null, voided_at: null, ...extra });

beforeEach(() => {
  fx.user = "kasir-a";
  fx.allowed = null;
  fx.shift = shiftContoh();
  fx.expenses = [
    { kategori: "Utilitas", deskripsi: "Listrik", jumlah: 500_000, metode_bayar: "Tunai" },
    { kategori: "Sewa", deskripsi: "Sewa ruko", jumlah: 2_000_000, metode_bayar: "Transfer" },
  ];
  fx.sales = [
    jual("s1", 5_000_000, "2026-11-01T05:00:00Z"),
    jual("void", 999, "2026-11-01T06:00:00Z", { voided_at: "2026-11-01T07:00:00Z" }),
    jual("belum-lunas", 777, "2026-11-01T06:00:00Z", { payment_plan: {}, payments_finalized_at: null }),
    jual("sesudah-tutup", 888, "2026-11-01T15:00:00Z"),
    jual("cabang-lain", 555, "2026-11-01T05:00:00Z", { branch_id: "cab-b" }),
  ];
  fx.targets = [{ periode: "2026-11", target: 50_000_000, basis: "omzet", branch_id: "cab-a", employee_id: null, category_id: null }];
  fx.history = [];
  fx.calls = [];
});

const teks = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent!.replace(/\s+/g, " ");

it("layar kasir sesudah tutup shift menampilkan rincian dan ringkasan target seperti contoh", async () => {
  const t = teks(renderToStaticMarkup(await KasirRingkasan({ params: Promise.resolve({ shiftId: "shift-1" }) })));
  expect(t).toContain("RINCIAN TUTUP SHIFT");
  expect(t).toContain("1 November 2026");
  expect(t).toContain("OMSET SHIFT INI");
  expect(t).toContain("Rp 5.000.000");
  expect(t).toMatch(/PEMBAYARAN TUNAI\s*Rp 4\.000\.000/);
  expect(t).toMatch(/PEMBAYARAN NON TUNAI\s*Rp 1\.000\.000/);
  expect(t).toContain("• Debit");
  expect(t).toContain("• QRIS");
  expect(t).toMatch(/PENGELUARAN\s*Rp 500\.000/);
  expect(t).toContain("• Listrik");
  expect(t).toContain("Rp 2.000.000 dibayar dari rekening");
  expect(t).toMatch(/TOTAL KAS SEHARUSNYA\s*Rp 3\.500\.000/);
  expect(t).toMatch(/KAS FISIK DIHITUNG\s*Rp 3\.500\.000/);
  expect(t).toMatch(/SELISIH KAS\s*Rp 0/);

  // Omset bulan: hanya penjualan selesai cabang ini sampai jam tutup shift.
  expect(t).toContain("RINGKASAN OMSET BULAN NOVEMBER 2026");
  expect(t).toMatch(/TOTAL OMSET BULAN INI\s*Rp 5\.000\.000/);
  expect(t).toMatch(/Pencapaian target bulan ini\s*10%/);
  expect(t).toMatch(/TARGET OMSET BULAN NOVEMBER\s*Rp 50\.000\.000/);
  expect(t).toMatch(/Sisa target bulan ini\s*Rp 45\.000\.000/);
  expect(t).toContain("Rp 1.666.667");
  expect(t).toMatch(/PENJUALAN HARI INI\s*Rp 5\.000\.000/);
  expect(t).toContain("300%");
  expect(t).toContain("TARGET TERLAMPAUI");
  expect(t).toContain("bulan November (30 hari)");
  expect(t).toContain("SELESAI");
});

it("tanpa target cabang, kartu menyuruh atur target alih-alih menampilkan persen palsu", async () => {
  fx.targets = [];
  const t = teks(renderToStaticMarkup(await KasirRingkasan({ params: Promise.resolve({ shiftId: "shift-1" }) })));
  expect(t).toContain("Target bulan ini belum diatur");
  expect(t).toMatch(/TOTAL OMSET BULAN INI\s*Rp 5\.000\.000/);
  expect(t).not.toContain("TARGET TERLAMPAUI");
});

it("kasir lain tidak bisa membuka layar sesudah tutup shift milik orang lain", async () => {
  fx.user = "kasir-b";
  await expect(KasirRingkasan({ params: Promise.resolve({ shiftId: "shift-1" }) })).rejects.toThrow("REDIRECT:/mulai");
});

it("laporan dari riwayat menampilkan kartu yang sama, shift klinik tanpa bagian target", async () => {
  fx.user = "owner";
  const petshop = teks(renderToStaticMarkup(await LaporanShift({ params: Promise.resolve({ id: "shift-1" }) })));
  expect(petshop).toContain("RINCIAN TUTUP SHIFT");
  expect(petshop).toContain("TARGET TERLAMPAUI");
  expect(petshop).toContain("Riwayat Tutup Shift");

  fx.shift = { ...shiftContoh(), shift_type: "klinik" };
  fx.calls = [];
  const klinik = teks(renderToStaticMarkup(await LaporanShift({ params: Promise.resolve({ id: "shift-1" }) })));
  expect(klinik).toContain("UANG MASUK SHIFT INI");
  expect(klinik).not.toContain("RINGKASAN OMSET BULAN");
  expect(fx.calls.some((c) => c.table === "sales")).toBe(false);
});

it("riwayat hanya membaca cabang yang boleh dilihat dan membuka laporan per shift", async () => {
  fx.user = "admin-a";
  fx.allowed = ["cab-a"];
  fx.history = [{
    ...shiftContoh(), id: "shift-9", closed_at: "2026-11-02T14:00:00Z", selisih: -20_000,
  }];
  const html = renderToStaticMarkup(await Riwayat({ searchParams: Promise.resolve({ dari: "2026-11-01", sampai: "2026-11-02" }) }));
  const doc = new DOMParser().parseFromString(html, "text/html");
  const shiftCall = fx.calls.find((c) => c.table === "cashier_shifts")!;
  expect(shiftCall.filters).toContainEqual(["in", "branch_id", ["cab-a"]]);
  expect(shiftCall.filters).toContainEqual(["eq", "status", "closed"]);
  expect(shiftCall.filters).toContainEqual(["gte", "closed_at", "2026-11-01T00:00:00+07:00"]);
  expect(shiftCall.filters).toContainEqual(["lt", "closed_at", "2026-11-03T00:00:00+07:00"]);
  expect([...doc.querySelectorAll("select[name=cabang] option")].map((o) => o.textContent)).toEqual(["Semua cabang", "Toko A"]);
  const row = doc.querySelector("tbody tr")!;
  expect(row.textContent).toContain("Kasir A");
  expect(row.textContent).toContain("Rp 5.000.000");
  expect(row.textContent).toContain("− Rp 20.000");
  expect(row.querySelector("a")?.getAttribute("href")).toBe("/pos/shift/shift-9");
});

it("riwayat kosong kalau akun tidak punya cabang sama sekali", async () => {
  fx.allowed = [];
  const html = renderToStaticMarkup(await Riwayat({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Belum ada shift yang ditutup");
  expect(fx.calls.some((c) => c.table === "cashier_shifts")).toBe(false);
});
