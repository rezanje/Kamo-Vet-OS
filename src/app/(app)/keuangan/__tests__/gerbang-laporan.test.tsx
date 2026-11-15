import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A1 (meeting 12 Nov 2026): laporan keuangan dibuka KOSONG — query berat (saldo buku besar,
// daftar piutang/hutang, riwayat jurnal, aset) baru jalan setelah Tampilkan (tampil=1).
// Klien Supabase palsu mencatat tabel yang benar-benar dieksekusi.

const db = vi.hoisted(() => ({ dibaca: [] as string[], rpc: [] as string[] }));
const spy = vi.hoisted(() => ({
  getAccountBalances: vi.fn(async () => []), getAccountLedger: vi.fn(async () => []), getAccountOpening: vi.fn(async () => 0),
  getCashMovements: vi.fn(async () => ({ moves: [], saldoKasNow: 0, saldoAwal: 0 })), getCashLedgerPerAccount: vi.fn(async () => []),
  mutasiPiutang: vi.fn(async () => []), mutasiHutang: vi.fn(async () => []),
  postRecurringCatchUp: vi.fn(async () => []), catchUpDepreciation: vi.fn(async () => []), loadRekeningAktif: vi.fn(async () => []),
}));

vi.stubGlobal("React", React);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const builder = (table: string) => {
    const target: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown, gagal?: (e: unknown) => unknown) => {
        db.dibaca.push(table);
        return Promise.resolve({ data: [], error: null, count: 0 }).then(ok, gagal);
      },
      maybeSingle: async () => {
        db.dibaca.push(table);
        return { data: table === "profiles" ? { role: "OWNER", is_active: true } : null, error: null };
      },
    };
    const proxy: unknown = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => proxy) });
    return proxy;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "pengguna-fiktif" } } }) },
    from: builder,
    rpc: async (nama: string) => { db.rpc.push(nama); return { data: [], error: null }; },
  };
} }));
vi.mock("@/lib/ledger", async (asli) => ({ ...await asli<typeof import("@/lib/ledger")>(),
  getAccountBalances: spy.getAccountBalances, getAccountLedger: spy.getAccountLedger, getAccountOpening: spy.getAccountOpening,
  getCashMovements: spy.getCashMovements, getCashLedgerPerAccount: spy.getCashLedgerPerAccount }));
vi.mock("@/lib/buku-pembantu-server", () => ({ mutasiPiutang: spy.mutasiPiutang, mutasiHutang: spy.mutasiHutang }));
vi.mock("@/lib/recurring", () => ({ postRecurringCatchUp: spy.postRecurringCatchUp }));
vi.mock("@/lib/depreciation", async (asli) => ({ ...await asli<typeof import("@/lib/depreciation")>(), catchUpDepreciation: spy.catchUpDepreciation }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: spy.loadRekeningAktif, PilihRekening: () => null }));
vi.mock("@/lib/role-capabilities", () => ({ loadRoleCapabilities: async () => ({ all_branches: true }) }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => true }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, ringkasan, children, siap }: { filter: React.ReactNode; ringkasan: React.ReactNode; children: React.ReactNode; siap: boolean }) =>
    // LaporanPage asli menyisipkan InputTampil sendiri; di sini cukup dipastikan prop `siap` sampai.
    <main data-siap={String(siap)}><form>{filter}</form>{siap ? <>{ringkasan}{children}</> : "BELUM DITAMPILKAN"}</main>,
  KartuAngka: () => <div>RINGKASAN</div>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
vi.mock("@/components/UnduhLaporan", () => ({ UnduhLaporan: () => <span>UNDUH</span> }));
for (const [modul, nama] of [
  ["@/app/(app)/keuangan/jurnal/JurnalForm", "JurnalForm"], ["@/app/(app)/keuangan/jurnal/JurnalCorrectionForm", "JurnalCorrectionForm"],
  ["@/app/(app)/keuangan/rekonsiliasi/BankReconciliationRecovery", "BankReconciliationRecovery"],
  ["@/app/(app)/keuangan/aset/KategoriUmur", "KategoriUmur"], ["@/components/PurchasePaymentForm", "PurchasePaymentForm"],
  ["@/components/PurchaseRequestKey", "PurchaseRecoveryComplete"], ["@/components/PurchaseCorrectionQuickRequest", "PurchaseCorrectionQuickRequest"],
  ["@/components/BackdateCashTable", "BackdateCashTable"],
] as const) vi.doMock(modul, () => ({ [nama]: () => null }));
vi.mock("@/app/(app)/keuangan/rekonsiliasi/RekonForm", () => ({ RekonForm: () => <div>FORM REKON</div> }));
vi.mock("@/components/LocalTransactionDraft", () => ({
  PreservedForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
  TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
}));

type Halaman = (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const muat = async (path: string) => (await import(`@/app/(app)/keuangan/${path}/page`)).default as Halaman;
const render = async (path: string, sp: Record<string, string> = {}) =>
  renderToStaticMarkup(<>{await (await muat(path))({ searchParams: Promise.resolve(sp) })}</>);

const LEDGER = ["getAccountBalances", "getAccountLedger", "getAccountOpening", "getCashMovements", "getCashLedgerPerAccount", "mutasiPiutang", "mutasiHutang"] as const;

// Halaman → tabel berat yang tidak boleh dibaca sebelum Tampilkan, dan pemuat yang wajib jalan setelahnya.
const KASUS: { path: string; tabelBerat: string[]; pemuat: () => boolean; laporanPage?: true }[] = [
  { path: "laba-rugi", tabelBerat: [], pemuat: () => spy.getAccountBalances.mock.calls.length > 0 },
  { path: "neraca", tabelBerat: [], pemuat: () => spy.getAccountBalances.mock.calls.length > 0 },
  { path: "neraca-saldo", tabelBerat: [], pemuat: () => spy.getAccountBalances.mock.calls.length > 0 },
  { path: "laba-ditahan", tabelBerat: ["accounting_locks"], pemuat: () => spy.getAccountLedger.mock.calls.length > 0, laporanPage: true },
  { path: "buku-besar", tabelBerat: [], pemuat: () => spy.getAccountBalances.mock.calls.length > 0 },
  { path: "arus-kas", tabelBerat: [], pemuat: () => spy.getCashMovements.mock.calls.length > 0 },
  { path: "arus-kas/rincian", tabelBerat: [], pemuat: () => spy.getCashLedgerPerAccount.mock.calls.length > 0, laporanPage: true },
  { path: "piutang", tabelBerat: ["invoices", "sales_invoices", "sales_receipts"], pemuat: () => db.dibaca.includes("invoices") },
  { path: "piutang/pembantu", tabelBerat: [], pemuat: () => spy.mutasiPiutang.mock.calls.length > 0, laporanPage: true },
  { path: "hutang", tabelBerat: ["purchase_invoices", "purchase_orders", "purchase_returns", "purchase_advances"], pemuat: () => db.dibaca.includes("purchase_invoices") },
  { path: "hutang/pembantu", tabelBerat: [], pemuat: () => spy.mutasiHutang.mock.calls.length > 0, laporanPage: true },
  { path: "jurnal", tabelBerat: ["journal_entries", "recurring_journals"], pemuat: () => db.dibaca.includes("journal_entries") },
  { path: "rekonsiliasi", tabelBerat: ["cash_accounts", "bank_reconciliations"], pemuat: () => db.dibaca.includes("bank_reconciliations") },
  { path: "aset", tabelBerat: ["fixed_assets", "asset_depreciations"], pemuat: () => db.dibaca.includes("fixed_assets") },
  { path: "kategori-aset", tabelBerat: ["fixed_assets", "asset_categories"], pemuat: () => db.dibaca.includes("asset_categories") },
];

beforeEach(() => {
  db.dibaca = []; db.rpc = [];
  for (const f of Object.values(spy)) f.mockClear();
});

describe.each(KASUS)("A1 gerbang: /keuangan/$path", ({ path, tabelBerat, pemuat, laporanPage }) => {
  it("dibuka tanpa Tampilkan: kosong, form membawa tampil=1, tanpa query berat", async () => {
    const html = await render(path);
    expect(html).toMatch(/belum ditampilkan/i);
    expect(html).toContain(laporanPage ? 'data-siap="false"' : 'name="tampil" value="1"');
    for (const f of LEDGER) expect(spy[f], f).not.toHaveBeenCalled();
    for (const t of tabelBerat) expect(db.dibaca, t).not.toContain(t);
    expect(db.rpc).toEqual([]);
    expect(html).not.toContain("UNDUH");
  });

  it("setelah Tampilkan: data dibaca", async () => {
    const html = await render(path, { tampil: "1" });
    expect(html).not.toMatch(/belum ditampilkan/i);
    expect(pemuat()).toBe(true);
  });
});

it("jurnal: posting jurnal berulang tetap jalan saat halaman dibuka (tidak ikut digerbang)", async () => {
  await render("jurnal");
  expect(spy.postRecurringCatchUp).toHaveBeenCalledTimes(1);
});

it("jurnal: tautan dokumen ke satu jurnal (entry/nomor) langsung tampil", async () => {
  await render("jurnal", { entry: "f5000000-0000-4000-8000-000000000001" });
  expect(db.dibaca).toContain("journal_entries");
  db.dibaca = [];
  await render("jurnal", { nomor: "JRN-202610-0001" });
  expect(db.dibaca).toContain("journal_entries");
});

it("hutang: tautan pembayaran pengganti (replace_payment) langsung tampil", async () => {
  await render("hutang", { replace_payment: "f5000000-0000-4000-8000-000000000009" });
  expect(db.dibaca).toContain("purchase_invoices");
});

it("tautan di dalam laporan yang sudah tampil tetap membawa tampil=1", async () => {
  const akun = [{ id: "a", code: "400001", name: "Pendapatan Fiktif", type: "PENDAPATAN", normal: "K", parent_id: null, is_header: false, debit: 0, credit: 100, saldo: 100 }];
  spy.getAccountBalances.mockResolvedValueOnce(akun as never);
  const bukuBesar = await render("buku-besar", { tampil: "1", dari: "2026-11-01" });
  expect(bukuBesar).toContain('href="/keuangan/buku-besar?dari=2026-11-01&amp;akun=400001&amp;tampil=1"');
  spy.getAccountBalances.mockResolvedValueOnce(akun as never);
  const labaRugi = await render("laba-rugi", { tampil: "1" });
  expect(labaRugi).toContain('href="/keuangan/buku-besar?akun=400001&amp;tampil=1"');
});
