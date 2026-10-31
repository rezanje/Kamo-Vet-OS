import React from "react";
import { beforeEach, it, expect, vi } from "vitest";

// Laporan Andri 29 Okt: di Detail rekam medis kartu racikan tidak punya jalan untuk
// menambah tindakan. Detail tidak boleh menulis sendiri (aturan BMHP & stok ada di
// form lain), jadi kartunya cuma mengantar ke form yang memang bisa menambah item.
const state = vi.hoisted(() => ({ allowed: true, failed: "", tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    rpc: async () => ({ data: state.allowed, error: state.failed === "rpc" ? {} : null }),
    from: (table: string) => {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const result = () => ({
        data: state.failed === table ? null : (state.tables[table] ?? []).filter(row => filters.every(match => match(row))),
        error: state.failed === table ? {} : null,
      });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        or: () => query, is: () => query, order: () => query, limit: () => query,
        range: async () => ({ ...result(), count: result().data?.length ?? 0 }),
        maybeSingle: async () => ({ ...result(), data: result().data?.[0] ?? null }),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ ...result(), count: result().data?.length ?? null }).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/dokter", () => ({ daftarDokter: async () => [] }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null }));
vi.mock("@/lib/rombongan-server", () => ({ bacaSaudaraKunjungan: async () => [] }));
vi.mock("@/lib/katalog-racikan-server", () => ({ bolehRacikKhusus: async () => false, loadKatalogRacikan: async () => [] }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/page";

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function texts(nodes: React.ReactElement<Record<string, unknown>>[]): string {
  return nodes
    .flatMap(node => React.Children.toArray(node.props.children as React.ReactNode))
    .filter((child): child is string => typeof child === "string")
    .join("\n");
}

beforeEach(() => {
  state.allowed = true;
  state.failed = "";
  state.tables = {
    visits: [{
      id: "visit", pet_id: "pet", branch_id: "branch", poli: "Poli Umum", status: "Pembayaran",
      created_at: "2026-10-28T00:00:00Z", checked_out_at: null, pets: { name: "Milo" }, customers: { name: "Pemilik" },
    }],
    medical_records: [{ id: "record", visit_id: "visit", clinical_revision: 1, anamnesis: "Catatan", penunjang_urls: [] }],
    prescription_items: [],
    compounding_recipes: [],
  };
});
const page = async (search: Record<string, string> = {}) =>
  elements(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve(search) }));
/** Tombol kartu "Tindakan & Racikan" saja — banner "Lanjut ke Pembayaran" di atasnya
 * kebetulan menuju alamat yang sama. */
const tombol = (nodes: React.ReactElement<Record<string, unknown>>[]) =>
  nodes.find(node => node.props["aria-label"] === "Tambah tindakan / obat")?.props.href ?? null;

it("renames the compound card so the doctor sees tindakan belongs there too", async () => {
  expect(texts(await page())).toContain("Tindakan & Racikan");
});

it("sends an inpatient still admitted to OBAT KHUSUS, opened on the tindakan tab", async () => {
  state.tables.inpatient_records = [{ id: "inap", visit_id: "visit", condition_status: "stabil", discharged_at: null }];
  const nodes = await page();
  expect(tombol(nodes)).toBe("/klinik/rawat-inap/inap/obat-khusus?tab=tindakan");
  expect(texts(nodes)).not.toContain("Rawat jalan: tindakan / obat susulan");
});

it("opens the susulan form for an unbilled outpatient instead of sending it to Pembayaran", async () => {
  const nodes = await page();
  // Koreksi rekam medis hanya menerima catatan klinis, jadi tombol tidak pernah ke sana.
  // Sejak opsi B (Andri 29 Okt) item susulan dicatat di rekam medis dulu, bukan di kasir.
  expect(tombol(nodes)).toBe("/klinik/rekam-medis/visit/tambah-item");
  expect(texts(nodes)).toContain("Rawat jalan: item susulan dicatat di rekam medis dulu");
});

it("prefers the inpatient note while admitted, but falls back once the patient went home", async () => {
  state.tables.inpatient_records = [{ id: "inap", visit_id: "visit", condition_status: "sembuh", discharged_at: "2026-10-28T09:00:00Z" }];
  expect(tombol(await page())).toBe("/klinik/rekam-medis/visit/tambah-item");
});

it("marks prescription rows that were added after the examination was saved", async () => {
  state.tables.prescription_items = [
    { medical_record_id: "record", nama_obat: "Amoxicillin", qty: 6, satuan: "tablet", aturan_pakai: "3x1", jenis: "obat" },
    { medical_record_id: "record", nama_obat: "Nebulizer", qty: 1, satuan: "jasa", aturan_pakai: null, jenis: "jasa",
      susulan_at: "2026-10-29T07:30:00Z", susulan_by_name: "Drh. Andri", susulan_source: "dokter" },
  ];
  const isi = texts(await page());
  expect(isi).toContain("Ditambahkan setelah pemeriksaan oleh Drh. Andri (dokter)");
  // Baris pemeriksaan asli tidak ikut diberi label.
  expect(isi.match(/Ditambahkan setelah pemeriksaan/g)).toHaveLength(1);
});

it("explains the billing correction route instead once an invoice exists", async () => {
  state.allowed = false;
  state.tables.invoices = [{ id: "invoice", visit_id: "visit" }];
  const nodes = await page();
  expect(tombol(nodes)).toBeNull();
  expect(texts(nodes)).toContain("Tagihan sudah dibuat — tambah item lewat koreksi tagihan di Pembayaran.");
});

it("says the visit is closed once it has been checked out", async () => {
  state.allowed = false;
  state.tables.visits[0].status = "Selesai";
  state.tables.visits[0].checked_out_at = "2026-10-28T10:00:00Z";
  const nodes = await page();
  expect(tombol(nodes)).toBeNull();
  expect(texts(nodes)).toContain("Kunjungan sudah selesai — tindakan baru dicatat di kunjungan berikutnya.");
});

it("keeps the examination form opening on the tab asked for in the address", async () => {
  state.tables.visits[0].status = "Diperiksa";
  const form = (await page({ tab: "tindakan" })).find(node => "tabAwal" in node.props)!;
  expect(form.props.tabAwal).toBe("tindakan");
  const plain = (await page()).find(node => "tabAwal" in node.props)!;
  expect(plain.props.tabAwal).toBeUndefined();
});
