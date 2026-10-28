import { beforeEach, expect, it, vi } from "vitest";

// U07: the inpatient daily-log save starts its independent reads together, still fails
// closed on every `{ error }` result or thrown read, and no longer re-renders the form.
const fx = vi.hoisted(() => ({
  started: [] as string[], rpcCalls: [] as string[],
  stayGate: null as Promise<void> | null,
  errorOn: "" as string, throwOn: "" as string,
  rec: { condition_status: "stabil", visit_id: "visit", medical_record_id: null as string | null } as Record<string, unknown> | null,
  role: "DOCTOR",
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("@/lib/inpatient-stay", async () => ({
  ...await vi.importActual<typeof import("../inpatient-stay")>("../inpatient-stay"),
  readStayTypesChecked: async () => {
    fx.started.push("stay");
    if (fx.stayGate) await fx.stayGate;
    if (fx.throwOn === "stay") throw new Error("stay transport failure");
    return { types: new Map([["stay", "sakit"]]), failed: fx.errorOn === "stay" };
  },
}));
vi.mock("@/lib/satuan", async () => ({
  ...await vi.importActual<typeof import("../satuan")>("../satuan"),
  loadUnitOptions: async () => {
    fx.started.push("units");
    if (fx.throwOn === "units") throw new Error("Ada barang yang tidak aktif atau tidak ditemukan. Pilih lagi dari master.");
    return new Map([["drug", [{ unit: "tab", factor: 1, sell_price: 1, buy_price: 0 }]]]);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => {
    fx.started.push("user");
    if (fx.throwOn === "user") throw new Error("auth transport failure");
    return { data: { user: { id: "actor" } } };
  } },
  rpc: async (name: string) => {
    fx.started.push(name); fx.rpcCalls.push(name);
    if (fx.throwOn === name) throw new Error(`${name} transport failure`);
    if (fx.errorOn === name) return { data: null, error: { message: "private failure" } };
    return { data: name === "clinic_bmhp_supported" ? true : "log", error: null };
  },
  from(table: string) {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => {
      fx.started.push(table);
      if (fx.throwOn === table) throw new Error(`${table} transport failure`);
      if (fx.errorOn === table) return { data: null, error: { message: "private failure" } };
      const data = table === "inpatient_records" ? fx.rec : table === "medical_records" ? { id: "mr" } : { role: fx.role };
      return { data, error: null };
    } };
    return q;
  },
}) }));
import { addDailyLogPos } from "../../app/(app)/klinik/rawat-inap/actions";

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ recordId: "stay", condition_note: "Stabil", request_key: "log-key", new_status: "kritis",
    resep: JSON.stringify([
      { item_id: "drug", nama_obat: "Tablet", qty: 1, satuan: "tab", harga: 1, jenis: "obat" },
      { item_id: "service", nama_obat: "Tindakan", qty: 1, harga: 1, jenis: "jasa", bmhp: [{ item_id: "material", qty: 1, unit: "pcs", nama: "Kasa" }] },
    ]), ...extra })) data.set(key, value);
  return data;
}
const run = async (p: Promise<unknown>) => { try { return { value: await p }; } catch (e) { return { error: (e as Error).message }; } };

beforeEach(() => {
  fx.started = []; fx.rpcCalls = []; fx.stayGate = null; fx.errorOn = ""; fx.throwOn = "";
  fx.rec = { condition_status: "stabil", visit_id: "visit", medical_record_id: null }; fx.role = "DOCTOR";
  revalidatePath.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

it("starts every pre-save read before the slowest one finishes, then saves once", async () => {
  let release!: () => void;
  fx.stayGate = new Promise<void>((resolve) => { release = resolve; });
  const saving = addDailyLogPos(form());
  await vi.waitFor(() => expect(fx.started).toEqual(expect.arrayContaining(
    ["user", "inpatient_records", "stay", "units", "clinic_bmhp_supported", "medical_records", "profiles"])));
  expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
  release();
  await expect(saving).resolves.toEqual({ saved: true, href: "/klinik/rawat-inap/stay?success=log" });
  expect(fx.rpcCalls.filter((name) => name === "clinic_save_inpatient_log_with_status")).toHaveLength(1);
});

it("does not revalidate (so the heavy log form is not rendered again in the save response)", async () => {
  await expect(addDailyLogPos(form({ cetak: "1" }))).resolves.toEqual({ saved: true, href: "/klinik/rekam-medis/visit/resep" });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("logs per-phase timing for production measurement", async () => {
  await addDailyLogPos(form());
  expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[u07:addDailyLogPos\] stay baca=\d+ms simpan=\d+ms total=\d+ms$/));
});

it.each([
  ["inpatient_records", "Data%20rawat%20inap%20tidak%20ditemukan"],
  ["stay", "Tipe%20rawat%20inap%20belum%20dapat%20diverifikasi"],
  ["medical_records", "Rekam%20medis%20belum%20dapat%20dibaca"],
  ["clinic_bmhp_supported", "Pencatatan%20BMHP%20tindakan%20belum%20aktif"],
  ["profiles", "Peran%20pengguna%20belum%20dapat%20diverifikasi"],
])("fails closed when the parallel %s read returns { error }", async (source, message) => {
  fx.errorOn = source;
  const result = await run(addDailyLogPos(form()));
  expect(result.error).toMatch(/^REDIRECT \/klinik\/rawat-inap\/stay\/catatan\?error=/);
  expect(result.error).toContain(message);
  expect(result.error).not.toContain("private");
  expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
});

it.each(["user", "inpatient_records", "stay", "medical_records", "clinic_bmhp_supported", "profiles"])(
  "fails closed when the parallel %s read throws", async (source) => {
    fx.throwOn = source;
    const result = await run(addDailyLogPos(form()));
    expect(result.error).toBe(`${source === "user" ? "auth" : source === "stay" ? "stay" : source} transport failure`);
    expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
  });

it("turns a thrown unit-master read into a clear message and does not save", async () => {
  fx.throwOn = "units";
  const result = await run(addDailyLogPos(form()));
  expect(result.error).toMatch(/^REDIRECT \/klinik\/rawat-inap\/stay\/catatan\?error=Ada%20barang/);
  expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
});

it("keeps the old validation order: a missing stay wins over a failing read started in parallel", async () => {
  fx.rec = null; fx.throwOn = "units";
  const result = await run(addDailyLogPos(form()));
  expect(result.error).toContain("Data%20rawat%20inap%20tidak%20ditemukan");
  expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
});

it("still refuses a non-doctor status transition and skips role/record reads that are not needed", async () => {
  fx.role = "STAFF";
  expect((await run(addDailyLogPos(form({ new_status: "rip" })))).error).toContain("Transisi%20kondisi%20hanya%20boleh%20dilakukan%20dokter");
  expect(fx.rpcCalls).not.toContain("clinic_save_inpatient_log_with_status");
  fx.started = []; fx.rec = { condition_status: "stabil", visit_id: "visit", medical_record_id: "mr-linked" };
  await expect(addDailyLogPos(form({ new_status: "stabil", resep: "[]" }))).resolves.toMatchObject({ saved: true });
  expect(fx.started).not.toContain("profiles");
  expect(fx.started).not.toContain("medical_records");
  expect(fx.started).not.toContain("units");
});
