import { describe, expect, it, vi } from "vitest";
import { loadPendingWork } from "../pending-work";

const approvals = [
  { id: "one", status: "menunggu", penyetuju_role: "FINANCE" },
  { id: "two", status: "menunggu", penyetuju_role: "ADMIN" },
  { id: "three", status: "disetujui", penyetuju_role: "FINANCE" },
];
const orders = [{ id: "draft", status: "draft" }, { id: "paid", status: "dibayar" }];

function fixture(roleModules: { role: string; module_id: string }[] = [], rulesError: unknown = null) {
  const db = {
    from: vi.fn((table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: (_columns: string, options?: { count: string; head: boolean }) => {
          if (table !== "role_modules") expect(options).toEqual({ count: "exact", head: true });
          return query;
        },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === "role_modules") return Promise.resolve({
            data: rulesError ? null : roleModules.filter(row => filters.every(([column, value]) => row[column as keyof typeof row] === value)),
            error: rulesError,
          }).then(resolve);
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

  it("does not link default FINANCE to approval or payment-order pages it cannot open", async () => {
    const db = fixture();
    const items = await loadPendingWork(db, "FINANCE");
    expect(items).toEqual([{ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 1, hasMore: false }]);
    expect(db.from).not.toHaveBeenCalledWith("approval_requests");
  });

  it("scopes approvals to FINANCE only when Akses Grup lets FINANCE open the approval page", async () => {
    const db = fixture([{ role: "FINANCE", module_id: "pengaturan" }, { role: "FINANCE", module_id: "kas-bank" }]);
    const items = await loadPendingWork(db, "FINANCE");
    expect(items.map(item => [item.href, item.count])).toEqual([["/pengaturan/penyetuju", 1], ["/kas-bank/refund", 1]]);
    expect(items.some(item => item.href.includes("perintah-bayar"))).toBe(false);
  });

  it("follows Akses Grup removals for ADMIN instead of showing dead links", async () => {
    const db = fixture([{ role: "ADMIN", module_id: "pembelian" }]);
    const items = await loadPendingWork(db, "ADMIN");
    expect(items.map(item => item.href)).toEqual(["/pembelian/perintah-bayar?pending=1"]);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalledWith("approval_requests");
  });

  it("shows queues as unknown when Akses Grup cannot be read", async () => {
    const items = await loadPendingWork(fixture([], { message: "offline" }), "OWNER");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.count === null)).toBe(true);
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
