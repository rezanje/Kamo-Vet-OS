import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";
import { expect, it, vi } from "vitest";
import { PROMO_MASTER_HEADERS, PROMO_MASTER_SHEET } from "../promo-master-excel";

// Only the transport is adapted: EVERY query/RPC runs with the authenticated
// role against the original full schema. No table-success / business mocks.
const native = vi.hoisted(() => ({ user: "a0000000-0000-0000-0000-000000000001" }));
const quote = (s: unknown) => "'" + String(s).replaceAll("'", "''") + "'";
function sql(source: string) {
  const out = execFileSync(process.env.KAMO_TEST_PSQL!, ["-X", "-qAt", "-h", process.env.KAMO_TEST_SOCKET!, "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `set role authenticated;select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: native.user, role: "authenticated" }))},false);` + source,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out.trim().split("\n").at(-1)!);
}
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: native.user } } }) },
  from(table: string) {
    let fields = "*"; const where: string[] = []; const order: string[] = []; let from = 0; let limit = 1000;
    const run = (single = false) => {
      try {
        const query = `select ${fields} from public.${table}${where.length ? " where " + where.join(" and ") : ""}`;
        const data = sql(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (${query}${order.length ? " order by " + order.join(",") : ""} offset ${from} limit ${limit}) r;`);
        const count = sql(`select count(*) from (${query}) r;`);
        return { data: single ? data[0] ?? null : data, count, error: null };
      } catch (error) { return { data: null, count: null, error: { message: String(error) } }; }
    };
    const q = {
      select: (cols: string) => { fields = cols; return q; },
      eq: (col: string, value: string) => { where.push(`${col}=${quote(value)}`); return q; },
      in: (col: string, values: string[]) => { where.push(`${col} in (${values.map(quote).join(",")})`); return q; },
      order: (col: string) => { order.push(col); return q; },
      range: (a: number, b: number) => { from = a; limit = b - a + 1; return q; },
      maybeSingle: async () => run(true),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    }; return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    try { return { data: sql(`select public.${name}(${Object.entries(params).map(([key, value]) => `${key} => ${quote(JSON.stringify(value))}::jsonb`).join(",")});`), error: null }; }
    catch (error) { return { data: null, error: { message: String(error) } }; }
  },
}) }));
import { previewPromoMaster, periksaPromoMaster, simpanPromoMaster } from "../../app/(app)/crm/promo/impor-daftar/actions";

it.skipIf(!process.env.KAMO_TEST_SOCKET)("OWNER/ADMIN real workbook preview and same-name save work while private table SELECT stays denied", async () => {
  native.user = process.env.KAMO_TEST_OWNER!;
  expect(() => sql("select coalesce(jsonb_agg(p),'[]') from public.promo_import_targets p;")).toThrow(/permission denied/);
  const values: Record<string, string> = { "Nama Promo": "App Seam Existing", "Kode SKU": "FA-OBAT", "Jenis Diskon": "Persen", "Nilai": "12", "Potong Otomatis": "Ya", "Tanggal Mulai": "2026-01-01", "Tanggal Berakhir": "2099-12-31", "Kelipatan": "Tidak" };
  for (const user of [process.env.KAMO_TEST_OWNER!, process.env.KAMO_TEST_ADMIN!]) {
    native.user = user;
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet(PROMO_MASTER_SHEET);
    sheet.addRow([...PROMO_MASTER_HEADERS]); sheet.addRow(PROMO_MASTER_HEADERS.map(key => values[key] ?? ""));
    const form = new FormData(); form.set("file", new File([await book.xlsx.writeBuffer() as ArrayBuffer], "native.xlsx"));
    const preview = await previewPromoMaster(form);
    expect(preview.error).toBeNull(); expect(preview.valid).toBe(true);
    expect(preview.diffs[0].promoId).not.toBeNull();
    expect((await simpanPromoMaster(preview.rows, preview.plans.map(({ name, expected }) => ({ name, expected })))).ok).toBe(true);
    expect(sql("select discount_value from public.promos where name='App Seam Existing';")).toBe(12);
  }
});

// This is the actual stale displayed-preview/action seam, not a recomputed plan.
it.skipIf(!process.env.KAMO_TEST_SOCKET)("rejects a stale displayed master rather than silently re-reviewing and overwriting", async () => {
  native.user = process.env.KAMO_TEST_OWNER!;
  const rows = [{ line: 2, Cabang: "", "Min Qty": "", "Maks Qty": "", "Min Belanja": "", "Teks Saran": "", "Nama Promo": "App Seam Existing", "Kode SKU": "FA-OBAT", "Jenis Diskon": "Persen", "Nilai": "12", "Potong Otomatis": "Ya", "Tanggal Mulai": "2026-01-01", "Tanggal Berakhir": "2099-12-31", "Kelipatan": "Tidak" }];
  const preview = await periksaPromoMaster(rows);
  expect(preview.valid).toBe(true);
  sql("update public.promos set discount_value=23 where name='App Seam Existing';select 'true'::jsonb;");
  const saved = await simpanPromoMaster(preview.rows, preview.plans.map(({ name, expected }) => ({ name, expected })));
  expect(saved.ok).toBe(false); expect(saved.message).toMatch(/berubah|ulang/i);
  expect(sql("select discount_value from public.promos where name='App Seam Existing';")).toBe(23);
});

it.skipIf(!process.env.KAMO_TEST_SOCKET)("inactive same-name preview discloses retained activation and real save preserves it", async () => {
  native.user = process.env.KAMO_TEST_OWNER!;
  sql("update public.promos set is_active=false where name='App Seam Existing';select 'true'::jsonb;");
  const rows = [{ line: 2, Cabang: "", "Min Qty": "", "Maks Qty": "", "Min Belanja": "", "Teks Saran": "", "Nama Promo": "App Seam Existing", "Kode SKU": "FA-OBAT", "Jenis Diskon": "Persen", "Nilai": "23", "Potong Otomatis": "Ya", "Tanggal Mulai": "2026-01-01", "Tanggal Berakhir": "2099-12-31", "Kelipatan": "Tidak" }];
  const preview = await periksaPromoMaster(rows);
  expect(preview.valid).toBe(true);
  expect(preview.diffs[0].status).toBe("sama");
  expect(preview.diffs[0].activationNote).toMatch(/tetap nonaktif.*status tidak diubah/i);
  const saved = await simpanPromoMaster(preview.rows, preview.plans.map(({ name, expected }) => ({ name, expected })));
  expect(saved.ok).toBe(true);
  expect(sql("select to_jsonb(is_active) from promos where name='App Seam Existing';")).toBe(false);
});

it.skipIf(!process.env.KAMO_TEST_SOCKET).each(["target", "activation", "absent"])("real action refuses stale %s state and requires another reviewed preview", async kind => {
  native.user = process.env.KAMO_TEST_OWNER!;
  const name = kind === "absent" ? "Action Creation Race" : "App Seam Existing";
  const rows = [{ line: 2, Cabang: "", "Min Qty": "", "Maks Qty": "", "Min Belanja": "", "Teks Saran": "", "Nama Promo": name, "Kode SKU": "FA-OBAT", "Jenis Diskon": "Persen", "Nilai": "23", "Potong Otomatis": "Ya", "Tanggal Mulai": "2026-01-01", "Tanggal Berakhir": "2099-12-31", "Kelipatan": "Tidak" }];
  const preview = await periksaPromoMaster(rows);
  expect(preview.valid).toBe(true);
  if (kind === "target") sql("insert into public.promo_items(promo_id,item_id) select p.id,i.id from promos p cross join items i where p.name='App Seam Existing' and i.code='SNAP-SERVICE';select 'true'::jsonb;");
  if (kind === "activation") sql("update promos set is_active=true where name='App Seam Existing';select 'true'::jsonb;");
  if (kind === "absent") sql("insert into promos(name,promo_type,rule) values('Action Creation Race','diskon_produk','{}');select 'true'::jsonb;");
  const before = sql(`select read_promo_edit(id) from promos where name=${quote(name)};`);
  const saved = await simpanPromoMaster(preview.rows, preview.plans.map(({ name, expected }) => ({ name, expected })));
  expect(saved.ok).toBe(false); expect(saved.message).toMatch(/berubah|ulang/i);
  expect(sql(`select read_promo_edit(id) from promos where name=${quote(name)};`)).toEqual(before);
  const refreshed = await periksaPromoMaster(rows);
  expect((await simpanPromoMaster(rows, refreshed.plans.map(({ name, expected }) => ({ name, expected })))).ok).toBe(true);
});
