import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction, legacyRoleHasAction } from "../role-grant-only-actions";
import {
  IZIN_BATAL_TAGIHAN, PESAN_BATAL_BELUM_TERKONFIRMASI, bacaBolehBatalTagihan, bolehTawarkanBatalTagihan, bolehTutupKunjungan, pesanBatalTagihan,
  pesanTutupKunjungan, putuskanBolehBatalTagihan, ringkasanHasilBatalTagihan, ringkasanPratinjauBatalTagihan, semuaTagihanLunas,
  type HasilBatalTagihan, type PratinjauBatalTagihan,
} from "../batal-tagihan-klinik";

// B2 (meeting 12 Nov 2026, pilihan A): batalkan tagihan klinik + tutup kunjungan.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261118620000_b2_batalkan_tagihan_klinik.sql"), "utf8");

describe("izin khusus klinik.batalkan_tagihan — sinkron dengan migrasi", () => {
  it("terdaftar sebagai izin khusus (bawaan mati untuk semua peran legacy, termasuk ADMIN), katalog enforced grup Klinik, modul klinik", () => {
    expect(IZIN_BATAL_TAGIHAN).toBe("klinik.batalkan_tagihan");
    expect(GRANT_ONLY_ACTIONS).toContain(IZIN_BATAL_TAGIHAN);
    expect(isGrantOnlyAction(IZIN_BATAL_TAGIHAN)).toBe(true);
    expect(legacyRoleHasAction(IZIN_BATAL_TAGIHAN, "ADMIN")).toBe(false);
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\)\s*values \('klinik\.batalkan_tagihan', '[^']+', 'Klinik', true\)/);
    expect(sql).toMatch(/action_modules\(id, module_id\)\s*values \('klinik\.batalkan_tagihan', 'klinik'\)/);
  });
  it("pemeriksa izin: Owner dulu tanpa membaca kebijakan; peran lain wajib baris eksplisit + role_action_allowed", () => {
    expect(sql).toMatch(/if v_role = 'OWNER' then return 'OWNER'; end if;[\s\S]*'klinik\.batalkan_tagihan' = any \(a\.allowed\)\)\s*and public\.role_action_allowed\('klinik\.batalkan_tagihan'\)/);
  });
  it("migrasi: 'Apply as ONE transaction' di 3 baris pertama, tanpa begin/commit sendiri, lock_timeout, header berbahasa Indonesia dengan rollback", () => {
    expect(sql.split("\n").slice(0, 3).join("\n")).toContain("Apply as ONE transaction");
    expect(sql.split("\n").filter(l => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    expect(sql).toContain("set local lock_timeout = '5s';");
    expect(sql).toContain("ROLLBACK (manual");
    expect(sql).toContain("B2_PRECONDITION");
  });
  it("aturan 2A (B3 A): pendapatan di tanggal tagihan asli, HPP dan stok hari ini; tambalan arsip berjangkar dan gagal tertutup", () => {
    expect(sql).toMatch(/clinic_write_journal\(v_orig, 'Batalkan tagihan '/);
    expect(sql).toMatch(/clinic_write_journal\(current_date, 'Batalkan tagihan ' \|\| v_inv\.invoice_no \|\| ': pembalikan HPP', 'klinik-hpp-void'/);
    expect(sql).toMatch(/'klinik-void', v_inv\.invoice_no, current_date, null\);/);
    expect(sql).toContain("perform public.inventory_assert_open_date(current_date);");
    expect(sql).not.toContain("inventory_assert_open_date(v_orig)");
    expect(sql).toMatch(/current_date <= v_invlock/);
    expect(sql).toMatch(/'klinik-void', v_inv\.invoice_no/);
    expect(sql).toMatch(/'klinik-hpp-void', v_inv\.invoice_no/);
    expect(sql).toContain("visit_archive_classify tidak seperti yang ditinjau (jangkar %)");
  });
});

describe("pesan galat -> bahasa biasa", () => {
  it("penolakan database: kode dibuang, kalimat dipakai apa adanya", () => {
    expect(pesanBatalTagihan("BATAL_TAGIHAN_LUNAS: Tagihan ini sudah Lunas. Batalkan penerimaannya dulu.")).toBe("Tagihan ini sudah Lunas. Batalkan penerimaannya dulu.");
    expect(pesanBatalTagihan("BATAL_TAGIHAN_RAWAT_INAP: Tagihan rawat inap belum bisa dibatalkan dari sini.")).toMatch(/^Tagihan rawat inap/);
  });
  it("kode teknis dipetakan; galat tak dikenal = belum terkonfirmasi (tidak diulang otomatis)", () => {
    expect(pesanBatalTagihan("ACCESS_DENIED: hanya Owner")).toMatch(/izin "Batalkan tagihan"/);
    expect(pesanBatalTagihan("BATAL_TAGIHAN_INVALID: x")).toMatch(/Alasan wajib diisi/);
    expect(pesanBatalTagihan("IDEMPOTENCY_CONFLICT: x")).toMatch(/Muat ulang/);
    expect(pesanBatalTagihan("canceling statement due to lock timeout")).toMatch(/kasir lain/);
    expect(pesanBatalTagihan("Periode s/d 2026-10-31 sudah ditutup — jurnal terkunci")).toMatch(/Tutup Buku/);
    expect(pesanBatalTagihan("something odd")).toBe(PESAN_BATAL_BELUM_TERKONFIRMASI);
    expect(pesanBatalTagihan(null)).toBe(PESAN_BATAL_BELUM_TERKONFIRMASI);
  });
  it("tutup kunjungan: pesan tanpa kode, huruf besar di depan", () => {
    expect(pesanTutupKunjungan("CLOSE_BLOCKED: kunjungan belum bisa ditutup karena pasien masih dirawat inap.")).toBe("Kunjungan belum bisa ditutup karena pasien masih dirawat inap.");
    expect(pesanTutupKunjungan("ACCESS_DENIED: hanya pemilik")).toMatch(/pemilik atau admin/);
    expect(pesanTutupKunjungan("lock timeout")).toMatch(/pengguna lain/);
    expect(pesanTutupKunjungan("")).toMatch(/Muat ulang/);
  });
});

describe("ringkasan pratinjau dan hasil", () => {
  const p: PratinjauBatalTagihan = {
    refuse: null, invoice: { id: "i1", no: "INV-9", total: 170000, paid_status: "DP", dp_amount: 100000, visit_id: "v1", branch_id: "b1", voided_at: null },
    original_date: "2026-11-03", today: "2026-11-14", dp: 100000, points_net: 25, stock_value: 4000, racik_value: 3000, hpp_reversed: 7000,
    stock_lines: 1, racik_lines: 1, withdraw_count: 2, line_count: 3, actor: "OWNER",
  };
  it("menyebut tanggal asli, stok kembali, DP jadi saldo uang muka, poin, dan langkah arsip — tanpa istilah teknis", () => {
    const t = ringkasanPratinjauBatalTagihan(p).join(" ");
    expect(t).toContain("3 November 2026");
    expect(t).toContain("Rp 7.000");
    expect(t).toContain("kembali ke stok hari ini");
    expect(t).toContain("DP Rp 100.000");
    expect(t).toContain("Kembalikan saldo uang muka");
    expect(t).toContain("25 poin");
    expect(t).toContain("Paksa arsip");
    expect(t).not.toMatch(/jurnal|journal|RPC|void|FIFO|idempot/i);
  });
  it("tanpa DP/poin/stok: kalimatnya tidak muncul", () => {
    const t = ringkasanPratinjauBatalTagihan({ ...p, dp: 0, points_net: 0, stock_value: 0, racik_value: 0, hpp_reversed: 0, withdraw_count: 0 }).join(" ");
    expect(t).not.toMatch(/DP|poin|stok/);
  });
  it("hasil: nomor uang muka dan poin", () => {
    const h = { status: "VOIDED", void_id: "x", invoice_id: "i1", invoice_no: "INV-9", visit_id: "v1", original_date: "2026-11-03", tanggal: "2026-11-14", total: 170000,
      dp_converted: 100000, advance_id: "a1", advance_no: "UMK-202611-0001", stock_value: 7000, hpp_reversed: 7000, stock: [], points_delta: -25, withdrawn: 2 } as HasilBatalTagihan;
    const t = ringkasanHasilBatalTagihan(h).join(" ");
    expect(t).toContain("UMK-202611-0001");
    expect(t).toContain("25 poin ditarik");
    expect(ringkasanHasilBatalTagihan({ ...h, dp_converted: 0, advance_no: null }).join(" ")).not.toContain("uang muka");
  });
});

describe("aturan layar", () => {
  it("tombol Batalkan tagihan: hanya Belum Lunas/DP, terbit, bukan koreksi, bukan rawat inap", () => {
    expect(bolehTawarkanBatalTagihan({ paid_status: "Belum Lunas", invoice_no: "INV-1" }, false)).toBe(true);
    expect(bolehTawarkanBatalTagihan({ paid_status: "DP", invoice_no: "INV-1" }, false)).toBe(true);
    expect(bolehTawarkanBatalTagihan({ paid_status: "Lunas", invoice_no: "INV-1" }, false)).toBe(false);
    expect(bolehTawarkanBatalTagihan({ paid_status: "DP", invoice_no: "INV-1" }, true)).toBe(false);
    expect(bolehTawarkanBatalTagihan({ paid_status: "DP", invoice_no: "INV-1", correction_pending: true }, false)).toBe(false);
    expect(bolehTawarkanBatalTagihan({ paid_status: "DP", invoice_no: null }, false)).toBe(false);
    expect(bolehTawarkanBatalTagihan(null, false)).toBe(false);
  });
  it("izin layar dibaca dari database; gagal baca -> hanya Owner", async () => {
    expect(await bacaBolehBatalTagihan({ rpc: async () => ({ data: true, error: null }) })).toBe(true);
    expect(await bacaBolehBatalTagihan({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBeNull();
    expect(await bacaBolehBatalTagihan({ rpc: async () => { throw new Error("jaringan"); } })).toBeNull();
    const names: string[] = [];
    await bacaBolehBatalTagihan({ rpc: async (n: string) => { names.push(n); return { data: false, error: null }; } });
    expect(names).toEqual(["clinic_invoice_void_allowed"]);
    expect(putuskanBolehBatalTagihan(null, "OWNER")).toBe(true);
    expect(putuskanBolehBatalTagihan(null, "ADMIN")).toBe(false);
    expect(putuskanBolehBatalTagihan(false, "OWNER")).toBe(false);
  });
  it("tutup kunjungan: Owner/Admin aktif; tombol hanya bila ada tagihan aktif dan semuanya Lunas", () => {
    expect(bolehTutupKunjungan({ role: "OWNER", is_active: true })).toBe(true);
    expect(bolehTutupKunjungan({ role: "ADMIN", is_active: true })).toBe(true);
    expect(bolehTutupKunjungan({ role: "ADMIN", is_active: false })).toBe(false);
    expect(bolehTutupKunjungan({ role: "FINANCE", is_active: true })).toBe(false);
    expect(semuaTagihanLunas([{ paid_status: "Lunas", voided_at: null }, { paid_status: "Belum Lunas", voided_at: "2026-11-01" }])).toBe(true);
    expect(semuaTagihanLunas([{ paid_status: "Lunas" }, { paid_status: "DP" }])).toBe(false);
    expect(semuaTagihanLunas([{ paid_status: "Lunas", correction_pending: true }])).toBe(false);
    expect(semuaTagihanLunas([{ paid_status: "Lunas", voided_at: "2026-11-01" }])).toBe(false);
    expect(semuaTagihanLunas([])).toBe(false);
    expect(semuaTagihanLunas(null)).toBe(false);
    expect(semuaTagihanLunas({ paid_status: "Lunas" })).toBe(true);
  });
});
