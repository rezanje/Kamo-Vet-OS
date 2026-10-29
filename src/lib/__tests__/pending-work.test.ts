import { describe, expect, it, vi } from "vitest";
import { loadPendingWork } from "../pending-work";

const approvals = [
  { id: "one", status: "menunggu", penyetuju_role: "FINANCE" },
  { id: "two", status: "menunggu", penyetuju_role: "ADMIN" },
  { id: "three", status: "disetujui", penyetuju_role: "FINANCE" },
];
const orders = [{ id: "draft", status: "draft" }, { id: "paid", status: "dibayar" }];
const corrections = [{ id: "c1", status: "pending" }, { id: "c2", status: "pending" }, { id: "c3", status: "selesai" }];

function fixture(roleModules: { role: string; module_id: string }[] = [], rulesError: unknown = null,
  clinicRequests: { id: string; status: string }[] = []) {
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
    rpc: vi.fn(async (name: string, args: { p_status: string }) => ({
      data: name === "get_sales_refund_requests" ? (args.p_status === "pending" ? [{ id: "refund" }] : [])
        : name === "get_clinic_refund_requests" ? clinicRequests.filter(row => row.status === args.p_status) : null,
      error: name === "get_sales_refund_requests" || name === "get_clinic_refund_requests" ? null : { message: "unknown rpc" },
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

  it("A02: counts pending and in-process clinic transfer refunds in the same refund alert", async () => {
    // Fictional queue: one petshop pending (fixture) + clinic pending, in process, and finished/cancelled.
    const db = fixture([], null, [
      { id: "rk-1", status: "pending" }, { id: "rk-2", status: "diproses" },
      { id: "rk-3", status: "selesai" }, { id: "rk-4", status: "batal" },
    ]);
    expect((await loadPendingWork(db, "FINANCE")).find(item => item.href === "/kas-bank/refund"))
      .toEqual({ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 3, hasMore: false });
    for (const status of ["pending", "diproses"]) {
      expect(db.rpc).toHaveBeenCalledWith("get_clinic_refund_requests", { p_invoice: null, p_office: true, p_status: status, p_offset: 0 });
    }
  });

  it("A02: shows the alert for clinic-only transfer refunds and flags a full first page", async () => {
    const db = fixture();
    db.rpc.mockImplementation(async (name: string, args: { p_status: string }) => ({
      data: name === "get_clinic_refund_requests" && args.p_status === "diproses" ? Array.from({ length: 100 }, (_, i) => ({ id: `rk-${i}` })) : [],
      error: null,
    }));
    expect((await loadPendingWork(db, "OWNER")).find(item => item.href === "/kas-bank/refund"))
      .toEqual({ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: 100, hasMore: true });
  });

  it("A02: shows the refund alert as unknown when the clinic queue cannot be read", async () => {
    const db = fixture();
    const rpc = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name: string, args: { p_status: string }) => name === "get_clinic_refund_requests"
      ? { data: null, error: { message: "denied" } } : rpc(name, args));
    expect((await loadPendingWork(db, "FINANCE")).find(item => item.href === "/kas-bank/refund")?.count).toBeNull();
  });

  it("A02: does not read the clinic refund queue when the role cannot open it", async () => {
    const db = fixture([{ role: "ADMIN", module_id: "pembelian" }], null, [{ id: "rk-1", status: "pending" }]);
    expect((await loadPendingWork(db, "ADMIN")).some(item => item.href === "/kas-bank/refund")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalledWith("get_clinic_refund_requests", expect.anything());
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
});
