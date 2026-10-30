import { describe, expect, it } from "vitest";
import { muatTagihanBerjalan, ringkasBelumDitagih, TagihanBerjalanError } from "../tagihan-berjalan-server";
import { bacaRombongan } from "../rombongan-server";

// Supabase palsu seadanya: tiap tabel mengembalikan barisnya apa adanya, dan
// `gagal` menandai tabel yang bacaannya error (untuk menguji gagal-tertutup).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function klien(tables: Record<string, Any[]>, gagal: string[] = [], kode?: string) {
  return {
    from(table: string) {
      const error = gagal.includes(table)
        ? { code: kode ?? "57014", message: `gagal baca ${table}` }
        : null;
      const hasil = { data: error ? null : (tables[table] ?? []), error };
      const self: Any = {
        select: () => self, eq: () => self, in: () => self, is: () => self,
        gte: () => self, lt: () => self, order: () => self, limit: () => self,
        maybeSingle: async () => ({ data: error ? null : (tables[table] ?? [])[0] ?? null, error }),
        then: (res: Any, rej: Any) => Promise.resolve(hasil).then(res, rej),
      };
      return self;
    },
  };
}

const dasar = () => ({
  inpatient_records: [{ id: "rec-1", visit_id: "vis-1", branch_id: "b1", admitted_at: "2026-10-27T00:00:00Z", discharged_at: null }],
  visits: [{ id: "vis-1", status: "Diperiksa", poli: "Poli Umum", dokter: "drh. A", customer_id: "c1", pets: { name: "Bimo", species: "Kucing" }, customers: { name: "Reza", phone: "0812" } }],
  medical_records: [{ id: "mr-1" }],
  prescription_items: [
    { id: "p1", nama_obat: "Infus", qty: 1, harga: 100_000, jenis: "obat", kategori: null, item_id: null, satuan: null, compound_recipe_id: null },
    { id: "p2", nama_obat: "Ranap insentif", qty: 2, harga: 150_000, jenis: "jasa", kategori: "Rawat Inap", item_id: "i1", satuan: "hari", compound_recipe_id: null },
  ],
  invoices: [{ id: "inv-1", invoice_no: "INV-1", created_at: "2026-10-27T01:00:00Z", total: 100_000, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null, correction_pending: false }],
  invoice_items: [{ invoice_id: "inv-1", prescription_item_id: "p1" }],
  invoice_payments: [{ invoice_id: "inv-1", amount: 40_000 }],
  clinic_payment_receipts: [{
    id: "kwt-1", no_kwitansi: "KWT-1", tanggal: "2026-10-27", total: 40_000, status: "aktif",
    catatan: null, void_reason: null, created_at: "2026-10-27T02:00:00Z",
    profiles: { full_name: "Wowo" },
    clinic_payment_receipt_parts: [{ urutan: 2, metode: "QRIS", amount: 10_000, kas_code: "1102" }, { urutan: 1, metode: "Tunai", amount: 30_000, kas_code: "1101" }],
  }],
  clinic_customer_advances: [{ id: "um-1", no_uang_muka: "UMK-1", tanggal: "2026-10-27", amount: 50_000, applied: 20_000, status: "aktif" }],
});

describe("muatTagihanBerjalan", () => {
  it("menyisakan baris resep yang belum masuk tagihan aktif", async () => {
    const data = (await muatTagihanBerjalan(klien(dasar()) as never, "rec-1"))!;
    expect(data.belumDitagih.map((b) => b.id)).toEqual(["p2"]);
    expect(data.pasien).toBe("Bimo · Kucing");
    expect(data.pemilik).toBe("Reza");
  });

  it("rincian memakai baris invoice tersimpan dan mengecualikan invoice void, tidak harga resep terbaru", async () => {
    const tables = dasar() as Record<string, Any[]>;
    tables.invoice_items = [
      { id: "line-old", invoice_id: "inv-void", prescription_item_id: "p1", deskripsi: "Jasa lama", qty: 2, harga: 9_000, diskon_persen: 0 },
      { id: "line-active", invoice_id: "inv-1", prescription_item_id: "p1", deskripsi: "Jasa tersimpan", qty: 2, harga: 50_000, diskon_persen: 10 },
    ];
    tables.invoices.push({ ...tables.invoices[0], id: "inv-void", voided_at: "2026-10-28" });
    const data = (await muatTagihanBerjalan(klien(tables) as never, "rec-1"))!;
    expect(data.rincianDitagih).toEqual([tables.invoice_items[1]]);
    expect(data.belumDitagih.map((b) => b.id)).toEqual(["p2"]);
  });

  it("menghitung dibayar dan sisa tiap tahap beserta total piutangnya", async () => {
    const data = (await muatTagihanBerjalan(klien(dasar()) as never, "rec-1"))!;
    expect(data.tahap).toMatchObject([{ id: "inv-1", dibayar: 40_000, sisa: 60_000 }]);
    expect(data.piutang).toBe(60_000);
  });

  it("mengurutkan bagian kwitansi dan menyebut kasirnya", async () => {
    const data = (await muatTagihanBerjalan(klien(dasar()) as never, "rec-1"))!;
    expect(data.kwitansi[0].bagian.map((b) => b.metode)).toEqual(["Tunai", "QRIS"]);
    expect(data.kwitansi[0].kasir).toBe("Wowo");
  });

  it("saldo uang muka = nominal dikurangi yang sudah terpakai", async () => {
    const data = (await muatTagihanBerjalan(klien(dasar()) as never, "rec-1"))!;
    expect(data.saldoUangMuka).toBe(30_000);
  });

  it("rawat inap yang tidak ada mengembalikan null, bukan layar kosong palsu", async () => {
    expect(await muatTagihanBerjalan(klien({ inpatient_records: [] }) as never, "rec-9")).toBeNull();
  });

  it.each(["inpatient_records", "visits", "invoices", "prescription_items", "invoice_items", "invoice_payments"])
    ("gagal baca %s menghentikan layar, bukan menampilkan angka setengah", async (tabel) => {
      await expect(muatTagihanBerjalan(klien(dasar(), [tabel]) as never, "rec-1"))
        .rejects.toBeInstanceOf(TagihanBerjalanError);
    });

  it("tabel kwitansi/uang muka yang MEMANG belum ada tidak mematikan layar tagihan", async () => {
    // Migrasi belum terpasang: tagihan tahap tetap harus terbaca, tetapi layar diberi
    // tahu bahwa riwayat uangnya belum tersedia supaya aksi uangnya dikunci.
    const data = (await muatTagihanBerjalan(
      klien(dasar(), ["clinic_payment_receipts", "clinic_customer_advances"], "42P01") as never, "rec-1"))!;
    expect(data.kwitansi).toEqual([]);
    expect(data.saldoUangMuka).toBe(0);
    expect(data.tahap).toHaveLength(1);
    expect(data.riwayatUangTerpasang).toBe(false);
  });

  // FIN-09/UF-09: gangguan baca pada riwayat uang DULU tampil sebagai "Belum ada
  // pembayaran" dan saldo uang muka nol — staf bisa meminta pembayaran ulang.
  it.each([
    ["clinic_payment_receipts", "PGRST201"],
    ["clinic_payment_receipts", "42501"],
    ["clinic_customer_advances", "57014"],
  ])("gagal baca %s (%s) menghentikan layar, bukan menampilkan nol", async (tabel, kode) => {
    await expect(muatTagihanBerjalan(klien(dasar(), [tabel], kode) as never, "rec-1"))
      .rejects.toBeInstanceOf(TagihanBerjalanError);
  });

  it("riwayat uang yang lengkap menandai layar boleh memproses uang", async () => {
    const data = (await muatTagihanBerjalan(klien(dasar()) as never, "rec-1"))!;
    expect(data.riwayatUangTerpasang).toBe(true);
  });
});

// UF-03: biaya yang sudah tercatat tetapi belum ditagih harus terlihat SEBELUM pasien
// dipulangkan; kepulangan sendiri tetap tidak diblokir oleh angka ini.
describe("ringkasBelumDitagih", () => {
  it("menjumlahkan baris resep yang belum menempel pada tagihan aktif", async () => {
    const hasil = await ringkasBelumDitagih(klien(dasar()) as never, "vis-1");
    expect(hasil).toEqual({ terbaca: true, baris: 1, nilai: 300_000 });
  });

  it("baris pada tagihan yang sudah di-void kembali terhitung belum ditagih", async () => {
    const data = dasar() as Record<string, Any[]>;
    data.invoices = [{ ...data.invoices[0], voided_at: "2026-10-28T00:00:00Z" }];
    const hasil = await ringkasBelumDitagih(klien(data) as never, "vis-1");
    expect(hasil).toMatchObject({ terbaca: true, baris: 2, nilai: 400_000 });
  });

  it("sumber yang gagal dibaca dilaporkan tidak terbaca, bukan nol", async () => {
    expect(await ringkasBelumDitagih(klien(dasar(), ["invoice_items"]) as never, "vis-1"))
      .toEqual({ terbaca: false, baris: 0, nilai: 0 });
  });
});

describe("rombongan dengan tagihan bertahap", () => {
  const db = () => ({
    visits: [
      { id: "vis-1", customer_id: "c1", branch_id: "b1", created_at: "2026-10-27T03:00:00Z", customers: { name: "Reza" }, pets: { name: "Bimo" } },
    ],
    invoices: [
      { id: "inv-1", visit_id: "vis-1", invoice_no: "INV-1", total: 100_000, dp_amount: 0, paid_status: "Lunas" },
      { id: "inv-2", visit_id: "vis-1", invoice_no: "INV-2", total: 200_000, dp_amount: 0, paid_status: "Belum Lunas" },
    ],
    invoice_payments: [{ invoice_id: "inv-2", amount: 50_000 }],
  });

  it("menjumlahkan seluruh tahap satu kunjungan, bukan memakai yang terakhir saja", async () => {
    const hasil = (await bacaRombongan(klien(db()), "vis-1"))!;
    expect(hasil.baris[0]).toMatchObject({ total: 300_000, dibayar: 150_000, paidStatus: "DP" });
  });

  it("menyimpan semua nomor tagihannya supaya struk gabungan tidak kehilangan tahap", async () => {
    const hasil = (await bacaRombongan(klien(db()), "vis-1"))!;
    expect(hasil.baris[0].invoiceNo).toBe("INV-1");
    expect(hasil.baris[0].invoiceNos).toEqual(["INV-1", "INV-2"]);
  });

  it("baru disebut lunas kalau seluruh tahapnya lunas", async () => {
    const data = db();
    data.invoices[1].paid_status = "Lunas";
    data.invoice_payments = [{ invoice_id: "inv-2", amount: 200_000 }];
    const hasil = (await bacaRombongan(klien(data), "vis-1"))!;
    expect(hasil.baris[0]).toMatchObject({ paidStatus: "Lunas", dibayar: 300_000 });
  });

  it("kunjungan tanpa tagihan tetap dilaporkan belum ditagih", async () => {
    const hasil = (await bacaRombongan(klien({ ...db(), invoices: [] }), "vis-1"))!;
    expect(hasil.baris[0]).toMatchObject({ invoiceNo: null, total: 0, paidStatus: null });
  });
});
