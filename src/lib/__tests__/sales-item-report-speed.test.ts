import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";
import { petaBerbatas } from "../konkuren-batas";

// Rincian penjualan per barang, Sumber Klinik: dulu satu query bergabung invoice_items x invoices
// dibaca per halaman 500 baris dan tiap halaman juga menghitung ulang jumlahnya. Dengan RLS itu
// sekitar 3 detik per query x 2 x 11 halaman -> melewati batas 8 detik / waktu tunggu.
// Sekarang invoice dibaca sekali (tanpa join ke baris item) lalu baris itemnya per kelompok id invoice.
// Angkanya HARUS sama persis dengan implementasi lama (sidik jari di bawah dihitung dari kode lama).

const bulat = (n: number) => Math.round(n);
function buatData() {
  const itemsMaster = Array.from({ length: 40 }, (_, i) => ({ id: `item-${i}`, code: `K${1000 + i}`, category_id: i % 3 === 0 ? "c-obat" : i % 3 === 1 ? "c-tind" : "c-sub" }));
  const kategori = [
    { id: "c-obat", name: "OBAT & VITAMIN", parent_id: null }, { id: "c-tind", name: "TINDAKAN", parent_id: null },
    { id: "c-sub", name: "Operasi", parent_id: "c-tind" },
  ];
  const invoiceItems: Record<string, unknown>[] = [];
  const medicalRecords: Record<string, unknown>[] = [];
  const recipes: Record<string, unknown>[] = [];
  const snapshots: Record<string, unknown>[] = [];
  for (let n = 0; n < 1300; n++) {
    const visitId = `visit-${Math.floor(n * 0.6)}`; // sebagian kunjungan punya lebih dari satu invoice
    const branchId = n % 4 === 0 ? "b2" : "b1";
    const demo = n % 97 === 0;
    const lines: Record<string, unknown>[] = Array.from({ length: 4 }, (_, k) => {
      const kind = (n + k) % 5;
      return {
        id: `line-${String(n).padStart(5, "0")}-${k}`, deskripsi: kind === 2 ? `Puyer ${n % 7}` : kind === 1 ? `Tindakan ${k}` : `Obat ${k}`, qty: 1 + ((n + k) % 3),
        harga: 10000 + ((n * 37 + k * 11) % 90) * 1000, diskon_persen: kind === 3 ? 10 : 0, jenis: kind === 1 ? "jasa" : "obat",
        item_id: kind === 2 ? null : `item-${(n + k) % 40}`, compound_recipe_id: null,
        bmhp_components: kind === 1 ? { cost: 3000, components: [{ name: "Kasa", qty: 2, unit: "lembar", cost: 1500 }] } : null,
        service_performers: kind === 1 ? { doctor_id: `dok-${n % 3}`, doctor_name: `Dokter ${n % 3}`, staff_id: null, staff_name: null } : null,
      };
    });
    const fee = demo ? 5000 : 0;
    if (demo) lines.push({ id: `line-${String(n).padStart(5, "0")}-fee`, deskripsi: "Admin pembayaran DEMO", qty: 1, harga: fee, diskon_persen: 0, jenis: "jasa", item_id: null, compound_recipe_id: null, bmhp_components: null, service_performers: null });
    const dasar = lines.filter(l => !String(l.id).endsWith("-fee")).reduce((s, l) => s + Number(l.qty) * Number(l.harga) * (1 - Number(l.diskon_persen) / 100), 0);
    const discount = n % 5 === 0 ? bulat(dasar * 0.05) : 0;
    const invoice = {
      id: `inv-${n}`, visit_id: visitId, invoice_no: `INV-${n}`, created_at: `2026-11-${String(1 + (n % 17)).padStart(2, "0")}T0${n % 9}:30:00Z`, paid_status: n % 3 ? "Lunas" : "Belum Lunas",
      subtotal: bulat(dasar) + fee, discount, voided_at: n % 111 === 5 ? "2026-11-12T00:00:00Z" : null,
      visits: { branch_id: branchId, branches: { name: branchId === "b1" ? "Satu" : "Dua" }, customers: { name: `Pemilik ${n % 50}` }, pets: { name: `Hewan ${n % 70}` } },
    };
    for (const line of lines) invoiceItems.push({ ...line, invoices: invoice });
    if (n % 6 === 0) {
      medicalRecords.push({ id: `mr-${n}`, visit_id: visitId });
      recipes.push({ id: `rc-${n}`, medical_record_id: `mr-${n}`, recipe_name: `Puyer ${n % 7}` });
    }
    if (demo) snapshots.push({ invoice_id: `inv-${n}`, fee_amount: fee, fee_bearer: "customer" });
  }
  return { invoiceItems, medicalRecords, recipes, snapshots, itemsMaster, kategori };
}
const sidikJari = (hasil: unknown) => createHash("sha256").update(JSON.stringify(hasil)).digest("hex");
const filters = { dari: "2026-11-01", sampai: "2026-11-17", kanal: "Klinik" as const, jenis: "Semua", q: "" };
const jalankan = async (extra: Record<string, unknown> = {}) => {
  const data = buatData();
  const fixture = clientFixture({ tables: {
    invoice_items: data.invoiceItems, medical_records: data.medicalRecords, compounding_recipes: data.recipes,
    clinic_demo_invoice_snapshots: data.snapshots, items: data.itemsMaster, item_categories: data.kategori,
  } });
  mocks.createClient.mockResolvedValue(fixture.client);
  const hasil = await ambilPenjualanBarang({ ...filters, ...extra });
  return { hasil, records: fixture.records };
};
beforeEach(() => { mocks.createClient.mockReset(); });

it("memberi hasil identik dengan implementasi lama (semua cabang, 1 - 17 Nov, ±5.200 baris)", async () => {
  const { hasil } = await jalankan();
  expect(hasil.pesanError).toBe("");
  expect(hasil.rows.length).toBeGreaterThan(5000);
  expect([hasil.rows.length, hasil.nilaiTotal, hasil.qtyTotal]).toEqual(EXPECTED.semua.ringkas);
  expect(sidikJari(hasil)).toBe(EXPECTED.semua.sidik);
});

it("memberi hasil identik dengan implementasi lama untuk satu cabang yang disaring di query", async () => {
  const { hasil } = await jalankan({ cabangId: "b2", saringCabangDiQuery: true });
  expect(hasil.pesanError).toBe("");
  expect([hasil.rows.length, hasil.nilaiTotal, hasil.qtyTotal]).toEqual(EXPECTED.cabang.ringkas);
  expect(sidikJari(hasil)).toBe(EXPECTED.cabang.sidik);
});

it("tidak membaca baris item lewat gabungan ke invoice dan jumlah query tetap terbatas", async () => {
  const { hasil, records } = await jalankan();
  expect(hasil.pesanError).toBe("");
  const selects = records.filter(call => call.table === "invoice_items" && call.method === "select").map(call => String(call.args[0]));
  expect(selects.length).toBeGreaterThan(0);
  for (const select of selects) expect(select).not.toMatch(/invoices(!inner)?\s*\(/);
  // Jumlah panggilan dihitung per `.from()` (satu query dibaca): 1.300 invoice -> kelompok 100.
  const dibaca = new Map<string, number>();
  for (const call of records.filter(item => item.method === "select")) dibaca.set(call.table, (dibaca.get(call.table) ?? 0) + 1);
  expect(dibaca.get("invoices") ?? 0).toBeLessThanOrEqual(4);
  expect(dibaca.get("invoice_items") ?? 0).toBeLessThanOrEqual(20);
  expect(dibaca.get("clinic_demo_invoice_snapshots") ?? 0).toBeLessThanOrEqual(15);
  expect(dibaca.get("medical_records") ?? 0).toBeLessThanOrEqual(15);
  const total = [...dibaca.values()].reduce((sum, n) => sum + n, 0);
  expect(total).toBeLessThanOrEqual(90);
});

it("petaBerbatas menjaga urutan, batas bersamaan, dan menghentikan saat gagal", async () => {
  let aktif = 0, puncak = 0;
  const hasil = await petaBerbatas([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    aktif++; puncak = Math.max(puncak, aktif);
    await new Promise(r => setTimeout(r, 5 * (11 - n)));
    aktif--; return n * 2;
  });
  expect(hasil).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  expect(puncak).toBeLessThanOrEqual(3);
  expect(puncak).toBeGreaterThan(1);
  let mulai = 0;
  await expect(petaBerbatas(Array.from({ length: 50 }, (_, i) => i), 2, async (n) => { mulai++; if (n === 3) throw new Error("gagal"); await new Promise(r => setTimeout(r, 2)); return n; })).rejects.toThrow("gagal");
  expect(mulai).toBeLessThan(50);
  expect(await petaBerbatas([], 6, async () => 1)).toEqual([]);
});

const EXPECTED = {
  semua: { ringkas: [6196, 545333040, 10305] as number[], sidik: "7f495f33574b785b03c4b856de5343da9648e599dcd586b9b734cecfec054285" },
  cabang: { ringkas: [1549, 136751955, 2576] as number[], sidik: "3d99f2a74a78dc81d59af8a8941bbad44e043f55947a5fe3b1ffde0185a4f0d0" },
};
