import { describe, expect, it } from "vitest";
import { diskonSale, muatKampanye, ringkasKampanye, type KampanyeInput } from "../laporan-kampanye";

// Rentang yang sama dengan halaman: `${dari}T00:00:00+07:00` .. `${sampai}T23:59:59+07:00`.
const MULAI = "2026-10-01T00:00:00+07:00";
const AKHIR = "2026-10-31T23:59:59+07:00";
const DALAM = "2026-10-10T03:00:00Z";
const LUAR = "2026-09-10T03:00:00Z";

const V1 = { id: "v1", code: "GAJIAN", valid_until: null };
const P1 = { id: "p1", name: "Vaksin Kitten", valid_until: null };
const kode = (over: Record<string, unknown>) => ({
  id: "k", code: "KODE", voucher_id: null, promo_id: null, max_uses: null, is_active: true, note: null, ...over,
});
const sale = (over: Record<string, unknown> = {}) => ({
  id: "s", total: 90, subtotal: 100, discount: 10, diskon_kategori: 0, poin_digunakan: 0,
  created_at: DALAM, branch_id: "b1", branches: { name: "Bogor" }, campaign_code: "KODE",
  payment_plan: [{ method: "Tunai", amount: 90 }], payments_finalized_at: "2026-10-10T03:01:00Z", voided_at: null,
  sale_items: [] as unknown[], ...over,
});
const inv = (over: Record<string, unknown> = {}) => ({
  id: "i", total: 200, subtotal: 250, discount: 50, created_at: DALAM, voided_at: null, campaign_code: "KODE",
  visits: { branch_id: "b2", branches: { name: "Depok" } }, ...over,
});
const jalan = (over: Partial<Record<keyof KampanyeInput, unknown>>) =>
  ringkasKampanye({
    kode: [], vouchers: [V1], promos: [P1], sales: [], invoices: [], mulai: MULAI, akhir: AKHIR, hariIni: "2026-11-04",
    ...over,
  } as KampanyeInput);

describe("ringkasKampanye", () => {
  it("menampilkan kode tanpa pemakaian di rentang dengan angka nol, bukan menghilangkannya", () => {
    const rows = jalan({ kode: [kode({ code: "SEPI", voucher_id: "v1" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "SEPI", jenis: "voucher", tujuan: "Voucher GAJIAN", pakai: 0, pakaiPos: 0, pakaiKlinik: 0, omzet: 0, terpakaiSemua: 0, cabang: [] });
  });

  it("struk batal tidak dihitung (guard void)", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      sales: [sale({ id: "ok" }), sale({ id: "batal", voided_at: "2026-10-11T00:00:00Z", total: 500 })],
    });
    expect(rows[0]).toMatchObject({ pakaiPos: 1, omzetPos: 90, tidakDihitung: 1 });
  });

  it("struk yang pembayarannya belum difinalisasi tidak dihitung (guard finalisasi)", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      sales: [sale({ id: "ok" }), sale({ id: "gantung", payments_finalized_at: null, total: 700 })],
    });
    expect(rows[0]).toMatchObject({ pakaiPos: 1, omzetPos: 90, tidakDihitung: 1, terpakaiSemua: 1 });
  });

  it("struk lama tanpa rencana pembayaran dan tanpa finalisasi tidak dihitung — definisi kuota database lebih ketat dari isCompletedSale", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1", max_uses: 2 })],
      sales: [sale({ id: "lama", payment_plan: null, payments_finalized_at: null }), sale({ id: "ok" })],
    });
    expect(rows[0]).toMatchObject({ pakaiPos: 1, tidakDihitung: 1, terpakaiSemua: 1, sisa: 1 });
  });

  it("invoice klinik batal tidak dihitung", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      invoices: [inv({ id: "ok" }), inv({ id: "batal", voided_at: "2026-10-12T00:00:00Z" })],
    });
    expect(rows[0]).toMatchObject({ pakaiKlinik: 1, omzetKlinik: 200, tidakDihitung: 1 });
  });

  it("terbit ulang invoice klinik: yang asli batal, salinan baru membawa kode — satu pemakaian", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1", max_uses: 5 })],
      invoices: [
        inv({ id: "asli", voided_at: "2026-10-11T00:00:00Z" }),
        inv({ id: "baru", created_at: "2026-10-11T01:00:00Z" }),
      ],
    });
    expect(rows[0]).toMatchObject({ pakaiKlinik: 1, terpakaiSemua: 1, sisa: 4 });
  });

  it("memisahkan POS dan klinik dan menjumlah omzet keduanya", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      sales: [sale({ id: "a" }), sale({ id: "b", total: 10 })],
      invoices: [inv({ id: "c" })],
    });
    expect(rows[0]).toMatchObject({ pakai: 3, pakaiPos: 2, pakaiKlinik: 1, omzetPos: 100, omzetKlinik: 200, omzet: 300 });
  });

  it("batas dalam rentang: dokumen di luar rentang tidak masuk pemakaian rentang, tapi memakan kuota seumur hidup", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1", max_uses: 3 })],
      sales: [sale({ id: "lama", created_at: LUAR }), sale({ id: "baru" })],
    });
    expect(rows[0]).toMatchObject({ pakai: 1, terpakaiSemua: 2, maxUses: 3, sisa: 1 });
  });

  it("invoice klinik di luar rentang juga memakan kuota seumur hidup", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1", max_uses: 3 })],
      invoices: [inv({ id: "lama", created_at: LUAR }), inv({ id: "baru" })],
    });
    expect(rows[0]).toMatchObject({ pakaiKlinik: 1, terpakaiSemua: 2, sisa: 1 });
  });

  it("batas rentang inklusif tepat di awal dan akhir (sama dengan gte/lte halaman)", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      sales: [
        sale({ id: "awal", created_at: "2026-09-30T17:00:00Z" }),
        sale({ id: "akhir", created_at: "2026-10-31T16:59:59Z" }),
        sale({ id: "sebelum", created_at: "2026-09-30T16:59:59Z" }),
        sale({ id: "sesudah", created_at: "2026-10-31T17:00:00Z" }),
      ],
    });
    expect(rows[0].pakaiPos).toBe(2);
  });

  it("kuota habis tidak negatif dan kode tanpa batas tidak punya sisa", () => {
    const habis = jalan({
      kode: [kode({ voucher_id: "v1", max_uses: 1 })],
      sales: [sale({ id: "a" }), sale({ id: "b" })],
    });
    expect(habis[0]).toMatchObject({ maxUses: 1, terpakaiSemua: 2, sisa: 0 });
    const bebas = jalan({ kode: [kode({ voucher_id: "v1" })], sales: [sale()] });
    expect(bebas[0]).toMatchObject({ maxUses: null, sisa: null });
  });

  it("kode berbatas yang belum dipakai punya sisa penuh", () => {
    const rows = jalan({ kode: [kode({ promo_id: "p1", max_uses: 10 })] });
    expect(rows[0]).toMatchObject({ jenis: "promo", tujuan: "Promo Vaksin Kitten", sisa: 10 });
  });

  it("kode terikat promo: potongan POS = promo_discount baris promo itu saja (angka yang sama dengan tabel promo)", () => {
    const rows = jalan({
      kode: [kode({ promo_id: "p1" })],
      sales: [sale({
        discount: 40,
        sale_items: [
          { qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: "p1", promo_discount: 10 },
          { qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: "p9", promo_discount: 30 },
        ],
      })],
    });
    expect(rows[0].potongan).toEqual({ pos: 10, eksak: true });
  });

  it("kode terikat promo tapi ada invoice klinik: potongan tidak eksak (klinik tidak menyimpan potongan per promo)", () => {
    const rows = jalan({ kode: [kode({ promo_id: "p1" })], invoices: [inv()] });
    expect(rows[0].potongan).toEqual({ pos: 0, eksak: false });
  });

  it("kode terikat promo tanpa invoice klinik tetap eksak walau nol", () => {
    const rows = jalan({ kode: [kode({ promo_id: "p1" })], sales: [sale()] });
    expect(rows[0].potongan).toEqual({ pos: 0, eksak: true });
  });

  it("kode terikat voucher: potongan voucher tidak bisa dipisah dari diskon manual — tidak ditebak", () => {
    const rows = jalan({ kode: [kode({ voucher_id: "v1" })], sales: [sale()] });
    expect(rows[0].potongan).toEqual({ pos: null, eksak: false });
    // Yang tersedia hanya total diskon pada dokumen itu (batas atas).
    expect(rows[0].diskonDokumen).toBe(10);
  });

  it("diskonDokumen memakai rumus tabel diskon cabang: item + golongan + poin + diskon struk, dan diskon invoice klinik", () => {
    const s = sale({
      discount: 30, diskon_kategori: 5, poin_digunakan: 4,
      sale_items: [{ qty: 2, harga: 50, item_discount_type: "nominal", item_discount_value: 6, promo_id: null, promo_discount: 0 }],
    });
    // item 6, poin 4, lain = 30 - 6 - 4 = 20, golongan 5 → 35
    expect(diskonSale(s as never)).toEqual({ item: 6, golongan: 5, poin: 4, lain: 20, total: 35 });
    const rows = jalan({ kode: [kode({ voucher_id: "v1" })], sales: [s], invoices: [inv()] });
    expect(rows[0].diskonDokumen).toBe(35 + 50);
  });

  it("daftar cabang dihitung per dokumen yang dihitung saja", () => {
    const rows = jalan({
      kode: [kode({ voucher_id: "v1" })],
      sales: [sale({ id: "a" }), sale({ id: "b" }), sale({ id: "x", voided_at: "2026-10-11T00:00:00Z", branches: { name: "Cibinong" } })],
      invoices: [inv()],
    });
    expect(rows[0].cabang).toEqual([{ nama: "Bogor", n: 2 }, { nama: "Depok", n: 1 }]);
  });

  it("urut menurut pemakaian lalu kode; kode nol-pakai ikut di bawah", () => {
    const rows = jalan({
      kode: [kode({ id: "1", code: "AAA", voucher_id: "v1" }), kode({ id: "2", code: "BBB", voucher_id: "v1" }), kode({ id: "3", code: "CCC", voucher_id: "v1" })],
      sales: [sale({ campaign_code: "CCC" }), sale({ id: "s2", campaign_code: "CCC" }), sale({ id: "s3", campaign_code: "BBB" })],
    });
    expect(rows.map((r) => r.code)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("status: nonaktif, kadaluarsa menurut tujuan (sama dengan layar kode kampanye), aktif", () => {
    const rows = jalan({
      kode: [
        kode({ id: "1", code: "AKTIF", voucher_id: "v1" }),
        kode({ id: "2", code: "MATI", voucher_id: "v1", is_active: false }),
        kode({ id: "3", code: "LEWAT", promo_id: "p1" }),
      ],
      promos: [{ ...P1, valid_until: "2026-10-31" }],
    });
    const status = Object.fromEntries(rows.map((r) => [r.code, r.status]));
    expect(status).toEqual({ AKTIF: "aktif", MATI: "nonaktif", LEWAT: "kadaluarsa" });
  });

  it("dokumen yang membawa kode yang sudah tidak ada di master tampil sebagai kode terhapus", () => {
    const rows = jalan({ kode: [], sales: [sale({ campaign_code: "HILANG" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "HILANG", status: "dihapus", tujuan: "(kode sudah dihapus)", pakaiPos: 1, maxUses: null });
  });

  it("dokumen tanpa campaign_code diabaikan", () => {
    const rows = jalan({ kode: [kode({ voucher_id: "v1" })], sales: [sale({ campaign_code: null })], invoices: [inv({ campaign_code: null })] });
    expect(rows[0].pakai).toBe(0);
  });
});

describe("muatKampanye", () => {
  const supabaseTiruan = (hasil: Array<{ data?: unknown[]; error?: unknown }>) => {
    let i = 0;
    const query: unknown = new Proxy({}, { get: () => () => query });
    return { from: () => query, __next: () => hasil[i++] };
  };

  it("mengembalikan data ketiga sumber lewat pembaca laporan lengkap", async () => {
    const hasil = [{ data: [{ id: "k1" }] }, { data: [{ id: "s1" }] }, { data: [{ id: "i1" }] }];
    const s = supabaseTiruan(hasil);
    const out = await muatKampanye(s as never, async () => ({ data: (s.__next().data ?? []) as never[], error: null }));
    expect(out).toEqual({ tersedia: true, kode: [{ id: "k1" }], sales: [{ id: "s1" }], invoices: [{ id: "i1" }] });
  });

  it.each(["42P01", "42703", "PGRST204", "PGRST205"])("kolom/tabel kampanye belum ada (%s): halaman tetap jalan, bagian kampanye ditandai tidak tersedia", async (code) => {
    const s = supabaseTiruan([]);
    const out = await muatKampanye(s as never, async () => { throw Object.assign(new Error("x"), { code }); });
    expect(out).toEqual({ tersedia: false, kode: [], sales: [], invoices: [] });
  });

  it("galat lain dilempar ulang, tidak ditelan jadi laporan kosong", async () => {
    const s = supabaseTiruan([]);
    await expect(muatKampanye(s as never, async () => { throw Object.assign(new Error("putus"), { code: "08006" }); })).rejects.toThrow("putus");
  });
});
