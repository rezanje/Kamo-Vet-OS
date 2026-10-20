import { describe, expect, it, vi } from "vitest";
import { postJournal } from "../posting";
vi.mock("../posting", () => ({ postJournal: vi.fn().mockResolvedValue(undefined) }));
import { runDepreciationPeriod } from "../depreciation";

const client = (data: string | null, error: object | null = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
  from: vi.fn(),
});

describe("depreciation after operational reset", () => {
  it("keeps cleared historical periods empty before reading or writing assets", async () => {
    const supabase = client("2026-10-21");
    expect(await runDepreciationPeriod(supabase, "2026-09", "2026-11-02")).toEqual({ periode: "2026-09", total: 0, jumlahAset: 0 });
    expect(supabase.rpc).toHaveBeenCalledWith("operational_reset_cutoff");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not recreate old entries if the reset boundary cannot be checked", async () => {
    const supabase = client(null, { message: "unavailable" });
    await expect(runDepreciationPeriod(supabase, "2026-09", "2026-11-02")).rejects.toThrow("Penyusutan belum dijalankan");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("posts a populated asset in the next completed period with the ordinary balanced amounts", async () => {
    const supabase = client("2026-10-21");
    const insert = vi.fn().mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table: string) => table === "fixed_assets"
      ? { select: () => ({ eq: async () => ({ data: [{ id: "asset", nama: "Fictional asset", tanggal_perolehan: "2026-01-01", harga_perolehan: 12000, nilai_sisa: 0, umur_bulan: 12, asset_categories: null }] }) }) }
      : { select: async () => ({ data: [] }), insert });
    expect(await runDepreciationPeriod(supabase, "2026-11", "2026-12-02")).toEqual({ periode: "2026-11", total: 1000, jumlahAset: 1 });
    expect(insert).toHaveBeenCalledWith({ asset_id: "asset", periode: "2026-11", amount: 1000 });
    expect(postJournal).toHaveBeenCalledWith(supabase, expect.objectContaining({ source: "depreciation", sourceRef: "2026-11", lines: [{ code: "5601", debit: 1000, credit: 0 }, { code: "1509", debit: 0, credit: 1000 }] }));
  });

  it("allows the first completed month after reset to follow the ordinary posting path", async () => {
    const supabase = client("2026-10-21");
    supabase.from.mockImplementation((table: string) => table === "fixed_assets"
      ? { select: () => ({ eq: async () => ({ data: [] }) }) }
      : { select: async () => ({ data: [] }) });
    expect(await runDepreciationPeriod(supabase, "2026-11", "2026-12-02")).toEqual({ periode: "2026-11", total: 0, jumlahAset: 0 });
    expect(supabase.from).toHaveBeenCalledWith("fixed_assets");
  });
});
