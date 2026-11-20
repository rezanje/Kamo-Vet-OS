import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Aldi (20 Nov): staf front desk membuka Rekam medis dari layar sambutan klinik untuk MELIHAT riwayat saja.
// Tombol alat OWNER/ADMIN (Perlu dilengkapi, Import) tidak ditawarkan ke STAFF; peran lain tidak berubah.
const s = vi.hoisted(() => ({ peran: "STAFF" as string | null, gagalPeran: false }));
vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({
  createClientLintasCabang: async () => ({
    cabangAktif: "b",
    client: {
      auth: { getUser: async () => ({ data: { user: s.peran === null ? null : { id: "u1" } } }) },
      from: (table: string) => {
        const q = {
          select: () => q, eq: () => q,
          maybeSingle: async () => {
            if (s.gagalPeran) throw new Error("jaringan");
            return { data: table === "profiles" ? { role: s.peran } : null, error: null };
          },
        };
        return q;
      },
      rpc: async (_n: string, a: { p_batas: number; p_offset: number }) => ({
        error: null,
        data: { jumlah: 0, ringkasan: { riwayat: 0, hewan: 0, impor: 0 }, batas: a.p_batas, offset: a.p_offset, baris: [] },
      }),
    },
  }),
}));
import MedicalPage from "../../app/(app)/klinik/rekam-medis/page";

const render = async () => renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({ kelompok: "kunjungan" }) }));
beforeEach(() => { s.peran = "STAFF"; s.gagalPeran = false; });

it("STAFF: daftar tampil dengan label Baca saja, tanpa tombol Import / Perlu dilengkapi", async () => {
  const html = await render();
  expect(html).toContain("REKAM MEDIS");
  expect(html).toContain("Baca saja");
  expect(html).not.toContain('href="/klinik/rekam-medis/impor"');
  expect(html).not.toContain('href="/klinik/rekam-medis/perlu-dilengkapi"');
});

it.each(["OWNER", "ADMIN", "DOCTOR"])("%s: tombol Import & Perlu dilengkapi tetap ada", async (peran) => {
  s.peran = peran;
  const html = await render();
  expect(html).not.toContain("Baca saja");
  expect(html).toContain('href="/klinik/rekam-medis/impor"');
  expect(html).toContain('href="/klinik/rekam-medis/perlu-dilengkapi"');
});

it("peran gagal dibaca: daftar tetap tampil (tampilan lama), tidak menahan halaman", async () => {
  s.gagalPeran = true;
  const html = await render();
  expect(html).toContain("REKAM MEDIS");
  expect(html).not.toContain("Baca saja");
});
