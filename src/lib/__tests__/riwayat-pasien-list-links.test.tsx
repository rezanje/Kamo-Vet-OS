import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Daftar Rekam Medis: nama hewan menjadi tautan + tombol "Riwayat" di sebelah "Buka" (Buka tetap ada).
const s = vi.hoisted(() => ({ visits: [] as Record<string, unknown>[] }));
vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({
  createClientLintasCabang: async () => ({
    cabangAktif: null,
    client: {
      rpc: async (_n: string, a: { p_batas: number; p_offset: number }) => ({ error: null, data: {
        jumlah: s.visits.length, ringkasan: { riwayat: s.visits.length, hewan: 1, impor: 0 }, batas: a.p_batas, offset: a.p_offset, baris: s.visits.slice(a.p_offset, a.p_offset + a.p_batas),
      } }),
    },
  }),
}));
import MedicalPage from "../../app/(app)/klinik/rekam-medis/page";

const baris = (id: string, pet_id: string | null, tanggal: string) => ({
  id, pet_id, branch_id: "b", created_at: tanggal, dokter: "drh", keluhan: "k", legacy_source_key: null,
  pets: { name: "choco", species: "Kucing", breed: null }, customers: { name: "tes", phone: "0812" }, branches: { code: "VET_CMGG" },
  medical_records: { diagnosis: "d", anamnesis: "a" }, inpatient_records: [],
});
const PET = "aaaaaaaa-0000-4000-8000-000000000001";
beforeEach(() => { s.visits = [baris("v2", PET, "2026-10-31T03:00:00Z"), baris("v1", PET, "2026-10-29T03:00:00Z"), baris("v0", null, "2026-10-01T03:00:00Z")]; });

it("setiap baris: nama hewan dan tombol Riwayat menuju riwayat pasien; Buka tetap ke kunjungan itu", async () => {
  const html = renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({}) }));
  const riwayat = `href="/klinik/rekam-medis/pasien/${PET}"`;
  // 2 baris punya petId x (nama + tombol) = 4 tautan
  expect(html.split(riwayat).length - 1).toBe(4);
  expect(html).toContain("Riwayat</a>");
  for (const id of ["v2", "v1", "v0"]) expect(html).toContain(`href="/klinik/rekam-medis/${id}"`);
  expect(html).toContain("Buka");
});

it("baris tanpa pet_id tidak mendapat tautan rusak (hanya Buka)", async () => {
  s.visits = [baris("v0", null, "2026-10-01T03:00:00Z")];
  const html = renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({}) }));
  expect(html).not.toContain("/klinik/rekam-medis/pasien/");
  expect(html).toContain('href="/klinik/rekam-medis/v0"');
});
