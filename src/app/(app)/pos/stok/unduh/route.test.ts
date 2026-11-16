import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  profile: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  gagal: null as Error | null,
  cariDiterima: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from: (tabel: string) => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: state.profile, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: tabel === "role_modules" ? [] : null, error: null }).then(resolve),
    };
    return query;
  },
}) }));

vi.mock("@/lib/stok-gudang-server", () => ({
  bacaGudangAktif: async () => [{ id: "wh-1", code: "DC_LOH", name: "DC Lohbener", type: "DC" }],
  bacaMatrixStok: async (_s: unknown, cari: string) => {
    if (state.gagal) throw state.gagal;
    state.cariDiterima.push(cari);
    return {
      gudang: ["DC_LOH", "WH_B2C"],
      items: [
        { item_id: "i1", code: "CK01", name: "Crystal Kitty Creamy Crab", unit: "pcs", per: { DC_LOH: 12, WH_B2C: 3 }, total: 15 },
        { item_id: "i2", code: "=HACK", name: "Crystal Kitty Tuna", unit: "pcs", per: { WH_B2C: 4 }, total: 4 },
      ],
    };
  },
  bacaSemuaStokGudang: async () => [{ code: "CK01", name: "Crystal Kitty Creamy Crab", unit: "pcs", qty: 12 }],
}));

import { GET } from "./route";
import { ListLoadError } from "@/lib/checked-list";

const panggil = (query = "") => GET(new Request(`https://app.test/pos/stok/unduh${query}`));

beforeEach(() => {
  state.user = { id: "user-1" };
  state.profile = { role: "OWNER", is_active: true };
  state.gagal = null;
  state.cariDiterima = [];
});

it("menolak permintaan tanpa sesi", async () => {
  state.user = null;
  expect((await panggil("?wh=all")).status).toBe(401);
});

it("menolak akun yang dinonaktifkan", async () => {
  state.profile = { role: "OWNER", is_active: false };
  expect((await panggil("?wh=all")).status).toBe(403);
});

it("CSV matrix memuat semua gudang, total, dan saringan pencarian", async () => {
  const res = await panggil("?wh=all&q=Crystal+kitty&format=csv");
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  expect(res.headers.get("Content-Disposition")).toMatch(/stok-per-gudang-semua-.*\.csv/);
  expect(state.cariDiterima).toEqual(["Crystal kitty"]);
  const teks = await res.text();
  expect(teks).toContain('"Kode","Nama","Satuan","DC_LOH","WH_B2C","Total"');
  expect(teks).toContain("Crystal Kitty Creamy Crab");
  expect(teks).toContain("'=HACK");
});

it("Excel membekukan kolom Kode & Nama serta baris judul", async () => {
  const res = await panggil("?wh=all&format=xlsx");
  expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await res.arrayBuffer());
  const sheet = book.getWorksheet("Stok")!;
  expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 1 });
  expect(sheet.getRow(1).values).toEqual([undefined, "Kode", "Nama", "Satuan", "DC_LOH", "WH_B2C", "Total"]);
  expect(sheet.getRow(2).values).toEqual([undefined, "CK01", "Crystal Kitty Creamy Crab", "pcs", 12, 3, 15]);
  expect(sheet.rowCount).toBe(3);
});

it("mode satu gudang mengunduh stok gudang itu", async () => {
  const res = await panggil("?wh=wh-1&format=csv");
  expect(res.headers.get("Content-Disposition")).toContain("stok-gudang-dc-loh-");
  expect(await res.text()).toContain('"Kode","Nama","Satuan","Qty"');
});

it("gudang yang tidak dikenal ditolak", async () => {
  expect((await panggil("?wh=tidak-ada")).status).toBe(404);
});

it("data yang belum lengkap ditolak dengan pesan, bukan file terpotong", async () => {
  state.gagal = new ListLoadError("Stok semua gudang melebihi batas 10.000 baris dan belum dapat ditampilkan lengkap.");
  const res = await panggil("?wh=all");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/melebihi batas/);
});
