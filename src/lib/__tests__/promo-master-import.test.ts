import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROMO_MASTER_HEADERS, PROMO_MASTER_SHEET, makePromoMasterTemplate, readPromoMasterExcel,
  type PromoMasterExcelRow,
} from "../promo-master-excel";
import {
  parsePromoAngka, parsePromoTanggal, parsePromoYaTidak, reviewPromoMaster,
  type PromoMasterExisting,
} from "../promo-master-import";

type Isi = Partial<Record<(typeof PROMO_MASTER_HEADERS)[number], string | number>>;

const BARIS: Isi = {
  "Nama Promo": "PROMO NOVEMBER", "Kode SKU": "SKU-1", "Jenis Diskon": "Persen", "Nilai": 10,
  "Potong Otomatis": "Ya", "Cabang": "BDG", "Tanggal Mulai": "2026-11-01", "Tanggal Berakhir": "2026-11-30",
  "Min Qty": "", "Maks Qty": "", "Kelipatan": "Tidak", "Min Belanja": "", "Teks Saran": "Diskon awal bulan",
};

async function berkas(rows: Isi[], ubah?: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(PROMO_MASTER_SHEET);
  sheet.addRow([...PROMO_MASTER_HEADERS]);
  for (const row of rows) sheet.addRow(PROMO_MASTER_HEADERS.map(header => row[header] ?? ""));
  ubah?.(sheet);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

const MASTER = {
  items: [
    { id: "item-1", code: "SKU-1", name: "Grooming Lengkap", is_active: true },
    { id: "item-2", code: "SKU-2", name: "Obat Kutu", is_active: true },
    { id: "item-3", code: "SKU-3", name: "Barang Arsip", is_active: false },
  ],
  branches: [
    { id: "branch-bdg", code: "BDG", name: "Bandung", is_active: true },
    { id: "branch-jkt", code: "JKT", name: "Jakarta", is_active: true },
    { id: "branch-tutup", code: "TTP", name: "Tutup", is_active: false },
  ],
  existing: [] as PromoMasterExisting[],
  itemLabels: { "item-1": "SKU-1 · Grooming Lengkap", "item-2": "SKU-2 · Obat Kutu", "item-9": "SKU-9 · Barang Lama" },
};

const baris = (over: Isi = {}, line = 2): PromoMasterExcelRow => ({
  line, ...(Object.fromEntries(PROMO_MASTER_HEADERS.map(header =>
    [header, String((over[header] ?? BARIS[header]) ?? "")])) as Record<(typeof PROMO_MASTER_HEADERS)[number], string>),
});

describe("format Excel daftar promo", () => {
  it("fills the real downloadable template, parses/reviews it, and can hand exact plans to native RPC verification", async () => {
    const branch = { id: "fa200000-0000-4000-8000-000000000001", code: "FA-RANAP", name: "Klinik Fiktif", is_active: true };
    const items = [
      { id: "fa800000-0000-4000-8000-000000000001", code: "FA-OBAT", name: "Obat Fiktif", is_active: true },
      { id: "fae00000-0000-4000-8000-000000000002", code: "PROMO-JASA", name: "Jasa Fiktif", is_active: true },
    ];
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await makePromoMasterTemplate([branch])) as never);
    const sheet = book.getWorksheet(PROMO_MASTER_SHEET)!;
    for (const item of items) {
      const row: Isi = { ...BARIS, "Nama Promo": "Native Workbook", "Kode SKU": item.code, Cabang: branch.code,
        "Tanggal Mulai": "2026-01-01", "Tanggal Berakhir": "2099-12-31", Nilai: 20 };
      sheet.addRow(PROMO_MASTER_HEADERS.map(header => row[header] ?? ""));
    }
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const parsed = await readPromoMasterExcel(bytes);
    const reviewed = reviewPromoMaster(parsed, { items, branches: [branch], existing: [] });
    expect(reviewed.valid).toBe(true);
    expect(reviewed.plans).toHaveLength(1);
    expect(reviewed.plans[0].item_ids).toEqual(items.map(item => item.id));
    // Optional real bridge, not a synthesized API response. The native suite reads
    // this exact parser/review output and invokes the original public import RPC.
    const prefix = process.env.KAMO_PROMO_NATIVE_ARTIFACTS;
    if (prefix) {
      writeFileSync(`${prefix}.xlsx`, bytes);
      writeFileSync(`${prefix}.json`, JSON.stringify({
        workbook: `${prefix}.xlsx`, sha256: createHash("sha256").update(bytes).digest("hex"), plans: reviewed.plans,
      }, null, 2));
    }
  });
  it("berkas format berisi sheet isian, kolom lengkap, dan petunjuk pengisian", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await makePromoMasterTemplate([
      { code: "BDG", name: "Bandung" }, { code: null, name: "Tanpa kode" },
    ])) as never);
    const sheet = book.getWorksheet(PROMO_MASTER_SHEET)!;
    expect(PROMO_MASTER_HEADERS.map((_, i) => sheet.getRow(1).getCell(i + 1).value)).toEqual([...PROMO_MASTER_HEADERS]);
    const petunjuk = book.getWorksheet("Petunjuk")!;
    const teks = JSON.stringify(petunjuk.getSheetValues());
    expect(teks).toContain("Nama yang sudah ada di VetOS akan DIPERBARUI");
    expect(teks).toContain("BDG = Bandung");
    expect(teks).not.toContain("Tanpa kode");
  });

  it("membaca baris apa adanya walau urutan kolomnya berbeda", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(PROMO_MASTER_SHEET);
    const terbalik = [...PROMO_MASTER_HEADERS].reverse();
    sheet.addRow(terbalik);
    sheet.addRow(terbalik.map(header => BARIS[header] ?? ""));
    const rows = await readPromoMasterExcel(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(rows).toHaveLength(1);
    expect(rows[0]["Nama Promo"]).toBe("PROMO NOVEMBER");
    expect(rows[0]["Kode SKU"]).toBe("SKU-1");
  });

  it("menolak rumus Excel, sheet salah, dan berkas tanpa isi", async () => {
    await expect(readPromoMasterExcel(await berkas([BARIS], sheet => {
      sheet.getCell("D2").value = { formula: "1+1", result: 2 } as never;
    }))).rejects.toThrow(/Rumus tidak didukung/);
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Lembar Lain").addRow(["x"]);
    await expect(readPromoMasterExcel(new Uint8Array(await book.xlsx.writeBuffer())))
      .rejects.toThrow(/Sheet Daftar Promo tidak ditemukan/);
    await expect(readPromoMasterExcel(await berkas([]))).rejects.toThrow(/belum berisi satu baris pun/);
  });

  it("angka dan tanggal gaya Indonesia tetap terbaca", () => {
    expect(parsePromoAngka("1.500.000")).toBe(1500000);
    expect(parsePromoAngka("12,5")).toBe(12.5);
    expect(parsePromoAngka("Rp 10.000")).toBe(10000);
    expect(parsePromoAngka("12,345")).toBeNaN();
    expect(parsePromoTanggal("01/11/2026")).toBe("2026-11-01");
    expect(parsePromoTanggal("2026-02-30")).toBe("");
    expect(parsePromoYaTidak("YA")).toBe(true);
    expect(parsePromoYaTidak("tidak")).toBe(false);
    expect(parsePromoYaTidak("mungkin")).toBeNull();
  });
});

describe("pemeriksaan isi berkas", () => {
  it("menandai tanggal berakhir yang sudah lewat merah sebelum DB menolak aktivasi", () => {
    const hasil = reviewPromoMaster([
      baris({ "Tanggal Mulai": "2000-01-01", "Tanggal Berakhir": "2000-12-31" }),
    ], MASTER);
    expect(hasil.valid).toBe(false);
    expect(hasil.rows[0].error).toMatch(/kedaluwarsa|lewat|perpanjang/i);
  });
  it("menggabungkan baris bernama sama jadi satu promo berisi banyak barang", () => {
    const hasil = reviewPromoMaster([
      baris({}, 2), baris({ "Kode SKU": "SKU-2" }, 3),
    ], MASTER);
    expect(hasil.valid).toBe(true);
    expect(hasil.plans).toHaveLength(1);
    expect(hasil.plans[0]).toMatchObject({
      name: "PROMO NOVEMBER", discount_type: "percent", discount_value: 10, auto_apply: true,
      branch_ids: ["branch-bdg"], valid_from: "2026-11-01", valid_until: "2026-11-30",
      kelipatan: false, suggest: "Diskon awal bulan",
    });
    expect(hasil.plans[0].item_ids).toEqual(["item-1", "item-2"]);
    expect(hasil.diffs[0]).toMatchObject({ status: "baru", promoId: null });
  });

  it("satu berkas boleh memuat beberapa promo sekaligus", () => {
    const hasil = reviewPromoMaster([
      baris({}, 2),
      baris({ "Nama Promo": "PROMO OBAT", "Kode SKU": "SKU-2", "Jenis Diskon": "Nominal", Nilai: 2000, Cabang: "BDG,JKT" }, 3),
    ], MASTER);
    expect(hasil.valid).toBe(true);
    expect(hasil.plans.map(plan => plan.name)).toEqual(["PROMO NOVEMBER", "PROMO OBAT"]);
    expect(hasil.plans[1]).toMatchObject({ discount_type: "nominal", discount_value: 2000 });
    expect(hasil.plans[1].branch_ids).toEqual(["branch-bdg", "branch-jkt"]);
  });

  it("kosongnya kolom cabang berarti semua cabang", () => {
    const hasil = reviewPromoMaster([baris({ Cabang: "" })], MASTER);
    expect(hasil.valid).toBe(true);
    expect(hasil.plans[0].branch_ids).toBeNull();
  });

  it.each([
    ["SKU tidak dikenal", { "Kode SKU": "SKU-X" }, "SKU tidak ada di master"],
    ["SKU nonaktif", { "Kode SKU": "SKU-3" }, "SKU nonaktif"],
    ["persen di atas 100", { Nilai: 120 }, "Diskon Persen tidak boleh lebih dari 100"],
    ["nilai nol", { Nilai: 0 }, "Nilai harus angka lebih dari 0"],
    ["cabang tidak dikenal", { Cabang: "XXX" }, "Kode cabang tidak dikenal"],
    ["cabang nonaktif", { Cabang: "TTP" }, "Kode cabang tidak dikenal"],
    ["tanggal terbalik", { "Tanggal Berakhir": "2026-10-01" }, "Tanggal Berakhir mendahului"],
    ["tanggal kosong", { "Tanggal Mulai": "" }, "wajib format YYYY-MM-DD"],
    ["maks qty di bawah min", { "Min Qty": 3, "Maks Qty": 2 }, "Maks Qty tidak boleh lebih kecil"],
    ["kelipatan tanpa min qty", { Kelipatan: "Ya" }, "Kelipatan Ya memerlukan Min Qty"],
    ["jenis diskon salah", { "Jenis Diskon": "Potongan" }, "Jenis Diskon harus Persen atau Nominal"],
  ])("menandai merah: %s", (_label, over, pesan) => {
    const hasil = reviewPromoMaster([baris(over)], MASTER);
    expect(hasil.valid).toBe(false);
    expect(hasil.plans).toHaveLength(0);
    expect(hasil.rows[0].error).toContain(pesan);
  });

  it("menolak nilai promo yang berbeda antar baris satu promo", () => {
    const hasil = reviewPromoMaster([baris({}, 2), baris({ "Kode SKU": "SKU-2", Nilai: 20 }, 3)], MASTER);
    expect(hasil.valid).toBe(false);
    expect(hasil.rows[1].error).toContain("Kolom Nilai berbeda dari baris pertama");
  });

  it("menolak SKU yang sama dua kali di promo yang sama", () => {
    const hasil = reviewPromoMaster([baris({}, 2), baris({}, 3)], MASTER);
    expect(hasil.valid).toBe(false);
    expect(hasil.rows[1].error).toContain("sudah ada di promo yang sama");
  });

  it("tidak menyimpan apa pun selama masih ada baris merah", () => {
    const hasil = reviewPromoMaster([baris({}, 2), baris({ "Nama Promo": "PROMO RUSAK", "Kode SKU": "SKU-X" }, 3)], MASTER);
    expect(hasil.valid).toBe(false);
    // Promo pertama tetap dirinci untuk diperlihatkan, tapi valid=false menahan simpan.
    expect(hasil.plans.map(plan => plan.name)).toEqual(["PROMO NOVEMBER"]);
  });
});

describe("preview perubahan promo lama", () => {
  const lama: PromoMasterExisting = {
    id: "promo-1", name: "Promo November", promo_type: "diskon_produk",
    discount_type: "percent", discount_value: 5, auto_apply: true, branch_ids: ["branch-jkt"],
    valid_from: "2026-11-01", valid_until: "2026-11-30", min_qty: null, max_qty: null,
    kelipatan: false, min_subtotal: null, suggest: "Saran lama",
    item_ids: ["item-1", "item-9"], locked: false, is_active: true, version: "canonical-version",
  };

  it("memperlihatkan nilai yang berubah serta barang yang masuk dan keluar", () => {
    const hasil = reviewPromoMaster([baris({}, 2), baris({ "Kode SKU": "SKU-2" }, 3)], { ...MASTER, existing: [lama] });
    expect(hasil.valid).toBe(true);
    expect(hasil.diffs[0]).toMatchObject({ status: "ubah", promoId: "promo-1" });
    expect(hasil.diffs[0].changes).toEqual(expect.arrayContaining([
      { label: "Nilai", dari: "5", ke: "10" },
      { label: "Cabang", dari: "JKT", ke: "BDG" },
      { label: "Teks Saran", dari: "Saran lama", ke: "Diskon awal bulan" },
    ]));
    expect(hasil.diffs[0].itemsAdded).toEqual(["SKU-2 · Obat Kutu"]);
    expect(hasil.diffs[0].itemsRemoved).toEqual(["SKU-9 · Barang Lama"]);
  });

  it("berkas yang sama persis dengan master ditandai tidak ada perubahan", () => {
    const sama: PromoMasterExisting = {
      ...lama, discount_value: 10, branch_ids: ["branch-bdg"], suggest: "Diskon awal bulan", item_ids: ["item-1"],
    };
    const hasil = reviewPromoMaster([baris()], { ...MASTER, existing: [sama] });
    expect(hasil.diffs[0]).toMatchObject({ status: "sama", itemsAdded: [], itemsRemoved: [], changes: [] });
  });

  it("menolak nama master yang ambigu sebelum menampilkan diff atau mengizinkan simpan", () => {
    const hasil = reviewPromoMaster([baris()], {
      ...MASTER, existing: [lama, { ...lama, id: "promo-2", name: " PROMO NOVEMBER " }],
    });
    expect(hasil.valid).toBe(false);
    expect(hasil.plans).toEqual([]);
    expect(hasil.diffs).toEqual([]);
    expect(hasil.rows[0].error).toContain("lebih dari satu promo");
  });

  it("menolak promo total per paket di preview, sama seperti RPC simpan", () => {
    const hasil = reviewPromoMaster([baris()], {
      ...MASTER, existing: [{ ...lama, discount_mode: "package_total" }],
    });
    expect(hasil.valid).toBe(false);
    expect(hasil.plans).toEqual([]);
    expect(hasil.rows[0].error).toContain("total per paket");
  });

  it("menolak menimpa promo jenis lain dan promo hasil impor per-SKU", () => {
    const bundling = reviewPromoMaster([baris()], { ...MASTER, existing: [{ ...lama, promo_type: "bundling" }] });
    expect(bundling.rows[0].error).toContain("sudah dipakai promo jenis bundling");
    const dikunci = reviewPromoMaster([baris()], { ...MASTER, existing: [{ ...lama, locked: true }] });
    expect(dikunci.rows[0].error).toContain("targetnya dikunci");
  });
});
