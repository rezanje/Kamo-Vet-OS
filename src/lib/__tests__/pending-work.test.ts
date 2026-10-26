import { describe, expect, it, vi } from "vitest";
import { loadPendingWork } from "../pending-work";

const approvals = [
  { id: "one", status: "menunggu", penyetuju_role: "FINANCE" },
  { id: "two", status: "menunggu", penyetuju_role: "ADMIN" },
  { id: "three", status: "disetujui", penyetuju_role: "FINANCE" },
];
const orders = [{ id: "draft", status: "draft" }, { id: "paid", status: "dibayar" }];

function fixture() {
  const db = {
    from: vi.fn((table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: (_columns: string, options: { count: string; head: boolean }) => { expect(options).toEqual({ count: "exact", head: true }); return query; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        then: (resolve: (value: unknown) => unknown) => {
          const rows = (table === "approval_requests" ? approvals : orders)
            .filter(row => filters.every(([column, value]) => row[column as keyof typeof row] === value));
          return Promise.resolve({ count: rows.length, error: null }).then(resolve);
        },
      };
      return query;
    }),
    rpc: vi.fn(async (_name: string, args: { p_status: string }) => ({
      data: args.p_status === "pending" ? [{ id: "refund" }] : [], error: null,
    })),
  };
  return db;
}

describe("pending action alerts", () => {
  it("shows owner all approvals and the separate purchase/refund queues", async () => {
    const db = fixture();
    expect(await loadPendingWork(db, "OWNER")).toEqual([
      { label: "Pengajuan menunggu persetujuan", href: "/pengaturan/penyetuju", count: 2 },
      { label: "Perintah bayar menunggu persetujuan", href: "/pembelian/perintah-bayar?pending=1", count: 1 },
      { label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 1, hasMore: false },
    ]);
    expect(db.rpc).toHaveBeenCalledWith("get_sales_refund_requests", expect.objectContaining({ p_office: true, p_status: "pending" }));
  });

  it("scopes finance approvals to its role and does not show owner-only payment orders", async () => {
    const db = fixture();
    const items = await loadPendingWork(db, "FINANCE");
    expect(items.map(item => item.count)).toEqual([1, 1]);
    expect(items.some(item => item.href.includes("perintah-bayar"))).toBe(false);
  });

  it("does not query privileged queues for staff", async () => {
    const db = fixture();
    expect(await loadPendingWork(db, "STAFF")).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("shows a failed queue read as unknown rather than empty", async () => {
    const db = fixture();
    db.rpc.mockRejectedValueOnce(new Error("offline"));
    const items = await loadPendingWork(db, "FINANCE");
    expect(items.find(item => item.href === "/kas-bank/refund")?.count).toBeNull();
  });
});
