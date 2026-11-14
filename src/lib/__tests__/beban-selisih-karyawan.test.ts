// F2 (meeting 12 Nov 2026): ringkasan selisih kurang opname + beban ke karyawan (kasbon, tidak potong gaji).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asalKasbon, bacaIsianBeban, bacaRingkasanBeban, bacaRupiah, bagiRata, IZIN_BEBAN_SELISIH, pesanBebanKaryawan, STATUS_KASBON_DICATAT,
} from "../beban-selisih-karyawan";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction, legacyRoleHasAction } from "../role-grant-only-actions";
import { alertDetailHref, evaluateAlerts, defaultAlertSettings } from "../operational-alerts";
import { collectOperationalAlertBlock } from "../operational-alerts-server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { batalBebanKaryawan, catatBebanKaryawan } from "../../app/(app)/pos/opname/[id]/beban-karyawan-actions";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261118660000_f2_beban_selisih_karyawan.sql"), "utf8");
const ORDER = "a1000000-0000-4000-8000-000000000001";
const RESULT = "a2000000-0000-4000-8000-000000000001";
const EMP_A = "e1000000-0000-4000-8000-000000000001";
const EMP_B = "e2000000-0000-4000-8000-000000000002";
const KEY = "c1000000-0000-4000-8000-000000000001";
const form = (isi: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(isi)) f.set(k, v); return f; };

describe("izin khusus & migrasi", () => {
  it("izin persediaan.beban_selisih_karyawan: izin khusus (bawaan MATI untuk semua selain Owner), sinkron dengan baris katalog migrasi", () => {
    expect(IZIN_BEBAN_SELISIH).toBe("persediaan.beban_selisih_karyawan");
    expect(GRANT_ONLY_ACTIONS).toContain(IZIN_BEBAN_SELISIH);
    expect(isGrantOnlyAction(IZIN_BEBAN_SELISIH)).toBe(true);
    for (const role of ["ADMIN", "FINANCE", "STAFF", "DOCTOR"]) expect(legacyRoleHasAction(IZIN_BEBAN_SELISIH, role)).toBe(false);
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\)\s*select 'persediaan\.beban_selisih_karyawan', '[^']*', 'Persediaan', true/);
    expect(sql).toMatch(/action_modules\(id, module_id\)\s*select 'persediaan\.beban_selisih_karyawan', 'pos'/);
    // Pemeriksa: Owner dulu tanpa membaca kebijakan; peran lain wajib baris eksplisit + role_action_allowed.
    expect(sql).toMatch(/if v_role = 'OWNER' then return 'OWNER'; end if;[\s\S]*'persediaan\.beban_selisih_karyawan' = any \(a\.allowed\)\)\s*and public\.role_action_allowed\('persediaan\.beban_selisih_karyawan'\)/);
  });
  it("satu transaksi tanpa begin/commit sendiri; penanda di 3 baris pertama; jurnal & kasbon sesuai keputusan", () => {
    expect(sql.split("\n").slice(0, 3).join("\n")).toContain("Apply as ONE transaction");
    expect(sql.split("\n").filter((l) => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    expect(sql).toContain("jsonb_build_object('code', '182001', 'debit', v_total, 'credit', 0)");
    expect(sql).toContain("insert into public.cash_advances(id, employee_id, tanggal, jumlah, tenor_bulan, status");
    expect(sql).toContain("'Dicatat'");
    expect(sql).toContain("'variance-loss-expense-gain-income'");
  });
  it("penggajian hanya membaca kasbon berstatus Disetujui, jadi kasbon 'Dicatat' tidak dipotong gaji otomatis", () => {
    const payroll = readFileSync(join(process.cwd(), "src/lib/payroll-data.ts"), "utf8");
    expect(payroll).toMatch(/from\("cash_advances"\)[\s\S]{0,200}\.eq\("status", "Disetujui"\)/);
    expect(STATUS_KASBON_DICATAT).not.toBe("Disetujui");
  });
});

describe("pembacaan isian & pesan", () => {
  it("bacaRupiah: format Indonesia / polos, maks 2 desimal", () => {
    expect(bacaRupiah("150.000")).toBe(150000);
    expect(bacaRupiah("1.379.040,92")).toBe(1379040.92);
    expect(bacaRupiah("250")).toBe(250);
    expect(bacaRupiah("12,5")).toBe(12.5);
    expect(bacaRupiah("12.50")).toBe(12.5);
    for (const bad of ["", "abc", "1,234", "1.2.3", "12,345", "-5", "1e3"]) expect(bacaRupiah(bad)).toBeNull();
  });
  it("bagiRata: total persis, sisa pembulatan di orang terakhir", () => {
    expect(bagiRata(250, 2)).toEqual([125, 125]);
    expect(bagiRata(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(bagiRata(0, 2)).toEqual([]);
  });
  it("bacaIsianBeban: total harus pas, karyawan unik, alasan wajib", () => {
    const ok = bacaIsianBeban({ baris: JSON.stringify([{ employee_id: EMP_A, amount: 150 }, { employee_id: EMP_B, amount: "100" }]), alasan: "  Barang   hilang " }, 250);
    expect(ok).toEqual({ ok: true, isian: { baris: [{ employee_id: EMP_A, amount: 150 }, { employee_id: EMP_B, amount: 100 }], alasan: "Barang hilang" } });
    const salah = (b: unknown, alasan = "Barang hilang", total = 250) => { const r = bacaIsianBeban({ baris: JSON.stringify(b), alasan }, total); return r.ok ? "" : r.pesan; };
    expect(salah([{ employee_id: EMP_A, amount: 200 }])).toContain("harus sama");
    expect(salah([{ employee_id: EMP_A, amount: 125 }, { employee_id: EMP_A, amount: 125 }])).toContain("sekali");
    expect(salah([{ employee_id: "x", amount: 250 }])).toContain("Pilih karyawan");
    expect(salah([{ employee_id: EMP_A, amount: 0 }])).toContain("lebih dari 0");
    expect(salah([{ employee_id: EMP_A, amount: 250 }], "ab")).toContain("Alasan wajib");
    expect(salah([])).toContain("Pilih 1 sampai 10");
    expect(bacaIsianBeban({ baris: "bukan json", alasan: "abc" }, 1).ok).toBe(false);
  });
  it("pesan database tanpa kode teknis; fungsi belum ada = belum aktif; galat lain = belum terkonfirmasi", () => {
    expect(pesanBebanKaryawan({ message: "BEBAN_KARYAWAN_SUDAH: Selisih kurang opname ini sudah dibebankan ke karyawan." })).toBe("Selisih kurang opname ini sudah dibebankan ke karyawan.");
    expect(pesanBebanKaryawan({ code: "PGRST202", message: "Could not find the function public.charge_opname_variance_to_employees" })).toContain("belum aktif");
    expect(pesanBebanKaryawan({ code: "42501", message: "permission denied" })).toContain("Hanya Owner");
    expect(pesanBebanKaryawan({ message: "boom" })).toContain("belum terkonfirmasi");
  });
  it("asal kasbon untuk HRIS: beban opname, selisih kas, kasbon biasa", () => {
    expect(asalKasbon("Dicatat", "Beban selisih stok opname OPR.1 — hilang")).toBe("beban-opname");
    expect(asalKasbon("Disetujui", "Selisih kas kurang saat tutup shift abcd1234")).toBe("selisih-kas");
    expect(asalKasbon("Disetujui", "butuh dana")).toBe("kasbon");
  });
  it("bacaRingkasanBeban: bentuk RPC divalidasi; bentuk salah = null", () => {
    const raw = { result_id: RESULT, no_hasil: "OPR.1", minus_lines: [{ item_id: "i", code: "A", name: "Barang", unit: "PCS", qty: 1, hpp: 100, harga_jual: 150, jual: 150 }],
      minus_count: 1, hpp_total: 100, jual_total: 150, hpp_part: 100, gain_part: 50, refuse: null, can_charge: true, charges: [] };
    expect(bacaRingkasanBeban(raw)).toMatchObject({ jual_total: 150, hpp_part: 100, gain_part: 50, refuse: null, can_charge: true });
    expect(bacaRingkasanBeban({ ...raw, jual_total: "x" })).toBeNull();
    expect(bacaRingkasanBeban(null)).toBeNull();
  });
});

describe("aksi catat & batal beban", () => {
  beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data: { total: 250, charge_id: "c" }, error: null }); });
  const isi = { order_id: ORDER, result_id: RESULT, request_key: KEY, total: "250", alasan: "Barang hilang di rak",
    baris: JSON.stringify([{ employee_id: EMP_A, amount: 150 }, { employee_id: EMP_B, amount: 100 }]) };

  it("memanggil RPC atomik dengan baris, alasan, kunci; sukses kembali ke halaman opname", async () => {
    await expect(catatBebanKaryawan(form(isi))).rejects.toThrow(/REDIRECT:\/pos\/opname\/a1000000-0000-4000-8000-000000000001\?success=.*#beban-karyawan/);
    expect(mocks.rpc).toHaveBeenCalledWith("charge_opname_variance_to_employees", {
      p_result_id: RESULT, p_lines: [{ employee_id: EMP_A, amount: 150 }, { employee_id: EMP_B, amount: 100 }], p_reason: "Barang hilang di rak", p_request_key: KEY,
    });
  });
  it.each([
    [{ request_key: "x" }, "Muat ulang"],
    [{ baris: JSON.stringify([{ employee_id: EMP_A, amount: 100 }]) }, "harus sama"],
    [{ alasan: "" }, "Alasan wajib"],
    [{ result_id: "x" }, "Hasil opname tidak valid"],
  ])("isian salah ditolak tanpa memanggil database %#", async (ubah, pesan) => {
    await expect(catatBebanKaryawan(form({ ...isi, ...ubah }))).rejects.toThrow(new URLSearchParams({ error: pesan }).toString().slice(6, 20));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("penolakan database diteruskan sebagai kalimat biasa", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "BEBAN_KARYAWAN_LAMA: Opname ini diposting sebelum aturan akun selisih baru berlaku." } });
    await expect(catatBebanKaryawan(form(isi))).rejects.toThrow(/error=Opname\+ini\+diposting\+sebelum/);
  });
  it("batal: alasan wajib; memanggil RPC pembatalan", async () => {
    const f = { order_id: ORDER, charge_id: RESULT, request_key: KEY, alasan: "Salah pilih karyawan" };
    await expect(batalBebanKaryawan(form({ ...f, alasan: "x" }))).rejects.toThrow("error=");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(batalBebanKaryawan(form(f))).rejects.toThrow("success=");
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_opname_variance_charge", { p_charge_id: RESULT, p_reason: "Salah pilih karyawan", p_request_key: KEY });
  });
});

function fakeSupabase(rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const calls: { name: string; args: unknown }[] = [];
  const from = (table: string) => {
    const data = table === "branches" ? [{ id: "b1", name: "Cabang Satu" }]
      : table === "warehouses" ? [{ id: "w1", branch_id: "b1" }]
        : table === "opname_results" ? [{ id: "r1", opname_orders: { warehouse_id: "w1" } }, { id: "r2", opname_orders: [{ warehouse_id: "w1" }] }]
          : table === "profiles" ? [{ role: "OWNER" }] : [];
    const query: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "gt", "lt", "is", "not", "neq", "order", "limit"]) query[m] = () => query;
    query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return query;
  };
  return { auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) }, from,
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return name === "read_opname_price_recap" ? rpc(name, args) : { data: true, error: null }; }, calls };
}
const FILTER = { from: "2026-11-01", to: "2026-11-30", branchIds: ["b1"], channel: "all" as const };

describe("alert operasional selisih opname (menggantikan stub)", () => {
  it("nilai HPP kurang melewati ambang Rp500.000 -> alert merah dengan keterangan harga jual & jumlah dokumen, tautan ke laporan hasil opname", async () => {
    const sb = fakeSupabase(async () => ({ data: [
      { result_id: "r1", snapshot: true, minus_modal: "-400000", minus_jual: "-600000", modal_missing: 0 },
      { result_id: "r2", snapshot: true, minus_modal: "-200000.5", minus_jual: "-250000", modal_missing: 0 },
    ], error: null }));
    const block = await collectOperationalAlertBlock(sb, FILTER);
    expect(block.status).toBe("ready");
    const alert = block.status === "ready" ? block.data.alerts.find((a) => a.ruleKey === "stock_opname_variance") : undefined;
    expect(alert).toMatchObject({ actual: 600000.5, threshold: 500000, severity: "red", detailUrl: "/laporan/hasil-opname" });
    expect(alert?.detail).toContain("Rp 850.000");
    expect(alert?.detail).toContain("2 dokumen");
    expect(sb.calls.find((c) => c.name === "read_opname_price_recap")?.args).toEqual({ p_result_ids: ["r1", "r2"] });
    if (block.status === "ready") expect(block.data.missing.some((m) => m.ruleKey === "stock_opname_variance")).toBe(false);
  });
  it("di bawah ambang -> tidak ada alert dan bukan 'missing'", async () => {
    const block = await collectOperationalAlertBlock(fakeSupabase(async () => ({ data: [{ result_id: "r1", snapshot: true, minus_modal: "-1000", minus_jual: "-1500", modal_missing: 0 }], error: null })), FILTER);
    expect(block.status === "ready" && block.data.alerts.some((a) => a.ruleKey === "stock_opname_variance")).toBe(false);
    expect(block.status === "ready" && block.data.missing.some((m) => m.ruleKey === "stock_opname_variance")).toBe(false);
  });
  it("peran tanpa hak nilai HPP -> diagnostik 'missing' dengan alasan, bukan angka", async () => {
    const block = await collectOperationalAlertBlock(fakeSupabase(async () => ({ data: null, error: { code: "42501", message: "ditolak" } })), FILTER);
    expect(block.status).toBe("ready");
    if (block.status === "ready") expect(block.data.missing).toContainEqual({ ruleKey: "stock_opname_variance", reason: "Nilai HPP hasil opname hanya untuk Owner/Finance" });
  });
  it("tautan detail laporan hasil opname memakai ID cabang (saringan laporan), POS tetap nama cabang", () => {
    expect(alertDetailHref("/laporan/hasil-opname", { from: "2026-11-01", to: "2026-11-30", branchName: "Cabang Satu", branchId: "b1" })).toBe("/laporan/hasil-opname?dari=2026-11-01&sampai=2026-11-30&cabang=b1");
    expect(alertDetailHref("/pos/opname", { from: "2026-11-01", to: "2026-11-30", branchName: "Cabang Satu", branchId: "b1" })).toBe("/pos/opname?dari=2026-11-01&sampai=2026-11-30&cabang=Cabang+Satu");
    const ev = evaluateAlerts([{ ruleKey: "stock_opname_variance", branchId: "b1", branchName: "C", status: "ready", actual: 600000, detail: "x", periodLabel: "p", detailUrl: "/laporan/hasil-opname" }], defaultAlertSettings());
    expect(ev.alerts[0]?.detail).toBe("x");
  });
});
