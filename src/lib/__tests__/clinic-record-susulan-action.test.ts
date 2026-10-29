import { beforeEach, expect, it, vi } from "vitest";

// Item susulan rawat jalan (Andri 29 Okt, opsi B). Yang diuji di sini: muatan yang
// dikirim server action ke RPC, gerbang BMHP, dan penerusan penolakan database.
// Penautan baris & idempotensinya diuji di PostgreSQL sungguhan
// (scripts/test-item-susulan-rekam-medis-postgres.py).
const fixture = vi.hoisted(() => ({
  supported: true as boolean,
  rpcError: null as { code?: string; message: string } | null,
  units: [] as Record<string, unknown>[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  revalidated: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { fixture.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("@/lib/dokter", () => ({ resolveDokter: async () => ({ doctorId: "doctor", nama: "Drh. Fiction" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    if (name === "clinic_bmhp_supported") {
      return fixture.supported ? { data: true, error: null } : { data: null, error: { message: "missing" } };
    }
    if (name === "clinic_add_record_items") return { data: fixture.rpcError ? null : "record", error: fixture.rpcError };
    return { data: null, error: null };
  },
  from(table: string) {
    const rows = () => table === "item_units" ? fixture.units
      : table === "items" ? [
          { id: "obat", unit: "tablet", sell_price: 5000, buy_price: 0 },
          { id: "jasa", unit: "jasa", sell_price: 75000, buy_price: 0 },
        ] : [];
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      range: async () => ({ data: rows(), error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: rows(), error: null }).then(resolve) };
    return q;
  },
}) }));
import { tambahItemRekamMedis } from "../../app/(app)/klinik/rekam-medis/[visitId]/actions";

beforeEach(() => {
  fixture.supported = true;
  fixture.rpcError = null;
  fixture.units = [];
  fixture.calls = [];
  fixture.revalidated = [];
});

function form(resep: unknown[], requestKey = "susulan-key") {
  const data = new FormData();
  data.set("visitId", "visit");
  data.set("request_key", requestKey);
  data.set("resep", JSON.stringify(resep));
  return data;
}
const panggilan = () => fixture.calls.find(c => c.name === "clinic_add_record_items");

it("mengirim obat, jasa, dan racikan susulan ke RPC rekam medis, bukan ke posting tagihan", async () => {
  await expect(tambahItemRekamMedis(form([
    { item_id: "obat", nama_obat: "Amoxicillin", qty: 6, satuan: "tablet", harga: 5000, jenis: "obat", aturan_pakai: "3x1" },
    { item_id: "jasa", nama_obat: "Nebulizer", qty: 1, satuan: "jasa", harga: 75000, jenis: "jasa", kategori: "Lab" },
    { item_id: null, sale_item_id: "racikan-sku", nama_obat: "Puyer batuk", qty: 1, harga: 20000, jenis: "racikan",
      key: "racik-1", official_version_id: "formula", aturan_pakai: "3x1 bungkus" },
  ]))).resolves.toMatchObject({ saved: true, href: "/klinik/rekam-medis/visit?success=susulan" });
  const call = panggilan()!;
  expect(call.args).toMatchObject({ p_visit_id: "visit", p_request_key: "susulan-key" });
  expect(call.args.p_items).toEqual([
    expect.objectContaining({ nama_obat: "Amoxicillin", jenis: "obat", satuan: "tablet", faktor: 1, kategori: null, aturan_pakai: "3x1" }),
    // Kategori tindakan ikut: gerbang form persetujuan dinilai dari baris rekam medis.
    expect.objectContaining({ nama_obat: "Nebulizer", jenis: "jasa", kategori: "Lab" }),
  ]);
  expect(call.args.p_compounds).toEqual([
    expect.objectContaining({ sale_item_id: "racikan-sku", official_version_id: "formula", request_key: "racik-1", dosage_instruction: "3x1 bungkus" }),
  ]);
  // Rekam medis, resep cetak, dan layar Pembayaran ikut disegarkan.
  expect(fixture.revalidated).toEqual(expect.arrayContaining([
    "/klinik/rekam-medis/visit", "/klinik/rekam-medis/visit/resep", "/klinik/pembayaran/visit"]));
});

it("membaca ulang faktor satuan dari master, bukan dari angka yang dikirim form", async () => {
  fixture.units = [{ item_id: "obat", unit: "strip", factor: 10, sell_price: 45000 }];
  await expect(tambahItemRekamMedis(form([
    { item_id: "obat", nama_obat: "Amoxicillin", qty: 2, satuan: "strip", harga: 45000, jenis: "obat", faktor: 999 },
  ]))).resolves.toMatchObject({ saved: true });
  expect((panggilan()!.args.p_items as Record<string, unknown>[])[0]).toMatchObject({ satuan: "strip", faktor: 10 });
});

it("meneruskan BMHP tindakan hanya setelah kontraknya ada di database", async () => {
  const bmhp = [{ item_id: "obat", nama_obat: "Vaksinasi", qty: 1, satuan: "jasa", harga: 150000, jenis: "jasa",
    bmhp: [{ item_id: "syringe", nama: "DIKARANG", qty: 2, unit: "pcs", cost: 9 }] }];
  await expect(tambahItemRekamMedis(form(bmhp))).resolves.toMatchObject({ saved: true });
  const call = panggilan()!;
  expect((call.args.p_items as Record<string, unknown>[])[0]).toMatchObject({
    bmhp_components: [{ item_id: "syringe", qty: 2, unit: "pcs" }],
  });
  // Nama & biaya tidak pernah ikut dari layar; database yang mengisinya.
  expect(JSON.stringify(call.args)).not.toContain("DIKARANG");

  fixture.calls = [];
  fixture.supported = false;
  await expect(tambahItemRekamMedis(form(bmhp))).rejects.toThrow("REDIRECT");
  expect(panggilan()).toBeUndefined();
});

it("menolak keranjang kosong, racikan tanpa bahan, dan kunci permintaan yang hilang", async () => {
  await expect(tambahItemRekamMedis(form([]))).rejects.toThrow("REDIRECT");
  await expect(tambahItemRekamMedis(form([
    { item_id: null, nama_obat: "Racikan kosong", qty: 1, harga: 0, jenis: "racikan", key: "r", ingredients: [] },
  ]))).rejects.toThrow("REDIRECT");
  await expect(tambahItemRekamMedis(form([{ item_id: "obat", nama_obat: "A", qty: 1, harga: 1, jenis: "obat" }], "")))
    .rejects.toThrow("REDIRECT");
  expect(panggilan()).toBeUndefined();
});

it("meneruskan penolakan database apa adanya: tagihan sudah terbit berarti lewat koreksi", async () => {
  fixture.rpcError = { code: "P0001", message: "RECORD_LOCKED: tagihan sudah terbit atau kunjungan sudah ditutup" };
  await expect(tambahItemRekamMedis(form([{ item_id: "obat", nama_obat: "A", qty: 1, harga: 1, jenis: "obat" }])))
    .rejects.toThrow(/tambah-item\?error=.*koreksi%20tagihan/);
  expect(fixture.revalidated).toEqual([]);
});

it("kunci permintaan yang sama dikirim apa adanya supaya kiriman ulang tidak menggandakan item", async () => {
  const baris = [{ item_id: "obat", nama_obat: "A", qty: 1, harga: 1, jenis: "obat" }];
  await expect(tambahItemRekamMedis(form(baris, "ulang-1"))).resolves.toMatchObject({ saved: true });
  await expect(tambahItemRekamMedis(form(baris, "ulang-1"))).resolves.toMatchObject({ saved: true });
  expect(fixture.calls.filter(c => c.name === "clinic_add_record_items").map(c => c.args.p_request_key))
    .toEqual(["ulang-1", "ulang-1"]);
});
