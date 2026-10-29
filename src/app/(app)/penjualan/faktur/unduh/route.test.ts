import { beforeEach, expect, it, vi } from "vitest";
import type { BarisFaktur } from "@/lib/faktur-gabungan";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  profile: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  rows: [] as BarisFaktur[],
  gagal: null as Error | null,
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

vi.mock("@/lib/faktur-gabungan-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/faktur-gabungan-server")>()),
  bacaSemuaFakturGabungan: async () => {
    if (state.gagal) throw state.gagal;
    return { rows: state.rows, ringkasan: { jumlah: state.rows.length, total: 4_600_000, jumlahBelum: 1, totalBelum: 4_500_000 } };
  },
}));

import { GET } from "./route";
import { ListLoadError } from "@/lib/checked-list";

const baris = (over: Partial<BarisFaktur> & Pick<BarisFaktur, "id" | "sumber">): BarisFaktur => ({
  nomor: "X", tanggal: "2026-10-20", total: 100_000, status: "lunas", branchId: "b1",
  customerId: null, namaBebas: null, cabang: "Pondok Aren", pelanggan: "Umum",
  keterangan: "Kasir petshop", visitId: null, rincianHpp: true, ...over,
});

const panggil = (query = "") => GET(new Request(`https://app.test/penjualan/faktur/unduh${query}`));

beforeEach(() => {
  state.user = { id: "user-1" };
  state.profile = { role: "OWNER", is_active: true };
  state.gagal = null;
  state.rows = [
    baris({ id: "g1", sumber: "grosir", nomor: "FJ.2026.10.00001", tanggal: "2026-10-02", status: "belum", total: 4_500_000, pelanggan: "Toko Hewan", keterangan: "Pesanan SO.1" }),
    baris({ id: "s1", sumber: "petshop", nomor: "CMGG2026102908220", tanggal: "2026-10-29" }),
  ];
});

it("menolak permintaan tanpa sesi", async () => {
  state.user = null;
  expect((await panggil()).status).toBe(401);
});

it("menolak peran yang tidak boleh membuka Faktur Penjualan", async () => {
  state.profile = { role: "STAFF", is_active: true };
  expect((await panggil()).status).toBe(403);
});

it("menolak akun yang dinonaktifkan", async () => {
  state.profile = { role: "OWNER", is_active: false };
  expect((await panggil()).status).toBe(403);
});

it("CSV memuat kolom yang sama dengan layar dan semua barisnya", async () => {
  const res = await panggil("?dari=2026-10-01&sampai=2026-10-31");
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  expect(res.headers.get("Content-Disposition")).toContain("faktur-penjualan-2026-10-01-2026-10-31.csv");
  const teks = await res.text();
  expect(teks).toContain('"Nomor","Tanggal","Cabang","Sumber","Pelanggan","Keterangan","Status","Umur (hari)","Total"');
  expect(teks).toContain("FJ.2026.10.00001");
  expect(teks).toContain("CMGG2026102908220");
  expect(teks).toContain("Belum Lunas");
  expect(teks).toContain("Grosir");
  expect(teks).toContain("Total penjualan (Rp)");
});

it("Excel dikirim sebagai berkas spreadsheet", async () => {
  const res = await panggil("?format=xlsx");
  expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
});

it("cakupan yang terlalu lebar ditolak dengan pesan, bukan daftar terpotong", async () => {
  state.gagal = new ListLoadError("Unduhan dibatasi 5.000 dokumen; persempit rentang tanggal atau filternya.");
  const res = await panggil();
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/persempit/i);
});
