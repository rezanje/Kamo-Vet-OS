// B3 (meeting 12 Nov 2026, keputusan A): pembatalan struk petshop & void/terbit ulang nota klinik dibukukan di tanggal transaksi asli.
// Pesan penolakan pagar tanggal asli harus terbaca jelas di layar klinik, dan kalimatnya sinkron dengan migrasi.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClinicPostingError } from "../klinik-posting";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261114141422_b3_jurnal_batal_tanggal_asli.sql"), "utf8");
const err = (message: string) => ({ code: "P0001", message });

describe("B3: pesan penolakan void & terbit ulang / koreksi nota pengganti", () => {
  it("periode tertutup, rekonsiliasi bank, penggajian: kalimat database diteruskan apa adanya + 'Belum ada yang tersimpan'", () => {
    const periode = "PERIODE_TERKUNCI: Periode akuntansi sampai 11/11/2026 sudah ditutup, jadi pembatalan tidak bisa dibukukan di tanggal transaksi asli (11/11/2026). Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku";
    expect(parseClinicPostingError(err(periode))).toBe(periode.slice("PERIODE_TERKUNCI: ".length) + ". Belum ada yang tersimpan.");
    expect(parseClinicPostingError(err("REKONSILIASI_TERKUNCI: Rekonsiliasi bank sudah mencakup tanggal transaksi asli (11/11/2026) pada rekening transaksi ini"))).toMatch(/^Rekonsiliasi bank sudah mencakup.*Belum ada yang tersimpan\.$/);
    expect(parseClinicPostingError(err("GAJI_SUDAH_DIBUAT: Penggajian bulan 11/2026 sudah dibuat, jadi transaksi tanggal 11/11/2026 tidak bisa dibatalkan atau dikoreksi sekarang"))).toMatch(/^Penggajian bulan 11\/2026 sudah dibuat.*Belum ada yang tersimpan\.$/);
  });
  it("kode yang dipakai migrasi sama dengan yang dikenali layar klinik", () => {
    for (const code of ["PERIODE_TERKUNCI", "REKONSILIASI_TERKUNCI", "GAJI_SUDAH_DIBUAT"]) expect(sql).toContain(`v_code:='${code}'`);
  });
  it("migrasi: satu transaksi, tanpa begin/commit sendiri, tambalan berjangkar bertanda B3_TANGGAL_ASLI di tiga fungsi", () => {
    expect(sql.split("\n").slice(0, 3).join("\n")).toContain("Apply as ONE transaction");
    expect(sql.split("\n").filter((l) => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    for (const fn of ["cancel_posted_sale(uuid,integer,text,text)", "clinic_void_reissue_invoice_core(uuid,text,text)", "clinic_edit_invoice_core(uuid,text,jsonb,jsonb)"]) {
      expect(sql).toContain(`select pg_temp.patch('public.${fn}'`);
    }
    expect(sql.toLowerCase()).not.toContain("create or replace function");
  });
});
