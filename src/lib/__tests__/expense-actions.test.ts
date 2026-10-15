import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: fixture.rpc, from: fixture.from,
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
}) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => undefined }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => "1101" }));
vi.mock("@/lib/transaction-draft-ack", async importOriginal => ({
  ...await importOriginal<object>(), assertDraftJournal: async () => undefined,
}));

import { simpanPengeluaranKasir } from "@/app/kasir/pengeluaran/actions";
import { simpanExpense } from "@/app/(app)/pos/expense/actions";

function form() {
  const data = new FormData();
  Object.entries({ branchId: "tampered-branch", tanggal: "2026-10-15", kategori: "Operasional", jumlah: "25000",
    metode_bayar: "Tunai", request_key: "retry-identity", draft_key: "retry-identity", draft_scope: "cashier-expense:shift",
    lampiran: JSON.stringify([{ path: "pengeluaran/proof.jpg", nama: "proof.jpg" }]),
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.rpc.mockResolvedValue({ data: { expense_id: "expense", journal_id: "journal" }, error: null });
  const query = { select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    single: async () => ({ data: { id: "expense" }, error: null }),
    maybeSingle: async () => ({ data: { id: "shift", branch_id: "real-branch" }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
  };
  fixture.from.mockReturnValue(query);
});

it("saves cashier expense, attachments and journal atomically under one retry identity without accepting a client branch", async () => {
  await expect(simpanPengeluaranKasir(form())).rejects.toThrow("draft_done=retry-identity");
  expect(fixture.rpc).toHaveBeenCalledWith("post_expense_atomic", expect.objectContaining({
    p_request_key: "retry-identity", p_context: "cashier", p_branch_id: null,
    p_expense: expect.objectContaining({ jumlah: 25000 }), p_attachments: expect.arrayContaining([expect.objectContaining({ path: "pengeluaran/proof.jpg" })]),
  }));
  expect(fixture.from).not.toHaveBeenCalledWith("expenses");
});

it("makes backoffice entry use the same atomic expense workflow", async () => {
  await expect(simpanExpense(form())).rejects.toThrow("draft_done=retry-identity");
  expect(fixture.rpc).toHaveBeenCalledWith("post_expense_atomic", expect.objectContaining({ p_context: "backoffice", p_branch_id: "tampered-branch" }));
});

it("rejects an expense without a durable request identity before saving", async () => {
  const data = form(); data.delete("request_key");
  await expect(simpanPengeluaranKasir(data)).rejects.toThrow("Identitas");
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(fixture.from).not.toHaveBeenCalledWith("expenses");
});

it("keeps the draft unacknowledged on an atomic posting failure", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Periode akuntansi sudah ditutup" } });
  await expect(simpanPengeluaranKasir(form())).rejects.toThrow("Periode akuntansi sudah ditutup");
});

it("never acknowledges an incomplete journal confirmation", async () => {
  fixture.rpc.mockResolvedValue({ data: { expense_id: "expense" }, error: null });
  await expect(simpanPengeluaranKasir(form())).rejects.toThrow("belum terkonfirmasi lengkap");
});

it.each(["NaN", "Infinity", "-1", "0"])("rejects invalid expense amount %s before posting", async value => {
  const data = form(); data.set("jumlah", value);
  await expect(simpanPengeluaranKasir(data)).rejects.toThrow("Jumlah");
  expect(fixture.rpc).not.toHaveBeenCalled();
});
