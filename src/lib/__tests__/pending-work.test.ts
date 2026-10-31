import { describe, expect, it, vi } from "vitest";
import { loadPendingWork } from "../pending-work";

const approvals = [
  { id: "one", status: "menunggu", penyetuju_role: "FINANCE" },
  { id: "two", status: "menunggu", penyetuju_role: "ADMIN" },
  { id: "three", status: "disetujui", penyetuju_role: "FINANCE" },
];
const orders = [{ id: "draft", status: "draft" }, { id: "paid", status: "dibayar" }];
const corrections = [{ id: "c1", status: "pending" }, { id: "c2", status: "pending" }, { id: "c3", status: "selesai" }];

type RefundRpc = "get_sales_refund_requests" | "get_clinic_refund_requests";
const defaultRefunds: Record<RefundRpc, Record<string, unknown[]>> = {
  get_sales_refund_requests: { pending: [{ id: "refund" }] },
  get_clinic_refund_requests: {},
};

function fixture(roleModules: { role: string; module_id: string }[] = [], rulesError: unknown = null,
  refunds: Record<RefundRpc, Record<string, unknown[]> | { error: unknown }> = defaultRefunds) {
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
          const rows = (table === "approval_requests" ? approvals : table === "purchase_correction_requests" ? corrections : orders)
            .filter(row => filters.every(([column, value]) => row[column as keyof typeof row] === value));
          return Promise.resolve({ count: rows.length, error: null }).then(resolve);
        },
      };
      return query;
    }),
    rpc: vi.fn(async (name: RefundRpc, args: { p_status: string }) => {
      const queue = refunds[name];
      if ("error" in queue) return { data: null, error: queue.error };
      return { data: queue[args.p_status] ?? [], error: null };
    }),
  };
  return db;
}

describe("pending action alerts", () => {
  it("shows owner all approvals and the separate purchase/refund queues", async () => {
    const db = fixture();
    expect(await loadPendingWork(db, "OWNER")).toEqual([
      { label: "Pengajuan menunggu persetujuan", href: "/pengaturan/penyetuju", count: 2 },
      { label: "Perintah bayar menunggu persetujuan", href: "/pembelian/perintah-bayar?pending=1", count: 1 },
      { label: "Permintaan koreksi pembelian", href: "/pembelian/koreksi", count: 2 },
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
    expect(items.some(item => item.href === "/pembelian/koreksi")).toBe(false);
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

  it("keeps the unknown fallback within the role's default pages", async () => {
    expect(await loadPendingWork(fixture([], { message: "offline" }), "FINANCE"))
      .toEqual([{ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: null }]);
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

  it("keeps purchase correction requests in the Super Admin queue only", async () => {
    for (const role of ["ADMIN", "FINANCE"]) {
      const db = fixture();
      expect((await loadPendingWork(db, role)).some(item => item.href === "/pembelian/koreksi")).toBe(false);
      expect(db.from).not.toHaveBeenCalledWith("purchase_correction_requests");
    }
  });

  it("shows a failed correction-request read as unknown for Super Admin", async () => {
    const db = fixture();
    const from = db.from.getMockImplementation()!;
    db.from.mockImplementation((table: string) => table === "purchase_correction_requests"
      ? { select: () => ({ eq: () => Promise.resolve({ count: null, error: { message: "offline" } }) }) } as never
      : from(table));
    expect((await loadPendingWork(db, "OWNER")).find(item => item.href === "/pembelian/koreksi")?.count).toBeNull();
  });

  it("counts clinic transfer refunds (J03) that share the finance refund queue", async () => {
    const db = fixture([], null, {
      get_sales_refund_requests: {},
      get_clinic_refund_requests: { pending: [{ id: "k1" }], diproses: [{ id: "k2" }] },
    });
    expect(await loadPendingWork(db, "FINANCE"))
      .toEqual([{ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 2, hasMore: false }]);
    for (const status of ["pending", "diproses"]) {
      expect(db.rpc).toHaveBeenCalledWith("get_clinic_refund_requests", { p_invoice: null, p_office: true, p_status: status, p_offset: 0 });
      expect(db.rpc).toHaveBeenCalledWith("get_sales_refund_requests", { p_sale_id: null, p_office: true, p_status: status, p_offset: 0 });
    }
  });

  it("adds petshop and clinic refunds together and flags a full clinic page", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}` }));
    const db = fixture([], null, { get_sales_refund_requests: { pending: [{ id: "p" }] }, get_clinic_refund_requests: { pending: page } });
    expect((await loadPendingWork(db, "OWNER")).find(item => item.href === "/kas-bank/refund"))
      .toEqual({ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 101, hasMore: true });
  });

  it("does not query clinic refunds for roles or Akses Grup that cannot open the refund queue", async () => {
    const staff = fixture();
    await loadPendingWork(staff, "STAFF");
    expect(staff.rpc).not.toHaveBeenCalled();
    const admin = fixture([{ role: "ADMIN", module_id: "pembelian" }]);
    await loadPendingWork(admin, "ADMIN");
    expect(admin.rpc).not.toHaveBeenCalledWith("get_clinic_refund_requests", expect.anything());
  });

  it("shows the refund alert as unknown when the clinic queue read fails", async () => {
    const db = fixture([], null, { get_sales_refund_requests: {}, get_clinic_refund_requests: { error: { code: "42501", message: "denied" } } });
    expect((await loadPendingWork(db, "FINANCE")).find(item => item.href === "/kas-bank/refund")?.count).toBeNull();
  });

  it("keeps petshop refunds countable before the clinic refund database step exists, like the queue page", async () => {
    const db = fixture([], null, { get_sales_refund_requests: { pending: [{ id: "p" }] }, get_clinic_refund_requests: { error: { code: "PGRST202", message: "missing" } } });
    expect((await loadPendingWork(db, "FINANCE")).find(item => item.href === "/kas-bank/refund")?.count).toBe(1);
  });
});
