import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

// Meniru guard_master_data_lifecycle (migrasi 20261021134543): UPDATE items.is_active langsung ditolak,
// aktivasi hanya sah lewat RPC change_master_data_lifecycle (alasan 3-500 huruf + versi).
const db = vi.hoisted(() => ({
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  directUpdates: 0,
  active: {} as Record<string, boolean>,
  trashed: null as string | null,
}));
const GUARD = "Perubahan status wajib melalui aksi master dengan alasan dan versi";
const items = () => [
  { id: "g1", code: "GRP-T-1", name: "Grup uji 1", item_type: "Grup", unit: "PCS", is_active: db.active.g1, units: [] },
  { id: "g2", code: "GRP-T-2", name: "Grup uji 2", item_type: "Grup", unit: "PCS", is_active: db.active.g2, units: [] },
  { id: "a", code: "BRG-A", name: "Barang A", item_type: "Persediaan", unit: "PCS", is_active: true, units: [] },
  { id: "b", code: "BRG-B", name: "Barang B", item_type: "Persediaan", unit: "PCS", is_active: true, units: [] },
];

vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected auth redirect"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args });
      if (fn === "change_master_data_lifecycle") db.active[String(args.p_id)] = true;
      return { data: { id: args.p_id }, error: null };
    },
    from(table: string) {
      let mode: "select" | "update" = "select";
      let eqId: string | null = null;
      const rows = () => table === "profiles" ? [{ role: "OWNER", is_active: true }]
        : table === "items" ? items() : [];
      const query = {
        select: () => query,
        update: () => { mode = "update"; return query; },
        eq: (col: string, value: string) => { if (col === "id") eqId = value; return query; },
        order: () => query,
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => {
          if (table === "items" && eqId) {
            return { data: { is_active: db.active[eqId], lifecycle_revision: 4, trashed_at: db.trashed, item_type: "Grup" }, error: null };
          }
          return { data: rows()[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (mode === "update" && table === "items") {
            db.directUpdates += 1;
            return Promise.resolve({ error: { message: GUARD } }).then(resolve);
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
import { konfirmasiKomponenGrup, previewKomponenGrup } from "@/app/(app)/pos/sku/impor/actions";

async function rincian(rows: (string | number)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rincian Grup");
  sheet.addRow(["Kode Grup", "Kode Komponen", "Kuantitas", "Satuan", "Urutan"]);
  rows.forEach((row) => sheet.addRow(row));
  const form = new FormData();
  form.set("group_file", new File([Buffer.from(await workbook.xlsx.writeBuffer())], "rincian.xlsx"));
  return form;
}
const FILE = [["GRP-T-1", "BRG-A", 1, "PCS", 1], ["GRP-T-1", "BRG-B", 1, "PCS", 2], ["GRP-T-2", "BRG-A", 1, "PCS", 1]];

beforeEach(() => { db.rpc = []; db.directUpdates = 0; db.active = { g1: false, g2: false }; db.trashed = null; });

it("preview menilai 2 Grup lengkap tanpa menulis", async () => {
  const result = await previewKomponenGrup(await rincian(FILE));
  expect(result).toMatchObject({ ok: true, complete: 2, rejected: 0 });
  expect(db.rpc).toEqual([]);
});

it("konfirmasi mengaktifkan setiap Grup lewat RPC lifecycle (bukan UPDATE langsung yang ditolak guard)", async () => {
  const result = await konfirmasiKomponenGrup(await rincian(FILE));
  expect(result.message).not.toContain(GUARD);
  expect(result).toMatchObject({ ok: true, complete: 2 });
  expect(db.directUpdates).toBe(0);
  const lifecycle = db.rpc.filter((call) => call.fn === "change_master_data_lifecycle");
  expect(lifecycle.map((call) => call.args.p_id)).toEqual(["g1", "g2"]);
  expect(lifecycle[0].args).toMatchObject({ p_entity: "items", p_action: "activate", p_expected_revision: 4 });
  expect(String(lifecycle[0].args.p_reason).length).toBeGreaterThanOrEqual(3);
  expect(db.rpc.filter((call) => call.fn === "replace_item_group_components")).toHaveLength(2);
});

it("Grup yang sudah aktif tidak dipanggil ulang (aman diulang)", async () => {
  db.active = { g1: true, g2: false };
  const result = await konfirmasiKomponenGrup(await rincian(FILE));
  expect(result).toMatchObject({ ok: true, complete: 2 });
  expect(db.rpc.filter((call) => call.fn === "change_master_data_lifecycle").map((call) => call.args.p_id)).toEqual(["g2"]);
});

it("Grup di Sampah ditolak dengan pesan jelas", async () => {
  db.trashed = "2026-11-01T00:00:00Z";
  const result = await konfirmasiKomponenGrup(await rincian(FILE));
  expect(result.ok).toBe(false);
  expect(result.message).toContain("Sampah");
});
