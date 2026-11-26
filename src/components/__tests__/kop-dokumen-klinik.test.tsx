// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Resep dan formulir persetujuan memakai kop CABANG KUNJUNGAN yang sama dengan rekam medis (logo, nama, alamat, telepon).
// Data sintetis; halaman dirender sungguhan.
const BR = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const LOGO = `cabang-logo/${BR}/1700000000000-ab12cd34.png`;
const state = vi.hoisted(() => ({
  branchId: null as string | null,
  branchName: null as string | null,
  identity: { data: null, error: null } as { data: unknown; error: unknown },
  identityThrows: false,
  signedThrows: false,
  signedPaths: [] as string[],
  eqs: [] as string[],
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/resep/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("../../app/(app)/klinik/rekam-medis/[visitId]/resep/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: (bucket: string) => ({
      createSignedUrl: async (path: string) => {
        if (state.signedThrows) throw new Error("boom");
        state.signedPaths.push(`${bucket}:${path}`);
        return { data: { signedUrl: "https://storage.test/sign/dokumen/logo.png?token=t1" }, error: null };
      },
    }) },
    from(table: string) {
      const visitRow = { id: "visit", dokter: "drh. Fiktif", poli: "Poli Umum", created_at: "2026-11-26T03:00:00Z",
        ...(state.branchId ? { branch_id: state.branchId } : { branch_id: null }),
        pets: { name: "Pasien Fiktif", species: "Kucing", breed: null, weight: null }, customers: { name: "Pemilik Fiktif", phone: "08000000001" },
        branches: state.branchName ? { name: state.branchName, code: "FIK" } : null };
      const hasil = (): { data: unknown; error: unknown } => {
        if (table === "branches") { if (state.identityThrows) throw new Error("boom"); return state.identity; }
        if (table === "visits") return { data: visitRow, error: null };
        if (table === "medical_records") return { data: { id: "mr-1", diagnosis: "Dx" }, error: null };
        if (table === "consents") return { data: { id: "c-1", tindakan: "Tindakan Fiktif", isi_snapshot: "Isi persetujuan fiktif.", status: "belum_ttd", signer_name: null, signature_data: null, signed_at: null, created_at: "2026-11-26T03:00:00Z", visit_id: "visit", visits: visitRow }, error: null };
        return { data: [], error: null };
      };
      const q = {
        select: () => q, is: () => q, in: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: string) => { state.eqs.push(`${table}.${c}=${v}`); return q; },
        maybeSingle: async () => { const r = hasil(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(hasil()).then(resolve),
      };
      return q;
    },
  }),
}));

import ResepPage from "../../app/(app)/klinik/rekam-medis/[visitId]/resep/page";
import ConsentPage from "../../app/(app)/klinik/consent/[consentId]/page";
const resep = async () => renderToStaticMarkup(await ResepPage({ params: Promise.resolve({ visitId: "visit" }) }));
const consent = async () => renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ consentId: "c-1" }) }));
const lengkap = { data: { alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logo_path: LOGO }, error: null };

beforeEach(() => {
  state.branchId = BR; state.branchName = "Kamo Pets Clinic Cimanggu"; state.identity = lengkap;
  state.identityThrows = false; state.signedThrows = false; state.signedPaths = []; state.eqs = [];
});

describe.each([
  ["resep", resep, "RESEP"],
  ["formulir persetujuan", consent, "SURAT PERSETUJUAN TINDAKAN"],
])("kop %s per cabang kunjungan", (_nama, render, judul) => {
  it("cabang lengkap: logo cabang, nama cabang, alamat + telepon; merek tetap 'KAMO PET CARE' dan tagline tidak ada; judul dokumen tetap", async () => {
    const h = await render();
    expect(h).toContain('data-kop="cabang"');
    expect(h).toContain("Kamo Pets Clinic Cimanggu");
    expect(h).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(h).toContain('src="https://storage.test/sign/dokumen/logo.png?token=t1"');
    expect(h).not.toContain("KAMO PET CARE"); expect(h).not.toContain("WE CARE, THEY DESERVE");
    expect(h).toContain(judul);
    expect(state.eqs).toContain(`branches.id=${BR}`);
    expect(state.signedPaths).toEqual([`dokumen:${LOGO}`]);
  });
  it("tanpa logo/alamat/telepon: logo cakar bawaan + nama cabang + tagline lama", async () => {
    state.identity = { data: { alamat: null, telepon: null, logo_path: null }, error: null };
    const h = await render();
    expect(h).toContain("data-kop-logo-bawaan"); expect(h).toContain("Kamo Pets Clinic Cimanggu"); expect(h).toContain("WE CARE, THEY DESERVE");
    expect(h).not.toContain("<img"); expect(state.signedPaths).toEqual([]);
  });
  it("kunjungan tanpa cabang: 'KAMO PET CARE' + tagline, tanpa membaca identitas", async () => {
    state.branchId = null; state.branchName = null;
    const h = await render();
    expect(h).toContain("KAMO PET CARE"); expect(h).toContain("WE CARE, THEY DESERVE");
    expect(state.eqs.some((e) => e.startsWith("branches."))).toBe(false);
  });
  it("gagal tautan logo atau gagal baca identitas: dokumen tetap tercetak dengan nama cabang", async () => {
    state.signedThrows = true;
    let h = await render();
    expect(h).toContain("Kamo Pets Clinic Cimanggu"); expect(h).toContain("Telp. 0251 8888"); expect(h).not.toContain("<img"); expect(h).toContain(judul);
    state.signedThrows = false; state.identityThrows = true;
    h = await render();
    expect(h).toContain("Kamo Pets Clinic Cimanggu"); expect(h).toContain("data-kop-logo-bawaan"); expect(h).toContain(judul);
  });
});
