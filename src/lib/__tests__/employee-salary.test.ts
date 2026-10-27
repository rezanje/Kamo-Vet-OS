import { describe, expect, it } from "vitest";
import { bacaGajiPokok, simpanGajiPokok } from "../employee-salary";

function client(rows: { employee_id: string; gaji_pokok: number }[], error: unknown = null) {
  const calls: { ids?: string[]; upsert?: unknown } = {};
  return {
    calls,
    from: (table: string) => {
      expect(table).toBe("employee_base_salaries");
      return {
        select: () => ({ in: async (_: string, ids: string[]) => { calls.ids = [...(calls.ids ?? []), ...ids]; return { data: rows.filter((r) => ids.includes(r.employee_id)), error }; } }),
        upsert: async (row: unknown) => { calls.upsert = row; return { error }; },
      };
    },
  };
}

describe("gaji pokok terpisah dari direktori karyawan", () => {
  it("mengembalikan peta kosong bila RLS tidak memberi baris (ADMIN/STAFF)", async () => {
    const map = await bacaGajiPokok(client([]), ["e1", "e2"]);
    expect(map.size).toBe(0);
  });
  it("membaca gaji per karyawan dalam batch", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `e${i}`);
    const c = client([{ employee_id: "e0", gaji_pokok: 3000000 }, { employee_id: "e449", gaji_pokok: 4000000 }]);
    const map = await bacaGajiPokok(c, ids);
    expect(map.get("e0")).toBe(3000000);
    expect(map.get("e449")).toBe(4000000);
    expect(c.calls.ids).toHaveLength(450);
  });
  it("gagal baca dilaporkan, bukan dianggap nol", async () => {
    await expect(bacaGajiPokok(client([], { message: "denied" }), ["e1"])).rejects.toThrow();
  });
  it("menyimpan gaji lewat upsert dan melaporkan gagal", async () => {
    const ok = client([]);
    expect(await simpanGajiPokok(ok, "e1", 5000000)).toBe(true);
    expect(ok.calls.upsert).toMatchObject({ employee_id: "e1", gaji_pokok: 5000000 });
    expect(await simpanGajiPokok(client([], { message: "denied" }), "e1", 1)).toBe(false);
  });
});
