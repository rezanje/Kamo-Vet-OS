import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Permintaan klinik 12 Nov 2026: Admin & Finance boleh edit Kas Masuk/Keluar dan mengelola lampirannya.
const ENTRY = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ role: "ADMIN", assertCalls: [] as unknown[][], entry: true }));
vi.mock("@/lib/master-guard", () => ({
  bolehTransaksiKas: async () => ["OWNER", "ADMIN", "FINANCE"].includes(state.role),
  assertRole: async (...args: unknown[]) => { state.assertCalls.push(args); return client(); },
}));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => [] }));
vi.mock("@/components/LocalTransactionDraft", async (importOriginal) => ({ ...(await importOriginal<object>()), TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => null }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: (p: { modul: string; refId: string; kembali: string }) => <div data-panel={`${p.modul}|${p.refId}|${p.kembali}`} /> }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<object>()), useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {}, push() {}, refresh() {} }), usePathname: () => "/kas-bank/kas-keluar", notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from: (table: string) => {
      const row = { id: ENTRY, no_bukti: "KK.2026.11.00001", tanggal: "2026-11-12", jumlah: 50000, lawan_code: "610001", account_id: "20000000-0000-4000-8000-000000000002", revision: 0, keterangan: "Galon", voided_at: null, rekening: { nama: "Kas Toko CIAWI" }, branches: null };
      const transfer = { no_transfer: "TF.2026.11.00001", tanggal: "2026-11-12", jumlah: 1000, voided_at: null, from: { nama: "Shopee Bogor" }, to: { nama: "Bank BCA Toko" } };
      const data = table === "cash_entries" ? [row] : table === "cash_accounts" ? [{ id: row.account_id, nama: "Kas Toko CIAWI", coa_code: "110005" }] : [];
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: true } : table === "cash_transfers" ? transfer : table === "cash_entries" && state.entry ? row : null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data, error: null }) };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));

import { KasEntryScreen } from "@/app/(app)/kas-bank/kas/KasEntryScreen";
import { LampiranKasScreen } from "@/app/(app)/kas-bank/kas/LampiranKasScreen";

beforeEach(() => { state.role = "ADMIN"; state.assertCalls = []; state.entry = true; });

it.each(["ADMIN", "FINANCE", "OWNER"])("offers %s the edit form and the attachment page for a cash entry", async (role) => {
  state.role = role;
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis: "Keluar", searchParams: Promise.resolve({}) }));
  expect(html).toContain("Edit / koreksi");
  expect(html).toContain('name="tanggal"');
  expect(html).toContain(`href="/kas-bank/kas-keluar/lampiran/${ENTRY}"`);
});

it("opens the attachment page of a Kas Masuk entry for Admin with the shared cash module", async () => {
  const html = renderToStaticMarkup(await LampiranKasScreen({ jenis: "Masuk", params: Promise.resolve({ id: ENTRY }) }));
  expect(state.assertCalls[0]).toEqual(["/kas-bank/kas-masuk", "lampiran", ["OWNER", "ADMIN", "FINANCE"]]);
  expect(html).toContain("KK.2026.11.00001");
  expect(html).toContain(`data-panel="pengeluaran|${ENTRY}|/kas-bank/kas-masuk/lampiran/${ENTRY}"`);
});

it("refuses malformed or unknown documents on the attachment page", async () => {
  await expect(LampiranKasScreen({ jenis: "Keluar", params: Promise.resolve({ id: "../x" }) })).rejects.toThrow("NOT_FOUND");
  state.entry = false;
  await expect(LampiranKasScreen({ jenis: "Keluar", params: Promise.resolve({ id: ENTRY }) })).rejects.toThrow("NOT_FOUND");
});

it("keeps transfer attachments in their own module", async () => {
  const html = renderToStaticMarkup(await LampiranKasScreen({ jenis: "Transfer", params: Promise.resolve({ id: ENTRY }) }));
  expect(state.assertCalls[0]).toEqual(["/kas-bank/transfer", "lampiran", ["OWNER", "ADMIN", "FINANCE"]]);
  expect(html).toContain(`data-panel="transfer|${ENTRY}|/kas-bank/transfer/lampiran/${ENTRY}"`);
});
