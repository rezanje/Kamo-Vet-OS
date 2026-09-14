import { beforeEach, describe, expect, it, vi } from "vitest";
import { jalankanWaEngine } from "../wa-engine";
import { sendWA } from "../fonnte";

vi.mock("../fonnte", () => ({ sendWA: vi.fn(async () => ({ ok: true })) }));

function database() {
  const records: Record<string, unknown> = {
    wa_engine_settings: { is_enabled: true, post_treatment_enabled: true, vaccination_due_enabled: true },
    customers: [{ id: "old", name: "Aldi", phone: "08111111111" }, { id: "new", name: "Andri", phone: "08222222222" }],
    pets: [{ id: "mochi", customer_id: "new", name: "Mochi" }],
    visits: [{ id: "v", customer_id: "old", pet_id: "mochi", branch_id: "b", poli: "Umum", created_at: "2026-09-07T03:00:00Z" }],
    follow_ups: [{ id: "f", customer_id: "old", pet_id: "mochi", branch_id: "b", jenis: "Vaksin", tanggal: "2026-10-14" }],
    sales: [],
  };
  const logs: Record<string, unknown>[] = [];
  return {
    logs,
    from(table: string) {
      let data = records[table] ?? [];
      const query = {
        select: () => query, eq: () => query,
        insert: (value: Record<string, unknown>) => { logs.push(value); data = { id: `log-${logs.length}` }; return query; },
        update: () => query,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return query;
    },
  };
}

describe("reminder setelah transfer kepemilikan", () => {
  beforeEach(() => vi.clearAllMocks());
  it("treatment dan vaksin menuju pemilik sekarang, bukan pemilik pada kunjungan lama", async () => {
    const db = database();
    const result = await jalankanWaEngine(db, new Date("2026-09-14T03:00:00Z"));
    expect(result.sent).toBe(2);
    expect(db.logs.map((row) => row.customer_id)).toEqual(["new", "new"]);
    expect(vi.mocked(sendWA).mock.calls.every(([phone]) => phone === "08222222222")).toBe(true);
  });
});
