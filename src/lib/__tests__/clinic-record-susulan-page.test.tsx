import React from "react";
import { beforeEach, expect, it, vi } from "vitest";

// Layar "Tambah tindakan / obat" rawat jalan (Andri 29 Okt, opsi B). Syarat masuknya
// diputuskan database (clinic_can_correct_record); layar hanya mengantar atau menolak.
const state = vi.hoisted(() => ({
  allowed: true as boolean,
  gateError: false as boolean,
  recordError: false as boolean,
  record: "record" as string | null,
  redirects: [] as string[],
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { state.redirects.push(href); throw new Error(`REDIRECT ${href}`); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
  rpc: async () => ({ data: state.allowed, error: state.gateError ? { message: "gate" } : null }),
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      range: async () => ({ data: [], error: null, count: 0 }),
      maybeSingle: async () => table === "visits"
        ? { data: { id: "visit", branch_id: "branch", poli: "Poli Umum", status: "Pembayaran", doctor_id: "doctor", checked_out_at: null, pets: { name: "Milo" }, customers: { name: "Pemilik" } }, error: null }
        : { data: state.record ? { id: state.record } : null, error: state.recordError ? { message: "read" } : null },
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return q;
  },
}) }));
vi.mock("@/lib/service-performers-server", () => ({
  loadServiceStaff: async () => [{ id: "staff", nama: "Perawat", jabatan: "Perawat" }],
  loadBranchGroomingPolicy: async () => ({ applies: false, doctorRequired: false }),
}));
vi.mock("@/lib/clinic-item-categories", () => ({
  loadClinicItemCategories: async () => [],
  splitClinicItems: () => ({
    obat: [{ id: "obat", name: "Amoxicillin", unit: "tablet", sell_price: 5000, stok: 9, item_type: "Persediaan", code: null, upc: null, tindakan_kategori: null, units: [] }],
    jasa: [{ id: "jasa", name: "Konsultasi", unit: "jasa", sell_price: 50000, stok: 0, item_type: "Jasa", code: null, upc: null, tindakan_kategori: null, units: [] }],
    tindakan: [{ id: "tindakan", name: "Nebulizer", unit: "jasa", sell_price: 75000, stok: 0, item_type: "Jasa", code: null, upc: null, tindakan_kategori: "Lab", units: [] }],
    racikan: [], bahan: [],
  }),
}));
vi.mock("@/lib/clinic-compound-skus", () => ({
  loadClinicCompoundSkus: async () => [],
  loadClinicSkuDetails: async () => ({ stock: new Map(), units: new Map(), prices: new Map() }),
}));
vi.mock("@/lib/katalog-racikan-server", () => ({ bolehRacikKhusus: async () => false, loadKatalogRacikan: async () => [] }));
vi.mock("@/lib/checked-list", () => ({ readCompleteList: async () => [] }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/tambah-item/TambahItemForm", () => ({ TambahItemForm: () => null }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/tambah-item/page";

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
const page = async () => elements(await Page({
  params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}),
}));

beforeEach(() => {
  state.allowed = true; state.gateError = false; state.recordError = false; state.record = "record"; state.redirects = [];
});

it("membuka form dengan tab yang sama seperti form pemeriksaan untuk rawat jalan yang belum ditagih", async () => {
  const form = (await page()).find(node => "tindakanItems" in node.props)!;
  expect(form.props).toMatchObject({ visitId: "visit", visitDoctorId: "doctor" });
  expect(form.props.items).toHaveLength(1);
  expect(form.props.jasaItems).toHaveLength(1);
  expect(form.props.tindakanItems).toHaveLength(1);
  expect(form.props.serviceStaff).toHaveLength(1);
  // Kunci permintaan dibuat server per pembukaan form: kiriman ulang tidak menggandakan item.
  expect(String(form.props.requestKey)).toMatch(/^[0-9a-f-]{36}$/);
});

it("menolak kunjungan yang sudah ditagih atau sudah selesai, dengan alasan di layar Detail", async () => {
  state.allowed = false;
  await expect(page()).rejects.toThrow("REDIRECT");
  expect(state.redirects[0]).toContain("/klinik/rekam-medis/visit?error=");
  expect(decodeURIComponent(state.redirects[0])).toContain("koreksi tagihan di Pembayaran");
});

it("gagal tertutup bila izin atau rekam medis tidak terbaca", async () => {
  state.gateError = true;
  await expect(page()).rejects.toThrow("REDIRECT");
  state.gateError = false; state.recordError = true;
  await expect(page()).rejects.toThrow("REDIRECT");
  state.recordError = false; state.record = null;
  await expect(page()).rejects.toThrow("REDIRECT");
  expect(decodeURIComponent(state.redirects[2])).toContain("Rekam medis belum tersimpan");
});
