import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Review PR #570 MINOR-4: daftar pengeluaran menandai baris bertanggal mundur, dan pengeluaran mundur tidak tenggelam
// di bawah baris hari ini (daftar kasir/beban dulu diurut menurut tanggal pengeluaran, bukan waktu input).
const state = vi.hoisted(() => ({ calls: [] as { table: string; op: string; args: unknown[] }[], expenses: [] as unknown[], jejak: [] as unknown[], jejakError: false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit", "gte", "lte", "in"]) q[op] = (...args: unknown[]) => { state.calls.push({ table, op, args }); return q; };
      q.then = (resolve: (v: unknown) => void) => {
        if (table === "expense_backdates" && state.jejakError) return resolve({ data: null, error: { message: "denied" } });
        resolve({ data: table === "expenses" ? state.expenses : table === "expense_backdates" ? state.jejak : [], error: null });
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift-1", branch_id: "b1", branchName: "Cabang Uji" }) }));
vi.mock("@/lib/tanggal", async (orig) => ({ ...(await orig<object>()), hariIniWIB: () => "2026-11-26" }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(u); }, useRouter: () => ({}), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => null }));
vi.mock("@/components/TransactionDraft", () => ({ TransactionDraft: () => null, clearTransactionDraft: () => {}, transactionDraftName: () => "x" }));
vi.mock("@/app/(app)/pos/expense/actions", () => ({ periksaExpense: vi.fn(), simpanExpense: vi.fn(), ubahExpense: vi.fn(), batalkanExpense: vi.fn() }));
vi.mock("./actions", () => ({ simpanPengeluaranKasir: vi.fn() }));
vi.mock("@/app/kasir/pengeluaran/actions", () => ({ simpanPengeluaranKasir: vi.fn() }));

import PengeluaranKasirPage from "@/app/kasir/pengeluaran/page";

const row = (id: string, tanggal: string) => ({ id, tanggal, kategori: "Operasional", deskripsi: `baris ${id}`, jumlah: 10000, metode_bayar: "Tunai" });
beforeEach(() => { state.calls = []; state.expenses = []; state.jejak = []; state.jejakError = false; });

it("kasir: daftar diurut menurut waktu INPUT terbaru dan baris bertanggal mundur diberi lencana + alasan", async () => {
  state.expenses = [row("e-hari-ini", "2026-11-26"), row("e-mundur", "2026-11-20")];
  state.jejak = [{ expense_id: "e-mundur", effective_date: "2026-11-20", reason: "nota bensin terlupa", recorded_at: "2026-11-26T03:00:00Z" }];
  const html = renderToStaticMarkup(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) }));
  const daftar = state.calls.filter((c) => c.table === "expenses" && c.op === "order");
  expect(daftar).toContainEqual({ table: "expenses", op: "order", args: ["created_at", { ascending: false }] });
  expect(daftar.some((c) => c.args[0] === "tanggal")).toBe(false);
  expect(html).toContain("nota bensin terlupa");
  expect(html.match(/data-testid="lencana-mundur"/g)).toHaveLength(1);
  expect(state.calls).toContainEqual({ table: "expense_backdates", op: "in", args: ["expense_id", ["e-hari-ini", "e-mundur"]] });
});
it("kasir: jejak tak terbaca (RLS/galat) tidak menjatuhkan halaman, hanya lencana yang hilang", async () => {
  state.expenses = [row("e-mundur", "2026-11-20")]; state.jejakError = true;
  const html = renderToStaticMarkup(await PengeluaranKasirPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("baris e-mundur"); expect(html).not.toContain("lencana-mundur");
});
