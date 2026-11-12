import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Permintaan klinik (12 Nov): pilihan rekening di Kas Masuk/Keluar tidak menampilkan saldo.
const state = vi.hoisted(() => ({ balanceCalls: 0 }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => true }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => { state.balanceCalls++; return [{ code: "110005", saldo: 10_670_000 }]; } }));
vi.mock("@/components/LocalTransactionDraft", () => ({ TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (table: string) => {
    const data = table === "cash_accounts" ? [{ id: "30000000-0000-4000-8000-000000000003", nama: "Kas Toko CIAWI", coa_code: "110005" }] : [];
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data, error: null }) };
    return q;
  },
}) }));

import { KasEntryScreen } from "@/app/(app)/kas-bank/kas/KasEntryScreen";

it.each(["Masuk", "Keluar"] as const)("lists %s cash accounts by name only, without their balance", async (jenis) => {
  state.balanceCalls = 0;
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis, searchParams: Promise.resolve({}) }));
  expect(html).toContain(">Kas Toko CIAWI</option>");
  expect(html).not.toContain("10.670.000");
  expect(state.balanceCalls).toBe(0);
});
