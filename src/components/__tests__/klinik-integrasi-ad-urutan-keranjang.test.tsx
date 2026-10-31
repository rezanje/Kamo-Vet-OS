import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, fictionalCatalogue, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Integrasi A<->D: bacaan paralel paket A tidak boleh membaca baris resep SEBELUM versi
// keranjang (paket D) selesai dibaca. Kontraknya: versi yang dikirim form harus
// menggambarkan persis baris yang ditampilkan, atau LEBIH LAMA (server lalu menolak
// CART_STALE). Kalau baris dibaca lebih dulu lalu dokter menambah item sebelum versi
// dibaca, layar menampilkan keranjang lama dengan versi baru -> item dokter lolos tak
// tertagih. Tes ini memakai klien tiruan bergelombang (round-trip) dengan "database"
// berstatus: tepat setelah bacaan pertama dari pasangan {baris resep, versi} dijawab,
// dokter menyisipkan item susulan.
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  form: null as null | { sourceVersion?: string; initialObat: { prescription_item_id?: string | null }[]; initialJasa: { prescription_item_id?: string | null }[] },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({ PembayaranForm: (props: NonNullable<typeof s.form>) => { s.form = props; return null; } }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({ InpatientCashier: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

const catalogue = fictionalCatalogue(50);
const visit = { id: "visit-a", status: "Pembayaran", poli: "Poli Umum", dokter: "Drh Fiksi", created_at: "2026-10-31T02:00:00Z", branch_id: "branch-a", customer_id: "cust-a", doctor_id: "doc-a", service_provider_id: null, pets: { name: "Milo", species: "Kucing", weight: 4, photo_url: null }, customers: { name: "Pemilik Fiksi", phone: "0800", address: null, review_catatan: null, customer_review_statuses: null } };
const awal = { id: "rx-a", nama_obat: "Jasa periksa", qty: 1, harga: 100000, jenis: "jasa", kategori: null, item_id: catalogue[0].id, satuan: "jasa", compound_recipe_id: null };
const susulan = { id: "rx-susulan", nama_obat: "Obat susulan dokter", qty: 1, harga: 25000, jenis: "obat", kategori: null, item_id: catalogue[1].id, satuan: "pcs", compound_recipe_id: null };

// "Database": baris resep tertunda kunjungan + versi = sidik baris itu (seperti D).
const db = { rows: [] as typeof awal[], inserted: false, order: [] as string[] };
const versionOf = (rows: typeof awal[]) => `v1:${createHash("md5").update(JSON.stringify(rows.map((r) => r.id))).digest("hex")}`;
function doctorInsertsAfterFirstOf(name: string) {
  db.order.push(name);
  if (!db.inserted) { db.inserted = true; db.rows = [...db.rows, susulan]; }
}

function respond(call: Call) {
  if (call.kind === "auth") return {};
  if (call.kind === "rpc") {
    if (call.name === "clinic_outpatient_cart_version") {
      const reply = { data: versionOf(db.rows) };
      doctorInsertsAfterFirstOf("versi");
      return reply;
    }
    if (call.name === "clinic_invoice_correction_eligible") return { data: false };
    if (call.name === "clinic_manual_invoice_units_supported") return { data: true };
    if (call.name === "clinic_demo_care_staff") return { data: [] };
    return { data: null };
  }
  switch (call.name) {
    case "visits":
      if (filterOf(call, "eq", "id") === "visit-a") return { data: visit };
      return { data: [{ id: "visit-a", status: "Pembayaran", created_at: visit.created_at, branch_id: "branch-a", customer_id: "cust-a", pets: { name: "Milo" }, invoices: [] }] };
    case "medical_records": return { data: { id: "record-a", catatan_resep: null } };
    case "inpatient_records": return { data: null };
    case "invoices": return { data: [] };
    case "prescription_items": {
      const reply = { data: db.rows.map((r) => ({ ...r })) };
      doctorInsertsAfterFirstOf("baris");
      return reply;
    }
    case "pajak_settings": return { data: { mode_pkp: false, ppn_rate: 11 } };
    case "profiles": return { data: { role: "ADMIN", full_name: "Kasir Fiksi", is_active: true } };
    case "cashier_shifts": return { data: { id: "shift-a", branch_id: "branch-a", opening_balance: 0, opened_at: "2026-10-31T00:00:00Z", branches: { name: "Cabang A", code: "A" } } };
    case "items": return paged(call, catalogue);
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    default: return undefined;
  }
}

beforeEach(() => { db.rows = [awal]; db.inserted = false; db.order = []; s.form = null; });

it("item dokter yang masuk di antara dua bacaan tidak pernah lolos dengan versi segar", async () => {
  s.rt = roundTripClient(respond);
  renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) }));
  report("pembayaran open (integrasi A+C+D, versi sebelum resep)", s.rt);
  const shown = [...s.form!.initialObat, ...s.form!.initialJasa].map((r) => r.prescription_item_id);
  const current = versionOf(db.rows);
  // Inti kontrak: versi yang akan dikirim SAMA dengan versi database sekarang hanya bila
  // keranjang yang tampil memuat semua baris tertunda sekarang (termasuk item dokter).
  if (s.form!.sourceVersion === current) expect(shown).toEqual(db.rows.map((r) => r.id));
  // Dan secara khusus: item susulan tidak boleh hilang dari layar sekaligus "segar".
  expect(!shown.includes("rx-susulan") && s.form!.sourceVersion === current).toBe(false);
});

it("urutan nyata: bacaan baris resep baru berangkat SESUDAH versi keranjang dijawab", async () => {
  s.rt = roundTripClient(respond);
  await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) });
  const versi = s.rt.calls.find((c) => c.kind === "rpc" && c.name === "clinic_outpatient_cart_version")!;
  const baris = s.rt.calls.filter((c) => c.name === "prescription_items");
  expect(baris).toHaveLength(1);
  expect(baris[0].wave).toBeGreaterThan(versi.wave);
  expect(db.order[0]).toBe("versi");
  // Bacaan lain paket A tetap paralel: versi berangkat di gelombang awal yang sama dengan invoice.
  const invoices = s.rt.calls.find((c) => c.name === "invoices")!;
  expect(versi.wave).toBe(invoices.wave);
});

it("tagihan yang sudah terbit tidak gagal karena versi keranjang (hanya tagihan baru yang memakainya)", async () => {
  // Versi error pada halaman invoice tersimpan: diabaikan, bukan galat layar.
  const paid = { id: "inv-a", invoice_no: "INV/1", subtotal: 1000, discount: 0, tax: 0, total: 1000, dp_amount: 0, dp_date: null, paid_status: "Lunas", metode_bayar: "Tunai", paid_at: "2026-10-31T03:00:00Z", reissued_from: null, correction_pending: false, created_at: "2026-10-31T03:00:00Z", request_key: "k", salesperson_id: null, cashier_name: "Kasir Fiksi", service_pricing_version: 1 };
  s.rt = roundTripClient((call) => call.kind === "rpc" && call.name === "clinic_outpatient_cart_version"
    ? { error: { code: "57014", message: "timeout" } }
    : call.name === "invoices" ? { data: [paid] } : respond(call));
  await expect(Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({ success: "bayar" }) })).resolves.toBeTruthy();
});
