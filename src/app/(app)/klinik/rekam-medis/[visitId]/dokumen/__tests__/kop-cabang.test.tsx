import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kop rekam medis = identitas CABANG KUNJUNGAN (logo, nama, alamat, telepon); kunjungan tanpa cabang tetap KAMO PET CARE.
// Halaman dirender sungguhan dengan sumber data tiruan.
const BR = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const state = vi.hoisted(() => ({
  visitBranchId: null as string | null,
  branchName: null as string | null,
  identity: { data: null, error: null } as { data: unknown; error: unknown },
  identityThrows: false,
  signed: { data: { signedUrl: "https://storage.test/sign/dokumen/logo.png?token=t1" }, error: null } as { data: { signedUrl: string } | null; error: unknown },
  signedThrows: false,
  signedPaths: [] as string[],
  selects: [] as string[],
  eqs: [] as [string, string][],
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/clinic-record-addenda", () => ({ loadRecordAddenda: async () => ({ state: "ok", rows: [] }), addendumAuthor: () => "—" }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/supabase/server", () => {
  class Query {
    constructor(private table: string) {}
    select(s: string) { state.selects.push(`${this.table}:${s}`); return this; }
    eq(c: string, v: string) { state.eqs.push([`${this.table}.${c}`, v]); return this; }
    is() { return this; } in() { return this; } order() { return this; } limit() { return this; }
    private hasil(): { data: unknown; error: unknown } {
      if (this.table === "visits") return { data: {
        id: "vis-1", poli: "Poli Umum", dokter: "drh. Fiktif", keluhan: "-", status: "Selesai", created_at: "2026-11-03T02:00:00Z",
        ...(state.visitBranchId ? { branch_id: state.visitBranchId } : { branch_id: null }),
        pets: { name: "Pasien Fiktif", species: "Kucing", breed: null, dob: null, gender: null, weight: null, photo_url: null },
        customers: { name: "Pemilik Fiktif", phone: "08000000001", address: null, tier: null },
        branches: state.branchName ? { name: state.branchName } : null }, error: null };
      if (this.table === "branches") { if (state.identityThrows) throw new Error("boom"); return state.identity; }
      if (this.table === "medical_records") return { data: { id: "mr-1", diagnosis: "Dx", therapy: null, anamnesis: null, suhu: null, berat: null, gejala_klinis: null, hasil_penunjang: null, penunjang_urls: [], follow_up: null, catatan_resep: null, created_at: "2026-11-03T02:10:00Z" }, error: null };
      return { data: [], error: null };
    }
    async maybeSingle() { const { data, error } = this.hasil(); return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }; }
    then(resolve: (value: { data: unknown; error: unknown }) => unknown) { return Promise.resolve(this.hasil()).then(resolve); }
  }
  return { createClient: async () => ({
    from: (table: string) => new Query(table),
    storage: { from: (bucket: string) => ({
      createSignedUrls: async () => ({ data: [] }),
      createSignedUrl: async (path: string) => { if (state.signedThrows) throw new Error("boom"); state.signedPaths.push(`${bucket}:${path}`); return state.signed; },
    }) },
  }) };
});

import DokumenRekamMedisPage from "../page";
const render = async () => renderToStaticMarkup(await DokumenRekamMedisPage({ params: Promise.resolve({ visitId: "vis-1" }) }));
const kop = (h: string) => h.slice(h.indexOf('data-kop="cabang"'), h.indexOf("REKAM MEDIS PASIEN"));

beforeEach(() => {
  state.visitBranchId = BR; state.branchName = "Kamo Pets Clinic Cimanggu";
  state.identity = { data: { alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logo_path: `cabang-logo/${BR}/1700000000000-ab12cd34.png` }, error: null };
  state.identityThrows = false; state.signedThrows = false;
  state.signed = { data: { signedUrl: "https://storage.test/sign/dokumen/logo.png?token=t1" }, error: null };
  state.signedPaths = []; state.selects = []; state.eqs = [];
});

describe("kop rekam medis per cabang kunjungan", () => {
  it("cabang lengkap: logo cabang (tautan bertanda tangan), nama cabang, alamat + telepon; KAMO PET CARE dan tagline tidak ada di kop", async () => {
    const h = await render(); const k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu");
    expect(k).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(k).toContain('src="https://storage.test/sign/dokumen/logo.png?token=t1"');
    expect(k).not.toContain("KAMO PET CARE");
    expect(k).not.toContain("WE CARE, THEY DESERVE");
    expect(state.signedPaths).toEqual([`dokumen:cabang-logo/${BR}/1700000000000-ab12cd34.png`]);
  });
  it("identitas dibaca dari cabang KUNJUNGAN ini (branch_id kunjungan), bukan cabang lain/terpilih", async () => {
    await render();
    expect(state.eqs).toContainEqual(["branches.id", BR]);
    expect(state.selects).toContain("branches:alamat, telepon, logo_path");
  });
  it("cabang tanpa logo/alamat/telepon: nama cabang + logo cakar + tagline lama; tidak ada penandatanganan", async () => {
    state.identity = { data: { alamat: null, telepon: null, logo_path: null }, error: null };
    const k = kop(await render());
    expect(k).toContain("Kamo Pets Clinic Cimanggu");
    expect(k).toContain("data-kop-logo-bawaan");
    expect(k).toContain("WE CARE, THEY DESERVE");
    expect(k).not.toContain("KAMO PET CARE");
    expect(state.signedPaths).toEqual([]);
  });
  it("kunjungan lama tanpa cabang (impor): KAMO PET CARE + tagline + logo cakar, tanpa membaca identitas cabang", async () => {
    state.visitBranchId = null; state.branchName = null;
    const k = kop(await render());
    expect(k).toContain("KAMO PET CARE");
    expect(k).toContain("WE CARE, THEY DESERVE");
    expect(k).toContain("data-kop-logo-bawaan");
    expect(state.selects.some((s) => s.startsWith("branches:"))).toBe(false);
  });
  it("jalur logo milik cabang lain / jalur modul lain tidak pernah ditandatangani (logo cakar dipakai)", async () => {
    for (const path of [`cabang-logo/73218196-99b8-4e2a-81dc-ecc6851cdbf6/x.png`, "pengeluaran/1700000000001-nota.png", `cabang-logo/${BR}/../x.png`, `cabang-logo/${BR}/x.gif`]) {
      state.signedPaths = [];
      state.identity = { data: { alamat: null, telepon: null, logo_path: path }, error: null };
      const k = kop(await render());
      expect(state.signedPaths, path).toEqual([]);
      expect(k).toContain("data-kop-logo-bawaan");
      expect(k).toContain("Kamo Pets Clinic Cimanggu");
    }
  });
  it("gagal membaca identitas (galat, lempar, bukan baris): dokumen tetap tercetak dengan nama cabang saja", async () => {
    state.identity = { data: null, error: { message: "permission denied" } };
    let k = kop(await render());
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).toContain("WE CARE, THEY DESERVE");
    state.identityThrows = true;
    k = kop(await render());
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).toContain("data-kop-logo-bawaan");
  });
  it("gagal membuat tautan logo (galat atau lempar): logo cakar, alamat/telepon tetap tercetak", async () => {
    state.signed = { data: null, error: { message: "not found" } };
    let k = kop(await render());
    expect(k).toContain("data-kop-logo-bawaan"); expect(k).toContain("Jl. Raya Cimanggu 12, Bogor");
    state.signedThrows = true;
    k = kop(await render());
    expect(k).toContain("data-kop-logo-bawaan"); expect(k).toContain("Telp. 0251 8888");
  });
  it("sisa dokumen tidak berubah: judul, No. RM, footer INFORMASI KLINIK memakai nama cabang yang sama", async () => {
    const h = await render();
    expect(h).toContain("REKAM MEDIS PASIEN");
    expect(h).toContain("INFORMASI KLINIK");
    expect(h).toContain("RM/2026/1103/VIS");
    expect(h.split("Kamo Pets Clinic Cimanggu").length - 1).toBe(2); // kop + footer
    expect(h).toContain("Dicetak pada");
  });
  it("lebar kop tetap: kolom grid dan ukuran logo tidak berubah (satu halaman A4)", async () => {
    const h = await render();
    expect(h).toContain("grid-template-columns:1fr auto 260px");
    expect(h).toContain("width:46px;height:46px");
  });
});
