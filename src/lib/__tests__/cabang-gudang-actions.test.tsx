import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rpc = [string, Record<string, unknown>];
const state = vi.hoisted(() => ({
  role: "ADMIN" as string, active: true, rpc: [] as Rpc[], rpcError: null as null | { message: string; code?: string },
  usage: {} as Record<string, string[]> | null, revalidated: [] as string[],
  tables: {} as Record<string, unknown[]>,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { state.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT " + to); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpc.push([name, args]);
    if (name === "read_branch_usage" || name === "read_warehouse_usage") return { data: state.usage, error: state.usage === null ? { message: "x" } : null };
    return { data: {}, error: state.rpcError };
  },
  from: (table: string) => {
    const query = {
      select: () => query, order: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: state.active } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { aturStatusCabang, ubahCabang } from "@/app/(app)/perusahaan/cabang/actions";
import { aturStatusGudang, hapusGudang, ubahGudang } from "@/app/(app)/perusahaan/gudang/actions";
import CabangPage from "@/app/(app)/perusahaan/cabang/page";
import GudangPage from "@/app/(app)/perusahaan/gudang/page";

const form = (entries: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(entries)) data.set(k, v); return data; };
const ke = (url: string) => expect.objectContaining({ message: expect.stringContaining("REDIRECT " + url) });
const dec = (text: string) => decodeURIComponent(text);

beforeEach(() => {
  state.role = "ADMIN"; state.active = true; state.rpc = []; state.rpcError = null; state.usage = {}; state.revalidated = []; state.tables = {};
});

describe("ubah cabang (OWNER/ADMIN)", () => {
  const id = "00000000-0000-4000-8000-0000000000a1";
  it("STAFF, FINANCE, DOCTOR ditolak tanpa menyentuh database", async () => {
    for (const role of ["STAFF", "FINANCE", "DOCTOR"]) {
      state.role = role; state.rpc = [];
      await expect(ubahCabang(form({ id, name: "Kamo Pets Clinic Lengkong" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
      await expect(aturStatusCabang(form({ id, is_active: "0" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
      expect(state.rpc).toEqual([]);
    }
  });

  it("ADMIN mengganti nama: spasi dirapikan, kode tidak dikirim bila kosong, halaman terkait disegarkan", async () => {
    await expect(ubahCabang(form({ id, name: "  Kamo   Pets Clinic  Lengkong " }))).rejects.toThrow("REDIRECT /perusahaan/cabang?success=");
    expect(state.rpc).toEqual([["update_branch_info", { p_id: id, p_name: "Kamo Pets Clinic Lengkong", p_code: null, p_is_active: null }]]);
    expect(state.revalidated).toEqual(expect.arrayContaining(["/perusahaan/cabang", "/perusahaan/gudang", "/pengaturan/cabang"]));
  });

  it("OWNER boleh; kode dikirim bila ada isinya (database yang memutuskan boleh/tidaknya)", async () => {
    state.role = "OWNER";
    await expect(ubahCabang(form({ id, name: "Kamo Pets Clinic Lengkong", code: " VET_LGKG " }))).rejects.toThrow("REDIRECT /perusahaan/cabang?success=");
    expect(state.rpc[0]).toEqual(["update_branch_info", { p_id: id, p_name: "Kamo Pets Clinic Lengkong", p_code: "VET_LGKG", p_is_active: null }]);
  });

  it("nama kosong, satu huruf, 81 karakter, atau cabang tak dikenal ditolak sebelum database", async () => {
    for (const name of ["", "   ", "x", "x".repeat(81)]) {
      state.rpc = [];
      await expect(ubahCabang(form({ id, name }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
      expect(state.rpc).toEqual([]);
    }
    await expect(ubahCabang(form({ id: "", name: "Nama Sah" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
    expect(state.rpc).toEqual([]);
  });

  it("nama kembar (23505) dan kode terkunci (CG001) menampilkan pesan database; galat lain hanya pesan umum", async () => {
    state.rpcError = { code: "23505", message: "Nama cabang sudah dipakai cabang lain" };
    await expect(ubahCabang(form({ id, name: "Kamo Pets Clinic Ciawi" }))).rejects.toThrow(ke("/perusahaan/cabang?error=" + encodeURIComponent("Nama cabang sudah dipakai cabang lain")));
    state.rpcError = { code: "CG001", message: "Kode cabang terkunci: cabang ini sudah punya transaksi atau riwayat. Ubah namanya saja" };
    await expect(ubahCabang(form({ id, name: "Nama Sah", code: "BARU" }))).rejects.toThrow(/Kode%20cabang%20terkunci/);
    state.rpcError = { code: "XX000", message: "relation \"branches\" is locked by internal detail" };
    try { await ubahCabang(form({ id, name: "Nama Sah" })); } catch (e) { expect(dec((e as Error).message)).toContain("Perubahan belum dapat disimpan"); expect(dec((e as Error).message)).not.toContain("internal detail"); }
  });

  it("nonaktifkan/aktifkan memakai fungsi yang sama tanpa mengirim nama atau kode", async () => {
    await expect(aturStatusCabang(form({ id, is_active: "0" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?success=");
    await expect(aturStatusCabang(form({ id, is_active: "1" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?success=");
    expect(state.rpc).toEqual([
      ["update_branch_info", { p_id: id, p_name: null, p_code: null, p_is_active: false }],
      ["update_branch_info", { p_id: id, p_name: null, p_code: null, p_is_active: true }],
    ]);
    state.rpc = [];
    await expect(aturStatusCabang(form({ id, is_active: "x" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
    expect(state.rpc).toEqual([]);
  });

  it("shift/antrean terbuka (CG001) menolak nonaktif dengan pesan database", async () => {
    state.rpcError = { code: "CG001", message: "Cabang masih punya 1 shift kasir yang terbuka. Tutup shift dulu" };
    await expect(aturStatusCabang(form({ id, is_active: "0" }))).rejects.toThrow(/shift%20kasir%20yang%20terbuka/);
  });
});

describe("ubah, nonaktifkan, hapus gudang", () => {
  const id = "00000000-0000-4000-8000-0000000000b1";
  it("STAFF ditolak pada ubah, status, dan hapus", async () => {
    state.role = "STAFF";
    for (const fn of [() => ubahGudang(form({ id, name: "Nama Sah" })), () => aturStatusGudang(form({ id, is_active: "0" })), () => hapusGudang(form({ id, reason: "Salah buat gudang" }))]) {
      await expect(fn()).rejects.toThrow("REDIRECT /perusahaan/gudang?error=");
    }
    expect(state.rpc).toEqual([]);
  });

  it("ADMIN mengubah nama, kode, dan jenis lewat fungsi database", async () => {
    await expect(ubahGudang(form({ id, name: " VET  Lengkong 2 ", code: "VET_LGKG", type: "VET" }))).rejects.toThrow("REDIRECT /perusahaan/gudang?success=");
    expect(state.rpc).toEqual([["update_warehouse_info", { p_id: id, p_name: "VET Lengkong 2", p_code: "VET_LGKG", p_type: "VET", p_is_active: null }]]);
  });

  it("jenis asing dan nama tidak sah ditolak sebelum database", async () => {
    await expect(ubahGudang(form({ id, name: "Nama Sah", type: "MOBIL" }))).rejects.toThrow("REDIRECT /perusahaan/gudang?error=");
    await expect(ubahGudang(form({ id, name: "x" }))).rejects.toThrow("REDIRECT /perusahaan/gudang?error=");
    expect(state.rpc).toEqual([]);
  });

  it("kode gudang terkunci karena sudah dipakai: pesan database ditampilkan", async () => {
    state.rpcError = { code: "CG001", message: "Kode gudang terkunci: gudang ini sudah dipakai stok atau dokumen. Ubah namanya saja" };
    await expect(ubahGudang(form({ id, name: "Nama Sah", code: "BARU" }))).rejects.toThrow(/Kode%20gudang%20terkunci/);
  });

  it("nonaktifkan: stok/dokumen terbuka ditolak database; sukses mengirim hanya is_active", async () => {
    await expect(aturStatusGudang(form({ id, is_active: "0" }))).rejects.toThrow("REDIRECT /perusahaan/gudang?success=");
    expect(state.rpc).toEqual([["update_warehouse_info", { p_id: id, p_name: null, p_code: null, p_type: null, p_is_active: false }]]);
    state.rpcError = { code: "CG001", message: "Gudang masih punya stok (3 barang). Pindahkan atau nolkan stoknya dulu" };
    await expect(aturStatusGudang(form({ id, is_active: "0" }))).rejects.toThrow(/masih%20punya%20stok/);
  });

  it("ADMIN TIDAK boleh menghapus gudang (database tidak dipanggil)", async () => {
    state.role = "ADMIN";
    await expect(hapusGudang(form({ id, reason: "Salah buat gudang" }))).rejects.toThrow(/Hanya%20OWNER%20yang%20bisa%20menghapus/);
    expect(state.rpc).toEqual([]);
  });

  it("OWNER menghapus dengan alasan: dikirim rapi ke delete_warehouse", async () => {
    state.role = "OWNER";
    await expect(hapusGudang(form({ id, reason: "  Salah buat gudang  " }))).rejects.toThrow("REDIRECT /perusahaan/gudang?success=");
    expect(state.rpc).toEqual([["delete_warehouse", { p_id: id, p_reason: "Salah buat gudang" }]]);
  });

  it("OWNER tanpa alasan atau alasan terlalu pendek ditolak sebelum database", async () => {
    state.role = "OWNER";
    for (const reason of ["", "   ", "abcd"]) {
      await expect(hapusGudang(form({ id, reason }))).rejects.toThrow("REDIRECT /perusahaan/gudang?error=");
    }
    expect(state.rpc).toEqual([]);
  });

  it("hapus ditolak database karena gudang sudah dipakai: pesan 'Sudah dipakai, nonaktifkan saja'", async () => {
    state.role = "OWNER";
    state.rpcError = { code: "CG001", message: "Sudah dipakai, nonaktifkan saja" };
    await expect(hapusGudang(form({ id, reason: "Salah buat gudang" }))).rejects.toThrow(ke("/perusahaan/gudang?error=" + encodeURIComponent("Sudah dipakai, nonaktifkan saja")));
  });
});

describe("halaman Cabang dan Gudang", () => {
  const cabang = [
    { id: "b-baru", code: "LENGKONG", name: "Hpy Pet Clinic Lengkong", type: "KLINIK", is_active: true },
    { id: "b-lama", code: "VET_CIAW", name: "Kamo Pets Clinic Ciawi", type: "KLINIK", is_active: true },
  ];
  const gudang = [
    { id: "w-baru", branch_id: "b-baru", code: "VET_LENGKONG", name: "VET LENGKONG", type: "VET", is_active: true },
    { id: "w-pakai", branch_id: "b-lama", code: "WH_VET_CIAW", name: "WH VET CIAW", type: "VET", is_active: true },
  ];
  const halamanCabang = async () => renderToStaticMarkup(await CabangPage({ searchParams: Promise.resolve({}) }));
  const halamanGudang = async () => renderToStaticMarkup(await GudangPage({ searchParams: Promise.resolve({}) }));

  it("tiap kartu cabang punya Ubah dan Nonaktifkan; cabang nonaktif punya Aktifkan", async () => {
    state.tables = { branches: [...cabang, { id: "b-mati", code: "VET_RE", name: "VET RE", type: "KLINIK", is_active: false }] };
    const html = await halamanCabang();
    expect((html.match(/> ?Ubah</g) ?? []).length).toBe(3);
    expect((html.match(/>Nonaktifkan</g) ?? []).length).toBe(2);
    expect((html.match(/>Aktifkan</g) ?? []).length).toBe(1);
  });

  it("pemakaian tidak terbaca tidak merusak halaman (kode dianggap terkunci)", async () => {
    state.tables = { branches: cabang }; state.usage = null;
    expect(await halamanCabang()).toContain("Hpy Pet Clinic Lengkong");
  });

  it("OWNER/ADMIN saja yang melihat halaman; STAFF dialihkan", async () => {
    state.role = "STAFF";
    await expect(halamanCabang()).rejects.toThrow("REDIRECT /perusahaan");
    await expect(halamanGudang()).rejects.toThrow("REDIRECT /perusahaan");
  });

  it("gudang: OWNER melihat Hapus aktif untuk gudang belum dipakai dan Hapus nonaktif 'Sudah dipakai' untuk yang dipakai", async () => {
    state.role = "OWNER"; state.tables = { branches: cabang, warehouses: gudang }; state.usage = { "w-pakai": ["public.stock"] };
    const html = await halamanGudang();
    expect((html.match(/>Hapus</g) ?? []).length).toBe(2);
    expect(html).toContain("Sudah dipakai, nonaktifkan saja");
    expect((html.match(/disabled=""[^>]*>Hapus</g) ?? []).length + (html.match(/>Hapus<\/button>/g) ?? []).length).toBeGreaterThan(0);
    expect((html.match(/<button[^>]*disabled=""[^>]*>Hapus</g) ?? []).length).toBe(1);
  });

  it("gudang: ADMIN melihat Hapus dinonaktifkan dengan alasan 'Hanya OWNER'", async () => {
    state.role = "ADMIN"; state.tables = { branches: cabang, warehouses: gudang }; state.usage = {};
    const html = await halamanGudang();
    expect((html.match(/<button[^>]*disabled=""[^>]*>Hapus</g) ?? []).length).toBe(2);
    expect(html).toContain("Hanya OWNER yang bisa menghapus gudang");
  });

  it("gudang: kolom Aksi ada dan form Tambah gudang hanya menawarkan cabang aktif", async () => {
    state.role = "OWNER"; state.tables = { branches: [...cabang, { id: "b-mati", code: "VET_RE", name: "VET RE", type: "KLINIK", is_active: false }], warehouses: gudang };
    const html = await halamanGudang();
    expect(html).toContain("<th>Aksi</th>");
    expect(html).toContain("Hpy Pet Clinic Lengkong · LENGKONG");
    expect(html).not.toContain("VET RE · VET_RE");
  });
});
