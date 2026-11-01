import { beforeEach, expect, it, vi } from "vitest";

// Edit rekam medis sebelum tagihan terbit + racikan baru (laporan Anisa 1 Nov 2026).
type Galat = { code?: string; message: string };
const s = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[], error: null as null | Galat, errors: [] as Galat[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(p); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  s.calls.push({ name, args });
  const error = s.errors.shift() ?? s.error; // satu galat sekali pakai (urut), lalu galat tetap
  return { data: error ? null : "record", error };
} }) }));
import { koreksiRekamMedisLengkap } from "@/app/(app)/klinik/rekam-medis/[visitId]/actions";
beforeEach(() => { s.calls = []; s.error = null; s.errors = []; });

const tersimpan = { prescription_item_id: "rx", nama_obat: "Vaksinasi F4", item_id: "vaksin", jenis: "jasa", qty: 1, harga: 235000, satuan: "PCS" };
const racikanLama = { prescription_item_id: "rx-lama", nama_obat: "Racikan Lama", item_id: null, jenis: "racikan", qty: 1, harga: 20000, satuan: "racikan", compound_recipe_id: "recipe-lama" };
const resmi = { key: "k-resmi", item_id: null, sale_item_id: "compound", nama_obat: "Obat Racik Sirup Flu", qty: 1, satuan: "racikan", faktor: 1, harga: 25000,
  jenis: "racikan", official_version_id: "v1", aturan_pakai: "3x sehari", ingredients: [{ item_id: "ing", nama: "Bahan", qty: 2, satuan: "pcs", harga: 5000 }],
  service_performers: { doctor_id: "dokter", staff_id: null } };
const khusus = { key: "k-khusus", item_id: null, sale_item_id: "compound", nama_obat: "Obat Racik Sirup Flu", qty: 1, satuan: "racikan", faktor: 1, harga: 25000,
  jenis: "racikan", dosage_form: "puyer", aturan_pakai: "2x sehari", ingredients: [{ item_id: "ing", nama: "Bahan", qty: 3, satuan: "pcs", harga: 5000 }, { item_id: "", nama: "kosong", qty: 1, satuan: "pcs", harga: 0 }] };

function form(resep: unknown[]) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ visitId: "visit", medical_record_id: "record", expected_revision: "2", request_key: "edit-key",
    correction_reason: "Tambah racikan", anamnesis: "Tersimpan", resep: JSON.stringify(resep) })) f.set(k, v);
  return f;
}

it("tanpa racikan baru: pembungkus dengan p_compounds kosong, baris tersimpan apa adanya", async () => {
  expect(await koreksiRekamMedisLengkap(form([tersimpan, racikanLama]))).toEqual({ saved: true, href: "/klinik/rekam-medis/visit?success=correction" });
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds"]);
  expect(s.calls[0].args.p_compounds).toEqual([]);
  expect(s.calls[0].args.p_rows).toMatchObject([{ prescription_item_id: "rx" }, { prescription_item_id: "rx-lama", compound_recipe_id: "recipe-lama" }]);
});

it("fungsi baru belum terpasang dan tanpa racikan baru: jatuh ke RPC edit lama persis", async () => {
  s.errors = [{ code: "PGRST202", message: "Could not find the function" }];
  expect(await koreksiRekamMedisLengkap(form([tersimpan]))).toEqual({ saved: true, href: "/klinik/rekam-medis/visit?success=correction" });
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds", "clinic_edit_queued_record"]);
  expect(s.calls[1].args).not.toHaveProperty("p_compounds");
  expect(s.calls[1].args).toEqual(Object.fromEntries(Object.entries(s.calls[0].args).filter(([k]) => k !== "p_compounds")));
});

it("kunci sama dengan isi berbeda (respons hilang lalu racikan dihapus): pesan muat ulang, tanpa jalur lain", async () => {
  s.error = { code: "P0001", message: "IDEMPOTENCY_CONFLICT: kunci edit rekam medis dipakai untuk data berbeda" };
  await expect(koreksiRekamMedisLengkap(form([tersimpan]))).rejects.toThrow(encodeURIComponent("Muat ulang halaman rekam medis"));
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds"]);
});

it("racikan baru dikirim ke RPC pembungkus satu transaksi, bukan sebagai baris resep", async () => {
  expect(await koreksiRekamMedisLengkap(form([tersimpan, racikanLama, resmi, khusus]))).toEqual({ saved: true, href: "/klinik/rekam-medis/visit?success=correction" });
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds"]);
  const args = s.calls[0].args;
  expect(args).toMatchObject({ p_visit_id: "visit", p_record_id: "record", p_expected_revision: 2, p_reason: "Tambah racikan", p_request_key: "edit-key" });
  // Baris tersimpan (termasuk racikan lama yang terkunci) tetap utuh; racikan baru tidak masuk p_rows.
  expect(args.p_rows).toEqual([expect.objectContaining({ prescription_item_id: "rx" }), expect.objectContaining({ prescription_item_id: "rx-lama", compound_recipe_id: "recipe-lama" })]);
  expect(args.p_compounds).toEqual([
    { official_version_id: "v1", sale_item_id: "compound", request_key: "k-resmi", dosage_instruction: "3x sehari", service_performers: { doctor_id: "dokter", staff_id: null } },
    { request_key: "k-khusus", sale_item_id: "compound", recipe: expect.objectContaining({ recipe_name: "Obat Racik Sirup Flu", dosage_form: "puyer",
      ingredients: [expect.objectContaining({ item_id: "ing", quantity: 3 })] }) },
  ]);
});

it("racikan khusus tanpa bahan ditolak sebelum ke database", async () => {
  await expect(koreksiRekamMedisLengkap(form([tersimpan, { ...khusus, ingredients: [] }]))).rejects.toThrow(encodeURIComponent("Setiap racikan harus memiliki minimal satu bahan"));
  expect(s.calls).toEqual([]);
});

it("stok bahan kurang dari peracikan diterjemahkan, seluruh simpanan batal di database", async () => {
  s.error = { code: "P0001", message: "STOCK_SHORT: Bahan diizinkan" };
  await expect(koreksiRekamMedisLengkap(form([tersimpan, resmi]))).rejects.toThrow(encodeURIComponent("Stok tidak cukup: Bahan diizinkan"));
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds"]);
});

it.each(["ACCESS_DENIED: hanya owner atau dokter dapat mengubah rekam medis", "RECORD_POSTED: kunjungan sudah berubah atau memiliki invoice"])(
  "penolakan Edit sendiri tetap apa adanya: %s", async (message) => {
    s.error = { code: "P0001", message };
    await expect(koreksiRekamMedisLengkap(form([tersimpan, resmi]))).rejects.toThrow(encodeURIComponent(message));
  });

it("fungsi database belum terpasang: pesan jelas, tanpa jatuh ke jalur lain", async () => {
  s.error = { code: "PGRST202", message: "Could not find the function public.clinic_edit_queued_record_with_compounds" };
  await expect(koreksiRekamMedisLengkap(form([tersimpan, resmi]))).rejects.toThrow(encodeURIComponent("Menambah racikan dari layar Edit belum aktif"));
  expect(s.calls.map(c => c.name)).toEqual(["clinic_edit_queued_record_with_compounds"]);
});
