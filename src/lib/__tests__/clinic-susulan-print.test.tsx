import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Rekam medis cetak & resep cetak harus memperlihatkan item susulan beserta pelaku dan
// jamnya (Andri 29 Okt, opsi B). Daftar yang gagal dibaca tidak boleh tercetak sebagai
// "tidak ada" — itu rekam medis yang salah, bukan rekam medis kosong.
const state = vi.hoisted(() => ({ gagal: false }));
const BARIS = [
  { nama_obat: "Amoxicillin", qty: 2, satuan: "btl", aturan_pakai: "2x sehari", jenis: "obat" },
  { nama_obat: "Nebulizer", qty: 1, satuan: "jasa", aturan_pakai: null, jenis: "jasa",
    susulan_at: "2026-11-01T07:30:00Z", susulan_by_name: "Kasir Wulan", susulan_source: "kasir" },
];
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  from(table: string) {
    const query = { select() { return query; }, eq() { return query; }, is() { return query; },
      order() { return query; }, limit() { return query; },
      maybeSingle: async () => ({
        data: table === "visits"
          ? { id: "visit", poli: "Poli Umum", dokter: "Drh. Andri", keluhan: "Batuk", status: "Pembayaran",
              created_at: "2026-11-01T00:00:00Z", pets: { name: "Milo", species: "Kucing" }, customers: { name: "Pemilik" }, branches: { name: "Cabang" } }
          : table === "medical_records" ? { id: "record", diagnosis: "ISPA", penunjang_urls: [] }
          : null,
        error: null }),
      then(resolve: (value: unknown) => void) {
        return Promise.resolve(table === "prescription_items" && state.gagal
          ? { data: null, error: { message: "kolom susulan belum ada" } }
          : { data: table === "prescription_items" ? BARIS : [], error: null }).then(resolve);
      } };
    return query;
  },
}) }));
vi.mock("@/lib/clinic-record-addenda", () => ({
  loadRecordAddenda: async () => ({ state: "ok", rows: [] }), addendumAuthor: () => "",
}));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import Dokumen from "../../app/(app)/klinik/rekam-medis/[visitId]/dokumen/page";
import Resep from "../../app/(app)/klinik/rekam-medis/[visitId]/resep/page";

beforeEach(() => { state.gagal = false; });
const dokumen = async () => renderToStaticMarkup(await Dokumen({ params: Promise.resolve({ visitId: "visit" }) }));
const resep = async () => renderToStaticMarkup(await Resep({ params: Promise.resolve({ visitId: "visit" }) }));

it("rekam medis cetak menandai baris susulan dan membiarkan baris pemeriksaan apa adanya", async () => {
  const html = await dokumen();
  expect(html).toContain("Susulan · Kasir Wulan · 01 Nov 2026, 14.30");
  expect(html.match(/Susulan ·/g)).toHaveLength(1);
  expect(html).toContain("Amoxicillin");
});

it("resep cetak menandai baris susulan", async () => {
  const html = await resep();
  expect(html).toContain("Susulan · Kasir Wulan");
  expect(html).toContain("2 btl");
});

it("daftar yang gagal dibaca memperingatkan, bukan tercetak sebagai kosong", async () => {
  state.gagal = true;
  const html = await dokumen();
  expect(html).toContain("Daftar obat &amp; tindakan belum dapat dimuat");
  const cetakResep = await resep();
  expect(cetakResep).toContain("Resep belum dapat dimuat");
  expect(cetakResep).not.toContain("Tidak ada resep.");
});
