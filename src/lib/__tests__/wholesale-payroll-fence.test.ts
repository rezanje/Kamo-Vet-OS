import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn(), calculate: vi.fn(), calls: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => ({
  rpc: fixture.rpc,
  from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }), upsert: fixture.upsert }),
}) }));
vi.mock("@/lib/payroll-data", () => ({ akhirBulan: () => "2026-10-31", kumpulkanDataGaji: fixture.calculate }));
import { hitungPenggajian } from "@/app/(app)/hris/penggajian/actions";
beforeEach(() => {
  vi.clearAllMocks(); fixture.calls = [];
  fixture.rpc.mockImplementation(async () => { fixture.calls.push("epoch"); return { data: 7, error: null }; });
  fixture.calculate.mockImplementation(async () => { fixture.calls.push("calculate"); return [{ employeeId: "employee", rincian: { komisi: 55 } }]; });
  fixture.upsert.mockResolvedValue({ error: null });
});
const form = () => { const fd = new FormData(); fd.set("periode", "2026-10"); return fd; };
it("captures the wholesale revision before reading commissions and supplies it with the existing payroll upsert", async () => {
  await expect(hitungPenggajian(form())).rejects.toThrow("success=hitung");
  expect(fixture.calls).toEqual(["epoch", "calculate"]);
  expect(fixture.upsert).toHaveBeenCalledWith([expect.objectContaining({ wholesale_source_epoch: 7, komisi: 55 })], { onConflict: "periode,employee_id" });
});
it("stops before commission calculation when the source revision cannot be read", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(hitungPenggajian(form())).rejects.toThrow("error=unavailable");
  expect(fixture.calculate).not.toHaveBeenCalled(); expect(fixture.upsert).not.toHaveBeenCalled();
});
it("explains unresolved service attribution before any payroll write",async()=>{
 fixture.calculate.mockRejectedValue(Error("SERVICE_ATTRIBUTION_PENDING: Periksa atribusi jasa di Komisi Penjual"));
 await expect(hitungPenggajian(form())).rejects.toThrow("error=Periksa%20atribusi%20jasa%20di%20Komisi%20Penjual");
 expect(fixture.upsert).not.toHaveBeenCalled();
});
