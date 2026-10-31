// Membuat file contoh SINTETIS berbentuk sama dengan file COA pengguna (Kode | Nama Akun | Normal).
// Semua nama fiktif, tanpa nomor rekening. File asli tidak pernah diunggah ke repo.
//
//   node scripts/buat-fixture-coa-pengguna.mjs
//
// Bentuk (dari inspeksi read-only Reza, 31 Okt 2026): satu sheet "Sheet1"; baris 1–3 pembuka; judul di
// baris 4; data baris 5–208 = 204 baris; 179 kode unik, semua 6 angka; Normal Debit 150 / Kredit 54;
// kode 110001 muncul 21× dan 120001 muncul 6×, masing-masing dengan nama berbeda.
// CSV-nya deterministik. XLSX menyimpan cap waktu di dalam zip, jadi hash yang dipatok di tes adalah
// hash berkas yang di-commit (jangan dibuat ulang tanpa memperbarui hash di tes).
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const OUT = new URL("../supabase/tests/fixtures/", import.meta.url);

function baris() {
  const unik = [];
  const tambah = (prefix, n, nama, normal) => {
    for (let i = 1; i <= n; i++) unik.push([`${prefix}${String(i).padStart(2, "0")}`, `${nama} ${String(i).padStart(2, "0")}`, normal]);
  };
  // 177 kode yang muncul sekali.
  tambah("1101", 20, "Kas Operasional Fiktif", "Debit");          // 110101..
  tambah("1201", 15, "Piutang Pelanggan Fiktif", "Debit");        // 120101..
  tambah("1301", 15, "Persediaan Fiktif", "Debit");               // 130101..
  tambah("1501", 7, "Peralatan Klinik Fiktif", "Debit");          // 150101..
  tambah("1509", 3, "Akumulasi Penyusutan Fiktif", "Kredit");     // akun kontra: sisi berbeda dari usulan
  tambah("2101", 25, "Hutang Pemasok Fiktif", "Kredit");
  tambah("3101", 6, "Modal Fiktif", "Kredit");
  tambah("4101", 20, "Pendapatan Layanan Fiktif", "Kredit");
  tambah("5101", 66, "Beban Operasional Fiktif", "Debit");
  const kembarKas = Array.from({ length: 21 }, (_, i) => ["110001", `Kas Gerai Fiktif ${String.fromCharCode(65 + i)}`, "Debit"]);
  const kembarPiutang = Array.from({ length: 6 }, (_, i) => ["120001", `Piutang Mitra Fiktif ${String.fromCharCode(80 + i)}`, "Debit"]);
  // Sisipkan baris kembar tersebar supaya asal-baris benar-benar diuji.
  const semua = [...unik];
  [...kembarKas, ...kembarPiutang].forEach((r, i) => semua.splice(3 + i * 7, 0, r));
  return semua;
}

const data = baris();
const pembuka = [["DAFTAR AKUN PERKIRAAN"], ["Perusahaan Fiktif Sejahtera — contoh sintetis"], []];
const judul = ["Kode", "Nama Akun", "Normal"];

const csv = [...pembuka.map((r) => r.join(",")), judul.join(","), ...data.map((r) => r.join(","))].join("\n") + "\n";
writeFileSync(new URL("coa-pengguna-sintetis.csv", OUT), csv);

const buku = new ExcelJS.Workbook();
buku.creator = "fixture";
buku.created = buku.modified = new Date("2026-10-31T00:00:00Z");
const sheet = buku.addWorksheet("Sheet1");
pembuka.forEach((r) => sheet.addRow(r));
sheet.addRow(judul);
// Kode disimpan sebagai angka, seperti umumnya hasil ketik di Excel.
data.forEach(([kode, nama, normal]) => sheet.addRow([Number(kode), nama, normal]));
writeFileSync(new URL("coa-pengguna-sintetis.xlsx", OUT), Buffer.from(await buku.xlsx.writeBuffer()));

const kode = data.map((r) => r[0]);
console.log(JSON.stringify({
  baris: data.length, unik: new Set(kode).size,
  debit: data.filter((r) => r[2] === "Debit").length, kredit: data.filter((r) => r[2] === "Kredit").length,
  k110001: kode.filter((k) => k === "110001").length, k120001: kode.filter((k) => k === "120001").length,
}));
