import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AKUN_KATEGORI_LAMA, AKUN_KATEGORI_PENGELUARAN, KATEGORI_PENGELUARAN, KATEGORI_PENGELUARAN_BACKOFFICE,
  KATEGORI_PENGELUARAN_FILTER, badgeKategoriPengeluaran,
} from "@/lib/kategori-pengeluaran";
import { KATEGORI_BEBAN } from "@/app/(app)/buku-besar/beban/kategori";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261123084004_kategori_pengeluaran_rinci.sql"), "utf8");
const fungsi = sql.slice(sql.indexOf("create or replace function public.expense_account_code"));
const petaSql = Object.fromEntries([...fungsi.matchAll(/when '([^']+)' then '(\d{6})'/g)].map((m) => [m[1], m[2]]));

describe("kategori pengeluaran → akun beban", () => {
  it("rincian dari keuangan dipetakan persis ke akunnya", () => {
    expect(AKUN_KATEGORI_PENGELUARAN).toEqual({
      "Listrik": "720002", "Air": "720003", "Internet": "720004", "Tips Ongkir": "740017",
      "Bensin, Parkir & Toll": "740005", "Perawatan Peralatan": "720008", "Uang Makan": "740021",
      "Kebutuhan RT": "740016", "Marketing": "730002", "Kebersihan": "720005", "Keamanan": "720006",
      "IPL": "720009", "ATK": "740002", "Print dan FC": "740014", "Kebutuhan Grooming": "740013",
      "Kresek dan Thermal": "740022", "Ekspedisi": "740012", "Lain-lain": "760003",
    });
  });

  it("peta aplikasi sama dengan fungsi database (baru + lama)", () => {
    expect(petaSql).toEqual({ ...AKUN_KATEGORI_LAMA, ...AKUN_KATEGORI_PENGELUARAN });
  });

  it("migrasi memeriksa semua akun tujuan sudah ada", () => {
    for (const akun of new Set(Object.values(AKUN_KATEGORI_PENGELUARAN))) expect(sql).toContain(`'${akun}'`);
  });

  it("form baru tidak lagi menawarkan kategori umum yang menumpuk ke Beban Operasional Lain", () => {
    for (const lama of ["Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan"]) {
      expect(KATEGORI_PENGELUARAN).not.toContain(lama);
      expect(KATEGORI_PENGELUARAN_BACKOFFICE).not.toContain(lama);
    }
    expect(KATEGORI_PENGELUARAN.at(-1)).toBe("Lain-lain");
    expect(KATEGORI_PENGELUARAN_BACKOFFICE.at(-1)).toBe("Lain-lain");
    expect(KATEGORI_PENGELUARAN_BACKOFFICE).toContain("Sewa Gedung");
  });

  it("filter riwayat tetap memuat kategori lama", () => {
    for (const lama of Object.keys(AKUN_KATEGORI_LAMA)) expect(KATEGORI_PENGELUARAN_FILTER).toContain(lama);
  });

  it("Pencatatan Beban back office memakai daftar dan akun yang sama", () => {
    expect(Object.keys(KATEGORI_BEBAN)).toEqual(KATEGORI_PENGELUARAN_BACKOFFICE);
    for (const [k, akun] of Object.entries(KATEGORI_BEBAN)) expect(akun).toBe(petaSql[k]);
  });

  it("badge: kategori lama tetap warnanya, baru per kelompok akun", () => {
    expect(badgeKategoriPengeluaran("Operasional")).toBe("b");
    expect(badgeKategoriPengeluaran("Listrik")).toBe("g");
    expect(badgeKategoriPengeluaran("Marketing")).toBe("pu");
    expect(badgeKategoriPengeluaran("ATK")).toBe("o");
    expect(badgeKategoriPengeluaran("Tak dikenal")).toBe("x");
  });
});
