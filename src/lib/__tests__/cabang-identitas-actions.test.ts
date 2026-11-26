import { beforeEach, describe, expect, it, vi } from "vitest";

// simpanIdentitasCabang: hanya OWNER/ADMIN; validasi sisi server; jalur logo milik cabang itu; ukuran/tipe diperiksa ulang;
// fungsi database dipanggil dengan nilai yang sudah dirapikan; unggahan yatim dan logo lama dibersihkan.
const ID = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
const LAIN = "73218196-99b8-4e2a-81dc-ecc6851cdbf6";
type Rpc = [string, Record<string, unknown>];
const state = vi.hoisted(() => ({
  role: "ADMIN" as string, active: true,
  rpc: [] as Rpc[], rpcResult: { data: { changed: true, logo_lama: null }, error: null } as { data: unknown; error: unknown },
  list: { data: [] as unknown[], error: null as unknown }, listArgs: [] as unknown[],
  removed: [] as string[][], revalidated: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT " + to); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push([name, args]); return state.rpcResult; },
  storage: { from: () => ({
    list: async (...a: unknown[]) => { state.listArgs.push(a); return state.list; },
    remove: async (paths: string[]) => { state.removed.push(paths); return { data: [], error: null }; },
  }) },
  from: (table: string) => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: state.active } : null, error: null }) }; return q; },
}) }));

import { simpanIdentitasCabang } from "@/app/(app)/pengaturan/cabang/actions";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const baru = `cabang-logo/${ID}/1700000000000-ab12cd34.png`;
const berkas = (size: number, mimetype = "image/png") => ({ data: [{ name: "1700000000000-ab12cd34.png", metadata: { size, mimetype } }], error: null });

beforeEach(() => {
  state.role = "ADMIN"; state.active = true; state.rpc = []; state.rpcResult = { data: { changed: true, logo_lama: null }, error: null };
  state.list = berkas(1000); state.listArgs = []; state.removed = []; state.revalidated = [];
});

describe("simpanIdentitasCabang", () => {
  it("STAFF, FINANCE, DOCTOR, nonaktif ditolak tanpa menyentuh database atau storage", async () => {
    for (const role of ["STAFF", "FINANCE", "DOCTOR", "ADMIN_ONLINE", ""]) {
      state.role = role; state.rpc = [];
      const r = await simpanIdentitasCabang(null, form({ id: ID, alamat: "Jl. Raya 1", telepon: "0251 8888" }));
      expect(r?.ok, role).toBe(false); expect(r?.message).toMatch(/tidak punya hak/);
      expect(state.rpc).toEqual([]);
    }
    state.role = "OWNER"; state.active = false;
    expect((await simpanIdentitasCabang(null, form({ id: ID }))) ?.ok).toBe(false);
  });
  it("OWNER dan ADMIN: alamat/telepon dirapikan lalu dikirim; logo tidak diubah (logo_aksi=tetap)", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      state.role = role; state.rpc = [];
      const r = await simpanIdentitasCabang(null, form({ id: ID, alamat: "  Jl.  Raya \n Cimanggu 12 ", telepon: " 0251  8888 ", logo_aksi: "tetap" }));
      expect(r).toEqual({ ok: true, message: "Identitas cabang tersimpan." });
      expect(state.rpc).toEqual([["update_branch_identity", { p_id: ID, p_alamat: "Jl. Raya Cimanggu 12", p_telepon: "0251 8888", p_logo_path: "", p_ubah_logo: false }]]);
    }
    expect(state.revalidated).toContain("/pengaturan/cabang");
  });
  it("kosong = dikosongkan (string kosong ke fungsi)", async () => {
    await simpanIdentitasCabang(null, form({ id: ID, alamat: "  ", telepon: "" }));
    expect(state.rpc[0][1]).toMatchObject({ p_alamat: "", p_telepon: "" });
  });
  it("validasi sisi server: alamat/telepon salah ditolak sebelum database", async () => {
    for (const [alamat, telepon, pesan] of [["ab", "", /Alamat cabang/], ["", "telp 1", /Telepon cabang/], ["x".repeat(201), "", /Alamat cabang/], ["", "1".repeat(31), /Telepon cabang/]] as const) {
      const r = await simpanIdentitasCabang(null, form({ id: ID, alamat, telepon }));
      expect(r?.ok).toBe(false); expect(r?.message).toMatch(pesan);
    }
    expect(state.rpc).toEqual([]);
  });
  it("id kosong dan aksi logo tidak dikenal ditolak", async () => {
    expect((await simpanIdentitasCabang(null, form({ id: "" })))?.message).toMatch(/Cabang tidak valid/);
    expect((await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "timpa" })))?.message).toMatch(/Aksi logo/);
    expect(state.rpc).toEqual([]);
  });
  it("ganti logo: jalur milik cabang ini, berkas ada, ≤ 1 MB, tipe gambar -> fungsi database dipanggil dengan p_ubah_logo", async () => {
    const r = await simpanIdentitasCabang(null, form({ id: ID, alamat: "Jl. Raya 1", telepon: "", logo_aksi: "ganti", logo_path: baru }));
    expect(r?.ok).toBe(true);
    expect(state.listArgs[0]).toEqual([`cabang-logo/${ID}`, { search: "1700000000000-ab12cd34.png", limit: 20 }]);
    expect(state.rpc[0][1]).toMatchObject({ p_logo_path: baru, p_ubah_logo: true });
  });
  it("ganti logo dengan jalur cabang lain, jalur modul lain, ekstensi gif, atau naik folder ditolak sebelum storage/database", async () => {
    for (const path of [`cabang-logo/${LAIN}/a.png`, "pengeluaran/1700000000001-nota.png", `cabang-logo/${ID}/a.gif`, `cabang-logo/${ID}/../a.png`, ""]) {
      const r = await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: path }));
      expect(r?.ok, path).toBe(false); expect(r?.message).toMatch(/Logo belum terunggah/);
    }
    expect(state.rpc).toEqual([]); expect(state.listArgs).toEqual([]); expect(state.removed).toEqual([]);
  });
  it("berkas tidak ditemukan di storage atau daftar galat: ditolak", async () => {
    state.list = { data: [], error: null };
    expect((await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru })))?.ok).toBe(false);
    state.list = { data: [{ name: "lain.png", metadata: { size: 1, mimetype: "image/png" } }], error: null };
    expect((await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru })))?.ok).toBe(false);
    state.list = { data: berkas(10).data, error: { message: "x" } };
    expect((await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru })))?.ok).toBe(false);
    expect(state.rpc).toEqual([]);
  });
  it("berkas > 1 MB atau bukan gambar PNG/JPG/WEBP: ditolak dan unggahannya dihapus", async () => {
    state.list = berkas(1024 * 1024 + 1);
    let r = await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru }));
    expect(r).toEqual({ ok: false, message: "Logo maksimal 1 MB." }); expect(state.removed).toEqual([[baru]]);
    state.removed = []; state.list = berkas(1000, "image/gif");
    r = await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru }));
    expect(r?.message).toMatch(/PNG, JPG, atau WEBP/); expect(state.removed).toEqual([[baru]]);
    expect(state.rpc).toEqual([]);
  });
  it("tepat 1 MB diterima", async () => {
    state.list = berkas(1024 * 1024);
    expect((await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru })))?.ok).toBe(true);
  });
  it("hapus logo: p_logo_path kosong + p_ubah_logo; logo lama dibersihkan dari storage setelah database sukses", async () => {
    const lama = `cabang-logo/${ID}/1699999999999-old12345.png`;
    state.rpcResult = { data: { changed: true, logo_lama: lama }, error: null };
    const r = await simpanIdentitasCabang(null, form({ id: ID, alamat: "Jl. Raya 1", logo_aksi: "hapus" }));
    expect(r?.ok).toBe(true);
    expect(state.rpc[0][1]).toMatchObject({ p_logo_path: "", p_ubah_logo: true });
    expect(state.removed).toEqual([[lama]]);
  });
  it("logo lama dengan jalur tidak sah (tidak mungkin dari database) tidak pernah dihapus", async () => {
    state.rpcResult = { data: { changed: true, logo_lama: "pengeluaran/1700000000001-nota.png" }, error: null };
    await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "hapus" }));
    expect(state.removed).toEqual([]);
  });
  it("database menolak: pesan Indonesia yang aman; galat tak dikenal diganti pesan umum; unggahan baru dibersihkan; logo lama tidak dihapus", async () => {
    state.rpcResult = { data: null, error: { code: "42501", message: "Hanya OWNER/ADMIN aktif yang dapat mengubah identitas cabang" } };
    let r = await simpanIdentitasCabang(null, form({ id: ID, logo_aksi: "ganti", logo_path: baru }));
    expect(r?.message).toMatch(/Hanya Owner atau Admin/); expect(state.removed).toEqual([[baru]]);
    state.removed = []; state.rpcResult = { data: null, error: { code: "22023", message: "Telepon cabang 3 sampai 30 karakter" } };
    r = await simpanIdentitasCabang(null, form({ id: ID, telepon: "123" }));
    expect(r?.message).toBe("Telepon cabang 3 sampai 30 karakter"); expect(state.removed).toEqual([]);
    state.rpcResult = { data: null, error: { code: "XX000", message: "internal: relation branches secret detail" } };
    r = await simpanIdentitasCabang(null, form({ id: ID }));
    expect(r?.message).toMatch(/belum dapat disimpan/); expect(JSON.stringify(r)).not.toMatch(/secret detail/);
    state.rpcResult = { data: null, error: { code: "CG002", message: "Cabang tidak ditemukan" } };
    expect((await simpanIdentitasCabang(null, form({ id: ID })))?.message).toMatch(/Cabang tidak ditemukan/);
  });
  it("tidak ada perubahan: pesan jujur", async () => {
    state.rpcResult = { data: { changed: false }, error: null };
    expect((await simpanIdentitasCabang(null, form({ id: ID })))?.message).toBe("Tidak ada perubahan.");
  });
});
