// Keputusan pemilik (Andri, 29 Okt 2026): "Yang sudah melewati batas waktu
// otomatis harus non aktif."
//
// Yang diuji di sini adalah BATAS HARINYA, bukan rumus potongannya: hari
// terakhir masih sah sampai tengah malam WIB, sehari sesudahnya mati — termasuk
// pada jam-jam ketika tanggal UTC dan tanggal WIB berbeda.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promoActiveFor, promoScheduleStatus, pesanAktivasiKadaluarsa, type PromoRow } from "../promo";
import { voucherBerlaku, voucherStatus, type VoucherRow } from "../voucher";
import { hariIniWIB } from "../tanggal";

const BERAKHIR = "2026-10-13";

// Salinan apa adanya dari promo Production "diskon aatas" (berakhir 13 Okt).
const promo: PromoRow = {
  id: "8ee5e96d-1802-4803-b6a5-ed0a5abe0892", name: "diskon aatas", promo_type: "diskon_produk",
  rule: {}, is_active: true, branch_ids: null, valid_from: BERAKHIR, valid_until: BERAKHIR,
  min_qty: 1, max_qty: 1, kelipatan: true, auto_apply: true, discount_type: "nominal", discount_value: 1000,
};
const voucher: VoucherRow = {
  code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true,
  valid_from: BERAKHIR, valid_until: BERAKHIR, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true,
};

const pada = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("batas hari terakhir dibaca menurut WIB", () => {
  it("hari terakhir masih berlaku sampai 23:59 WIB", () => {
    pada("2026-10-13T16:30:00Z"); // 23:30 WIB, masih 13 Okt
    expect(hariIniWIB()).toBe(BERAKHIR);
    expect(promoActiveFor(promo, "cabang-mana-pun", hariIniWIB())).toBe(true);
    expect(promoScheduleStatus(promo, hariIniWIB())).toBe("aktif");
    expect(voucherBerlaku(voucher, hariIniWIB())).toBe(true);
    expect(voucherStatus(voucher, hariIniWIB())).toBe("aktif");
  });

  it("lewat tengah malam WIB langsung kadaluarsa", () => {
    pada("2026-10-13T17:10:00Z"); // 00:10 WIB tanggal 14
    expect(hariIniWIB()).toBe("2026-10-14");
    expect(promoActiveFor(promo, "cabang-mana-pun", hariIniWIB())).toBe(false);
    expect(promoScheduleStatus(promo, hariIniWIB())).toBe("kadaluarsa");
    expect(voucherBerlaku(voucher, hariIniWIB())).toBe(false);
    expect(voucherStatus(voucher, hariIniWIB())).toBe("kadaluarsa");
  });

  // Jam 00:00–07:00 WIB adalah jam ketika tanggal UTC masih KEMARIN. Memakai
  // tanggal UTC mentah akan membuat promo hidup satu hari lebih lama di layar
  // kasir Indonesia — persis kesalahan yang dicegah hariIniWIB().
  it("jam rawan: UTC masih 13 Okt, WIB sudah 14 Okt, promonya tetap mati", () => {
    pada("2026-10-13T20:00:00Z");
    expect(new Date().toISOString().slice(0, 10)).toBe(BERAKHIR);
    expect(hariIniWIB()).toBe("2026-10-14");
    expect(promoActiveFor(promo, "cabang-mana-pun", hariIniWIB())).toBe(false);
    expect(voucherBerlaku(voucher, hariIniWIB())).toBe(false);
  });

  it("promo tanpa tanggal akhir tidak pernah kadaluarsa", () => {
    pada("2030-01-01T00:00:00Z");
    const abadi = { ...promo, valid_from: "2026-10-15", valid_until: null };
    expect(promoActiveFor(abadi, "cabang-mana-pun", hariIniWIB())).toBe(true);
    expect(promoScheduleStatus(abadi, hariIniWIB())).toBe("aktif");
  });
});

describe("status tetap menjelaskan ALASAN setelah penyapu mematikan barisnya", () => {
  it("kadaluarsa menang atas nonaktif", () => {
    const mati = { ...promo, is_active: false };
    expect(promoScheduleStatus(mati, "2026-10-14")).toBe("kadaluarsa");
    expect(voucherStatus({ ...voucher, is_active: false }, "2026-10-14")).toBe("kadaluarsa");
  });

  it("nonaktif manual tanpa tanggal akhir tetap berlabel nonaktif", () => {
    expect(promoScheduleStatus({ ...promo, is_active: false, valid_until: null }, "2026-10-14")).toBe("nonaktif");
    expect(voucherStatus({ ...voucher, is_active: false, valid_until: null }, "2026-10-14")).toBe("nonaktif");
  });
});

describe("mengaktifkan kembali harus lewat perpanjangan tanggal", () => {
  it("menolak dengan menyebut tanggal berakhir dan langkah berikutnya", () => {
    const pesan = pesanAktivasiKadaluarsa('Promo "diskon aatas"', BERAKHIR, "2026-10-14");
    expect(pesan).toContain("diskon aatas");
    expect(pesan).toContain(BERAKHIR);
    expect(pesan).toContain("Perpanjang");
  });

  it("hari terakhir dan tanpa batas akhir tetap boleh diaktifkan", () => {
    expect(pesanAktivasiKadaluarsa("Promo", BERAKHIR, BERAKHIR)).toBeNull();
    expect(pesanAktivasiKadaluarsa("Promo", null, "2030-01-01")).toBeNull();
  });
});

// Tanpa database di CI, invarian migrasinya diperiksa dari teks SQL-nya —
// pola yang sama dengan promo-rls-migration.test.ts.
describe("migrasi penonaktifan otomatis", () => {
  const SQL = readFileSync("supabase/migrations/20261031150000_promo_kadaluarsa_otomatis.sql", "utf8");

  it("memakai tanggal Asia/Jakarta, bukan tanggal server", () => {
    expect(SQL).toContain("(now() at time zone 'Asia/Jakarta')::date");
    expect(SQL).not.toContain("current_date");
  });

  it("menonaktifkan promo, voucher, dan kode kampanye yang tujuannya lewat tanggal", () => {
    expect(SQL).toContain("update public.promos set is_active = false where is_active and valid_until < hari");
    expect(SQL).toContain("update public.vouchers set is_active = false where is_active and valid_until < hari");
    expect(SQL).toContain("update public.campaign_codes c set is_active = false");
  });

  it("berhenti lebih awal dan tidak mengunci apa pun bila tidak ada yang lewat tanggal", () => {
    expect(SQL).toContain("create index if not exists promos_aktif_berakhir");
    expect(SQL).toContain("create index if not exists vouchers_aktif_berakhir");
    expect(SQL).toContain("pg_try_advisory_xact_lock");
  });

  it("tercatat sebagai perubahan sistem, bukan atas nama pengguna yang membuka layar", () => {
    expect(SQL).toContain(`set "request.jwt.claims" to ''`);
    expect(SQL).toContain(`set "request.jwt.claim.sub" to ''`);
  });

  it("tidak bisa dipanggil anon/service_role dan tidak bocor lewat search_path", () => {
    expect(SQL).toContain("security definer");
    expect(SQL).toContain("set search_path = ''");
    expect(SQL).toContain("revoke all on function public.nonaktifkan_promo_kadaluarsa() from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.nonaktifkan_promo_kadaluarsa() to authenticated;");
  });

  it("memasang jadwal harian hanya bila pg_cron benar-benar terpasang", () => {
    expect(SQL).toContain("select 1 from pg_extension where extname = 'pg_cron'");
    expect(SQL).toContain("'promo-kadaluarsa-harian','5 17 * * *'"); // 00:05 WIB
  });

  it("menolak menghidupkan baris kedaluwarsa dan mematikan yang tanggalnya mundur", () => {
    // OLD tidak terisi pada INSERT, jadi cabangnya harus dipisah — bukan satu
    // rangkaian OR, yang evaluasinya tidak dijamin PostgreSQL.
    expect(SQL).toContain("if tg_op = 'INSERT' then menghidupkan := true; else menghidupkan := not old.is_active; end if;");
    expect(SQL).toContain("if menghidupkan then");
    expect(SQL).toContain("Perpanjang dulu tanggal \"Berlaku s/d\" sebelum diaktifkan kembali.");
    expect(SQL).toContain("new.is_active := false;");
    expect(SQL).toContain("create trigger promo_kadaluarsa_otomatis before insert or update on public.promos");
    expect(SQL).toContain("create trigger voucher_kadaluarsa_otomatis before insert or update on public.vouchers");
  });

  it("idempoten: aman dijalankan ulang", () => {
    for (const perintah of ["create or replace function", "create index if not exists", "drop trigger if exists"]) {
      expect(SQL).toContain(perintah);
    }
  });
});
