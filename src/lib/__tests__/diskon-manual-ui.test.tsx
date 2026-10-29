import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Layar menyembunyikan kemampuan mengetik diskon untuk akun tanpa hak. Ini
// kenyamanan, bukan pengaman — server dan database menolak lagi (lihat
// diskon-manual-kasir-pos / diskon-manual-klinik / diskon-manual-migration).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
vi.mock("@/app/(app)/pos/transaksi/actions", () => ({ checkoutSale: vi.fn() }));
vi.mock("@/components/useClinicDraft", () => ({ useClinicDraft: ({ requestKey }: { requestKey: string }) => ({ submissionKey: requestKey, submit: vi.fn(), capture: vi.fn(), attachForm: vi.fn(), discard: vi.fn(), recovered: false, storageError: "", saveError: "" }) }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/lib/tagihan-klinik", () => ({ hargaNetto: (r: { harga: number }) => r.harga, nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));

import { KasirClient } from "@/app/kasir/KasirClient";
import { PosClient } from "@/app/(app)/pos/transaksi/PosClient";
import { ItemTable, PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { PESAN_DISKON_MANUAL } from "../akses-diskon";

const CATATAN = PESAN_DISKON_MANUAL;

/** Kolom diskon yang terkunci ditandai readonly DAN diberi judul penjelas. */
const terkunci = (html: string) => (html.match(new RegExp(`readonly[^>]*title="${CATATAN}"|title="${CATATAN}"[^>]*readonly`, "g")) ?? []).length;

function cariInput(node: React.ReactNode, cocok: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(node)) return;
  if (cocok(node.props)) return node.props;
  for (const child of React.Children.toArray(node.props.children as React.ReactNode)) {
    const hasil = cariInput(child, cocok);
    if (hasil) return hasil;
  }
}

describe("kasir petshop", () => {
  const dasar = { branchName: "Cabang Uji", items: [], customers: [], vouchers: [], hariIni: "2026-10-29" };
  it("mengunci kolom diskon nota dan memberi catatan untuk akun tanpa hak", () => {
    const html = renderToStaticMarkup(<KasirClient {...dasar} bolehDiskonManual={false} />);
    expect(html).toContain(CATATAN);
    expect(terkunci(html)).toBeGreaterThan(0);
    // Tombol pengganti satuan potongan (Rp / %) ikut dimatikan.
    expect(html).toContain("disabled");
  });
  it("membiarkan kolomnya terbuka untuk akun berwenang", () => {
    const html = renderToStaticMarkup(<KasirClient {...dasar} bolehDiskonManual />);
    expect(html).not.toContain(CATATAN);
    expect(terkunci(html)).toBe(0);
  });
});

describe("POS back-office", () => {
  const dasar = { items: [], customers: [], branches: [{ id: "b", code: "B", name: "Cabang", type: "PETSHOP" }] };
  it("mengunci kolom diskon untuk akun tanpa hak", () => {
    const html = renderToStaticMarkup(<PosClient {...dasar} bolehDiskonManual={false} />);
    expect(html).toContain(CATATAN);
    expect(terkunci(html)).toBeGreaterThan(0);
  });
  it("membiarkan kolomnya terbuka untuk akun berwenang", () => {
    const html = renderToStaticMarkup(<PosClient {...dasar} bolehDiskonManual />);
    expect(html).not.toContain(CATATAN);
    expect(terkunci(html)).toBe(0);
  });
});

describe("kasir / koreksi tagihan klinik", () => {
  const baris = { deskripsi: "Konsultasi", qty: 1, harga: 1000, item_id: "item", satuan: "PCS" };
  const master = [{ id: "item", code: "FIC", name: "Konsultasi", unit: "PCS", harga: 1000 }];
  const props = {
    visitId: "visit", requestKey: "request",
    patient: { photo: null, name: "Fiksi", species: "Kucing", owner: "Pemilik", phone: "", address: "", dokter: "Dokter", jenisLayanan: "Klinik", noInvoice: "(baru)", tanggal: "2026-10-29" },
    initialObat: [], initialJasa: [], catatanResep: null,
    bekal: { promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-10-29", customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 },
  };

  it("kolom diskon per baris terkunci untuk akun tanpa hak", () => {
    const terkunci = cariInput(
      ItemTable({ title: "OBAT", icon: "pill", color: "black", rows: [baris], setRows: () => {}, master, listId: "uji", bolehDiskonManual: false }),
      (p) => p.title === CATATAN && p.max === 100,
    );
    expect(terkunci).toMatchObject({ readOnly: true, "aria-readonly": true });
  });

  it("kolom diskon per baris terbuka untuk akun berwenang", () => {
    const terbuka = cariInput(
      ItemTable({ title: "OBAT", icon: "pill", color: "black", rows: [baris], setRows: () => {}, master, listId: "uji", bolehDiskonManual: true }),
      (p) => p.max === 100 && p.min === 0,
    );
    expect(terbuka).toMatchObject({ readOnly: false });
  });

  it("kolom diskon tagihan terkunci dan diberi catatan untuk akun tanpa hak", () => {
    const html = renderToStaticMarkup(React.createElement(PembayaranForm, { ...props, cashierName: "Kasir", bolehDiskonManual: false }));
    expect(html).toContain(CATATAN);
    expect(terkunci(html)).toBeGreaterThan(0);
  });

  it("kolom diskon tagihan terbuka untuk akun berwenang", () => {
    const html = renderToStaticMarkup(React.createElement(PembayaranForm, { ...props, cashierName: "Kasir", bolehDiskonManual: true }));
    expect(html).not.toContain(CATATAN);
    expect(terkunci(html)).toBe(0);
  });
});
