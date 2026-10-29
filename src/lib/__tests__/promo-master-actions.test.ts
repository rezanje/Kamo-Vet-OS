import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
import { PROMO_MASTER_HEADERS, PROMO_MASTER_SHEET, type PromoMasterExcelRow } from "../promo-master-excel";

// Unggah daftar promo mengubah master harga: hanya OWNER/ADMIN aktif yang boleh,
// dan yang disimpan selalu hasil pemeriksaan ULANG di server — bukan rencana
// yang dikirim layar, yang bisa saja sudah basi.

const state = vi.hoisted(() => ({
  profile: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  user: { id: "owner" } as { id: string } | null,
  calls: [] as { name: string; params: Record<string, unknown> }[],
}));

const ITEMS = [
  { id: "item-1", code: "SKU-1", name: "Grooming Lengkap", is_active: true },
  { id: "item-2", code: "SKU-2", name: "Obat Kutu", is_active: true },
];
const BRANCHES = [{ id: "branch-bdg", code: "BDG", name: "Bandung", is_active: true }];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from(table: string) {
    let kolom = "";
    let nilai: string[] = [];
    const rows = () => {
      if (table === "items") return kolom === "code" ? ITEMS.filter(i => nilai.includes(i.code)) : ITEMS.filter(i => nilai.includes(i.id));
      if (table === "branches") return BRANCHES;
      return [];                                   // promos, promo_items, promo_import_targets
    };
    const q = {
      select: () => q, eq: () => q, order: () => q, range: () => q,
      in: (col: string, values: string[]) => { kolom = col; nilai = values; return q; },
      maybeSingle: async () => ({ data: table === "profiles" ? state.profile : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const data = rows();
        return Promise.resolve({ data, count: data.length, error: null }).then(resolve);
      },
    };
    return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    return { data: { created: 1, updated: 0 }, error: null };
  },
}) }));
import { previewPromoMaster, periksaPromoMaster, simpanPromoMaster } from "../../app/(app)/crm/promo/impor-daftar/actions";

const ISI: Record<string, string> = {
  "Nama Promo": "PROMO NOVEMBER", "Kode SKU": "SKU-1", "Jenis Diskon": "Persen", "Nilai": "10",
  "Potong Otomatis": "Ya", "Cabang": "BDG", "Tanggal Mulai": "2026-11-01", "Tanggal Berakhir": "2026-11-30",
  "Min Qty": "", "Maks Qty": "", "Kelipatan": "Tidak", "Min Belanja": "", "Teks Saran": "Diskon awal bulan",
};
const baris = (over: Record<string, string> = {}, line = 2) =>
  ({ line, ...ISI, ...over }) as unknown as PromoMasterExcelRow;

async function unggahan(rows: Record<string, string>[]): Promise<FormData> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(PROMO_MASTER_SHEET);
  sheet.addRow([...PROMO_MASTER_HEADERS]);
  for (const row of rows) sheet.addRow(PROMO_MASTER_HEADERS.map(header => row[header] ?? ""));
  const form = new FormData();
  form.set("file", new File([await book.xlsx.writeBuffer() as ArrayBuffer], "daftar.xlsx"));
  return form;
}

beforeEach(() => { state.profile = { role: "OWNER", is_active: true }; state.user = { id: "owner" }; state.calls = []; });

it("membaca berkas unggahan dan menyiapkan rencananya", async () => {
  const hasil = await previewPromoMaster(await unggahan([ISI, { ...ISI, "Kode SKU": "SKU-2" }]));
  expect(hasil.error).toBeNull();
  expect(hasil.valid).toBe(true);
  expect(hasil.plans[0].item_ids).toEqual(["item-1", "item-2"]);
  expect(hasil.diffs[0].status).toBe("baru");
});

it("menolak berkas yang bukan .xlsx tanpa menyentuh master", async () => {
  const form = new FormData();
  form.set("file", new File(["bukan excel"], "daftar.csv"));
  const hasil = await previewPromoMaster(form);
  expect(hasil.error).toContain("Pilih file Excel .xlsx");
  expect(state.calls).toEqual([]);
});

it.each([
  ["kasir", { role: "KASIR", is_active: true }],
  ["admin nonaktif", { role: "ADMIN", is_active: false }],
])("menolak unggahan dari %s", async (_label, profile) => {
  state.profile = profile;
  expect((await periksaPromoMaster([baris()])).error).toContain("Hanya Owner/Admin aktif");
  const simpan = await simpanPromoMaster([baris()]);
  expect(simpan).toMatchObject({ ok: false });
  expect(simpan.message).toContain("Hanya Owner/Admin aktif");
  expect(state.calls).toEqual([]);
});

it("menolak unggahan tanpa sesi", async () => {
  state.user = null;
  expect((await simpanPromoMaster([baris()])).message).toContain("Sesi berakhir");
  expect(state.calls).toEqual([]);
});

it("menyimpan hasil pemeriksaan ulang server, bukan angka dari layar", async () => {
  const hasil = await simpanPromoMaster([baris(), baris({ "Kode SKU": "SKU-2" }, 3)]);
  expect(hasil).toMatchObject({ ok: true });
  expect(hasil.message).toContain("1 promo baru");
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].name).toBe("import_promo_master");
  expect(state.calls[0].params.p_promos).toEqual([{
    name: "PROMO NOVEMBER", discount_type: "percent", discount_value: 10, auto_apply: true,
    branch_ids: ["branch-bdg"], valid_from: "2026-11-01", valid_until: "2026-11-30",
    min_qty: null, max_qty: null, kelipatan: false, min_subtotal: null,
    suggest: "Diskon awal bulan", item_ids: ["item-1", "item-2"],
  }]);
});

it("tidak menyimpan apa pun selama masih ada baris merah", async () => {
  const hasil = await simpanPromoMaster([baris(), baris({ "Nama Promo": "PROMO RUSAK", "Kode SKU": "SKU-X" }, 3)]);
  expect(hasil.ok).toBe(false);
  expect(hasil.message).toContain("baris bertanda merah");
  expect(state.calls).toEqual([]);
});

it("menolak jumlah baris di luar batas", async () => {
  expect((await periksaPromoMaster([])).error).toContain("1 sampai 500 baris");
  expect((await simpanPromoMaster(Array.from({ length: 501 }, (_, i) => baris({}, i + 2)))).message).toContain("1 sampai 500 baris");
  expect(state.calls).toEqual([]);
});
