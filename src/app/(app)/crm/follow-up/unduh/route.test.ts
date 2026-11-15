import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ akses: { ok: true, role: "OWNER", bolehUnduh: true } as { ok: boolean; role: string | null; bolehUnduh: boolean }, daftar: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/marketing-followup-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/marketing-followup-server")>()),
  periksaAksesMarketing: async () => mock.akses,
  muatDaftarMarketing: (...a: unknown[]) => mock.daftar(...a),
}));
import { GET } from "./route";

const baris = { customer_id: "c", pet_id: null, nama: "=EVIL()", hp: "+62 812", wa: "62812", hewan: ["Mochi"], hewan_total: 1, cabang_id: null, cabang: null, terakhir: "2026-08-01T03:00:00Z",
  jenis_terakhir: "Klinik", total_belanja: 0, kunjungan: 2, hari: 106, sumber: null, jadwal: null, groomer: null, item: null, dihubungi: null };
beforeEach(() => {
  mock.akses = { ok: true, role: "OWNER", bolehUnduh: true };
  mock.daftar.mockReset();
  mock.daftar.mockResolvedValue({ tab: "lama", hari_ini: "2026-11-15", total: 1, tanpa_nomor: 2, baris: [baris] });
});

describe("unduh Excel follow up", () => {
  it("tanpa akses atau bukan Owner/Admin = 403 dan database tidak dibaca", async () => {
    mock.akses = { ok: false, role: null, bolehUnduh: false };
    expect((await GET(new Request("http://x/crm/follow-up/unduh"))).status).toBe(403);
    mock.akses = { ok: true, role: "STAFF", bolehUnduh: false };
    expect((await GET(new Request("http://x/crm/follow-up/unduh"))).status).toBe(403);
    expect(mock.daftar).not.toHaveBeenCalled();
  });
  it("xlsx: saringan dari URL dipakai (maks. 500 per cabang), sel rumus diberi petik, ada lembar Keterangan dengan catatan riwayat", async () => {
    const res = await GET(new Request("http://x/crm/follow-up/unduh?tab=lama&hari=180&status=semua&cabang=bukan-uuid"));
    expect(res.status).toBe(200);
    expect(mock.daftar.mock.calls[0][1]).toMatchObject({ tab: "lama", hari: 180, status: "semua", cabang: "" });
    expect(mock.daftar.mock.calls[0][2]).toEqual({ limit: 500 });
    expect(res.headers.get("content-disposition")).toContain("follow-up-lama-2026-11-15.xlsx");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Lama tidak balik")!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(["Nama pemilik", "No. HP", "Total belanja (Rp)", "Status hubungi"]));
    expect(String(sheet.getRow(2).getCell(2).value)).toBe("'=EVIL()");
    expect(String(sheet.getRow(2).getCell(4).value)).toBe("'+62 812");
    expect(String(sheet.getRow(2).getCell(1).value)).toBe("Tanpa cabang (riwayat impor)");
    expect(JSON.stringify(book.getWorksheet("Keterangan")!.getSheetValues())).toContain("Riwayat belanja rinci baru ada sejak 1 Nov 2026");
  });
  it("galat database = 500 dengan pesan aman", async () => {
    mock.daftar.mockRejectedValue(new Error("stack rahasia"));
    const res = await GET(new Request("http://x/crm/follow-up/unduh"));
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain("rahasia");
  });
});
