import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ hash: "", writes: [] as string[], tables: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected auth redirect"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
  from(table: string) {
    db.tables.push(table);
    const result = (single = false) => {
      const rows = table === "profiles" ? [{ role: "OWNER", is_active: true }]
        : table === "import_runs" ? [{ id: "legacy-preview", kind: "master_accurate", status: "previewed", source_hash: db.hash, summary: {} }] : [];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const query = {
      select: () => query, eq: () => query, in: () => query, range: () => query, order: () => query, limit: () => query,
      insert: () => { db.writes.push(`${table}:insert`); return query; },
      update: () => { db.writes.push(`${table}:update`); return query; },
      upsert: () => { db.writes.push(`${table}:upsert`); return query; },
      delete: () => { db.writes.push(`${table}:delete`); return query; },
      maybeSingle: async () => result(true), single: async () => result(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));
import { konfirmasiImporAccurate, previewImporAccurate } from "@/app/(app)/pos/sku/impor/actions";

async function invalidFile(type: string | null = null) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kategori Barang", "Kode Barang", "Nama Barang", "Jenis Barang", "Satuan", "Kuantitas Saldo Awal", "Nilai Satuan"]);
  sheet.addRow(["FIKTIF", "FIX-001", "Barang fiktif satu", type, "PCS", 3, 10000]);
  sheet.addRow(["FIKTIF", "FIX-002", "Barang fiktif dua", type, "PCS", 0, 0]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  db.hash = createHash("sha256").update("fiction.xlsx").update("\0").update(String(bytes.length)).update("\0").update(bytes).digest("hex");
  const form = new FormData(); form.set("files", new File([bytes], "fiction.xlsx")); form.set("run_id", "legacy-preview");
  return form;
}
beforeEach(() => { db.hash = ""; db.writes = []; db.tables = []; });

it.each([null, "UNSUPPORTED"])("blocks a preview when every source master row is rejected (%s)", async (type) => {
  const result = await previewImporAccurate(await invalidFile(type));
  expect(result.ok).toBe(false);
  expect(result.phase).toBe("preview");
  expect(result.run_id).toBeNull();
  expect(result.summary.Ditolak).toBe(2);
  expect(result.rows).toHaveLength(2);
  expect(result.message).toContain("Tidak ada barang/jasa yang siap");
  expect(db.writes).toEqual([]);
});

it("rejects confirmation of a legacy preview with no valid master rows before any writes", async () => {
  const result = await konfirmasiImporAccurate(await invalidFile());
  expect(result.ok).toBe(false);
  expect(result.phase).toBe("preview");
  expect(result.summary.Ditolak).toBe(2);
  expect(result.message).toContain("Jenis barang wajib diisi");
  expect(result.message).not.toContain("sudah disimpan");
  expect(db.writes).toEqual([]);
});

it("rejects an empty template without creating an empty audit batch", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kategori Barang", "Kode Barang", "Nama Barang", "Jenis Barang", "Satuan"]);
  const form = new FormData(); form.set("files", new File([Buffer.from(await workbook.xlsx.writeBuffer())], "empty.xlsx"));
  const result = await previewImporAccurate(form);
  expect(result.ok).toBe(false);
  expect(result.run_id).toBeNull();
  expect(result.message).toContain("Tidak ada barang/jasa yang siap");
  expect(db.writes).toEqual([]);
});
