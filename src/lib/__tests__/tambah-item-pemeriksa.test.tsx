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
  visit: {} as Record<string, unknown>, doctorRequired: true as boolean,
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
        ? { data: state.visit, error: null }
        : { data: state.record ? { id: state.record } : null, error: state.recordError ? { message: "read" } : null },
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return q;
  },
}) }));
vi.mock("@/lib/service-performers-server", () => ({
  loadServiceStaff: async () => [{ id: "staff", nama: "Perawat", jabatan: "Perawat" }],
  loadBranchGroomingPolicy: async () => ({ applies: true, doctorRequired: state.doctorRequired }),
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
const visitDasar = { id: "visit", branch_id: "branch", poli: "Grooming", status: "Pembayaran", doctor_id: "groomer", pemeriksa_id: "dokter-p", checked_out_at: null, pets: { name: "Milo" }, customers: { name: "Pemilik" } };
const formProps = async () => (elements(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) })).find(node => "tindakanItems" in node.props)!).props;

beforeEach(() => {
  state.allowed = true; state.gateError = false; state.recordError = false; state.record = "record"; state.redirects = [];
  state.visit = { ...visitDasar }; state.doctorRequired = true;
});

// Tambah item di rekam medis memakai isian awal Dokter yang sama dengan kasir (dokter pemeriksa dari antrian Grooming).
it("Grooming + pemeriksa + cabang mewajibkan dokter: isian awal Dokter = pemeriksa", async () => {
  expect((await formProps()).visitDoctorId).toBe("dokter-p");
});
it("cabang tidak mewajibkan dokter pada Grooming: perilaku lama (groomer)", async () => {
  state.doctorRequired = false;
  expect((await formProps()).visitDoctorId).toBe("groomer");
});
it("tanpa pemeriksa / poli lain: perilaku lama persis", async () => {
  state.visit = { ...visitDasar, pemeriksa_id: null };
  expect((await formProps()).visitDoctorId).toBe("groomer");
  state.visit = { ...visitDasar, poli: "Poli Umum", doctor_id: "doctor" };
  expect((await formProps()).visitDoctorId).toBe("doctor");
});
