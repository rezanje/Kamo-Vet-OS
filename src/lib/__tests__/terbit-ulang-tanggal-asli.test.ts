import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tanpa database di CI, invarian SQL-nya diperiksa dari teks migrasi.
const NAMA = "20261111035704_terbit_ulang_tanggal_asli.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");

describe("migrasi: nota terbit ulang memakai tanggal transaksi asli", () => {
  it("terpasang sesudah migrasi terakhir yang menulis ulang clinic_void_reissue_invoice_core", () => {
    const semua = readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort();
    const penulis = semua.filter(n => n !== NAMA && readFileSync(`supabase/migrations/${n}`, "utf8")
      .includes("clinic_void_reissue_invoice_core"));
    expect(penulis.length).toBeGreaterThan(0);
    expect(NAMA > penulis[penulis.length - 1]).toBe(true);
  });

  it("nota pengganti mewarisi created_at (+1 ms, urutan riwayat tetap) dan paid_at nota sumber", () => {
    expect(SQL).toContain("v_invoice.created_at + interval ''1 millisecond''");
    expect(SQL).toContain("coalesce(v_invoice.paid_at,now())");
    expect(SQL).toContain("service_pricing_version,created_at)");
  });

  it("menambal dari definisi berjalan dengan jangkar tunggal, lalu memeriksa hasilnya", () => {
    expect(SQL).toContain("pg_get_functiondef(signature)");
    expect(SQL).toContain("Jangkar tidak tunggal");
    expect(SQL).toContain("do $check$");
  });

  it("jurnal tidak disentuh: pembukuan tetap di tanggal koreksi", () => {
    expect(SQL).not.toMatch(/update\s+public\.journal_entries/i);
    expect(SQL).not.toContain("clinic_write_journal(");
  });
});
