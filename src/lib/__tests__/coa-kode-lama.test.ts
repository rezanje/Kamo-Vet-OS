import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Bagan akun baru (20261105010000): kode sistem 4 angka lama sudah diganti kode 6 angka.
// Kode lama yang muncul lagi di aplikasi atau di migrasi sesudahnya akan mencari akun yang
// tidak ada lagi — postJournal berhenti diam-diam, RPC gagal. Tes ini menjaga pintu itu.
const ROOT = join(__dirname, "../../..");
const KODE_LAMA = ["1101", "1102", "1105", "1201", "1202", "1203", "1301", "1302", "1303", "1401", "1501", "1509",
  "2101", "2102", "2103", "2201", "2301", "3101", "3201", "4101", "4102", "4201", "4301", "4302", "4303", "5101",
  "5201", "5301", "5302", "5303", "5304", "5305", "5401", "5501", "5601", "5602", "5901", "5902"];
const LITERAL = new RegExp(`(["'\`])(${KODE_LAMA.join("|")})\\1`);

function berkas(dir: string, cocok: (p: string) => boolean): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) return nama === "__tests__" || nama === "node_modules" ? [] : berkas(p, cocok);
    return cocok(p) ? [p] : [];
  });
}

describe("bagan akun baru: kode akun lama tidak boleh kembali", () => {
  it("kode aplikasi tidak menulis kode akun lama", () => {
    const pelanggar = berkas(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => LITERAL.test(readFileSync(p, "utf8")))
      .map((p) => relative(ROOT, p));
    expect(pelanggar).toEqual([]);
  });

  it("migrasi sesudah bagan akun baru tidak menulis kode akun lama", () => {
    const dir = join(ROOT, "supabase/migrations");
    const pelanggar = readdirSync(dir)
      .filter((n) => n.endsWith(".sql") && n > "20261105010000_coa_bagan_baru.sql")
      .filter((n) => LITERAL.test(readFileSync(join(dir, n), "utf8")));
    expect(pelanggar).toEqual([]);
  });
});
