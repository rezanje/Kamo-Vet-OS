import { beforeEach, expect, it, vi } from "vitest";

// Keputusan pemilik 29 Okt 2026 pada jalur klinik: penerbitan tagihan baru DAN
// koreksi tagihan (temuan audit S-4, koreksi tidak boleh menaikkan potongan).
const state = vi.hoisted(() => ({
  peran: "STAFF" as string | null,
  existing: false, diskonLama: 0, barisLama: [] as { id: string; diskon_persen: number }[],
  barisLamaError: false,
  calls: [] as { name: string; params: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: vi.fn() }));
vi.mock("@/lib/voucher", () => ({ normalizeKode: () => "", pesanVoucherDitolak: vi.fn(), potonganVoucher: vi.fn() }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: vi.fn(async () => true) }));
vi.mock("@/lib/clinic-payment", async () => await import("../clinic-payment"));
vi.mock("@/lib/klinik-posting", async () => await import("../klinik-posting"));
vi.mock("@/lib/poin-klinik", async () => await import("../poin-klinik"));
vi.mock("@/lib/tagihan-klinik", () => ({
  nilaiBaris: (r: { qty: number; harga: number; diskon_persen?: number }) =>
    r.qty * r.harga * (1 - (Number(r.diskon_persen) || 0) / 100),
  hargaNetto: (r: { harga: number }) => r.harga,
  hitungPotonganKlinik: async () => ({ total: 0, tolakVoucher: null }),
  barisTagihanVisit: vi.fn(), bagiPotongan: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "aktor" } } }) },
  from(table: string) {
    const invoice = {
      id: "invoice", visit_id: "visit", invoice_no: "INV-UJI", request_key: "kunci-lama",
      subtotal: 100, discount: state.diskonLama, tax: 0, total: 100 - state.diskonLama,
      dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "Tunai", voucher_code: null,
      correction_pending: false, service_pricing_version: null, salesperson_id: null,
    };
    const single = () => ({ data:
      table === "profiles" ? (state.peran ? { role: state.peran, is_active: true } : null)
      : table === "role_capabilities" ? null
      : table === "medical_records" ? { id: "rekam" }
      : table === "visits" ? { branch_id: "branch", customer_id: null, doctor_id: null, service_provider_id: null }
      // Pembacaan nomor invoice SETELAH posting harus menemukan barisnya.
      : table === "invoices" ? (state.existing || state.calls.some(c => c.name.startsWith("clinic_post")) ? invoice : null)
      : null, error: null });
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      update: () => query, insert: () => query,
      maybeSingle: async () => single(), single: async () => single(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(
        table === "invoice_items"
          ? { data: state.barisLamaError ? null : state.barisLama, error: state.barisLamaError ? { message: "tidak terbaca" } : null }
          : { data: [], error: null },
      ).then(resolve),
    };
    return query;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    return { data: name.startsWith("clinic_post") ? "invoice" : null, error: null };
  },
}) }));

import { bayarVisit } from "@/app/(app)/klinik/pembayaran/[visitId]/actions";
import { PESAN_DISKON_MANUAL } from "../akses-diskon";

beforeEach(() => {
  state.peran = "STAFF"; state.existing = false; state.diskonLama = 0;
  state.barisLama = []; state.barisLamaError = false; state.calls = [];
});

type Baris = Record<string, unknown>;
function form(opsi: { discount?: number; baris?: Baris; requestKey?: string } = {}) {
  const data = new FormData();
  data.set("visitId", "visit");
  data.set("requestKey", opsi.requestKey ?? "kunci-baru");
  data.set("edit_reason", "Alasan koreksi");
  data.set("discount", String(opsi.discount ?? 0));
  data.set("items", JSON.stringify([{ deskripsi: "Konsultasi", qty: 1, harga: 100, jenis: "jasa", item_id: "item", ...(opsi.baris ?? {}) }]));
  return data;
}
const jalankan = (p: Promise<unknown>) => p.then(() => "sukses", (error: Error) => decodeURIComponent(error.message));

it("tagihan baru: diskon tagihan dari akun tanpa hak ditolak sebelum posting", async () => {
  expect(await jalankan(bayarVisit(form({ discount: 30 })))).toContain(PESAN_DISKON_MANUAL);
  expect(state.calls).toEqual([]);
});

it("tagihan baru: diskon per baris dari akun tanpa hak ditolak", async () => {
  expect(await jalankan(bayarVisit(form({ baris: { diskon_persen: 10 } })))).toContain(PESAN_DISKON_MANUAL);
  expect(state.calls).toEqual([]);
});

it("tagihan baru: keuangan boleh, dan rincian potongan ikut dikirim ke database", async () => {
  state.peran = "FINANCE";
  expect(await jalankan(bayarVisit(form({ discount: 30 })))).toEqual("sukses");
  expect(state.calls[0]).toMatchObject({
    name: "clinic_post_invoice",
    params: { p_invoice: { discount: 30, manual_discount: 30, auto_discount: 0, manual_discount_by: "aktor" } },
  });
});

it("tagihan baru tanpa diskon tetap jalan untuk kasir, tanpa jejak pemberi diskon", async () => {
  expect(await jalankan(bayarVisit(form()))).toEqual("sukses");
  expect(state.calls[0].params.p_invoice).toMatchObject({ manual_discount: 0, auto_discount: 0 });
  expect(state.calls[0].params.p_invoice).not.toHaveProperty("manual_discount_by");
});

it("koreksi: kasir boleh mempertahankan potongan lama (promo tidak dihitung ulang saat koreksi)", async () => {
  state.existing = true; state.diskonLama = 30;
  expect(await jalankan(bayarVisit(form({ discount: 30 })))).toEqual("sukses");
  expect(state.calls[0].name).toBe("clinic_edit_invoice");
});

it("koreksi: kasir tidak boleh MENAIKKAN potongan nota (temuan audit S-4)", async () => {
  state.existing = true; state.diskonLama = 30;
  expect(await jalankan(bayarVisit(form({ discount: 31 })))).toContain(PESAN_DISKON_MANUAL);
  expect(state.calls).toEqual([]);
});

it("koreksi: kasir boleh menurunkan potongan nota", async () => {
  state.existing = true; state.diskonLama = 30;
  expect(await jalankan(bayarVisit(form({ discount: 10 })))).toEqual("sukses");
});

it("koreksi: diskon baris tidak boleh melebihi baris asalnya, boleh sama", async () => {
  state.existing = true; state.barisLama = [{ id: "baris-lama", diskon_persen: 10 }];
  expect(await jalankan(bayarVisit(form({ baris: { diskon_persen: 10, source_invoice_item_id: "baris-lama" } })))).toEqual("sukses");
  state.calls = [];
  expect(await jalankan(bayarVisit(form({ baris: { diskon_persen: 25, source_invoice_item_id: "baris-lama" } })))).toContain(PESAN_DISKON_MANUAL);
  expect(state.calls).toEqual([]);
});

it("koreksi: baris baru tanpa asal tidak boleh membawa diskon sendiri", async () => {
  state.existing = true;
  expect(await jalankan(bayarVisit(form({ baris: { diskon_persen: 5 } })))).toContain(PESAN_DISKON_MANUAL);
});

it("koreksi: rincian lama yang tidak terbaca dianggap kenaikan (gagal tertutup)", async () => {
  state.existing = true; state.barisLamaError = true;
  expect(await jalankan(bayarVisit(form({ baris: { diskon_persen: 5, source_invoice_item_id: "baris-lama" } })))).toContain(PESAN_DISKON_MANUAL);
});

it("koreksi: pemilik tetap boleh menaikkan potongan", async () => {
  state.peran = "OWNER"; state.existing = true; state.diskonLama = 0;
  expect(await jalankan(bayarVisit(form({ discount: 40, baris: { diskon_persen: 10 } })))).toEqual("sukses");
  expect(state.calls[0].name).toBe("clinic_edit_invoice");
});
