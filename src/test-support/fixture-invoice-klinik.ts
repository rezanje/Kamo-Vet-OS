// Data fiktif invoice klinik untuk uji "jalur baru (fungsi database) == jalur lama (query per halaman)". Tengah hari WIB supaya
// perbandingan teks jalur lama tidak terganggu batas jam. Mencakup: batal, racikan bertaut/tidak bertaut, jasa, barang, snapshot DEMO
// (pembawa biaya pelanggan/klinik), refund sebagian, penjual per baris, pelaku jasa, invoice tanpa item.
import type { TabelInvoiceKlinik } from "./rpc-invoice-klinik-tiruan";

export const idKlinik = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const CABANG_KLINIK = ["cab-a", "cab-b", "cab-c"];
export const JUMLAH_INVOICE_KLINIK = 300;

export function bikinTabelInvoiceKlinik(): Required<TabelInvoiceKlinik> & { branches: { id: string; name: string }[]; employees: Record<string, unknown>[] } {
  const invoices: Record<string, unknown>[] = [];
  const invoice_items: Record<string, unknown>[] = [];
  const clinic_demo_invoice_snapshots: Record<string, unknown>[] = [];
  const medical_records: Record<string, unknown>[] = [];
  const compounding_recipes: Record<string, unknown>[] = [];
  const clinic_refunds: Record<string, unknown>[] = [];
  for (let i = 0; i < JUMLAH_INVOICE_KLINIK; i++) {
    const hari = new Date(Date.UTC(2026, 8, 1) + Math.floor(i * 82 / (JUMLAH_INVOICE_KLINIK - 1)) * 86_400_000).toISOString().slice(0, 10);
    const cabang = CABANG_KLINIK[i % 3];
    const visitId = idKlinik(50_000 + i), invoiceId = idKlinik(i + 1);
    const barisItem: Record<string, unknown>[] = [];
    for (let j = 0; j < i % 4; j++) {
      barisItem.push({
        id: idKlinik(100_000 + i * 10 + j), invoice_id: invoiceId,
        deskripsi: j === 1 ? `Racikan Z${i % 5}` : j === 2 ? `racikan  z${i % 5}` : `Barang ${i % 9}`, qty: 1 + j, harga: 12_500 * (1 + ((i + j) % 4)),
        diskon_persen: (i + j) % 7, jenis: ["obat", "jasa", "produk", "obat"][(i + j) % 4], item_id: (i + j) % 3 === 1 ? idKlinik(7000 + (i % 6)) : null,
        compound_recipe_id: j === 2 && i % 9 === 0 ? idKlinik(8000 + i) : null,
        bmhp_components: i % 6 === 0 ? { components: [{ item_id: "x", qty: 1 }] } : null,
        service_performers: (i + j) % 4 === 1 ? { staff_id: "dokter", staff_name: "Drh. Fiktif" } : null,
        salesperson_id: j === 0 && i % 8 === 0 ? "pj" : null,
      });
    }
    // Snapshot DEMO dengan biaya ditanggung pelanggan: invoice wajib punya tepat satu baris "Admin pembayaran DEMO" senilai biaya itu.
    const biayaDemo = i % 13 === 0 ? 2500 + (i % 3) : 0;
    const bebanPelanggan = biayaDemo > 0 && i % 2 === 0;
    if (bebanPelanggan && barisItem.length > 0) {
      barisItem.push({ id: idKlinik(100_000 + i * 10 + 9), invoice_id: invoiceId, deskripsi: "Admin pembayaran DEMO", qty: 1, harga: biayaDemo, diskon_persen: 0, jenis: "jasa",
        item_id: null, compound_recipe_id: null, bmhp_components: null, service_performers: null, salesperson_id: null });
    }
    // Subtotal = jumlah baris setelah diskon baris (nilai dokumen harus cocok dengan baris); diskon dokumen kecil.
    const subtotal = Math.round(barisItem.reduce((a, b) => a + Number(b.qty) * Number(b.harga) * (1 - Number(b.diskon_persen) / 100), 0) * 100) / 100;
    const diskon = i % 4 === 0 || subtotal < 5000 ? 0 : 2500;
    invoices.push({
      id: invoiceId, visit_id: visitId, invoice_no: `INV-${i + 1}`, created_at: `${hari}T05:${String(i % 60).padStart(2, "0")}:00Z`,
      paid_status: i % 5 === 0 ? "dp" : "paid", subtotal, discount: diskon, total: subtotal - diskon,
      salesperson_id: i % 4 === 1 ? "pj" : null, voided_at: i % 17 === 0 ? `${hari}T06:00:00Z` : null,
      visits: {
        branch_id: cabang, customer_id: idKlinik(900 + (i % 20)), doctor_id: i % 3 === 0 ? "dokter" : null,
        branches: { name: `Cabang ${cabang.slice(-1).toUpperCase()}` }, customers: { name: `Pemilik ${i % 20}` }, pets: i % 6 === 0 ? null : { name: `Hewan ${i % 20}` },
      },
    });
    invoice_items.push(...barisItem);
    if (i % 3 === 0) medical_records.push({ id: idKlinik(120_000 + i), visit_id: visitId });
    if (i % 6 === 0) compounding_recipes.push({ id: idKlinik(130_000 + i), medical_record_id: idKlinik(120_000 + i), recipe_name: `Racikan Z${i % 5}` });
    if (i % 13 === 0) clinic_demo_invoice_snapshots.push({ invoice_id: invoiceId, fee_amount: biayaDemo, fee_bearer: i % 2 === 0 ? "customer" : "clinic" });
    if (i % 19 === 0 && i % 4 > 0) {
      clinic_refunds.push({
        id: idKlinik(140_000 + i), invoice_id: invoiceId, tanggal: "2026-10-01", total: 10_000,
        clinic_refund_items: [{ id: idKlinik(150_000 + i), invoice_item_id: idKlinik(100_000 + i * 10), qty: 1 }],
      });
    }
  }
  return {
    invoices, invoice_items, clinic_demo_invoice_snapshots, medical_records, compounding_recipes, clinic_refunds,
    branches: CABANG_KLINIK.map(c => ({ id: c, name: `Cabang ${c.slice(-1).toUpperCase()}` })),
    employees: [
      { id: "pj", nama: "Penjual Satu", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } },
      { id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } },
    ],
  };
}
