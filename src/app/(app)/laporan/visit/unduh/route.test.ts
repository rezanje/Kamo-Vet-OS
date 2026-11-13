import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ boleh: true, dipanggil: 0 }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "pengguna" } }, error: null }) },
  from: (table: string) => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER" } : null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return q;
  },
}) }));
vi.mock("@/lib/akses", () => ({ bolehBukaPath: () => state.boleh }));
vi.mock("../data", () => ({
  ambilOpsiFilterVisit: async () => ({ cabangOptions: [{ id: "cabang", name: "Cabang Uji" }], karyawan: [], pesanError: "" }),
  ambilVisit: async () => {
    state.dipanggil += 1;
    return { pesanError: "", rows: [{
      id: "a", tanggal: "2026-11-10", waktu: "2026-11-10T09:37:00Z", jenis: "doctor_visit", inpatientId: "r1",
      cabangId: "cabang", cabang: "Cabang Uji", pasien: "Milo", pemilik: "Pemilik Fiktif", kondisi: "=SUM(1)", tindakan: "Infus",
      dokterId: "dokter", dokterNama: "Drh. Fiktif", paramedisId: "perawat", paramedisNama: "Perawat Fiktif",
    }] };
  },
}));

import { GET } from "./route";

beforeEach(() => { state.boleh = true; state.dipanggil = 0; });

it("A4: Excel berisi rekap per orang dan rincian; teks berbahaya diamankan", async () => {
  const response = await GET(new Request("https://contoh.test/laporan/visit/unduh?dari=2026-11-01&sampai=2026-11-30&orang=perawat"));
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  expect(book.worksheets.map((s) => s.name)).toEqual(["Filter", "Rekap per orang", "Rincian catatan"]);
  const rekap = (book.getWorksheet("Rekap per orang")!.getSheetValues().filter(Boolean) as unknown[][]).map((r) => r.slice(1));
  expect(rekap).toEqual([
    ["Nama", "Peran", "Visit terhitung (maks 1/pasien/hari)", "Semua catatan visit", "Pasien berbeda", "Hari visit", "Pemantauan (bukan visit)", "Keterangan"],
    ["Perawat Fiktif", "Paramedis", 1, 1, 1, 1, 0, ""],
  ]);
  const rincian = JSON.stringify(book.getWorksheet("Rincian catatan")!.getSheetValues());
  expect(rincian).toContain("'=SUM(1)");
  expect(rincian).toContain("16.37");
});

it("A4: menolak tanpa akses dan tidak membaca data", async () => {
  state.boleh = false;
  expect((await GET(new Request("https://contoh.test/laporan/visit/unduh"))).status).toBe(403);
  expect(state.dipanggil).toBe(0);
});
