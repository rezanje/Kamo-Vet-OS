import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), lama: vi.fn(), katalog: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ubah-struk-server", () => ({ loadStrukUbah: fixture.lama, loadKatalogUntuk: fixture.katalog }));
import { ubahTransaksi } from "@/app/(app)/penjualan/[id]/actions";
import { revalidatePath } from "next/cache";

const id = "e8700000-0000-4000-8000-000000000001", newId = "e8700000-0000-4000-8000-000000000002", GOOD = "a0000000-0000-4000-8000-000000000001";
const isian = { lines: [{ asal: "l1", item_id: GOOD, qty: 3, harga: 50000, satuan: "pcs" }], diskon_kategori: 0, potongan_lain: 0, payments: [{ method: "Transfer", amount: 150000 }] };
function form(over: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ id, revision: "0", requestKey: "key-1", alasan: "Salah input jumlah", isian: JSON.stringify(isian), ...over }).forEach(([k, v]) => data.set(k, v));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.lama.mockResolvedValue({ id, revision: 0, voided_at: null, customer_id: null, poin_digunakan: 0, subtotal: 100000, discount: 0, diskon_kategori: 0, rupiahPerPoin: null,
    items: [{ id: "l1", item_id: GOOD, nama: "Pakan", qty: 2, harga: 50000, satuan: "pcs", faktor: 1, target_species: "Universal", service_performers: null,
      item_discount_type: null, item_discount_value: 0, promo_id: null, promo_discount: 0, quantity_pool_claim: false, promo_claim_id: null,
      promo_sets: 0, promo_syarat_units: 0, promo_hasil_units: 0, promo_floor_waiver: false, source_position: 0, components: [] }] });
  fixture.katalog.mockResolvedValue(new Map([[GOOD, { id: GOOD, nama: "Pakan", item_type: "Persediaan", is_active: true, units: [{ unit: "pcs", factor: 1 }] }]]));
  fixture.rpc.mockResolvedValue({ data: { old_sale_id: id, sale_id: newId, no_struk: "POS-1-U1", edit_id: "edit" }, error: null });
});

it("sends the rebuilt receipt to the atomic RPC and opens the new receipt", async () => {
  await expect(ubahTransaksi(form())).rejects.toThrow(`/penjualan/${newId}?success=edited`);
  expect(fixture.rpc).toHaveBeenCalledWith("edit_posted_pos_sale", expect.objectContaining({
    p_sale_id: id, p_expected_revision: 0, p_request_key: "key-1", p_reason: "Salah input jumlah",
    p_edit: expect.objectContaining({ header: expect.objectContaining({ subtotal: 150000, total: 150000, metode_bayar: "Transfer" }) }),
  }));
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it("returns readable refusals for invalid input without calling the database", async () => {
  await expect(ubahTransaksi(form({ alasan: "x" }))).resolves.toMatchObject({ ok: false, outcome: "rejected" });
  await expect(ubahTransaksi(form({ isian: JSON.stringify({ ...isian, payments: [{ method: "Tunai", amount: 1 }] }) }))).resolves.toMatchObject({ message: expect.stringMatching(/harus sama dengan total/) });
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("refuses a stale receipt before the database", async () => {
  fixture.lama.mockResolvedValue({ id, revision: 1, voided_at: "x", items: [] });
  await expect(ubahTransaksi(form())).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/sudah berubah/) });
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("shows a database refusal instead of the hidden production error", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Periode tanggal struk atau hari ini sudah ditutup buku" } });
  await expect(ubahTransaksi(form())).resolves.toEqual({ ok: false, outcome: "rejected", message: "Periode tanggal struk atau hari ini sudah ditutup buku" });
  expect(revalidatePath).not.toHaveBeenCalled();
});
it("does not acknowledge an unconfirmed result", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(ubahTransaksi(form())).rejects.toThrow(/belum terkonfirmasi/);
});
