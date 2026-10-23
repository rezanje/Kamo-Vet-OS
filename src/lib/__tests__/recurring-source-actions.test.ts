import { beforeEach, describe, expect, it, vi } from "vitest";
import { postRecurringSourcePeriod, startRecurringFromJournal } from "../../app/(app)/keuangan/jurnal-berulang/actions";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-owner" } } }) },
  rpc,
}) }));

const SOURCE = "a4000000-0000-4000-8000-000000000001";
const SCHEDULE = "a4000000-0000-4000-8000-000000000002";
const ENTRY = "a4000000-0000-4000-8000-000000000003";
const snapshot = { entry_id: SOURCE, source: "manual", revision: 0, tanggal: "2025-10-17", lines: [] };
function setupForm() {
  const data = new FormData();
  data.set("requestKey", "fiction-key"); data.set("draft_key", "fiction-key"); data.set("draft_scope", `j04-source-${SOURCE}`);
  data.set("source_entry_id", SOURCE); data.set("expected_snapshot", JSON.stringify(snapshot));
  data.set("name", "Fiction amortization"); data.set("first_period", "2026-11"); data.set("day", "25");
  data.set("count", "12"); data.set("end_period", ""); data.set("confirm_source", "1"); data.set("confirm_backdated", "0");
  return data;
}

beforeEach(() => { rpc.mockReset(); });

describe("journal source schedule actions", () => {
  it("confirms creation by the exact saved schedule receipt and retires its draft", async () => {
    rpc.mockResolvedValue({ data: { schedule_id: SCHEDULE, source_id: SOURCE, first_period: "2026-11", last_period: "2027-10", count: 12, mode: "manual" }, error: null });
    await expect(startRecurringFromJournal(setupForm())).rejects.toThrow(
      `REDIRECT:/keuangan/jurnal-berulang/${SCHEDULE}?success=created&draft_done=fiction-key&draft_scope=j04-source-${SOURCE}`,
    );
    expect(rpc).toHaveBeenCalledWith("create_recurring_journal_from_source", expect.objectContaining({
      p_request_key: "fiction-key", p_source_entry_id: SOURCE, p_count: 12,
      p_first_period: "2026-11", p_confirm_source: true,
    }));
  });

  it("recovers a lost create response by the same request key", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network timeout" } })
      .mockResolvedValueOnce({ data: { schedule_id: SCHEDULE, source_id: SOURCE, first_period: "2026-11", last_period: "2027-10", count: 12, mode: "manual" }, error: null });
    await expect(startRecurringFromJournal(setupForm())).rejects.toThrow(`/keuangan/jurnal-berulang/${SCHEDULE}?success=created`);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_recurring_journal_from_source", "get_recurring_journal_source_result",
    ]);
  });

  it("never reports a source-period retry as a new journal", async () => {
    rpc.mockResolvedValue({ data: { schedule_id: SCHEDULE, period: "2026-11", entry_id: ENTRY, posted: false }, error: null });
    const data = new FormData(); data.set("schedule_id", SCHEDULE); data.set("period", "2026-11");
    await expect(postRecurringSourcePeriod(data)).rejects.toThrow(`/keuangan/jurnal-berulang/${SCHEDULE}?replayed=1&entry=${ENTRY}`);
    expect(rpc).toHaveBeenCalledWith("post_recurring_journal_source_period", { p_schedule_id: SCHEDULE, p_period: "2026-11" });
  });

  it("recovers an ambiguous create receipt only when it matches the submitted plan", async () => {
    rpc.mockResolvedValueOnce({ data: { schedule_id: SCHEDULE, source_id: SOURCE, count: 12 }, error: null })
      .mockResolvedValueOnce({ data: { schedule_id: SCHEDULE, source_id: SOURCE, first_period: "2026-11", last_period: "2027-10", count: 12, mode: "manual" }, error: null });
    await expect(startRecurringFromJournal(setupForm())).rejects.toThrow(`/keuangan/jurnal-berulang/${SCHEDULE}?success=created`);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_recurring_journal_from_source", "get_recurring_journal_source_result",
    ]);
  });

  it("retries a timed out period with the same idempotent period key and confirms the old receipt", async () => {
    rpc.mockRejectedValueOnce(new Error("fixture timeout"))
      .mockResolvedValueOnce({ data: { schedule_id: SCHEDULE, period: "2026-11", entry_id: ENTRY, posted: false }, error: null });
    const data = new FormData(); data.set("schedule_id", SCHEDULE); data.set("period", "2026-11");
    await expect(postRecurringSourcePeriod(data)).rejects.toThrow(`/keuangan/jurnal-berulang/${SCHEDULE}?replayed=1&entry=${ENTRY}`);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
});
