import { beforeEach, expect, it, vi } from "vitest";

// U07: the medical-record save must not queue its independent reads one by one.
const fx = vi.hoisted(() => ({
  started: new Set<string>(), doctorGate: null as Promise<void> | null, unitsFail: false,
  rpcCalls: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("@/lib/dokter", () => ({ resolveDokter: async () => {
  fx.started.add("doctor");
  if (fx.doctorGate) await fx.doctorGate;
  return { doctorId: "doctor", nama: "Drh. Fiction" };
} }));
vi.mock("@/lib/satuan", async () => ({
  ...await vi.importActual<typeof import("../satuan")>("../satuan"),
  loadUnitOptions: async () => {
    fx.started.add("units");
    if (fx.unitsFail) throw new Error("Ada barang yang tidak aktif atau tidak ditemukan. Pilih lagi dari master.");
    return new Map();
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string) => {
    fx.started.add(name); fx.rpcCalls.push(name);
    return { data: name === "clinic_bmhp_supported" ? true : "record", error: null };
  },
  from(table: string) {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => {
      fx.started.add(table);
      return { data: table === "visits" ? { poli: "Poli Umum" } : { species: "Kucing" }, error: null };
    } };
    return q;
  },
}) }));
import { simpanRekamMedis } from "../../app/(app)/klinik/rekam-medis/[visitId]/actions";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ visitId: "visit", petId: "pet", request_key: "stable-key", doctor_id: "doctor",
    keluhan: "Batuk", berat: "4", next: "resep",
    resep: JSON.stringify([{ item_id: "service", nama_obat: "Tindakan", qty: 1, harga: 1, jenis: "jasa",
      bmhp: [{ item_id: "material", qty: 1, unit: "pcs", nama: "Kasa" }] }]) })) data.set(key, value);
  return data;
}
beforeEach(() => { fx.started.clear(); fx.doctorGate = null; fx.unitsFail = false; fx.rpcCalls = []; });

it("starts every pre-save read before the slowest one finishes", async () => {
  let release!: () => void;
  fx.doctorGate = new Promise<void>((resolve) => { release = resolve; });
  const saving = simpanRekamMedis(form());
  await vi.waitFor(() => expect(fx.started.has("doctor")).toBe(true));
  await vi.waitFor(() => expect([...fx.started]).toEqual(expect.arrayContaining(["visits", "pets", "units", "clinic_bmhp_supported"])));
  expect(fx.rpcCalls).not.toContain("clinic_save_initial_record");
  release();
  await expect(saving).resolves.toMatchObject({ saved: true });
  expect(fx.rpcCalls).toContain("clinic_save_initial_record");
});

it("turns an unreadable unit master into a clear message instead of a false connection error", async () => {
  fx.unitsFail = true;
  await expect(simpanRekamMedis(form())).rejects.toThrow(/^REDIRECT \/klinik\/rekam-medis\/visit\?error=Ada%20barang/);
  expect(fx.rpcCalls).not.toContain("clinic_save_initial_record");
});
