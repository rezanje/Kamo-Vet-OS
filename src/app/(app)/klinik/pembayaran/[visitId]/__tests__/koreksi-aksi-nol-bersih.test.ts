// Jalur kirim yang sebenarnya: form koreksi -> aksi `bayarVisit` -> RPC publik
// `clinic_edit_invoice_with_record` (atau RPC lama hanya bila wrapper belum tersedia).
// Yang diperiksa di sini adalah muatan yang dikirim aksi,
// bukan penolong terpisah: uang muka kepala diambil dari tagihan TERSIMPAN (bukan
// dari isian pengirim), status pembayaran tidak berubah, dan riwayat pembayaran
// yang sudah dibalik tidak ikut dikirim sebagai "uang baru".
//
// Bahwa RPC publiknya menerima muatan ini — untuk tagihan tahap pasien yang masih
// dirawat maupun yang sudah pulang — diuji dengan PostgreSQL asli di
// scripts/test-ranap-mitigasi-penuh-postgres.py (IND03-dirawat, IND03-sudah-pulang,
// R2-01-nol-bersih-keuangan-dikoreksi, R2-02-kepala-dp-keuangan-boleh).
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dp: 0,
  paidStatus: "Belum Lunas",
  correctionPending: false,
  wrapperError: null as { code: string; message: string } | null,
  calls: [] as { name: string; params: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/clinic-payment", async () => await import("@/lib/clinic-payment"));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "keuangan" } } }) },
  from(table: string) {
    const invoice = { id: "tagihan", visit_id: "visit", invoice_no: "INV-TAHAP-2", request_key: "kunci-tersimpan",
      subtotal: 100000, discount: 0, tax: 0, total: 100000, dp_amount: state.dp, paid_status: state.paidStatus,
      metode_bayar: "Tunai", voucher_code: null, correction_pending: state.correctionPending,
      service_pricing_version: 1, salesperson_id: null };
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, update: () => q, insert: () => q,
      maybeSingle: async () => ({ data:
        table === "invoices" ? invoice
        : table === "visits" ? { branch_id: "cabang", customer_id: null, doctor_id: null, service_provider_id: null }
        : table === "medical_records" ? { id: "rm" }
        : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    if (name === "clinic_edit_invoice_with_record" && state.wrapperError) {
      return { data: null, error: state.wrapperError };
    }
    return { data: "tagihan", error: null };
  },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/tanggal", async () => await import("@/lib/tanggal"));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: vi.fn() }));
vi.mock("@/lib/tagihan-klinik", () => ({ nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga,
  hargaNetto: (r: { harga: number }) => r.harga, hitungPotonganKlinik: async () => ({ total: 0, tolakVoucher: null }),
  barisTagihanVisit: vi.fn(), bagiPotongan: vi.fn() }));
vi.mock("@/lib/voucher", () => ({ normalizeKode: () => "", pesanVoucherDitolak: vi.fn(), potonganVoucher: vi.fn() }));
vi.mock("@/lib/klinik-posting", async () => await import("@/lib/klinik-posting"));
vi.mock("@/lib/poin-klinik", async () => await import("@/lib/poin-klinik"));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: vi.fn() }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
import { bayarVisit } from "@/app/(app)/klinik/pembayaran/[visitId]/actions";

function form(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("visitId", "visit");
  f.set("requestKey", "kunci-koreksi");
  f.set("items", JSON.stringify([
    { deskripsi: "Jasa Rawat Inap Fiktif", qty: 1, harga: 100000, jenis: "jasa" },
    { deskripsi: "Obat Fiktif", qty: 2, harga: 25000, jenis: "obat", item_id: "barang" },
  ]));
  f.set("edit_reason", "Koreksi fiktif");
  f.set("paid_status", state.paidStatus);
  f.set("metode_bayar", "Tunai");
  f.set("dp_amount", String(state.dp));
  for (const [k, v] of Object.entries(patch)) f.set(k, v);
  return f;
}

beforeEach(() => { state.dp = 0; state.paidStatus = "Belum Lunas"; state.correctionPending = false; state.wrapperError = null; state.calls = []; });

it("mengirim koreksi riwayat nol-bersih lewat wrapper rekam medis tanpa uang baru", async () => {
  await expect(bayarVisit(form())).resolves.toMatchObject({ saved: true, href: "/klinik/pembayaran/visit?success=edit" });
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({ name: "clinic_edit_invoice_with_record", params: {
    p_invoice_id: "tagihan",
    p_invoice: { dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "Tunai", total: 150000, reason: "Koreksi fiktif" },
  } });
  expect((state.calls[0].params.p_lines as unknown[])).toHaveLength(2);
});

it("memakai RPC lama hanya bila exact wrapper tidak ditemukan di schema cache, dengan muatan identik", async () => {
  state.wrapperError = { code: "PGRST202", message: "Could not find the function public.clinic_edit_invoice_with_record(p_invoice, p_invoice_id, p_lines, p_request_key) in the schema cache" };
  await expect(bayarVisit(form())).resolves.toMatchObject({ saved: true });
  expect(state.calls.map((call) => call.name)).toEqual(["clinic_edit_invoice_with_record", "clinic_edit_invoice"]);
  expect(state.calls[1].params).toEqual(state.calls[0].params);
  expect(state.calls[1].params.p_invoice).toMatchObject({ dp_amount: 0, paid_status: "Belum Lunas", total: 150000 });
  expect(state.calls[1].params.p_lines).toHaveLength(2);
});

it("penolakan wrapper menghentikan koreksi, tidak mencoba RPC lama", async () => {
  state.wrapperError = { code: "P0001", message: "ACCESS_DENIED: pengguna tidak diizinkan" };
  await expect(bayarVisit(form())).rejects.toThrow("?error=");
  expect(state.calls.map((call) => call.name)).toEqual(["clinic_edit_invoice_with_record"]);
});

it("memakai uang muka kepala yang TERSIMPAN, bukan angka dari pengirim", async () => {
  state.dp = 60000; state.paidStatus = "DP";
  await expect(bayarVisit(form({ dp_amount: "999999" }))).resolves.toMatchObject({ saved: true });
  expect(state.calls[0].params.p_invoice).toMatchObject({ dp_amount: 60000, paid_status: "DP" });
});

it("menolak koreksi yang mengubah status pembayaran sebelum menyentuh basis data", async () => {
  await expect(bayarVisit(form({ paid_status: "Lunas" }))).rejects.toThrow("?error=");
  expect(state.calls).toEqual([]);
});
