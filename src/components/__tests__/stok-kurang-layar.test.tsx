import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Satu permintaan "Disetujui" yang stoknya tidak cukup — persis kasus yang dilaporkan
// Andri: diminta 500, gudang pengirim cuma punya 250.
const state = vi.hoisted(() => ({ error: "" as string | undefined }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: vi.fn() }));
vi.mock("@/app/(app)/pos/permintaan/actions", () => ({
  kirimPermintaan: vi.fn(), setujuiPermintaan: vi.fn(), terimaDariBackoffice: vi.fn(), updateRequestStatus: vi.fn(),
}));
vi.mock("@/lib/warehouse-stock", () => ({ loadWarehouseStock: async () => [{ warehouse_id: "wh-1", item_id: "itm-a", qty: 250 }] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from: () => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({
          data: {
            id: "req", no_request: "PRM-1", status: "Disetujui", created_at: "2026-10-29T03:00:00Z",
            priority: "normal", catatan: null, to_warehouse_id: "wh-1",
            branches: { name: "Cabang A" }, warehouses: { name: "Gudang Pusat" },
            stock_request_items: [{
              id: "line-1", item_id: "itm-a", nama: "Obat A", satuan: "pcs", faktor: 1,
              qty_diminta: 500, qty_disetujui: 500, qty_dikirim: null, qty_diterima: null, kondisi: null, catatan: null,
            }],
          }, error: null,
        }),
      };
      return query;
    },
  }),
}));
import PermintaanDetailPage from "@/app/(app)/pos/permintaan/[id]/page";
import { MasterPage } from "../MasterPage";

const KURANG_KIRIM = "Stok gudang pengirim tidak cukup. Obat A butuh 500 pcs, tersedia 250 pcs. Kurangi jumlah kirim atau tunggu stok masuk";

const halamanPermintaan = async () => renderToStaticMarkup(await PermintaanDetailPage({
  params: Promise.resolve({ id: "req" }),
  searchParams: Promise.resolve({ error: state.error }),
}));

beforeEach(() => { state.error = undefined; });

describe("permintaan barang: penolakan pengiriman jadi popup, bukan cuma bilah merah", () => {
  it("popup menyebut barang, gudang pengirim, dan angka kurangnya", async () => {
    state.error = KURANG_KIRIM;
    const html = await halamanPermintaan();
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Stok tidak cukup");
    expect(html).toContain("Gudang pengirim");
    expect(html).toContain("Ubah jumlah");
    expect(html).toContain("kirim sebagian");
    // Bilah merah halaman tetap ada sebagai jejak setelah popup ditutup.
    expect(html).toContain("Kurangi jumlah kirim atau tunggu stok masuk");
  });

  it("isian qty kirim diberi penanda supaya 'Ubah jumlah' mengantar ke barangnya", async () => {
    state.error = KURANG_KIRIM;
    expect(await halamanPermintaan()).toContain('data-stok-kurang="Obat A"');
  });

  it("pesan yang bukan soal stok tidak memunculkan popup", async () => {
    state.error = "Hanya Kepala Gudang / Manajer yang bisa mengirim";
    const html = await halamanPermintaan();
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain("Hanya Kepala Gudang / Manajer yang bisa mengirim");
  });

  it("tanpa pesan sama sekali, tidak ada dialog", async () => {
    expect(await halamanPermintaan()).not.toContain('aria-modal="true"');
  });
});

describe("kerangka MasterPage: satu pintu untuk layar master & dokumen", () => {
  const render = (error?: string) => renderToStaticMarkup(
    <MasterPage back="/pos" icon="ti-box" title="PRODUKSI" desc="" error={error}
      successMsg="Tersimpan." bolehKelola readOnlyNote=""><p>isi</p></MasterPage>,
  );

  it("penolakan stok bahan produksi naik jadi popup", () => {
    const html = render("Stok bahan tidak cukup");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Bahan produksi");
  });

  it("pesan biasa hanya jadi bilah merah", () => {
    const html = render("Nama kategori sudah dipakai.");
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain("Nama kategori sudah dipakai.");
  });
});

describe("cakupan: tiap layar yang mengeluarkan stok bermuara ke popup yang sama", () => {
  // Penjaga daftar layar. Kalau sebuah layar dibongkar ulang dan popupnya ikut
  // terbuang, tes ini yang menangkapnya — bukan petugas gudang di lapangan.
  it.each([
    ["Permintaan barang — setujui & kirim", "src/app/(app)/pos/permintaan/[id]/page.tsx"],
    ["Pemindahan barang — formulir", "src/app/(app)/pos/pemindahan/baru/PemindahanForm.tsx"],
    ["Pemindahan barang — penolakan database", "src/app/(app)/pos/pemindahan/baru/page.tsx"],
    ["Kasir petshop — checkout", "src/app/kasir/KasirClient.tsx"],
    ["Klinik — rekam medis", "src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx"],
    ["Klinik — racikan & penolakan halaman rekam medis", "src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx"],
    ["Klinik — catatan rawat inap", "src/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm.tsx"],
    ["Klinik — pembayaran (stok benar-benar keluar di sini)", "src/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx"],
    ["Penyesuaian persediaan — daftar", "src/app/(app)/pos/penyesuaian/page.tsx"],
    ["Penyesuaian persediaan — baru", "src/app/(app)/pos/penyesuaian/baru/page.tsx"],
    ["Koreksi stok dokumen", "src/app/(app)/pos/koreksi-stok/StockCorrectionForm.tsx"],
    ["Produksi merek sendiri", "src/app/(app)/pos/produksi/page.tsx"],
    ["Retur pembelian — daftar", "src/app/(app)/pembelian/retur/page.tsx"],
    ["Retur pembelian — baru", "src/app/(app)/pembelian/retur/baru/page.tsx"],
    ["Pengiriman penjualan grosir", "src/app/(app)/penjualan/pesanan/[id]/page.tsx"],
    ["Kerangka MasterPage (faktur penjualan langsung dll.)", "src/components/MasterPage.tsx"],
  ])("%s", (_layar, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/StokKurang(Popup|DariPesan)/);
  });
});
