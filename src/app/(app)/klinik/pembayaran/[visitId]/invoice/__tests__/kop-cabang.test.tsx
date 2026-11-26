// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kop invoice klinik = identitas CABANG PENERBIT invoice (logo, nama, alamat, telepon); data sintetis, halaman dirender sungguhan.
const BR = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const INV_ID = "5f1b4e2c-8d2f-4b7a-9c1e-2a3b4c5d6e7f";
const state = vi.hoisted(() => ({
  invoiceBranchId: null as string | null,
  branchName: null as string | null,
  visitBranchName: "Cabang Kunjungan Salah" as string | null,
  identity: { data: null, error: null } as { data: unknown; error: unknown },
  identityThrows: false,
  signed: { data: { signedUrl: "https://storage.test/sign/dokumen/logo.png?token=t1" }, error: null } as { data: { signedUrl: string } | null; error: unknown },
  signedThrows: false,
  signedPaths: [] as string[],
  selects: [] as string[],
  eqs: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "cabang-terpilih-lain" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PrintButton", () => ({ PrintButton: ({ label }: { label: string }) => <button data-cetak>{label}</button> }));
vi.mock("../../PrintButton", () => ({ PrintButton: ({ label }: { label: string }) => <button data-cetak>{label}</button> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    storage: { from: (bucket: string) => ({
      createSignedUrl: async (path: string) => { if (state.signedThrows) throw new Error("boom"); state.signedPaths.push(`${bucket}:${path}`); return state.signed; },
    }) },
    from(table: string) {
      const invoice = { id: INV_ID, invoice_no: "INV-202611-1864", subtotal: 45000, discount: 0, tax: 0, total: 45000, dp_amount: 0, dp_date: null,
        paid_status: "Lunas", metode_bayar: "Tunai", paid_at: "2026-11-26T04:00:00Z", created_at: "2026-11-26T03:00:00Z", cashier_name: "Kasir Fiktif",
        visits: { ...(state.invoiceBranchId ? { branch_id: state.invoiceBranchId } : { branch_id: null }), branches: state.branchName ? { name: state.branchName, code: "FIK" } : null } };
      const items = [{ id: "li-1", invoice_id: INV_ID, item_id: "x", deskripsi: "Layanan Fiktif", qty: 1, harga: 45000, diskon_persen: 0, jenis: "jasa", package_item_id: null, package_qty: null, package: null, service_performers: null, compound_recipe_id: null, compounding_recipes: null }];
      const visit = { id: "visit", poli: "Poli Umum", dokter: "drh. Fiktif", doctor_id: null, created_at: "2026-11-26T03:00:00Z", pets: { name: "Pasien Fiktif", species: "Kucing", breed: null }, customers: { name: "Pemilik Fiktif", phone: "08000000001", address: null },
        branches: state.visitBranchName ? { name: state.visitBranchName, code: "SALAH" } : null };
      const one = (): { data: unknown; error: unknown } => {
        if (table === "branches") { if (state.identityThrows) throw new Error("boom"); return state.identity; }
        if (table === "invoices") return { data: invoice, error: null };
        if (table === "visits") return { data: visit, error: null };
        return { data: null, error: null };
      };
      let exact = false;
      const q = {
        select: (s: string, o?: { count?: string }) => { exact = o?.count === "exact"; state.selects.push(`${table}:${s}`); return q; },
        eq: (c: string, v: string) => { state.eqs.push(`${table}.${c}=${v}`); return q; },
        is: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
        maybeSingle: async () => { const r = one(); return table === "invoices" ? { ...r, count: 1 } : r; },
        then: (resolve: (v: unknown) => unknown) => {
          const rows = table === "invoice_items" ? items : [];
          return Promise.resolve({ data: rows, error: null, count: exact ? rows.length : null }).then(resolve);
        },
      };
      return q;
    },
  }),
}));

import InvoicePage from "../page";
const render = async () => renderToStaticMarkup(await InvoicePage({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({ invoice_id: INV_ID }) }));
const kop = (h: string) => h.slice(h.indexOf('data-kop="cabang"'), h.indexOf("INVOICE</div>"));
const LOGO = `cabang-logo/${BR}/1700000000000-ab12cd34.png`;

beforeEach(() => {
  state.invoiceBranchId = BR; state.branchName = "Kamo Pets Clinic Cimanggu"; state.visitBranchName = "Cabang Kunjungan Salah";
  state.identity = { data: { alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logo_path: LOGO }, error: null };
  state.identityThrows = false; state.signedThrows = false;
  state.signed = { data: { signedUrl: "https://storage.test/sign/dokumen/logo.png?token=t1" }, error: null };
  state.signedPaths = []; state.selects = []; state.eqs = [];
});

describe("kop invoice klinik per cabang penerbit", () => {
  it("cabang lengkap: logo (tautan bertanda tangan), nama cabang, alamat + telepon di kiri; judul INVOICE, nomor, tanggal, status Lunas tetap di kanan", async () => {
    const h = await render(); const k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu");
    expect(k).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(k).toContain('src="https://storage.test/sign/dokumen/logo.png?token=t1"');
    expect(k).not.toContain("data-kop-logo-bawaan");
    expect(k).toMatch(/data-kop-kontak[^>]*font-size:10px/);
    expect(state.signedPaths).toEqual([`dokumen:${LOGO}`]);
    const sisi = h.slice(h.indexOf("INVOICE</div>"));
    expect(sisi.indexOf("INV-202611-1864")).toBeGreaterThan(-1);
    expect(sisi).toContain("26 November 2026");
    expect(sisi).toContain("Lunas");
    expect(h.indexOf('data-kop="cabang"')).toBeLessThan(h.indexOf("INVOICE</div>"));
  });
  it("memakai cabang PENERBIT invoice (kunjungan invoice), bukan cabang kunjungan lain atau cabang yang sedang dipilih", async () => {
    const h = await render();
    expect(state.eqs).toContain(`branches.id=${BR}`);
    expect(state.selects).toContain("branches:alamat, telepon, logo_path");
    expect(state.selects.some((s) => s.startsWith("invoices:") && s.includes("visits(branch_id, branches(name, code))"))).toBe(true);
    expect(h).not.toContain("Cabang Kunjungan Salah");
    expect(h).not.toContain("cabang-terpilih-lain");
    expect(h).not.toContain("KAMO PET CARE");
  });
  it("tanpa logo: logo cakar bawaan, tidak ada penandatanganan; alamat/telepon tetap tampil", async () => {
    state.identity = { data: { alamat: "Jl. Ciawi 1", telepon: null, logo_path: null }, error: null };
    const k = kop(await render());
    expect(k).toContain("data-kop-logo-bawaan"); expect(k).toContain("ti-paw"); expect(k).not.toContain("<img");
    expect(k).toContain("Jl. Ciawi 1"); expect(k).not.toContain("Telp.");
    expect(state.signedPaths).toEqual([]);
  });
  it("tanpa alamat dan telepon: baris kontak dihilangkan (tidak ada tagline, tidak ada baris kosong)", async () => {
    state.identity = { data: { alamat: null, telepon: "  ", logo_path: null }, error: null };
    const k = kop(await render());
    expect(k).toContain("Kamo Pets Clinic Cimanggu");
    expect(k).not.toContain("data-kop-kontak"); expect(k).not.toContain("data-kop-tagline"); expect(k).not.toContain("WE CARE");
  });
  it("hanya telepon: baris kontak berisi telepon saja", async () => {
    state.identity = { data: { alamat: null, telepon: "0251 1234", logo_path: null }, error: null };
    expect(kop(await render())).toContain("Telp. 0251 1234");
  });
  it("cabang invoice tidak tercatat: 'Cabang belum tercatat' seperti semula, tanpa membaca identitas, tanpa KAMO PET CARE", async () => {
    state.invoiceBranchId = null; state.branchName = null;
    const h = await render();
    expect(h).toContain("Cabang belum tercatat");
    expect(h).not.toContain("KAMO PET CARE"); expect(h).not.toContain("Cabang Kunjungan Salah");
    expect(state.eqs.some((e) => e.startsWith("branches."))).toBe(false);
    expect(h).toContain("INV-202611-1864");
  });
  it("gagal membuat tautan logo (galat atau lempar): dokumen tetap tercetak dengan nama, alamat, telepon; tanpa <img>", async () => {
    state.signed = { data: null, error: { message: "denied" } };
    let h = await render(); let k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888"); expect(k).not.toContain("<img");
    expect(h).toContain("Rp 45.000"); expect(h).toContain("Cetak Invoice");
    state.signedThrows = true;
    h = await render(); k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).toContain("Telp. 0251 8888"); expect(k).not.toContain("<img");
    expect(h).toContain("Cetak Invoice");
  });
  it("gagal membaca identitas (galat atau lempar): kop jatuh ke nama cabang + logo cakar; invoice tetap lengkap", async () => {
    state.identity = { data: null, error: { message: "denied" } };
    let h = await render();
    expect(kop(h)).toContain("Kamo Pets Clinic Cimanggu"); expect(kop(h)).toContain("data-kop-logo-bawaan"); expect(h).toContain("Rp 45.000");
    state.identityThrows = true;
    h = await render();
    expect(kop(h)).toContain("Kamo Pets Clinic Cimanggu"); expect(h).toContain("Layanan Fiktif");
    expect(state.signedPaths).toEqual([]);
  });
  it("jalur logo milik cabang lain ditolak (tidak ditandatangani, tanpa <img>)", async () => {
    state.identity = { data: { alamat: "Jl. A 1", telepon: null, logo_path: "cabang-logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.png" }, error: null };
    const k = kop(await render());
    expect(state.signedPaths).toEqual([]); expect(k).not.toContain("<img"); expect(k).toContain("Jl. A 1");
  });
  it("teks cabang dilepas dari HTML (tidak menyisipkan markup)", async () => {
    state.branchName = "<b>Klinik</b>"; state.identity = { data: { alamat: "<script>alert(1)</script>", telepon: null, logo_path: null }, error: null };
    const h = await render();
    expect(h).not.toContain("<script>alert(1)</script>"); expect(h).toContain("&lt;b&gt;Klinik&lt;/b&gt;");
  });
  it("tata letak cetak tidak berubah: A4 margin 14mm, tombol 'Cetak Invoice' (tidak ikut tercetak), logo 46x46 tetap sehingga kop satu halaman", async () => {
    const h = await render();
    expect(h).toContain("@media print { @page { size: A4; margin: 14mm; } }");
    expect(h).toMatch(/class="no-print"[^>]*>[\s\S]*Cetak Invoice/);
    expect(h).toContain("width:46px;height:46px"); expect(h).toContain("object-fit:contain");
    expect(h).toContain("flex-shrink:0");
    expect((h.match(/data-kop="cabang"/g) ?? []).length).toBe(1);
    expect(h).toContain("border-bottom:2px solid #16213e");
  });
});
