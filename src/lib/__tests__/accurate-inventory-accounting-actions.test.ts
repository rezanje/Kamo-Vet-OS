import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  user: "owner" as string | null,
  profile: { role: "OWNER", is_active: true },
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: fixture.user } : null }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixture.profile, error: null }) }) }) }),
  rpc: fixture.rpc,
}) }));

import { previewInventoryAccounting, postInventoryAccounting } from "@/app/(app)/keuangan/persediaan-awal/actions";
import type { InventoryAccountingReport } from "@/app/(app)/keuangan/persediaan-awal/types";

const report = {
  run_id: "11111111-1111-4111-8111-111111111111", status: "previewed", source_name: "initial.xlsx", source_hash: "hash",
  branch_id: "branch", branch_name: "PDRY", warehouse_id: "warehouse", warehouse_name: "Gudang PDRY", as_of: "2026-09-01",
  selected_rows: 2, excluded_rows: 1, original_qty: 3, original_value: 150000, remaining_value: 0,
  inventory_account: { id: "inventory", code: "170001", name: "Persediaan" },
  equity_account: { id: "22222222-2222-4222-8222-222222222222", code: "410001", name: "Modal" },
  blockers: [], can_post: true, receipt: null,
} satisfies InventoryAccountingReport;

beforeEach(() => { fixture.user = "owner"; fixture.profile = { role: "OWNER", is_active: true }; fixture.rpc.mockReset(); fixture.revalidate.mockReset(); });

it.each([{ role: "ADMIN", is_active: true }, { role: "OWNER", is_active: false }])("rejects an unauthorized actor before requesting a financial preview: %j", async profile => {
  fixture.profile = profile;
  expect((await previewInventoryAccounting(report.run_id, report.equity_account.id)).ok).toBe(false);
  expect(fixture.rpc).not.toHaveBeenCalled();
});

it("returns the canonical database preview, including historical blockers, without writing", async () => {
  const historical = { ...report, status: "posted", can_post: false, blockers: ["Historical repair requires Finance review"] };
  fixture.rpc.mockResolvedValue({ data: historical, error: null });
  expect(await previewInventoryAccounting(report.run_id, report.equity_account.id)).toEqual({ ok: true, report: historical });
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("preview_accurate_inventory_accounting", { p_run_id: report.run_id, p_equity_account_id: report.equity_account.id });
  expect(fixture.revalidate).not.toHaveBeenCalled();
});

it.each([{ confirmed: false, reason: "Reviewed source workbook" }, { confirmed: true, reason: "short" }])("requires explicit confirmation and a meaningful audit reason", async input => {
  expect((await postInventoryAccounting({ report, ...input })).ok).toBe(false);
  expect(fixture.rpc).not.toHaveBeenCalled();
});

it("rejects historical reports before sending any posting request", async () => {
  expect((await postInventoryAccounting({ report: { ...report, status: "posted", can_post: false }, reason: "Reviewed source workbook", confirmed: true })).ok).toBe(false);
  expect(fixture.rpc).not.toHaveBeenCalled();
});

it("posts the exact database evidence when it matches the reviewed report", async () => {
  const receipt = { run_id: report.run_id, journal_id: "journal", amount: 150000 };
  // 16569.4200000000000001 is beyond JavaScript precision; the RPC must receive the database text, not the browser number.
  const exact = JSON.stringify({ ...report, original_qty: 3 }).replace('"original_qty":3', '"original_qty":3.0000000000000000001');
  fixture.rpc.mockResolvedValueOnce({ data: exact, error: null }).mockResolvedValueOnce({ data: receipt, error: null });
  expect(await postInventoryAccounting({ report, reason: "Reviewed source workbook", confirmed: true })).toEqual({ ok: true, receipt });
  expect(fixture.rpc).toHaveBeenNthCalledWith(1, "preview_accurate_inventory_accounting_text", { p_run_id: report.run_id, p_equity_account_id: report.equity_account.id });
  expect(fixture.rpc).toHaveBeenNthCalledWith(2, "post_accurate_inventory_accounting_text", {
    p_run_id: report.run_id, p_equity_account_id: report.equity_account.id, p_expected: exact, p_reason: "Reviewed source workbook",
  });
  expect(fixture.revalidate).toHaveBeenCalledWith("/keuangan/neraca");
});

it("refuses to post when the database evidence differs from the reviewed report", async () => {
  fixture.rpc.mockResolvedValueOnce({ data: JSON.stringify({ ...report, original_value: 150001 }), error: null });
  expect(await postInventoryAccounting({ report, reason: "Reviewed source workbook", confirmed: true })).toEqual({ ok: false, error: "Bukti berubah; tinjau preview ulang" });
  expect(fixture.rpc).toHaveBeenCalledOnce();
});

it("reports uncertain transport failure without silently retrying a financial mutation", async () => {
  fixture.rpc.mockRejectedValue(new Error("Response lost"));
  const result = await postInventoryAccounting({ report, reason: "Reviewed source workbook", confirmed: true });
  expect(result).toEqual({ ok: false, error: "Response lost" });
  expect(fixture.rpc).toHaveBeenCalledOnce();
  expect(fixture.revalidate).not.toHaveBeenCalled();
});
