import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
import type { BarisPenjual } from "@/lib/laporan-tenaga-penjual";

// Fixture fiktif: nama orang dan dokumen di sini tidak merujuk data nyata.

const state = vi.hoisted(() => ({ boleh: true, rows: [] as unknown[], argumen: [] as unknown[] }));

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
vi.mock("../data", () => {
  const karyawan = [
    { id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", branchName: "Cabang Uji" },
    { id: "kasir", nama: "Kasir Fiktif", jabatan: "Kasir", branchName: "Cabang Uji" },
  ];
  const namaKaryawan = new Map(karyawan.map((k) => [k.id, k.nama]));
  const cabangOptions = [{ id: "cabang", name: "Cabang Uji" }];
  return {
    ambilOpsiFilterPenjual: async () => ({ karyawan, namaKaryawan, cabangOptions, pesanError: "" }),
    ambilTenagaPenjual: async (arg: unknown) => {
      state.argumen.push(arg);
      return { rows: state.rows, karyawan, namaKaryawan, cabangOptions, faktur: [], selisihDokumen: 0, returTanpaSumber: 0, pesanError: "" };
    },
  };
});

import { GET } from "./route";

function baris(over: Partial<BarisPenjual> & { id: string }): BarisPenjual {
  return {
    dokumenId: "inv", dokumen: "INV-1", href: "/x", waktu: "2026-10-20T03:00:00Z", tanggal: "2026-10-20",
    kanal: "Klinik", jenis: "Obat", cabangId: "cabang", cabang: "Cabang Uji", pelanggan: "Pemilik Fiktif",
    pasien: "Milo", item: "Vaksin", qty: 1, bruto: 100, netto: 100, dokterId: null, stafId: null, penjualId: null,
    retur: false, ...over,
  };
}

async function bukaXlsx(response: Response) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  const isi = (nama: string) => (book.getWorksheet(nama)?.getSheetValues() ?? []).filter(Boolean)
    .map((row) => (row as unknown[]).slice(1).map((v) => (v ?? "")));
  return { book, isi };
}

beforeEach(() => {
  state.boleh = true;
  state.argumen = [];
  state.rows = [
    baris({ id: "a", dokterId: "dokter", itemId: "vaksin", kode: "VK-1", qty: 2, dokumenId: "d1" }),
    baris({ id: "b", dokterId: "dokter", itemId: "vaksin", kode: "VK-1", qty: 3, dokumenId: "d2" }),
    baris({ id: "c", penjualId: "kasir", kanal: "Petshop", jenis: "Barang", item: "Pasir", itemId: "pasir", qty: 4, dokumenId: "s1" }),
  ];
});

it("A3: tersedia saat disaring ke SATU tenaga penjual, lengkap dengan rekap per item", async () => {
  const response = await GET(new Request("https://contoh.test/laporan/penjual/unduh?dari=2026-10-01&sampai=2026-10-31&karyawan=dokter&tampilan=rekap-item"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
  expect(response.headers.get("Content-Disposition")).toContain("penjualan-tenaga-penjual-2026-10-01-2026-10-31.xlsx");

  const { book, isi } = await bukaXlsx(response);
  expect(book.worksheets.map((s) => s.name)).toEqual(["Filter", "Rekap per orang", "Rekap per item", "Rincian baris", "Faktur grosir"]);
  // Lembar filter memakai NAMA karyawan, bukan ID.
  expect(isi("Filter")).toContainEqual(["Karyawan", "Drh. Fiktif"]);
  expect(isi("Rekap per item")).toEqual([
    ["Tenaga penjual", "Peran", "Kode", "Item", "Jenis", "Satuan", "Qty bersih", "Qty retur", "Transaksi", "Netto"],
    ["Drh. Fiktif", "Dokter", "VK-1", "Vaksin", "Obat", "", 5, 0, 2, 200],
  ]);
  // Hanya baris orang terpilih yang ikut.
  expect(JSON.stringify(isi("Rincian baris"))).not.toContain("Kasir Fiktif");
  expect(isi("Rincian baris")).toHaveLength(3);
});

it("A3: semua karyawan & CSV juga bisa, dan cabang terpilih diteruskan ke penarikan data", async () => {
  const response = await GET(new Request("https://contoh.test/laporan/penjual/unduh?dari=2026-10-01&sampai=2026-10-31&cabang_id=cabang&format=csv"));
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).toContain("Rekap per item");
  expect(csv).toContain("Drh. Fiktif");
  expect(csv).toContain("Kasir Fiktif");
  expect(csv).toContain("Pasir");
  expect(state.argumen).toEqual([{ dari: "2026-10-01", sampai: "2026-10-31", cabangId: "cabang" }]);
});

it("A3: menolak pengguna tanpa akses laporan, tanpa membaca data", async () => {
  state.boleh = false;
  const response = await GET(new Request("https://contoh.test/laporan/penjual/unduh"));
  expect(response.status).toBe(403);
  expect(state.argumen).toEqual([]);
});
