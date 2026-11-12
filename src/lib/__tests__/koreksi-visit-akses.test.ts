import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";
import { effectiveAllowedActions, type RoleAccessConfig } from "../role-access-catalog";
import { parseClinicRecordError } from "../klinik-posting";
import {
  alasanKoreksi, bacaBolehKoreksiVisit, bolehKoreksiVisit, IZIN_KOREKSI_VISIT, putuskanBolehKoreksiVisit, ubahBagianVisit, visitTerlambat,
} from "../koreksi-visit-akses";

// A5 (meeting 12 Nov 2026): izin Akses Grup "Koreksi visit rawat inap".
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261115400000_a5_koreksi_visit_rawat_inap.sql"), "utf8");

describe("izin khusus klinik.koreksi_visit — sinkron dengan migrasi", () => {
  it("terdaftar sebagai izin khusus (bawaan mati), baris katalog enforced grup Klinik, modul klinik", () => {
    expect(IZIN_KOREKSI_VISIT).toBe("klinik.koreksi_visit");
    expect(GRANT_ONLY_ACTIONS).toContain(IZIN_KOREKSI_VISIT);
    expect(isGrantOnlyAction(IZIN_KOREKSI_VISIT)).toBe(true);
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\)\s*values \('klinik\.koreksi_visit', 'Koreksi visit rawat inap', 'Klinik', true\)/);
    expect(sql).toMatch(/action_modules\(id, module_id\)\s*values \('klinik\.koreksi_visit', 'klinik'\)/);
  });

  it("daftar izin khusus yang DIKECUALIKAN saat ADMIN bawaan-lama dituliskan = GRANT_ONLY_ACTIONS sebelum A5 (tanpa koreksi_visit)", () => {
    const block = /v_grant_only constant text\[\] := array\[([\s\S]*?)\];/.exec(sql);
    expect(block).not.toBeNull();
    const inMigration = [...block![1].matchAll(/'([a-z_.]+)'/g)].map(m => m[1]).sort();
    expect(inMigration).toEqual(GRANT_ONLY_ACTIONS.filter(id => id !== IZIN_KOREKSI_VISIT).slice().sort());
  });

  it("peran bawaan lama tidak ditampilkan tercentang; kebijakan tertulis dihormati apa adanya", () => {
    const cat = [IZIN_KOREKSI_VISIT, "bank.cash_entry.view_history"].map(id => ({ id, label: id, group: "Klinik", enforced: true }));
    const legacy = { actions: { source: "legacy", allowed: [] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(legacy)).toEqual(["bank.cash_entry.view_history"]);
    const custom = { actions: { source: "custom", allowed: [IZIN_KOREKSI_VISIT] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(custom)).toEqual([IZIN_KOREKSI_VISIT]);
  });

  it("migrasi: satu transaksi tanpa begin/commit sendiri, lock_timeout, pagar prasyarat, penjaga Akses Grup dinyalakan lagi", () => {
    expect(sql.split("\n").filter(l => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    expect(sql).toContain("set local lock_timeout = '5s';");
    expect(sql).toContain("A5_PRECONDITION");
    expect(sql).toContain("A5 (meeting 12 Nov 2026)");
    for (const [table, trigger] of [["epochs", "epoch_guard"], ["action_policies", "action_policy_guard"]]) {
      expect(sql).toContain(`alter table role_settings_private.${table} disable trigger ${trigger};`);
      expect(sql).toContain(`alter table role_settings_private.${table} enable trigger ${trigger};`);
    }
    // aktor izin khusus: Owner dulu (tanpa membaca kebijakan), peran lain wajib baris eksplisit + role_action_allowed
    expect(sql).toMatch(/if v_role = 'OWNER' then return 'OWNER'; end if;[\s\S]*'klinik\.koreksi_visit' = any \(a\.allowed\)\)\s*and public\.role_action_allowed\('klinik\.koreksi_visit'\)/);
  });
});

describe("pembacaan izin (pola Batalkan penerimaan)", () => {
  it("jawaban database dipakai apa adanya; galat baca -> hanya Owner", async () => {
    expect(await bolehKoreksiVisit({ rpc: async () => ({ data: true, error: null }) }, "STAFF")).toBe(true);
    expect(await bolehKoreksiVisit({ rpc: async () => ({ data: false, error: null }) }, "OWNER")).toBe(false);
    expect(await bacaBolehKoreksiVisit({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBeNull();
    expect(await bacaBolehKoreksiVisit({ rpc: async () => { throw new Error("jaringan"); } })).toBeNull();
    expect(putuskanBolehKoreksiVisit(null, "OWNER")).toBe(true);
    expect(putuskanBolehKoreksiVisit(null, "ADMIN")).toBe(false);
    expect(putuskanBolehKoreksiVisit(null, undefined)).toBe(false);
  });
  it("memanggil RPC layar yang benar", async () => {
    const names: string[] = [];
    await bacaBolehKoreksiVisit({ rpc: async (n: string) => { names.push(n); return { data: true, error: null }; } });
    expect(names).toEqual(["clinic_inpatient_visit_correction_allowed"]);
  });
});

describe("aturan koreksi", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  it("visit dokter lebih dari 48 jam lalu = koreksi; pemantauan dan visit tepat waktu bukan", () => {
    expect(visitTerlambat("doctor_visit", new Date("2026-11-10T09:59:00Z"), now)).toBe(true);
    expect(visitTerlambat("doctor_visit", new Date("2026-11-10T10:01:00Z"), now)).toBe(false);
    expect(visitTerlambat("monitoring", new Date("2026-11-01T10:00:00Z"), now)).toBe(false);
    expect(visitTerlambat("doctor_visit", null, now)).toBe(false);
  });
  it("alasan 3–500 huruf setelah dirapikan", () => {
    expect(alasanKoreksi("  ok  ")).toBeNull();
    expect(alasanKoreksi(" Lupa dicatat ")).toBe("Lupa dicatat");
    expect(alasanKoreksi("x".repeat(501))).toBeNull();
    expect(alasanKoreksi(null)).toBeNull();
  });
  it("bagian visit yang dijaga: waktu, jenis, dokter, paramedis (hanya bila lama atau baru visit dokter)", () => {
    const visit = { log_kind: "doctor_visit", visit_doctor_id: "d1", paramedic_id: "p1" };
    expect(ubahBagianVisit(visit, { ...visit }, false)).toBe(false);
    expect(ubahBagianVisit(visit, { ...visit, paramedic_id: "p2" }, false)).toBe(true);
    expect(ubahBagianVisit(visit, { ...visit, paramedic_id: null }, false)).toBe(true);
    expect(ubahBagianVisit(visit, { ...visit, visit_doctor_id: "d2" }, false)).toBe(true);
    expect(ubahBagianVisit(visit, { ...visit, log_kind: "monitoring" }, false)).toBe(true);
    expect(ubahBagianVisit(visit, {}, true)).toBe(true);
    expect(ubahBagianVisit(visit, {}, false)).toBe(false);
    const mon = { log_kind: "monitoring", visit_doctor_id: null, paramedic_id: "p1" };
    expect(ubahBagianVisit(mon, { ...mon, paramedic_id: "p2" }, true)).toBe(false);
    expect(ubahBagianVisit(mon, { ...mon, log_kind: "doctor_visit", visit_doctor_id: "d1" }, false)).toBe(true);
  });
});

describe("pesan galat database A5 -> bahasa biasa", () => {
  const err = (message: string) => ({ code: "P0001", message });
  it("izin, alasan, masa rawat, dan tanpa obat dipetakan jelas", () => {
    expect(parseClinicRecordError(err("VISIT_CORRECTION_DENIED: visit dokter lebih dari 48 jam lalu hanya dapat dicatat Owner"))).toMatch(/izin Koreksi visit rawat inap/);
    expect(parseClinicRecordError(err("VISIT_CORRECTION_REASON: alasan koreksi wajib diisi"))).toMatch(/alasan koreksi/);
    expect(parseClinicRecordError(err("VISIT_CORRECTION_WINDOW: tanggal"))).toMatch(/tanggal masuk dan tanggal pulang/);
    expect(parseClinicRecordError(err("VISIT_CORRECTION_CART: tanpa obat"))).toMatch(/tanpa obat, tagihan, atau ubah kondisi/);
    // pesan lama tetap
    expect(parseClinicRecordError(err("CARE_INVALID: waktu visit dokter tidak boleh di masa depan"))).toBe("waktu visit dokter tidak boleh di masa depan");
  });
});
