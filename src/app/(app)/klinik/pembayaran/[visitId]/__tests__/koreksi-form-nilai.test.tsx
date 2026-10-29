// Form koreksi harus BISA DIKIRIM ke aksi yang sudah ada.
//
// Koreksi tidak menerima uang: kolom "Jumlah Bayar" dimatikan di mode koreksi dan
// aksi `bayarVisit` menolak koreksi yang mengubah status pembayaran. Tetapi jumlah
// bayar otomatis "= sisa tagihan" untuk metode non-tunai ikut berlaku di mode
// koreksi, sehingga form mengirim paid_status "Lunas" untuk tagihan yang tersimpan
// "Belum Lunas" dan koreksinya ditolak sebelum menyentuh basis data. Tagihan tahap
// rawat inap yang kwitansinya QRIS/Transfer persis masuk kategori ini — jadi form
// yang baru ditawarkan untuk riwayat nol-bersih akan mentok tanpa perbaikan ini.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/useClinicDraft", () => ({ useClinicDraft: ({ requestKey }: { requestKey: string }) => ({ submissionKey: requestKey, submit: vi.fn(), capture: vi.fn(), attachForm: vi.fn(), discard: vi.fn(), recovered: false, storageError: "", saveError: "" }) }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/lib/tagihan-klinik", () => ({ hargaNetto: (r: { harga: number }) => r.harga, nilaiBaris: (r: { qty: number; harga: number }) => r.qty * (r.harga || 0) }));
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

const bekal = { poinSaldo: 0, promos: [], vouchers: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, hariIni: "2026-11-03", customerId: null, categoryId: null, kodeKampanye: [] };
const jasa = [{ deskripsi: "Jasa Rawat Inap Fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: null, satuan: null }];
const pasien = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "08000000000",
  address: "Alamat fiktif", dokter: "Dokter Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "INV-TAHAP-2", tanggal: "2026-11-03" };
function markup(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    <PembayaranForm visitId="visit" requestKey="kunci" patient={pasien}
      initialObat={[]} initialJasa={jasa} catatanResep={null} bekal={bekal as never} {...props} />,
  );
}
const nilai = (html: string, name: string) => html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];

it.each(["Tunai", "QRIS", "Transfer"])("koreksi tidak mengubah status pembayaran tagihan yang belum dibayar (%s)", (metode) => {
  const html = markup({ initialMetode: metode, editMode: true });
  expect(nilai(html, "paid_status")).toBe("Belum Lunas");
  expect(nilai(html, "dp_amount")).toBe("0");
});

it("koreksi mempertahankan uang muka yang tersimpan di kepala tagihan", () => {
  const html = markup({ initialMetode: "Transfer", initialDpAmount: 60000, editMode: true });
  expect(nilai(html, "paid_status")).toBe("DP");
  expect(nilai(html, "dp_amount")).toBe("60000");
});

it("koreksi tagihan pengganti mempertahankan pembayaran yang dialihkan", () => {
  const html = markup({ initialMetode: "QRIS", initialCreditAmount: 40000, editMode: true });
  expect(nilai(html, "paid_status")).toBe("DP");
  expect(nilai(html, "dp_amount")).toBe("0");
});

it("kasir biasa (bukan koreksi) tetap otomatis lunas untuk metode non-tunai", () => {
  expect(nilai(markup({ initialMetode: "QRIS" }), "paid_status")).toBe("Lunas");
  expect(nilai(markup({ initialMetode: "Tunai" }), "paid_status")).toBe("Belum Lunas");
});
