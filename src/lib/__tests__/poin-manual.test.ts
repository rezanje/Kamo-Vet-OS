// D1 (meeting 12 Nov 2026): sesuaikan poin pelanggan manual.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bacaIsianPoin, kunciSah, pesanPoinManualDb, poinManualAllowed, POIN_MANUAL_ACTION } from "../poin-manual";
import { GRANT_ONLY_ACTIONS, legacyRoleHasAction } from "../role-grant-only-actions";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sesuaikanPoin } from "../../app/(app)/crm/pelanggan/actions";

const ID = "c1000000-0000-4000-8000-000000000001";
const KEY = "d1000000-0000-4000-8000-000000000001";
const form = (isi: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(isi)) f.set(k, v); return f; };
const isiSah = { id: ID, phone: "0812", request_key: KEY, arah: "tambah", jumlah: "1.500", alasan: "Saldo poin sistem lama" };

describe("bacaIsianPoin", () => {
  it("tambah/kurang -> delta bertanda; titik/koma ribuan diabaikan; spasi alasan dirapikan", () => {
    expect(bacaIsianPoin({ arah: "tambah", jumlah: "1.500", alasan: "  sistem   lama " })).toEqual({ ok: true, isian: { arah: "tambah", jumlah: 1500, alasan: "sistem lama" }, delta: 1500 });
    expect(bacaIsianPoin({ arah: "kurang", jumlah: "20", alasan: "salah input" })).toMatchObject({ ok: true, delta: -20 });
  });
  it.each([
    [{ arah: "x", jumlah: "1", alasan: "abc" }, "tambah atau kurangi"],
    [{ arah: "tambah", jumlah: "0", alasan: "abc" }, "lebih dari 0"],
    [{ arah: "tambah", jumlah: "-5", alasan: "abc" }, "lebih dari 0"],
    [{ arah: "tambah", jumlah: "1.5e3", alasan: "abc" }, "lebih dari 0"],
    [{ arah: "tambah", jumlah: "10000001", alasan: "abc" }, "maksimal"],
    [{ arah: "tambah", jumlah: "5", alasan: "ab" }, "Alasan wajib"],
    [{ arah: "tambah", jumlah: "5", alasan: "x".repeat(301) }, "Alasan wajib"],
  ])("ditolak %#", (raw, pesan) => {
    const r = bacaIsianPoin(raw);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.pesan).toContain(pesan);
  });
});

describe("hak & pesan", () => {
  it("izin khusus: bawaan mati untuk semua peran selain Owner", () => {
    expect(POIN_MANUAL_ACTION).toBe("crm.poin_manual");
    expect(GRANT_ONLY_ACTIONS).toContain(POIN_MANUAL_ACTION);
    for (const role of ["ADMIN", "FINANCE", "STAFF", "DOCTOR"]) expect(legacyRoleHasAction(POIN_MANUAL_ACTION, role)).toBe(false);
  });
  it("poinManualAllowed fail-closed: galat, bukan true, atau melempar = false", async () => {
    expect(await poinManualAllowed({ rpc: async () => ({ data: true, error: null }) })).toBe(true);
    expect(await poinManualAllowed({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) })).toBe(false);
    expect(await poinManualAllowed({ rpc: async () => ({ data: "true", error: null }) })).toBe(false);
    expect(await poinManualAllowed({ rpc: () => { throw new Error("x"); } })).toBe(false);
  });
  it("pesan database tanpa kode teknis; fungsi belum ada = belum aktif", () => {
    expect(pesanPoinManualDb({ message: "POIN_MANUAL_MINUS: saldo poin tidak boleh minus (saldo sekarang 10)." })).toBe("saldo poin tidak boleh minus (saldo sekarang 10).");
    expect(pesanPoinManualDb({ code: "PGRST202", message: "Could not find the function public.adjust_customer_points" })).toContain("belum aktif");
    expect(pesanPoinManualDb({ message: "boom" })).toBe("Poin belum dapat disesuaikan. Coba lagi.");
    expect(kunciSah(KEY)).toBe(true);
    expect(kunciSah("bukan-uuid")).toBe(false);
  });
});

describe("aksi sesuaikanPoin", () => {
  beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data: { saldo: 2500 }, error: null }); });

  it("memanggil RPC atomik dengan delta bertanda, alasan, kunci; sukses menampilkan saldo baru", async () => {
    await expect(sesuaikanPoin(form(isiSah))).rejects.toThrow(/success=.*Saldo%20sekarang%202\.500%20poin.*&cari=0812/);
    expect(mocks.rpc).toHaveBeenCalledWith("adjust_customer_points", { p_customer_id: ID, p_delta: 1500, p_reason: "Saldo poin sistem lama", p_request_key: KEY });
  });
  it("kurangi -> delta negatif", async () => {
    await expect(sesuaikanPoin(form({ ...isiSah, arah: "kurang", jumlah: "200" }))).rejects.toThrow("success=");
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_delta: -200 });
  });
  it.each([
    [{ id: "x" }, "Pelanggan tidak valid"],
    [{ request_key: "" }, "Muat ulang"],
    [{ jumlah: "0" }, "lebih dari 0"],
    [{ alasan: "" }, "Alasan wajib"],
  ])("isian salah ditolak tanpa memanggil database %#", async (ubah, pesan) => {
    await expect(sesuaikanPoin(form({ ...isiSah, ...ubah }))).rejects.toThrow(encodeURIComponent(pesan).slice(0, 20));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("penolakan database diteruskan dengan bahasa biasa", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "POIN_MANUAL_DITOLAK: hanya Owner atau peran yang diberi izin \"Sesuaikan poin pelanggan\"." } });
    await expect(sesuaikanPoin(form(isiSah))).rejects.toThrow(encodeURIComponent("hanya Owner atau peran"));
  });
});

describe("sinkron migrasi", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261118600000_d1_poin_manual.sql"), "utf8");
  it("katalog izin enforced di modul CRM, satu transaksi tanpa begin/commit sendiri", () => {
    expect(sql).toMatch(/action_catalog\(id,label,"group",enforced\) values\s*\('crm\.poin_manual',[\s\S]*?'CRM',true\)/);
    expect(sql).toMatch(/action_modules\(id,module_id\) values\('crm\.poin_manual','crm'\)/);
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql.split("\n").slice(0, 3).join("\n").toLowerCase()).toContain("apply as one transaction");
  });
  it("nama & parameter RPC sama dengan yang dipanggil aplikasi", () => {
    expect(sql).toContain("create function public.adjust_customer_points(p_customer_id uuid,p_delta integer,p_reason text,p_request_key uuid)");
    expect(sql).toContain("create function public.customer_points_adjust_allowed()");
  });
});
