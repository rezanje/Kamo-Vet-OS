// @vitest-environment jsdom
// E3 (meeting 12 Nov 2026): layar "Akses khusus akun ini" — hanya Owner, validasi, simpan lewat RPC.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "a0000000-0000-4000-8000-000000000001";
const s = vi.hoisted(() => ({
  actor: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  target: "STAFF",
  rpc: vi.fn(),
  refresh: vi.fn(),
  revalidate: vi.fn(),
}));
function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-fiktif" } }, error: null }) },
    rpc: s.rpc,
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
        maybeSingle: async () => ({ data: table === "profiles" ? s.actor : null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/master-guard", () => ({ assertMasterAdmin: async () => client() }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: s.revalidate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: s.refresh }), redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ simpanEditPengguna: vi.fn(), resetLoginPengguna: vi.fn() }));

import { simpanAksesKhususAkun } from "@/app/(app)/pengaturan/pengguna/akses-khusus-actions";
import Page from "@/app/(app)/pengaturan/pengguna/[id]/edit/page";

const KEY = "b0000000-0000-4000-8000-000000000002";
const fd = (entries: [string, string][]) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const online = (): [string, string][] => [["profile_id", ID], ["request_key", KEY], ["mode", "khusus"], ["mod_penjualan", "on"], ["subs_penjualan", "1"], ["sub_penjualan.online", "on"]];
const snapshot = () => ({ profile_id: ID, full_name: "Staf Online Fiktif", role: s.target, is_active: true, branch_ids: [], version: "v1", editable_roles: ["STAFF"], self: false });
const roleConfig = { role: "STAFF", revision: "a".repeat(32), source: "defaults", modules: ["klinik", "kasir", "quest-staff"], capabilities: { all_branches: false, create_accounts: false },
  actions: { source: "legacy", allowed: [] }, action_catalog: [], audit: [] };

beforeEach(() => {
  s.actor = { role: "OWNER", is_active: true }; s.target = "STAFF";
  s.rpc.mockReset(); s.refresh.mockReset(); s.revalidate.mockReset();
});

describe("server action simpanAksesKhususAkun", () => {
  it("Owner: memanggil RPC atomik dengan isi yang sudah dirapikan", async () => {
    s.rpc.mockResolvedValue({ data: { profile_id: ID, changed: true, already_applied: false }, error: null });
    const r = await simpanAksesKhususAkun(fd([...online(), ["reason", " staf Shopee "]]));
    expect(r.ok).toBe(true);
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith("save_account_access_override", {
      p_profile_id: ID, p_mode: "khusus", p_modules: { penjualan: ["penjualan.online"] }, p_reason: "staf Shopee", p_request_key: KEY,
    });
    expect(s.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it.each([["ADMIN", true], ["STAFF", true], ["OWNER", false]])("%s (aktif=%s) bukan Owner aktif: ditolak tanpa memanggil database", async (role, aktif) => {
    s.actor = role === "OWNER" ? { role, is_active: false } : { role, is_active: aktif as boolean };
    const r = await simpanAksesKhususAkun(fd(online()));
    expect(r).toEqual({ ok: false, message: "Hanya pemilik (Owner) aktif yang boleh mengatur akses khusus akun." });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("isian tidak valid: pesan jelas, database tidak dipanggil", async () => {
    const r = await simpanAksesKhususAkun(fd([["profile_id", ID], ["request_key", KEY], ["mode", "khusus"], ["mod_penjualan", "on"], ["subs_penjualan", "1"]]));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("semua sub-menunya kosong");
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("penolakan database diterjemahkan, isi galat tidak bocor", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "ACCOUNT_ACCESS_TARGET_OWNER: akun OWNER selalu penuh" } });
    const r = await simpanAksesKhususAkun(fd(online()));
    expect(r).toEqual({ ok: false, message: "Akun OWNER selalu punya akses penuh, jadi tidak bisa diberi akses khusus." });
  });
  it("jawaban tidak terkonfirmasi / lemparan = belum pasti (tidak mengaku tersimpan)", async () => {
    s.rpc.mockResolvedValue({ data: { profile_id: "lain" }, error: null });
    expect((await simpanAksesKhususAkun(fd(online()))).message).toContain("belum dapat dipastikan");
    s.rpc.mockRejectedValue(new Error("network"));
    expect((await simpanAksesKhususAkun(fd(online()))).message).toContain("belum dapat dipastikan");
  });
  it("Ikuti peran + permintaan ulang", async () => {
    s.rpc.mockResolvedValue({ data: { profile_id: ID, changed: true, already_applied: false }, error: null });
    expect((await simpanAksesKhususAkun(fd([["profile_id", ID], ["request_key", KEY], ["mode", "ikuti"]]))).message).toContain("kembali mengikuti akses perannya");
    expect(s.rpc.mock.calls[0][1]).toMatchObject({ p_mode: "ikuti", p_modules: null, p_reason: null });
    s.rpc.mockResolvedValue({ data: { profile_id: ID, changed: true, already_applied: true }, error: null });
    expect((await simpanAksesKhususAkun(fd(online()))).message).toContain("sudah tersimpan sebelumnya");
  });
});

describe("halaman Pengaturan › Pengguna › edit", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const override = { mode: "khusus", modules: { penjualan: ["penjualan.online"] }, updated_at: "2026-11-13T01:00:00Z", updated_by_name: "Owner Fiktif" };
  function rpcs(akun: unknown = { profile_id: ID, role: "STAFF", is_active: true, override, history: [{ id: "h1", created_at: "2026-11-13T01:00:00Z", created_by_name: "Owner Fiktif", reason: "staf online", before: null, after: { mode: "khusus", modules: { penjualan: ["penjualan.online"] } } }] }, akunError: unknown = null) {
    s.rpc.mockImplementation(async (name: string) => {
      if (name === "get_user_account_for_edit") return { data: snapshot(), error: null };
      if (name === "get_user_login_email") return { data: "staf@contoh.test", error: null };
      if (name === "get_account_access_override") return { data: akunError ? null : akun, error: akunError };
      if (name === "get_role_access_config") return { data: roleConfig, error: null };
      return { data: null, error: { message: "tak terduga" } };
    });
  }
  async function render() { const view = await Page({ params: Promise.resolve({ id: ID }) }); await act(async () => root.render(view)); }

  it("Owner melihat bagian akses khusus: pengaturan sekarang, akses efektif, editor terisi, riwayat", async () => {
    rpcs(); await render();
    const sec = host.querySelector("[data-akses-khusus-section]")!;
    expect(sec.textContent).toContain("AKSES KHUSUS AKUN INI");
    expect(sec.textContent).toContain("Hanya akses khusus: Penjualan: Penjualan Online");
    expect(sec.textContent).toContain("Akses peran STAFF: Klinik (semua); Kasir; Quest Staff");
    expect(sec.textContent).toContain("Akses efektif akun ini: Penjualan: Penjualan Online");
    expect(sec.textContent).toContain("staf online");
    const form = sec.querySelector<HTMLFormElement>("form[data-akses-khusus]")!;
    const data = new FormData(form);
    expect(data.get("mode")).toBe("khusus");
    expect(data.get("mod_penjualan")).toBe("on");
    expect(data.get("sub_penjualan.online")).toBe("on");
    expect(data.get("sub_penjualan.faktur")).toBeNull();
    expect(data.get("mod_klinik")).toBeNull();
  });
  it("Owner menyimpan dari layar: aksi dipanggil dengan pilihan di layar lalu halaman dimuat ulang", async () => {
    rpcs(); await render();
    s.rpc.mockResolvedValue({ data: { profile_id: ID, changed: true, already_applied: false }, error: null });
    const form = host.querySelector<HTMLFormElement>("form[data-akses-khusus]")!;
    await act(async () => { form.querySelector<HTMLInputElement>('input[name="mode"][value="tambah"]')!.click(); });
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = s.rpc.mock.calls.find(c => c[0] === "save_account_access_override")!;
    expect(call[1]).toMatchObject({ p_profile_id: ID, p_mode: "tambah", p_modules: { penjualan: ["penjualan.online"] } });
    expect(s.refresh).toHaveBeenCalled();
    expect(host.textContent).toContain("Tersimpan.");
  });
  it("non-Owner (ADMIN) tidak melihat bagian ini dan tidak membaca datanya", async () => {
    s.actor = { role: "ADMIN", is_active: true }; rpcs(); await render();
    expect(host.querySelector("[data-akses-khusus-section]")).toBeNull();
    expect(s.rpc.mock.calls.map(c => c[0])).not.toContain("get_account_access_override");
  });
  it("akun OWNER: hanya keterangan 'selalu penuh', tanpa editor", async () => {
    s.target = "OWNER"; rpcs(); await render();
    const sec = host.querySelector("[data-akses-khusus-section]")!;
    expect(sec.textContent).toContain("Akun OWNER selalu punya akses penuh");
    expect(sec.querySelector("form")).toBeNull();
  });
  it("fungsi database belum ada / gagal baca: tanpa editor, pesan jelas", async () => {
    rpcs(undefined, { code: "PGRST202", message: "Could not find the function" }); await render();
    expect(host.querySelector("[data-akses-khusus-section]")!.textContent).toContain("belum aktif di database");
    expect(host.querySelector("form[data-akses-khusus]")).toBeNull();
    rpcs(undefined, { code: "57014", message: "PRIVATE timeout" }); await render();
    expect(host.querySelector("[data-akses-khusus-section]")!.textContent).toContain("belum dapat dimuat");
    expect(host.textContent).not.toContain("PRIVATE");
  });
});
