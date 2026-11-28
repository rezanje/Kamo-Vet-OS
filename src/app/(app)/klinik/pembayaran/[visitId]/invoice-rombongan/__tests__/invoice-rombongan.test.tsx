// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAB_A, CAB_B, buatDb, dataDasar, galat, type Tabel } from "./fake-db";

// Invoice gabungan satu kedatangan (A4). Memakai bacaRombongan yang ASLI di atas basis data tiruan, sehingga
// definisi rombongan (pemilik + cabang + hari, tanpa void/arsip) diuji sungguhan dan struk gabungan dibandingkan langsung.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "cabang-terpilih-lain" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => holder.db }));
vi.mock("../../PrintButton", () => ({ PrintButton: ({ label }: { label: string }) => <button data-cetak>{label}</button> }));

import InvoiceRombongan from "../page";
import StrukRombongan from "../../struk-rombongan/page";

let tabel: Tabel;
let logo: string | null | undefined;
const pasang = () => { holder.db = buatDb(tabel, { logo }); };
const params = (id = "v1") => ({ params: Promise.resolve({ visitId: id }) });
const render = async (id = "v1") => renderToStaticMarkup(await InvoiceRombongan(params(id)));
const teks = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const kop = (h: string) => h.slice(h.indexOf('data-kop="cabang"'), h.indexOf("INVOICE GABUNGAN</div>"));
const bagian = (h: string, visit: string) => { const a = h.indexOf(`data-bagian-hewan="${visit}"`); const b = h.indexOf("</section>", a); return h.slice(a, b); };
const LOGO = `cabang-logo/${CAB_A}/1700000000000-ab12cd34.png`;

beforeEach(() => {
  tabel = dataDasar(); logo = undefined;
  galat.atTable = null; galat.bilaSelect = null; galat.thrown = null; galat.dropInvoice = false;
  pasang();
});

describe("invoice gabungan: isi dokumen", () => {
  it("satu dokumen A4: kop cabang, judul, pemilik (nama/telepon/alamat), tanggal, jumlah pasien dan invoice", async () => {
    const h = await render(); const t = teks(h);
    expect(h).toContain("@media print { @page { size: A4; margin: 14mm; }");
    expect(h).toMatch(/class="no-print"[^>]*>[\s\S]*Cetak Invoice Gabungan/);
    expect(t).toContain("INVOICE GABUNGAN");
    expect(t).toContain("3 pasien · 3 invoice");
    expect(t).toContain("27 November 2026");
    expect(t).toContain("Bu Sinta Fiktif"); expect(t).toContain("0811000111"); expect(t).toContain("Jl. Mawar 5, Bogor");
    expect((h.match(/data-kop="cabang"/g) ?? []).length).toBe(1);
    expect((h.match(/data-bagian-hewan="v\d"/g) ?? []).length).toBe(3);
  });

  it("tiap hewan satu bagian: nama, spesies, poli, nomor invoice, baris tagihan, kasir, dokter/groomer seperti struk", async () => {
    const h = await render(); const m = bagian(h, "v1"); const g = bagian(h, "v2");
    expect(teks(m)).toContain("1. Milo"); expect(teks(m)).toContain("Kucing / Persia");
    expect(teks(m)).toContain("No. Invoice: INV-202611-0101"); expect(teks(m)).toContain("Konsultasi Fiktif");
    expect(teks(m)).toContain("Kasir: Kasir Fiktif"); expect(teks(m)).toContain("Dokter: drh. Fiktif");
    expect(teks(g)).toContain("2. Bruno"); expect(teks(g)).toContain("Poli: Grooming"); expect(teks(g)).toContain("Kasir: Kasir Dua");
    expect(teks(g)).toContain("Grooming Fiktif"); expect(teks(g)).not.toContain("Konsultasi Fiktif");
    expect(teks(g)).toContain("Groomer: drh. Fiktif");
  });

  it("subtotal tiap hewan dan TOTAL SEMUA = jumlah total semua invoice (45.000 + 100.000 + 80.500 = 225.500)", async () => {
    const h = await render();
    const sub = [...h.matchAll(/data-subtotal-hewan[^>]*>Rp ([\d.]+)</g)].map((x) => Number(x[1].replace(/\./g, "")));
    expect(sub).toEqual([45000, 100000, 80500]);
    expect(sub.reduce((a, b) => a + b, 0)).toBe(225500);
    expect(h).toMatch(/data-total-semua[^>]*>Rp 225\.500</);
    // diskon transaksi tiap invoice tampil di invoicenya sendiri, total tetap neto
    expect(teks(bagian(h, "v2"))).toContain("Diskon transaksi - Rp 20.000");
    expect(teks(bagian(h, "v2"))).toContain("Total INV-202611-0102 Rp 100.000");
  });

  it("pembayaran: metode dan status per invoice, status keseluruhan Belum lunas, dibayar/sisa gabungan sama dengan struk", async () => {
    const h = await render(); const t = teks(h);
    expect(teks(bagian(h, "v1"))).toContain("Metode pembayaran: Tunai"); expect(teks(bagian(h, "v1"))).toContain("Lunas");
    const dp = teks(bagian(h, "v3"));
    expect(dp).toContain("DP"); expect(dp).toContain("DP dibayar - Rp 30.000"); expect(dp).toContain("Sisa Rp 30.500");
    expect(dp).toContain("Metode pembayaran: Campuran"); expect(dp).toContain("QRIS: Rp 30.000"); expect(dp).toContain("Tunai: Rp 20.000");
    expect(t).toContain("Dibayar Rp 195.000"); expect(t).toContain("Sisa Rp 30.500");
    expect(h).toMatch(/data-status-keseluruhan[^>]*>Belum lunas</); expect(h).toMatch(/data-status-semua[^>]*>Belum lunas</);
    expect(t).toContain("Masih ada tagihan yang belum lunas");
    expect(t).toMatch(/Metode pembayaran: (Tunai, Campuran|Campuran, Tunai)/);
  });

  it("semua lunas: status keseluruhan Lunas, tanpa peringatan, tanpa baris Sisa", async () => {
    tabel.invoices[2] = { ...tabel.invoices[2], paid_status: "Lunas", paid_at: "2026-11-27T06:30:00Z" };
    tabel.invoice_payments = []; pasang();
    const h = await render(); const t = teks(h);
    expect(h).toMatch(/data-status-keseluruhan[^>]*>Lunas</); expect(h).toMatch(/data-status-semua[^>]*>Lunas</);
    expect(t).not.toContain("Masih ada tagihan yang belum lunas"); expect(t).not.toContain("Sisa Rp");
    expect(h).toMatch(/data-total-semua[^>]*>Rp 225\.500</); expect(t).toContain("Dibayar Rp 225.500");
  });

  it("kasir yang tidak tercatat ditulis apa adanya, tidak ditebak dari dokter", async () => {
    tabel.invoices[0] = { ...tabel.invoices[0], cashier_name: null }; pasang();
    const m = teks(bagian(await render(), "v1"));
    expect(m).toContain("Kasir: Kasir belum tercatat"); expect(m).not.toContain("Kasir: drh. Fiktif");
  });

  it("promo per barang tampil di bawah barangnya; 'Diskon transaksi' hanya sisanya; total tidak berubah", async () => {
    tabel.invoice_promo_lines = [{ id: "pl1", invoice_id: "i2", item_id: "it-l2", promo_name: "Promo Fiktif Grooming", potongan: 15000, created_at: "2026-11-27T04:31:00Z" }]; pasang();
    const h = await render(); const g = teks(bagian(h, "v2"));
    expect(g).toContain("Promo Fiktif Grooming"); expect(g).toContain("- Rp 15.000");
    expect(g).toContain("Diskon transaksi - Rp 5.000"); expect(g).toContain("Subtotal Rp 105.000");
    expect(g).toContain("Total INV-202611-0102 Rp 100.000");
    expect(h).toMatch(/data-total-semua[^>]*>Rp 225\.500</);
  });

  it("tiap bagian hewan tidak terpotong di tengah halaman saat dicetak", async () => {
    expect(await render()).toContain("[data-bagian-hewan] { break-inside: avoid; }");
  });

  it("hewan yang belum ditagih tetap tampil sebagai bagian kosong dan dokumen memperingatkan", async () => {
    tabel.visits.push({ id: "v4", customer_id: "cust-1", branch_id: CAB_A, created_at: "2026-11-27T03:30:00Z", archived_at: null, pet_id: "pet-9", poli: "Poli Umum", doctor_id: null, dokter: null });
    pasang();
    const h = await render(); const t = teks(h);
    expect(teks(bagian(h, "v4"))).toContain("4. Lain"); expect(teks(bagian(h, "v4"))).toContain("(tagihan belum dibuat)");
    expect(t).toContain("belum dibuat"); expect(t).toContain("4 pasien · 3 invoice");
    expect(h).toMatch(/data-total-semua[^>]*>Rp 225\.500</); expect(h).toMatch(/data-status-keseluruhan[^>]*>Belum lunas</);
  });

  it("rawat inap bertahap: satu hewan dengan dua invoice aktif, keduanya tercetak dan masuk subtotal hewan", async () => {
    tabel.invoices.push({ ...tabel.invoices[0], id: "i1b", invoice_no: "INV-202611-0109", subtotal: 15000, total: 15000, created_at: "2026-11-27T08:30:00Z" });
    tabel.invoice_items.push({ ...tabel.invoice_items[0], id: "l9", invoice_id: "i1b", deskripsi: "Obat tahap dua", qty: 1, harga: 15000 });
    pasang();
    const h = await render(); const m = bagian(h, "v1");
    expect(teks(m)).toContain("INV-202611-0101"); expect(teks(m)).toContain("INV-202611-0109"); expect(teks(m)).toContain("Obat tahap dua");
    expect(m).toMatch(/data-subtotal-hewan[^>]*>Rp 60\.000</);
    expect(h).toMatch(/data-total-semua[^>]*>Rp 240\.500</);
    expect(teks(h)).toContain("4 invoice");
  });
});

describe("invoice gabungan: siapa yang ikut (rombongan sama dengan struk gabungan)", () => {
  it("invoice yang di-void tidak ikut: nomornya, barisnya, dan angkanya tidak tercetak", async () => {
    tabel.invoices.push({ ...tabel.invoices[0], id: "i1v", invoice_no: "INV-202611-0199", subtotal: 999000, total: 999000, voided_at: "2026-11-27T05:00:00Z", created_at: "2026-11-27T04:00:00Z" });
    tabel.invoice_items.push({ ...tabel.invoice_items[0], id: "l99", invoice_id: "i1v", deskripsi: "Jasa dibatalkan", qty: 1, harga: 999000 });
    pasang();
    const h = await render(); const t = teks(h);
    expect(t).not.toContain("INV-202611-0199"); expect(t).not.toContain("Jasa dibatalkan"); expect(t).not.toContain("999.000");
    expect(h).toMatch(/data-total-semua[^>]*>Rp 225\.500</); expect(t).toContain("3 invoice");
  });

  it("hanya kunjungan pemilik yang sama, cabang yang sama, hari yang sama, dan tidak diarsipkan", async () => {
    const tambah = (id: string, extra: Record<string, unknown>, no: string) => {
      tabel.visits.push({ id, customer_id: "cust-1", branch_id: CAB_A, created_at: "2026-11-27T03:40:00Z", archived_at: null, pet_id: "pet-9", poli: "Poli Umum", doctor_id: null, dokter: null, ...extra });
      tabel.invoices.push({ ...tabel.invoices[0], id: "x" + id, invoice_no: no, visit_id: id, subtotal: 7000, total: 7000 });
      tabel.invoice_items.push({ ...tabel.invoice_items[0], id: "lx" + id, invoice_id: "x" + id, deskripsi: "Jasa " + id, qty: 1, harga: 7000 });
    };
    tambah("va", { customer_id: "cust-2" }, "INV-X-PEMILIK-LAIN");
    tambah("vb", { branch_id: CAB_B }, "INV-X-CABANG-LAIN");
    tambah("vc", { created_at: "2026-11-28T03:40:00Z" }, "INV-X-HARI-LAIN");
    tambah("vd", { created_at: "2026-11-27T17:30:00Z" }, "INV-X-LEWAT-TENGAH-MALAM-WIB");
    tambah("ve", { archived_at: "2026-11-27T09:00:00Z" }, "INV-X-ARSIP");
    pasang();
    const t = teks(await render());
    for (const no of ["INV-X-PEMILIK-LAIN", "INV-X-CABANG-LAIN", "INV-X-HARI-LAIN", "INV-X-LEWAT-TENGAH-MALAM-WIB", "INV-X-ARSIP"]) expect(t).not.toContain(no);
    expect(t).toContain("3 pasien · 3 invoice"); expect(t).toContain("Rp 225.500");
  });

  it("dibuka dari kunjungan hewan mana pun, isinya sama; dan nomor invoice + total sama persis dengan struk gabungan", async () => {
    const a = await render("v1"); const b = await render("v3");
    expect(teks(a)).toBe(teks(b));
    const struk = teks(renderToStaticMarkup(await StrukRombongan(params("v2"))));
    for (const no of ["INV-202611-0101", "INV-202611-0102", "INV-202611-0103"]) { expect(struk).toContain(no); expect(teks(a)).toContain(no); }
    expect(struk).toContain("TOTAL SEMUA Rp 225.500"); expect(teks(a)).toContain("TOTAL SEMUA Rp 225.500");
    expect(struk).toContain("Dibayar Rp 195.000"); expect(teks(a)).toContain("Dibayar Rp 195.000");
    expect(struk).toContain("3 ekor");
  });

  it("kunjungan tanpa pemilik atau tidak ada: tidak ada dokumen (404)", async () => {
    tabel.visits[0] = { ...tabel.visits[0], customer_id: null }; pasang();
    await expect(render("v1")).rejects.toThrow("NOT_FOUND");
    await expect(render("tidak-ada")).rejects.toThrow("NOT_FOUND");
  });
});

describe("invoice gabungan: kop cabang penerbit", () => {
  it("satu cabang: logo (tautan bertanda tangan), nama, alamat + telepon; judul INVOICE GABUNGAN di kanan", async () => {
    tabel.branches[0] = { ...tabel.branches[0], logo_path: LOGO }; pasang();
    const h = await render(); const k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
    expect(k).toContain(`src="https://storage.test/sign/${LOGO}?token=t"`); expect(k).not.toContain("data-kop-logo-bawaan");
    expect(h.indexOf('data-kop="cabang"')).toBeLessThan(h.indexOf("INVOICE GABUNGAN</div>"));
    expect(h).toContain("border-bottom:2px solid #16213e"); expect(h).toContain("width:46px;height:46px");
    expect(h).not.toContain("cabang-terpilih-lain"); expect(h).not.toContain("KAMO PET CARE");
  });

  it("tagihan dari beberapa cabang: hanya daftar nama cabang, tanpa alamat/telepon/logo (aturan struk gabungan)", async () => {
    tabel.branches[0] = { ...tabel.branches[0], logo_path: LOGO };
    tabel.invoices[1] = { ...tabel.invoices[1], penerbit_branch: CAB_B }; pasang();
    const h = await render("v1"); const k = kop(h);
    expect(k).toContain("Kamo Pets Clinic Cimanggu · Kamo Pets Clinic Panduraya");
    expect(k).not.toContain("Jl. Raya"); expect(k).not.toContain("Telp."); expect(k).not.toContain("<img"); expect(k).toContain("data-kop-logo-bawaan");
  });

  it("tanpa alamat/telepon: baris kontak hilang; tanpa logo: logo cakar bawaan", async () => {
    tabel.branches[0] = { ...tabel.branches[0], alamat: null, telepon: "  " }; pasang();
    const k = kop(await render());
    expect(k).toContain("Kamo Pets Clinic Cimanggu"); expect(k).not.toContain("data-kop-kontak"); expect(k).toContain("data-kop-logo-bawaan");
  });

  it("hanya telepon: baris kontak berisi telepon saja", async () => {
    tabel.branches[0] = { ...tabel.branches[0], alamat: null }; pasang();
    expect(kop(await render())).toContain("Telp. 0251 8888");
  });

  it("gagal membaca identitas cabang: kop tetap tercetak dengan nama cabang; dokumen lengkap", async () => {
    galat.thrown = "branches"; // identitas melempar; nama cabang datang dari relasi tagihan
    const h = await render();
    expect(kop(h)).toContain("Kamo Pets Clinic Cimanggu"); expect(kop(h)).not.toContain("Telp."); expect(h).toContain("Rp 225.500");
  });

  it("nama cabang tidak tercatat: 'Cabang belum tercatat'; teks cabang dilepas dari markup", async () => {
    tabel.branches[0] = { ...tabel.branches[0], name: null, code: null }; pasang();
    expect(kop(await render())).toContain("Cabang belum tercatat");
    tabel.branches[0] = { ...tabel.branches[0], name: "<b>Klinik</b>", alamat: "<script>alert(1)</script>" }; pasang();
    const h = await render();
    expect(h).not.toContain("<script>alert(1)</script>"); expect(h).toContain("&lt;b&gt;Klinik&lt;/b&gt;");
  });
});

describe("invoice gabungan: menolak mencetak bila tagihan tidak dapat diverifikasi", () => {
  const TOLAK = /Verifikasi rincian tagihan gagal\. Invoice gabungan tidak dapat dicetak/;
  it("daftar tagihan rombongan gagal dibaca: ditolak (bukan 'semua belum ditagih' Rp 0)", async () => {
    galat.atTable = "invoices"; galat.bilaSelect = "visit_id";
    await expect(render()).rejects.toThrow(TOLAK);
  });
  it("pembayaran rombongan gagal dibaca (pembacaan daftar): ditolak", async () => {
    galat.atTable = "invoice_payments"; galat.bilaSelect = "invoice_id, amount";
    await expect(render()).rejects.toThrow(TOLAK);
  });
  it("galat membaca rincian invoice: ditolak dengan pesan jelas", async () => {
    galat.atTable = "invoices"; galat.bilaSelect = "subtotal";
    await expect(render()).rejects.toThrow(TOLAK);
  });
  it("hasil terpotong (satu invoice hilang dari bacaan rincian): ditolak, bukan dianggap belum ditagih", async () => {
    galat.dropInvoice = true;
    await expect(render()).rejects.toThrow(TOLAK);
  });
  it("galat membaca pembayaran per invoice: ditolak", async () => {
    galat.atTable = "invoice_payments"; galat.bilaSelect = "metode";
    await expect(render()).rejects.toThrow(/Pembayaran invoice gabungan belum dapat dimuat lengkap/);
  });
  it("galat membaca baris rincian: ditolak", async () => {
    galat.atTable = "invoice_items";
    await expect(render()).rejects.toThrow(/Rincian invoice gabungan belum dapat dimuat lengkap/);
  });
  it("galat membaca nama petugas: ditolak", async () => {
    galat.atTable = "employees"; tabel.visits[0] = { ...tabel.visits[0], doctor_id: "emp-1" }; pasang();
    await expect(render()).rejects.toThrow(/Nama petugas tidak terbaca/);
  });
  it("galat membaca kunjungan sumber: ditolak", async () => {
    galat.atTable = "visits"; galat.bilaSelect = "pets(name, species";
    await expect(render()).rejects.toThrow(/Kunjungan sumber belum dapat diverifikasi\. Invoice gabungan tidak dapat dicetak/);
  });
  it("subtotal rincian tidak cocok dengan invoice: ditolak (aturan invoice satuan)", async () => {
    tabel.invoice_items[0] = { ...tabel.invoice_items[0], harga: 44000 }; pasang();
    await expect(render()).rejects.toThrow(/Subtotal rincian invoice belum dapat diverifikasi/);
  });
  it("dua bacaan menyebut total berbeda: ditolak, tidak dicetak dengan dua angka", async () => {
    // Rincian dibaca ulang setelah daftar rombongan; bila total invoice berubah di antaranya, dokumen ditahan.
    const asli = holder.db as ReturnType<typeof buatDb>; let panggilan = 0;
    holder.db = { ...asli, from: (t: string) => {
      const q = asli.from(t) as Record<string, unknown> & { select: (k: string, o?: unknown) => unknown };
      if (t === "invoices") { const sel = q.select; q.select = (k: string, o?: unknown) => { panggilan += 1; if (k.includes("subtotal")) { tabel.invoices[0] = { ...tabel.invoices[0], total: 46000, subtotal: 46000 }; } return sel(k, o); }; }
      return q;
    } };
    await expect(render()).rejects.toThrow(/Verifikasi total tagihan gagal\. Invoice gabungan tidak dapat dicetak/);
    expect(panggilan).toBeGreaterThan(1);
  });
  it("struk gabungan menolak pada kondisi yang sama (satu aturan)", async () => {
    galat.dropInvoice = true;
    await expect(StrukRombongan(params("v1"))).rejects.toThrow(/Verifikasi rincian tagihan gagal\. Struk gabungan/);
    galat.dropInvoice = false; galat.atTable = "invoices"; galat.bilaSelect = "visit_id";
    await expect(StrukRombongan(params("v1"))).rejects.toThrow(/Verifikasi rincian tagihan gagal\. Struk gabungan/);
  });
});
