import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analisisSemua, type BarisStokMentah } from "@/lib/stok-analisis";

const mock = vi.hoisted(() => ({ akses: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/stok-analisis-server", () => ({
  periksaAksesStok: async () => ({ ok: mock.akses, role: "OWNER", aturan: [] }),
  muatPilihanStok: async () => ({ gudang: [], kategori: [], kategoriOpsi: [], kategoriDari: () => "=KATEGORI" }),
  muatRingkasStok: async () => analisisSemua({ hari_ini: "2026-11-13", riwayat_hari: 13, baris: [{
    id: "a", kode: "+K1", nama: "=HYPERLINK(\"http://x\")", satuan: "PCS", kategori_id: null, aktif: true, min_stock: 0, supplier_id: null,
    buy_unit: null, min_buy: 0, buy_price: 0, stok: 5, nilai: 1000, stok_sejak: "2026-11-01", keluar: 0, modal_keluar: 0, terakhir: null,
  } as BarisStokMentah] }),
}));
import { GET } from "./route";

beforeEach(() => { mock.akses = true; });

describe("unduh Excel stok slow moving", () => {
  it("akses ditolak = 403", async () => {
    mock.akses = false;
    expect((await GET(new Request("http://x/laporan/stok-slow-moving/unduh"))).status).toBe(403);
  });
  it("berkas xlsx berisi kolom singkat dan sel teks berawalan rumus diberi petik (amankanSel)", async () => {
    const res = await GET(new Request("http://x/laporan/stok-slow-moving/unduh"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("stok-slow-moving-2026-11-13.xlsx");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Slow moving")!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(["Terjual/bulan", "Cukup untuk (bulan)", "Modal tertahan", "Terakhir laku"]));
    const baris = sheet.getRow(2);
    expect(String(baris.getCell(1).value)).toBe("\'+K1");
    expect(String(baris.getCell(2).value).startsWith("\'=")).toBe(true);
    expect(String(baris.getCell(3).value)).toBe("\'=KATEGORI");
    expect(baris.getCell(10).value).toBe(1000);
    const info = book.getWorksheet("Keterangan")!;
    expect(JSON.stringify(info.getSheetValues())).toContain("riwayat baru 13 hari");
  });
});
