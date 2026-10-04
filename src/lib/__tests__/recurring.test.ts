import { afterEach, describe, expect, it, vi } from "vitest";
import { idRecurringDariRef, periodeTertinggal, postRecurringCatchUp } from "../recurring";

const JUL = new Date(2026, 6, 23); // 2026-07

describe("periodeTertinggal", () => {
  it("belum pernah posting -> bulan berjalan saja", () => {
    expect(periodeTertinggal(null, JUL)).toEqual(["2026-07"]);
  });
  it("tertinggal 2 bulan -> catch-up berurutan", () => {
    expect(periodeTertinggal("2026-05", JUL)).toEqual(["2026-06", "2026-07"]);
  });
  it("sudah bulan ini -> kosong", () => {
    expect(periodeTertinggal("2026-07", JUL)).toEqual([]);
  });
  it("lintas tahun", () => {
    expect(periodeTertinggal("2025-11", new Date(2026, 0, 5))).toEqual(["2025-12", "2026-01"]);
  });

  // Tanggal jatuhnya jurnal belum lewat -> bulan berjalan belum boleh diposting,
  // kalau tidak jurnalnya bertanggal masa depan.
  it("tanggal jatuh tempo belum lewat -> bulan berjalan dilewati", () => {
    expect(periodeTertinggal("2026-06", JUL, 25)).toEqual([]);
    expect(periodeTertinggal("2026-05", JUL, 25)).toEqual(["2026-06"]);
  });
  it("tanggal jatuh tempo sudah lewat -> bulan berjalan ikut", () => {
    expect(periodeTertinggal("2026-05", JUL, 23)).toEqual(["2026-06", "2026-07"]);
    expect(periodeTertinggal("2026-05", JUL, 10)).toEqual(["2026-06", "2026-07"]);
  });
  it("belum pernah posting + tanggal belum lewat -> kosong", () => {
    expect(periodeTertinggal(null, JUL, 25)).toEqual([]);
  });
});

const ID = "abc00000-0000-4000-8000-000000000001";
const OTHER = "abc00000-0000-4000-8000-000000000002";

function database(lastPosted = "2026-06") {
  const schedule = { id: ID, nama: "Sewa fiktif", day_of_month: 1, last_posted: lastPosted };
  const rpc = vi.fn(async () => ({ data: [{ entry_id: "journal", no_jurnal: "JRN-202607-0001", posted: true }], error: null }));
  const query = (table: string) => {
    const result = { data: table === "recurring_journals" ? [schedule] : [], error: null };
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, update: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { rpc, from: query };
}

afterEach(() => vi.useRealTimers());

describe("atomic recurring catch-up", () => {
  it("posts each overdue month through the transaction RPC", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-03T03:00:00Z"));
    const db = database();
    expect(await postRecurringCatchUp(db)).toEqual([
      { nama: "Sewa fiktif", periode: "2026-07" },
      { nama: "Sewa fiktif", periode: "2026-08" },
    ]);
    expect(db.rpc.mock.calls).toEqual([
      ["post_recurring_journal_period", { p_recurring_id: ID, p_periode: "2026-07" }],
      ["post_recurring_journal_period", { p_recurring_id: ID, p_periode: "2026-08" }],
    ]);
  });

  it("does not report an idempotent replay as another new journal", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-03T03:00:00Z"));
    const db = database();
    db.rpc.mockResolvedValue({ data: [{ entry_id: "existing", no_jurnal: "JRN-202607-0001", posted: false }], error: null });
    expect(await postRecurringCatchUp(db)).toEqual([]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("stops and surfaces a failed month so month-end cannot close over missing entries", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-03T03:00:00Z"));
    const db = database();
    db.rpc.mockResolvedValue({ data: null, error: { message: "Jurnal lama tidak lengkap" } } as never);
    await expect(postRecurringCatchUp(db)).rejects.toThrow("Jurnal lama tidak lengkap");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("checks the historical marker when no further month is due", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-03T03:00:00Z"));
    const db = database("2026-07");
    db.rpc.mockResolvedValue({ data: null, error: { message: "RECURRING_HISTORY: jurnal lama tidak lengkap" } } as never);
    await expect(postRecurringCatchUp(db)).rejects.toThrow("jurnal lama tidak lengkap");
    expect(db.rpc).toHaveBeenCalledWith("post_recurring_journal_period", { p_recurring_id: ID, p_periode: "2026-07" });
  });

  it("surfaces an unreadable schedule instead of treating it as no work", async () => {
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "Koneksi gagal" } }) }) }) };
    await expect(postRecurringCatchUp(db)).rejects.toThrow("Koneksi gagal");
  });

  it("skips an inaccessible schedule without treating it as posted", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-03T03:00:00Z"));
    const db = database();
    db.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "RECURRING_SCOPE: Cabang jurnal berulang tidak dapat diakses." } } as never);
    expect(await postRecurringCatchUp(db)).toEqual([]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("uses the WIB due day even while the server is still on yesterday", () => {
    expect(periodeTertinggal("2026-06", new Date("2026-07-24T17:01:00Z"), 25)).toEqual(["2026-07"]);
  });

  it("keeps catch-up capped at twelve months", () => {
    const result = periodeTertinggal("2024-12", new Date("2026-07-23T03:00:00Z"));
    expect(result).toHaveLength(12);
    expect(result[0]).toBe("2025-01");
    expect(result[11]).toBe("2025-12");
  });
});

describe("recurring history identity", () => {
  it("keeps full UUID references distinct when their old short prefixes collide", () => {
    expect(idRecurringDariRef(`${ID}:2026-07`, [ID, OTHER])).toBe(ID);
    expect(idRecurringDariRef(`${OTHER}:2026-07`, [ID, OTHER])).toBe(OTHER);
  });
  it("recognizes unambiguous historic source refs but never assigns ambiguous ones", () => {
    expect(idRecurringDariRef("abc00000-2026-07", [ID])).toBe(ID);
    expect(idRecurringDariRef("abc00000-2026-07", [ID, OTHER])).toBeNull();
    expect(idRecurringDariRef("unrelated", [ID])).toBeNull();
  });
});
