// F2: panel ringkasan selisih kurang + beban karyawan di halaman hasil opname.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ rpc: null as null | { data: unknown; error: unknown }, tables: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async () => st.rpc,
  from: (table: string) => {
    st.tables.push(table);
    const query: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) query[m] = () => query;
    query.maybeSingle = async () => ({ data: { id: "r1" }, error: null });
    query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [
      { id: "e2", nama: "Budi", jabatan: "Kasir", branch_id: "b2" }, { id: "e1", nama: "Sari", jabatan: "Kepala toko", branch_id: "b1" },
    ], error: null }).then(resolve);
    return query;
  },
}) }));
vi.mock("./beban-karyawan-actions", () => ({ catatBebanKaryawan: vi.fn(), batalBebanKaryawan: vi.fn() }));

import { BebanKaryawanPanel } from "./BebanKaryawanPanel";

const base = { result_id: "r1", no_hasil: "OPR.00001", tanggal_opname: "2026-11-14", order_id: "o1", no_opname: "OPO.1", branch_id: "b1", warehouse: "Gudang",
  method: "fifo", minus_lines: [{ item_id: "i1", code: "A1", name: "Kalung kucing", unit: "PCS", qty: 1, hpp: 100000, harga_jual: 150000, jual: 150000 }],
  minus_count: 1, hpp_total: 100000, jual_total: 150000, hpp_part: 100000, gain_part: 50000, today: "2026-11-14", refuse: null, can_charge: true, charges: [] };
const render = async () => renderToStaticMarkup(await BebanKaryawanPanel({ orderId: "o1" }));

beforeEach(() => { st.tables = []; });

it("Owner: ringkasan HPP & harga jual, pratinjau jurnal, form beban; karyawan cabang opname di atas", async () => {
  st.rpc = { data: base, error: null };
  const html = await render();
  expect(html).toContain("SELISIH KURANG &amp; BEBAN KARYAWAN");
  expect(html).toContain("Rp 100.000");
  expect(html).toContain("Rp 150.000");
  expect(html).toContain("Rp 50.000");
  expect(html).toContain("Catat sebagai kasbon karyawan");
  expect(html).toContain("Tidak dipotong gaji otomatis");
  expect(html.indexOf("Sari")).toBeLessThan(html.indexOf("Budi"));
});

it("Finance tanpa izin: ringkasan tampil, form tidak; penjelasan siapa yang boleh", async () => {
  st.rpc = { data: { ...base, can_charge: false }, error: null };
  const html = await render();
  expect(html).toContain("Rp 150.000");
  expect(html).not.toContain("Catat sebagai kasbon karyawan");
  expect(html).toContain("hanya bisa oleh Owner");
  expect(st.tables).not.toContain("employees");
});

it("opname lama: alasan penolakan tampil, form tidak", async () => {
  st.rpc = { data: { ...base, refuse: { code: "LAMA", message: "Opname ini diposting sebelum aturan akun selisih baru berlaku." } }, error: null };
  const html = await render();
  expect(html).toContain("Belum bisa dibebankan ke karyawan: Opname ini diposting sebelum aturan");
  expect(html).not.toContain("Catat sebagai kasbon karyawan");
});

it("riwayat beban aktif: daftar karyawan, status kasbon, tombol batal", async () => {
  st.rpc = { data: { ...base, refuse: { code: "SUDAH", message: "sudah" }, charges: [{ id: "c1", tanggal: "2026-11-14", reason: "Hilang", total: 150000, hpp_part: 100000, gain_part: 50000,
    actor_name: "Reza", created_at: "2026-11-14T03:00:00Z", journal_id: "j1", cancelled_at: null, cancel_reason: null, cancel_journal_id: null,
    lines: [{ employee_id: "e1", nama: "Sari", amount: 150000, advance_id: "a1", status: "Dicatat", dibayar: 0 }] }] }, error: null };
  const html = await render();
  expect(html).toContain("Riwayat beban karyawan");
  expect(html).toContain("Sari: Rp 150.000 · kasbon dicatat");
  expect(html).toContain("Batalkan beban");
  expect(html).not.toContain("Catat sebagai kasbon karyawan");
});

it.each(["42501", "PGRST202"])("tanpa hak / fitur belum aktif (%s): panel tidak tampil", async (code) => {
  st.rpc = { data: null, error: { code, message: "x" } };
  expect(await render()).toBe("");
});
