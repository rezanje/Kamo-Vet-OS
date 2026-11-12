import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effectiveDateBounds, loadPurchaseBackdateAccess, PURCHASE_BACKDATE_ACTION, readEffectiveDate } from "../purchase-backdate";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";

const client = (result: { data: unknown; error: unknown } | "throw") => ({
  rpc: vi.fn(() => (result === "throw" ? (() => { throw new Error("jaringan"); })() : Promise.resolve(result))),
});

describe("izin tanggal mundur (layar)", () => {
  it("Owner aktif selalu boleh dan tidak membaca kebijakan (gagal-terbuka khusus Owner)", async () => {
    const c = client("throw");
    expect(await loadPurchaseBackdateAccess(c, { role: "OWNER", is_active: true })).toBe(true);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("Owner nonaktif atau profil kosong tidak mendapat akses", async () => {
    expect(await loadPurchaseBackdateAccess(client({ data: true, error: null }), { role: "OWNER", is_active: false })).toBe(false);
    expect(await loadPurchaseBackdateAccess(client({ data: true, error: null }), null)).toBe(false);
  });
  it("peran lain hanya bila database menjawab tepat true", async () => {
    expect(await loadPurchaseBackdateAccess(client({ data: true, error: null }), { role: "ADMIN", is_active: true })).toBe(true);
    for (const result of [{ data: false, error: null }, { data: "true", error: null }, { data: 1, error: null }, { data: null, error: null }, { data: true, error: { message: "x" } }, "throw" as const]) {
      expect(await loadPurchaseBackdateAccess(client(result as never), { role: "ADMIN", is_active: true })).toBe(false);
    }
  });
  it("tindakan terdaftar sebagai izin khusus (bawaan MATI) dan sama dengan baris katalog migrasi", () => {
    expect(isGrantOnlyAction(PURCHASE_BACKDATE_ACTION)).toBe(true);
    expect(GRANT_ONLY_ACTIONS).toContain("pembelian.tanggal_mundur");
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261114500000_backdate_pembelian.sql"), "utf8");
    expect(migration).toMatch(/action_catalog\(id,label,"group",enforced\) values\s*\('pembelian\.tanggal_mundur'/);
    expect(migration).toMatch(/action_modules\(id,module_id\) values \('pembelian\.tanggal_mundur','pembelian'\)/);
    // tindakan batal sebelumnya tidak terhapus
    expect(GRANT_ONLY_ACTIONS).toEqual(expect.arrayContaining(["pembelian.batalkan_penerimaan", "pembelian.batalkan_faktur", "pembelian.batalkan_pembayaran", "pembelian.batalkan_uang_muka", "klinik.batalkan_penerimaan", "penjualan.pos_penerimaan.batalkan"]));
  });
});

describe("batas isian tanggal", () => {
  const today = "2026-11-12";
  it("Owner/izin: bawaan hari ini, rentang tanggal dokumen asal sampai hari ini", () => {
    expect(effectiveDateBounds({ docDate: "2026-11-05", canBackdate: true, today })).toEqual({ value: today, min: "2026-11-05", max: today, locked: false });
  });
  it("tanpa izin: dikunci ke hari ini", () => {
    expect(effectiveDateBounds({ docDate: "2026-11-05", canBackdate: false, today })).toEqual({ value: today, min: today, max: today, locked: true });
  });
  it("tanggal dokumen tidak sah, kosong, atau di masa depan: batas bawah = hari ini (tidak pernah melewati hari ini)", () => {
    for (const docDate of [null, undefined, "", "bukan-tanggal", "2026-13-40", "2026-11-13", "2027-01-01"]) {
      expect(effectiveDateBounds({ docDate, canBackdate: true, today })).toEqual({ value: today, min: today, max: today, locked: false });
    }
  });
  it("hari yang sama dengan dokumen asal: satu tanggal saja", () => {
    expect(effectiveDateBounds({ docDate: today, canBackdate: true, today })).toMatchObject({ min: today, max: today });
  });
});

describe("pemeriksaan tanggal di server sebelum RPC", () => {
  const today = "2026-11-12";
  it("kosong = hari ini", () => {
    expect(readEffectiveDate(undefined, today)).toEqual({ ok: true, value: today });
    expect(readEffectiveDate("   ", today)).toEqual({ ok: true, value: today });
    expect(readEffectiveDate(null, today)).toEqual({ ok: true, value: today });
  });
  it("tanggal sah sampai hari ini diteruskan apa adanya (izin dan tanggal dokumen: database)", () => {
    expect(readEffectiveDate("2026-11-05", today)).toEqual({ ok: true, value: "2026-11-05" });
    expect(readEffectiveDate(" 2026-11-12 ", today)).toEqual({ ok: true, value: today });
  });
  it("masa depan ditolak dengan penjelasan", () => {
    const r = readEffectiveDate("2026-11-13", today);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("masa depan");
  });
  it.each(["12-11-2026", "2026-2-3", "2026-02-30", "2026-13-01", "abc", "2026-11-12T10:00:00Z", "2026/11/12"])("format tidak sah %s ditolak", (raw) => {
    const r = readEffectiveDate(raw, today);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("tidak valid");
  });
});
