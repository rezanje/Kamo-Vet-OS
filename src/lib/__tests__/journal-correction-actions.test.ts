import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { batalkanJurnal, koreksiJurnal } from "@/app/(app)/keuangan/jurnal/actions";

function form() {
  const value = new FormData();
  Object.entries({ entryId: "entry", revision: "3", draft_key: "durable-key", draft_scope: "journal-edit-entry-3",
    requestKey: "obsolete-key", tanggal: "2026-10-20", deskripsi: "Correction", reason: "Wrong date", lines: "[]",
  }).forEach(([key, field]) => value.set(key, field));
  return value;
}
beforeEach(() => fixture.rpc.mockReset());

it("does not acknowledge a correction without both committed journals", async () => {
  fixture.rpc.mockResolvedValue({ data: { reversal_journal_id: "reversal" }, error: null });
  await expect(koreksiJurnal(form())).rejects.toThrow("?error=");
  expect(fixture.rpc).toHaveBeenCalledWith("revise_manual_journal", expect.objectContaining({ p_request_key: "durable-key", p_expected_revision: 3 }));
});

it("keeps the draft on a failed or unconfirmed cancellation", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(batalkanJurnal(form())).rejects.toThrow("?error=");
});

it("retires only the confirmed draft after a committed correction", async () => {
  fixture.rpc.mockResolvedValue({ data: { reversal_journal_id: "reversal", replacement_journal_id: "replacement" }, error: null });
  await expect(koreksiJurnal(form())).rejects.toThrow("draft_done=durable-key&draft_scope=journal-edit-entry-3");
});

it("reports a rejected revision without success acknowledgement", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Jurnal sudah berubah" } });
  await expect(batalkanJurnal(form())).rejects.toThrow("?error=Jurnal%20sudah%20berubah");
});
