// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Halaman booking publik, pesan WhatsApp (rawat inap duka, retensi) dan kop struk termal: data sintetis.
const state = vi.hoisted(() => ({
  klinik: [] as Record<string, unknown>[],
  firstSelectError: false,
  selects: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      let kolom = "";
      const q = {
        select: (c: string) => { kolom = c; state.selects.push(`${table}:${c}`); return q; },
        eq: () => q,
        order: () => q,
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "branches" && kolom.includes("alamat") && state.firstSelectError) return Promise.resolve({ data: null, error: { message: "column alamat does not exist" } }).then(resolve);
          const data = state.klinik.map((k) => (kolom.includes("alamat") ? k : { id: k.id, name: k.name }));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("../../app/booking/actions", () => ({ kirimBooking: async () => {} }));

import BookingPage from "../../app/booking/page";
import { BookingKop, BookingKlinikProvider, PilihKlinikBooking } from "@/components/BookingKop";
import { KopStruk } from "@/components/KopStruk";
import { ripWaMessage } from "@/lib/inpatient";
import { pesanRetensi } from "@/lib/retensi";

const A = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const B = "78d6e24f-b23c-4356-a425-16060a343db6";
const KLINIK = [
  { id: A, name: "Kamo Pets Clinic Cimanggu", alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888" },
  { id: B, name: "Kamo Pets Clinic Ciawi", alamat: null, telepon: null },
];
beforeEach(() => { state.klinik = KLINIK; state.firstSelectError = false; state.selects = []; });

const halaman = async (sp: { cabang?: string; sukses?: string; error?: string } = {}) =>
  renderToStaticMarkup(await BookingPage({ searchParams: Promise.resolve(sp) }));

describe("halaman booking publik", () => {
  it("belum ada klinik terpilih: kop umum lama (KAMO PET CARE), daftar klinik utuh, tanpa logo/alamat", async () => {
    const h = await halaman();
    expect(h).toContain("KAMO PET CARE");
    expect(h).not.toContain('data-kop="cabang"');
    expect(h).not.toContain("Jl. Raya Cimanggu");
    expect(h).toContain("Booking jadwal periksa hewan kesayangan");
    expect(h).toContain("Kamo Pets Clinic Ciawi");
  });
  it("tautan ?cabang= cabang yang sah: kop cabang itu (logo cakar bawaan + nama + alamat · telepon) menggantikan merek umum", async () => {
    const h = await halaman({ cabang: A });
    expect(h).toContain('data-kop="cabang"');
    expect(h).toContain("data-kop-logo-bawaan");
    expect(h).not.toContain("<img");
    expect(h).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(h).not.toContain(">KAMO PET CARE<");
    expect(h).toContain("Booking jadwal periksa hewan kesayangan");
    expect(h).toMatch(/<option value="3c9fa638-[^"]+" selected/);
  });
  it("cabang tanpa alamat/telepon: baris kecil dihilangkan, nama tetap", async () => {
    const h = await halaman({ cabang: B });
    expect(h).toContain('data-kop="cabang"');
    expect(h).not.toContain("data-kop-kontak");
    expect(h).toContain("Kamo Pets Clinic Ciawi");
  });
  it("?cabang= asal-asalan atau bukan klinik aktif: diabaikan, kop umum", async () => {
    for (const cabang of ["bukan-uuid", "00000000-0000-0000-0000-000000000000", "<script>alert(1)</script>"]) {
      const h = await halaman({ cabang });
      expect(h).toContain("KAMO PET CARE");
      expect(h).not.toContain('data-kop="cabang"');
      expect(h).not.toContain("<script>alert");
      // pilihan formulir tetap di placeholder "pilih klinik" (bukan klinik pertama yang terpilih diam-diam)
      expect(h).toMatch(/<option value=""[^>]*disabled[^>]*selected|<option value=""[^>]*selected[^>]*disabled/);
      expect(h).not.toMatch(/<option value="[0-9a-f-]{36}"[^>]*selected/);
    }
  });
  it("kolom alamat/telepon gagal dibaca: formulir tetap hidup dengan daftar klinik (id dan nama saja), kop umum", async () => {
    state.firstSelectError = true;
    const h = await halaman({ cabang: A });
    expect(state.selects).toEqual(["branches:id, name, alamat, telepon", "branches:id, name"]);
    expect(h).toContain("Kamo Pets Clinic Cimanggu");
    expect(h).toContain('data-kop="cabang"');
    expect(h).not.toContain("data-kop-kontak");
  });
  it("pesan sukses/galat dan formulir booking tetap ada", async () => {
    const h = await halaman({ sukses: "1", error: "Gagal" });
    expect(h).toContain("Booking terkirim.");
    expect(h).toContain("Gagal");
    expect(h).toContain('name="nama_pemilik"');
  });
});

describe("kop booking mengikuti klinik yang dipilih di formulir", () => {
  it("memilih klinik mengganti kop umum menjadi kop klinik itu, memilih lain mengganti lagi", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(el);
    await act(async () => { root.render(<BookingKlinikProvider klinik={KLINIK} awal=""><BookingKop /><form><PilihKlinikBooking /></form></BookingKlinikProvider>); });
    expect(el.textContent).toContain("KAMO PET CARE");
    const sel = el.querySelector("select") as HTMLSelectElement;
    const ubah = async (v: string) => { await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!; set.call(sel, v);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }); };
    await ubah(A);
    expect(el.textContent).not.toContain("KAMO PET CARE");
    expect(el.textContent).toContain("Kamo Pets Clinic Cimanggu");
    expect(el.textContent).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    await ubah(B);
    expect(el.textContent).toContain("Kamo Pets Clinic Ciawi");
    expect(el.textContent).not.toContain("Jl. Raya Cimanggu");
    expect((el.querySelector("select") as HTMLSelectElement).name).toBe("branch_id");
    await act(async () => { root.unmount(); });
  });
});

describe("kop struk termal (komponen)", () => {
  it("nama saja bila alamat/telepon kosong; baris kecil bila diisi; anak (judul) tampil di bawah", () => {
    expect(renderToStaticMarkup(<KopStruk nama="Cabang X" />)).not.toContain("data-kop-struk-kontak");
    expect(renderToStaticMarkup(<KopStruk nama="Cabang X" alamat="  " telepon="" />)).not.toContain("data-kop-struk-kontak");
    const h = renderToStaticMarkup(<KopStruk nama="Cabang X" alamat="Jl. A 1" telepon="021 1"><b>JUDUL</b></KopStruk>);
    expect(h).toContain("Jl. A 1 · Telp. 021 1");
    expect(h.indexOf("Cabang X")).toBeLessThan(h.indexOf("Jl. A 1"));
    expect(h.indexOf("Jl. A 1")).toBeLessThan(h.indexOf("JUDUL"));
    expect(h).not.toContain("<img");
  });
});

describe("pesan WhatsApp memakai nama cabang, bukan merek 'KAMO PET CARE', bila cabang diketahui", () => {
  it("rawat inap (duka): penutup dan isi = nama cabang kunjungan", () => {
    const m = ripWaMessage("Choco", "Susi", "Kamo Pets Clinic Cimanggu");
    expect(m).toContain("saat perawatan di Kamo Pets Clinic Cimanggu.");
    expect(m.trimEnd().endsWith("— Kamo Pets Clinic Cimanggu")).toBe(true);
    expect(m).not.toContain("KAMO PET CARE");
    expect(m).toContain("Choco"); expect(m).toContain("berduka");
  });
  it("cabang tidak diketahui (null/kosong/spasi): 'klinik kami' di isi dan merek lama di penutup", () => {
    for (const b of [null, undefined, "", "   "]) {
      const m = ripWaMessage("Choco", "Susi", b);
      expect(m).toContain("saat perawatan di klinik kami.");
      expect(m.trimEnd().endsWith("— KAMO PET CARE")).toBe(true);
    }
  });
  it("nama cabang dengan baris baru dirapikan satu baris", () => {
    expect(ripWaMessage("C", "S", "Kamo\n Pets  Clinic")).toContain("— Kamo Pets Clinic");
  });
  it("retensi: tempat berkunjung = cabang pertama pelanggan; tidak tercatat ('—'/kosong/null) = merek lama", () => {
    expect(pesanRetensi("Budi", "Kamo Petshop Loji")).toContain("berkunjung ke Kamo Petshop Loji.");
    expect(pesanRetensi("Budi", "Kamo Petshop Loji")).not.toContain("Kamo Pet Care");
    for (const c of ["—", "", "  ", null, undefined]) expect(pesanRetensi("Budi", c)).toContain("berkunjung ke Kamo Pet Care.");
    expect(pesanRetensi("Budi", "X")).toContain("Halo Kak Budi,");
    expect(pesanRetensi("Budi", "X")).not.toMatch(/diskon/i);
  });
});
