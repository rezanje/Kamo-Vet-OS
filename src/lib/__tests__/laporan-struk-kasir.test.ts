import { describe, expect, it } from "vitest";
import { HARI_PER_RENTANG, STRUK_KASIR_RPC, bacaStrukKasirCepat, rentangHari, fungsiStrukBelumAda } from "@/lib/laporan-struk-kasir";
import { klasifikasiGalatLaporan, statusGalatLaporan } from "@/lib/laporan-galat";
import { rpcStrukKasirTiruan } from "@/test-support/rpc-struk-kasir-tiruan";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hariKe = (dari: string, n: number) => new Date(new Date(`${dari}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const selisihHari = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

describe("rentangHari", () => {
  it.each([
    ["2026-11-01", "2026-11-22", 4],   // 7+7+7+1
    ["2026-11-01", "2026-11-07", 1],
    ["2026-11-01", "2026-11-08", 2],
    ["2026-11-15", "2026-11-15", 1],
    ["2026-09-01", "2026-11-22", 12],  // 83 hari (hampir tiga bulan)
    ["2026-12-28", "2027-01-05", 2],   // lintas tahun
    ["2028-02-26", "2028-03-02", 1],   // tahun kabisat
  ])("%s .. %s -> %i rentang tanpa celah/tumpang tindih, masing-masing <= 7 hari", (dari, sampai, jumlah) => {
    const r = rentangHari(dari, sampai);
    expect(r).toHaveLength(jumlah);
    expect(r[0].dari).toBe(dari);
    expect(r[r.length - 1].sampai).toBe(sampai);
    r.forEach((x, i) => {
      expect(selisihHari(x.dari, x.sampai) + 1).toBeLessThanOrEqual(HARI_PER_RENTANG);
      expect(x.dari <= x.sampai).toBe(true);
      if (i > 0) expect(x.dari).toBe(hariKe(r[i - 1].sampai, 1));
    });
  });
  it("dari > sampai -> kosong", () => expect(rentangHari("2026-11-10", "2026-11-01")).toEqual([]));
});

const struk = (n: number, tgl: string, extra: Record<string, unknown> = {}) => ({ id: id(n), branch_id: "cab-a", customer_id: null, no_struk: `POS-${n}`, created_at: tgl, channel: null, total: 10000, merchant_fee_total: 0, payment_plan: null, payments_finalized_at: null, voided_at: null, salesperson_id: null, cashier_id: null, branches: { name: "A" }, customers: null, ...extra });
const item = (n: number, saleId: string) => ({ id: id(10_000 + n), sale_id: saleId, nama: "Pakan", qty: 1, harga: 10000, item_id: null, satuan: null, faktor: 1, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null });

function klien(tables: { sales: ReturnType<typeof struk>[]; sale_items: ReturnType<typeof item>[] }, opsi: { boleh?: string[] | null } = {}) {
  const panggilan: { nama: string; args: Record<string, unknown> }[] = [];
  let aktif = 0, puncak = 0;
  const fn = rpcStrukKasirTiruan(tables, opsi.boleh ?? null);
  return {
    panggilan, puncak: () => puncak,
    client: { rpc: async (nama: string, args: Record<string, unknown>) => { panggilan.push({ nama, args }); aktif++; puncak = Math.max(puncak, aktif); await new Promise(r => setTimeout(r, 1)); aktif--; return fn(args); } },
  };
}

describe("bacaStrukKasirCepat", () => {
  it("jumlah panggilan = jumlah rentang 7 hari (bukan ratusan query), bersamaan paling banyak 6, hasil urut id tanpa duplikat", async () => {
    // 83 hari, 2 struk per hari, tersebar di batas rentang termasuk tepat tengah malam WIB.
    const sales: ReturnType<typeof struk>[] = []; const sale_items: ReturnType<typeof item>[] = [];
    for (let d = 0; d < 83; d++) for (const jam of ["00:00:00+07:00", "23:59:59.999+07:00"]) {
      const n = sales.length + 1; sales.push(struk(n, `${hariKe("2026-09-01", d)}T${jam}`)); sale_items.push(item(n, id(n)), item(n + 5000, id(n)));
    }
    const k = klien({ sales, sale_items });
    const hasil = await bacaStrukKasirCepat(k.client, { dari: "2026-09-01", sampai: "2026-11-22" });
    expect(hasil!.sales).toHaveLength(sales.length);
    expect(hasil!.items).toHaveLength(sale_items.length);
    expect(k.panggilan).toHaveLength(12);
    expect(k.panggilan.every(p => p.nama === STRUK_KASIR_RPC)).toBe(true);
    expect(k.puncak()).toBeLessThanOrEqual(6);
    expect(new Set(hasil!.sales.map(s => s.id)).size).toBe(sales.length);
    expect(hasil!.sales.map(s => s.id)).toEqual([...sales.map(s => s.id)].sort());
    expect(hasil!.items.map(i => i.id)).toEqual([...sale_items.map(i => i.id)].sort());
  });

  it("struk di luar periode tidak ikut; saringan cabang dan p_dengan_item diteruskan", async () => {
    const sales = [struk(1, "2026-10-31T16:59:59Z"), struk(2, "2026-10-31T17:00:00Z"), struk(3, "2026-11-22T16:59:59.999Z", { branch_id: "cab-b" }), struk(4, "2026-11-22T17:00:00Z")];
    const sale_items = sales.map((s, i) => item(i + 1, s.id));
    const semua = await bacaStrukKasirCepat(klien({ sales, sale_items }).client, { dari: "2026-11-01", sampai: "2026-11-22" });
    expect(semua!.sales.map(s => s.no_struk)).toEqual(["POS-2", "POS-3"]);
    const k = klien({ sales, sale_items });
    const cab = await bacaStrukKasirCepat(k.client, { dari: "2026-11-01", sampai: "2026-11-22", cabangId: "cab-b", denganItem: false });
    expect(cab!.sales.map(s => s.no_struk)).toEqual(["POS-3"]);
    expect(cab!.items).toEqual([]);
    expect(k.panggilan[0].args).toMatchObject({ p_branch_id: "cab-b", p_dengan_item: false, p_from: "2026-11-01T00:00:00+07:00" });
  });

  it("hak baca: hanya cabang yang boleh (fungsi database yang menentukan, aplikasi tidak menambah apa pun)", async () => {
    const sales = [struk(1, "2026-11-02T03:00:00Z", { branch_id: "cab-a" }), struk(2, "2026-11-02T03:00:00Z", { branch_id: "cab-b" }), struk(3, "2026-11-02T03:00:00Z", { branch_id: null })];
    const sale_items = sales.map((s, i) => item(i + 1, s.id));
    const h = await bacaStrukKasirCepat(klien({ sales, sale_items }, { boleh: ["cab-a"] }).client, { dari: "2026-11-01", sampai: "2026-11-22" });
    expect(h!.sales.map(s => s.no_struk)).toEqual(["POS-1"]);
    expect(h!.items).toHaveLength(1);
  });

  it("klien tanpa rpc atau fungsi belum ada -> null (pemanggil memakai pembaca lama), hanya satu panggilan percobaan", async () => {
    expect(await bacaStrukKasirCepat({}, { dari: "2026-11-01", sampai: "2026-11-22" })).toBeNull();
    const panggilan: unknown[] = [];
    const hilang = { rpc: async (...a: unknown[]) => { panggilan.push(a); return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${STRUK_KASIR_RPC}(p_branch_id, p_dari) in the schema cache` } }; } };
    expect(await bacaStrukKasirCepat(hilang, { dari: "2026-09-01", sampai: "2026-11-22" })).toBeNull();
    expect(panggilan).toHaveLength(1);
  });

  it("galat lain (batas waktu, izin) TIDAK jatuh diam-diam ke jalur lama: dilempar dengan kodenya", async () => {
    for (const [code, message] of [["57014", "canceling statement due to statement timeout"], ["42501", "ADMIN_ONLINE_FUNCTION_DENIED: x"], ["PGRST202", "Could not find the function public.fungsi_lain in the schema cache"]]) {
      const c = { rpc: async () => ({ data: null, error: { code, message } }) };
      await expect(bacaStrukKasirCepat(c, { dari: "2026-11-01", sampai: "2026-11-02" })).rejects.toMatchObject({ code, message: expect.stringContaining("Data laporan gagal dibaca") });
    }
    expect(fungsiStrukBelumAda({ code: "PGRST202", message: "Could not find the function public.fungsi_lain" })).toBe(false);
    expect(fungsiStrukBelumAda({ code: "42883", message: `function public.${STRUK_KASIR_RPC}(timestamp) does not exist` })).toBe(true);
  });

  it("gagal-tertutup: hitungan tidak cocok, struk dobel, item tanpa struk, hasil bukan objek", async () => {
    const dasar = { n_struk: 1, n_item: 1, sales: [struk(1, "2026-11-02T03:00:00Z")], items: [item(1, id(1))] };
    const cek = (data: unknown) => bacaStrukKasirCepat({ rpc: async () => ({ data, error: null }) }, { dari: "2026-11-01", sampai: "2026-11-02" });
    expect(await cek(dasar)).toMatchObject({ sales: [{ id: id(1) }] });
    await expect(cek({ ...dasar, n_struk: 2 })).rejects.toThrow("tidak lengkap");
    await expect(cek({ ...dasar, n_item: 0 })).rejects.toThrow("tidak lengkap");
    await expect(cek({ ...dasar, items: [item(1, id(99))] })).rejects.toThrow("item tanpa struk");
    await expect(cek(null)).rejects.toThrow("tidak lengkap");
    await expect(cek("x")).rejects.toThrow("tidak lengkap");
    // struk yang sama muncul di dua rentang -> ditolak
    await expect(bacaStrukKasirCepat({ rpc: async () => ({ data: dasar, error: null }) }, { dari: "2026-11-01", sampai: "2026-11-09" })).rejects.toThrow("identitas struk");
  });
});

describe("klasifikasiGalatLaporan: pesan spesifik, bukan satu kalimat umum", () => {
  const kode = (e: unknown) => klasifikasiGalatLaporan(e).kode;
  it("batas waktu database", () => {
    expect(kode(new Error("Data laporan gagal dibaca: canceling statement due to statement timeout"))).toBe("batas_waktu");
    expect(kode(Object.assign(new Error("x"), { code: "57014" }))).toBe("batas_waktu");
    expect(kode(new Error("Data laporan gagal dibaca: upstream request timeout"))).toBe("batas_waktu");
  });
  it("izin", () => {
    expect(kode(new Error("Data laporan gagal dibaca: permission denied for function laporan_struk_kasir"))).toBe("izin");
    expect(kode(Object.assign(new Error("ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia"), { code: "42501" }))).toBe("izin");
    expect(kode(new Error("Data laporan gagal dibaca: new row violates row-level security policy"))).toBe("izin");
    expect(kode(new Error("Data laporan gagal dibaca: JWT expired"))).toBe("izin");
  });
  it("koneksi, periode, umum", () => {
    expect(kode(new TypeError("fetch failed"))).toBe("koneksi");
    expect(klasifikasiGalatLaporan(new Error("Periode memuat terlalu banyak baris"))).toEqual({ kode: "periode", pesan: "Periode memuat terlalu banyak baris" });
    expect(kode(new Error("Nilai dokumen tidak cocok dengan baris untuk laporan per item."))).toBe("umum");
    expect(kode(undefined)).toBe("umum");
    expect(kode("sesuatu")).toBe("umum");
  });
  it("pesan ke pengguna tidak membawa teks mentah database; status HTTP unduhan", () => {
    const p = klasifikasiGalatLaporan(new Error("Data laporan gagal dibaca: canceling statement due to statement timeout (SELECT secret)")).pesan;
    expect(p).not.toMatch(/SELECT|statement/);
    expect(new Set(["batas_waktu", "izin", "koneksi", "umum"].map(k => klasifikasiGalatLaporan(k === "umum" ? new Error("x") : new Error(k === "batas_waktu" ? "statement timeout" : k === "izin" ? "permission denied" : "fetch failed")).pesan)).size).toBe(4);
    expect([statusGalatLaporan("izin"), statusGalatLaporan("batas_waktu"), statusGalatLaporan("koneksi"), statusGalatLaporan("umum"), statusGalatLaporan(undefined)]).toEqual([403, 504, 503, 400, 400]);
  });
});
