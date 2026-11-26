import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Pemindai sebaran peran ADMIN_UMUM (permintaan Andri 26 Nov 2026).
// Setiap daftar peran literal yang menyebut "ADMIN" HARUS memuat "ADMIN_UMUM" juga, atau terdaftar di PENGECUALIAN dengan alasan.
// Setiap perbandingan langsung role ===/!== "ADMIN" juga harus lewat isAdminRole(), atau terdaftar di PENGECUALIAN.
// Tujuan: ADMIN_UMUM tidak diam-diam tertinggal di satu tempat (kehilangan akses) dan tidak diam-diam melebihi ADMIN.

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

/** file (relatif ke akar repo) -> potongan teks baris yang dikecualikan -> alasan */
const PENGECUALIAN: Record<string, Record<string, string>> = {
  "src/lib/persetujuan.ts": {
    "PERAN_PENYETUJU =": "approval_rules.penyetuju_role hanya OWNER/ADMIN/FINANCE (CHECK database). Admin Umum memakai antrean ADMIN lewat peranPenyetujuEfektif().",
  },
  "src/lib/inpatient.ts": { "export type Role": "tipe peran: ADMIN_UMUM ditambahkan sebagai anggota tipe union, bukan daftar akses" },
  "src/app/(app)/crm/promo/paket/loadPaketPage.ts": { "role:": "tipe/nilai tampilan Manager OWNER|ADMIN dari akses.isOwner; bukan pagar akses (pagar ada di lib/akses-paket)" },
  "src/app/(app)/crm/promo/paket/PaketEditor.tsx": { "type Role": "tipe tampilan OWNER|ADMIN pada editor paket promo; bukan pagar akses" },
  "src/app/(app)/pengaturan/akses-grup/page.tsx": { 'peran && editableRole(sp.peran) ? sp.peran : "ADMIN"': "peran awal yang ditampilkan di Akses Grup; bukan pagar" },
  "src/app/(app)/pengaturan/pengguna/page.tsx": { '<option value="ADMIN">': "hanya OWNER yang bisa memberi peran ADMIN; opsi ADMIN_UMUM ada tepat di bawahnya" },
};

function* berkas(dir: string): Generator<string> {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    const st = statSync(p);
    if (st.isDirectory()) { if (nama === "node_modules" || nama === "__tests__" || nama === "fixtures") continue; yield* berkas(p); } else if (/\.(ts|tsx|mts)$/.test(nama) && !/\.test\.(ts|tsx)$/.test(nama)) yield p;
  }
}

const KUTIP = /["']ADMIN["']/;
const DAFTAR = /\[[^\]\n]*["']ADMIN["'][^\]\n]*\]/g; // literal array satu baris yang memuat "ADMIN"
const BANDING = /(===|!==|==|!=)\s*["']ADMIN["']|["']ADMIN["']\s*(===|!==|==|!=)/;

function dikecualikan(rel: string, baris: string): string | null {
  const t = PENGECUALIAN[rel];
  if (!t) return null;
  for (const [potongan, alasan] of Object.entries(t)) if (baris.includes(potongan)) return alasan;
  return null;
}

type Temuan = { rel: string; no: number; jenis: string; baris: string };

function pindai(): { temuan: Temuan[]; sudah: number; dikecualikan: number } {
  const temuan: Temuan[] = []; let sudah = 0, dik = 0;
  for (const f of berkas(SRC)) {
    const rel = relative(ROOT, f);
    if (rel === "src/lib/peran-admin.ts") continue; // berkas definisi pembantu ADMIN/ADMIN_UMUM itu sendiri
    const baris = readFileSync(f, "utf8").split("\n");
    baris.forEach((b, i) => {
      if (!KUTIP.test(b)) return;
      const ket = dikecualikan(rel, b);
      for (const m of b.match(DAFTAR) ?? []) {
        if (/["']ADMIN_UMUM["']/.test(m)) sudah++;
        else if (ket) dik++;
        else temuan.push({ rel, no: i + 1, jenis: "daftar", baris: b.trim() });
      }
      if (BANDING.test(b)) { if (ket) dik++; else temuan.push({ rel, no: i + 1, jenis: "banding", baris: b.trim() }); }
      // sisa literal "ADMIN" lain (object key, tipe, dst.): wajib punya padanan ADMIN_UMUM di baris sama, atau pengecualian
      if (!(b.match(DAFTAR)?.length) && !BANDING.test(b) && !/["']ADMIN_UMUM["']/.test(b)) { if (ket) dik++; else temuan.push({ rel, no: i + 1, jenis: "lain", baris: b.trim() }); }
    });
  }
  return { temuan, sudah, dikecualikan: dik };
}

describe("sebaran ADMIN_UMUM di kode aplikasi", () => {
  const hasil = pindai();
  it("tidak ada daftar peran / perbandingan peran yang menyebut ADMIN tetapi lupa ADMIN_UMUM (kecuali pengecualian tertulis)", () => {
    expect(hasil.temuan.map((t) => `${t.rel}:${t.no} [${t.jenis}] ${t.baris}`)).toEqual([]);
  });
  it("pemindai benar-benar menemukan banyak daftar yang sudah memuat ADMIN_UMUM (bukan pemindai kosong)", () => {
    expect(hasil.sudah).toBeGreaterThanOrEqual(40);
  });
  it("setiap pengecualian punya alasan dan masih dipakai (tidak basi)", () => {
    for (const [rel, t] of Object.entries(PENGECUALIAN)) {
      const isi = readFileSync(join(ROOT, rel), "utf8");
      for (const [potongan, alasan] of Object.entries(t)) {
        expect(alasan.length).toBeGreaterThan(15);
        expect(isi.includes(potongan), `${rel}: pengecualian basi "${potongan}"`).toBe(true);
      }
    }
  });
  it("pemindai menangkap contoh pelanggaran (mutan)", () => {
    expect(DAFTAR.test('const x = ["OWNER", "ADMIN", "FINANCE"]')).toBe(true);
    DAFTAR.lastIndex = 0;
    expect(BANDING.test('if (profile.role === "ADMIN")')).toBe(true);
    expect(BANDING.test('if (isAdminRole(profile.role))')).toBe(false);
  });
});
