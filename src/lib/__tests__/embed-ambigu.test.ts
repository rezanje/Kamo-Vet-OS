import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Tabel yang punya DUA jalur ke tabel lain. Embed PostgREST tanpa `!nama_fk`
// gagal total (PGRST201) dan halamannya kosong/diam-diam error — kejadian nyata:
// daftar Permintaan Barang kosong setelah kolom gudang Transit ditambahkan,
// laporan Tenaga Penjual gagal karena karyawan punya cabang utama + penugasan.
// Tambah pasangan baru di sini setiap kali migrasi menambah FK kedua.
const AMBIGU: [string, string][] = [
  ["stock_requests", "warehouses"],
  ["employees", "branches"],
  ["invoices", "invoice_payments"],
  ["invoice_payments", "invoices"],
  ["invoice_items", "items"],
  ["staff_reward_redemptions", "profiles"],
  ["goods_receipts", "profiles"],
  ["expenses", "profiles"],
  // Kwitansi klinik: dibuat oleh satu orang, dibatalkan orang lain, dan punya shift
  // pembuat + shift pembatal. Keduanya dua jalur ke tabel yang sama.
  ["clinic_payment_receipts", "profiles"],
  ["clinic_payment_receipts", "cashier_shifts"],
];

const SRC = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

it("embed ke tabel yang punya dua relasi selalu memakai !nama_fk", () => {
  const masalah: string[] = [];
  for (const file of files(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const [asal, tujuan] of AMBIGU) {
      const from = new RegExp(`\\.from\\(\\s*["']${asal}["']\\s*\\)`, "g");
      for (const m of src.matchAll(from)) {
        const jendela = src.slice(m.index! + m[0].length, m.index! + m[0].length + 1500);
        const sel = jendela.match(/\.select\(\s*(["`'])([\s\S]*?)\1/)?.[2] ?? "";
        // tujuan( langsung di level atas select, tanpa !hint
        if (new RegExp(`(^|[,\\s(:])${tujuan}\\s*\\(`).test(sel)) masalah.push(`${relative(SRC, file)}: ${asal} → ${tujuan}`);
      }
    }
  }
  expect(masalah).toEqual([]);
});

it("embed bertingkat employees(… branches(…)) juga memakai !employees_branch_id_fkey", () => {
  const masalah = files(SRC).filter((file) => /employees(![a-z_]+)?\(([^()]|\([^()]*\))*\bbranches\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
  expect(masalah).toEqual([]);
});
