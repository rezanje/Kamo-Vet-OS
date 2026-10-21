import { beforeEach, expect, it, vi } from "vitest";
const { guard, from, redirect } = vi.hoisted(() => ({ guard: vi.fn(), from: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(url); }) }));
vi.mock("@/lib/master-guard", () => ({ assertMasterAdmin: guard }));
vi.mock("next/navigation", () => ({ redirect }));
import { tambahRekening } from "@/app/(app)/kas-bank/rekening/actions";
beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ from }); });
it.each(["123.456", "1000000000001", "NaN", "Infinity", "-1"])("rejects invalid opening %s before persisting account records", async amount => {
  const f = new FormData(); f.set("nama", "New bank"); f.set("jenis", "Bank"); f.set("saldo_awal", amount);
  await expect(tambahRekening(f)).rejects.toThrow("error=");
  expect(from).not.toHaveBeenCalled();
});
