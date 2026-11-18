import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS } from "@/lib/role-grant-only-actions";
import {
  ALASAN_UBAH_DOKTER_MAX, ALASAN_UBAH_DOKTER_MIN, alasanUbahDokter, bacaBolehUbahDokterPJ, IZIN_UBAH_DOKTER_PJ, kalimatHasilUbahDokter, pesanUbahDokter, pilihanDokterBaru,
  PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI, putuskanBolehUbahDokterPJ, rakitPanelUbahDokter, ringkasanDariRpc,
} from "@/lib/ubah-dokter-pj";
import { muatPanelUbahDokter } from "@/lib/ubah-dokter-pj-server";

describe("ubah dokter PJ: izin dan alasan", () => {
  it("izin khusus: terdaftar sebagai grant-only (bawaan MATI selain Owner)", () => {
    expect(IZIN_UBAH_DOKTER_PJ).toBe("klinik.ubah_dokter_pj");
    expect(GRANT_ONLY_ACTIONS).toContain(IZIN_UBAH_DOKTER_PJ);
  });
  it("Owner tidak pernah terkunci oleh galat baca; peran lain gagal-tertutup", () => {
    expect(putuskanBolehUbahDokterPJ(null, "OWNER")).toBe(true);
    for (const role of ["ADMIN", "DOCTOR", "FINANCE", "STAFF", null, undefined]) expect(putuskanBolehUbahDokterPJ(null, role)).toBe(false);
    expect(putuskanBolehUbahDokterPJ(true, "ADMIN")).toBe(true);
    expect(putuskanBolehUbahDokterPJ(false, "OWNER")).toBe(false);
  });
  it("bacaBolehUbahDokterPJ: true/false dari database, null bila gagal atau melempar", async () => {
    expect(await bacaBolehUbahDokterPJ({ rpc: async () => ({ data: true, error: null }) })).toBe(true);
    expect(await bacaBolehUbahDokterPJ({ rpc: async () => ({ data: false, error: null }) })).toBe(false);
    expect(await bacaBolehUbahDokterPJ({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBeNull();
    expect(await bacaBolehUbahDokterPJ({ rpc: async () => { throw new Error("putus"); } })).toBeNull();
  });
  it("alasan: 5-500 huruf setelah dirapikan", () => {
    expect(alasanUbahDokter("abcd")).toBeNull();
    expect(alasanUbahDokter("   abcd   ")).toBeNull();
    expect(alasanUbahDokter("  abcde  ")).toBe("abcde");
    expect(alasanUbahDokter("a".repeat(500))).toHaveLength(500);
    expect(alasanUbahDokter("a".repeat(501))).toBeNull();
    expect(alasanUbahDokter(undefined)).toBeNull();
    expect(alasanUbahDokter(12345)).toBeNull();
  });
});

describe("ubah dokter PJ: pilihan dokter pengganti", () => {
  const staff = [
    { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter Hewan Poli" },
    { id: "aini", nama: "DRH LUTHFIAH RUSYDA AINI", jabatan: "Dokter" },
    { id: "para", nama: "ENGKOS KOSASIH", jabatan: "Paramedis" },
    { id: "groomer", nama: "Groomer Fiktif", jabatan: "Staff Toko - Groomer" },
    { id: "asisten", nama: "Asisten Dokter Fiktif", jabatan: "Asisten Dokter" },
    { id: "kosong", nama: "Tanpa Jabatan", jabatan: null },
  ];
  it("hanya yang berjabatan dokter, bukan dokter sekarang, urut nama", () => {
    expect(pilihanDokterBaru(staff, "ilham").map((d) => d.id)).toEqual(["aini"]);
    expect(pilihanDokterBaru(staff, "aini").map((d) => d.id)).toEqual(["ilham"]);
    expect(pilihanDokterBaru(staff, null).map((d) => d.id)).toEqual(["aini", "ilham"]);
  });
  it("dokter sekarang kosong (data lama) menawarkan semua dokter cabang", () => {
    expect(pilihanDokterBaru(staff, undefined).map((d) => d.id)).toEqual(["aini", "ilham"]);
  });
});

describe("ubah dokter PJ: pesan penolakan database -> kalimat", () => {
  it.each([
    ["UBAH_DOKTER_DENIED: ubah dokter PJ hanya dapat dilakukan Owner atau peran yang diberi izin", "DENIED"],
    ["UBAH_DOKTER_ALASAN: alasan wajib diisi (5-500 huruf)", "ALASAN"],
    ["UBAH_DOKTER_CABANG: kunjungan ini di cabang yang tidak dapat Anda akses", "CABANG"],
    ["UBAH_DOKTER_PILIHAN: dokter baru harus karyawan aktif", "PILIHAN"],
    ["UBAH_DOKTER_SAMA: dokter baru sama dengan dokter PJ saat ini", "SAMA"],
    ["UBAH_DOKTER_ARSIP: kunjungan sudah diarsipkan; dokternya tidak dapat diubah", "ARSIP"],
    ["UBAH_DOKTER_PAYROLL: slip gaji bulan pelunasan sudah disahkan", "PAYROLL"],
  ])("%s", (raw, kode) => {
    const t = pesanUbahDokter(raw);
    expect(t.kode).toBe(kode);
    expect(t.pesan.length).toBeGreaterThan(10);
    expect(t.pesan).not.toMatch(/UBAH_DOKTER_/);
    expect(t.perluKonfirmasi).toBe(false);
  });
  it("tagihan lunas: bagi Owner meminta konfirmasi, bagi peran lain tidak", () => {
    expect(pesanUbahDokter("UBAH_DOKTER_FINAL: tagihan lunas kunjungan ini mengikuti dokter kunjungan; komisi bulan pelunasan akan berpindah. Centang konfirmasi Owner untuk melanjutkan"))
      .toMatchObject({ kode: "FINAL", perluKonfirmasi: true });
    expect(pesanUbahDokter("UBAH_DOKTER_FINAL: tagihan kunjungan ini sudah lunas dan komisinya mengikuti dokter kunjungan; hanya Owner yang dapat mengubah dokternya"))
      .toMatchObject({ kode: "FINAL", perluKonfirmasi: false });
  });
  it("kunci permintaan terpakai: kalimat tetap, tidak membocorkan kode", () => {
    expect(pesanUbahDokter("UBAH_DOKTER_KUNCI_BEDA: x").pesan).toMatch(/Muat ulang/);
  });
  it("galat jaringan/kunci/izin tidak dikenal: tidak pernah menyatakan berhasil dan tidak membocorkan teks mentah", () => {
    expect(pesanUbahDokter("canceling statement due to lock timeout").kode).toBe("SIBUK");
    expect(pesanUbahDokter("permission denied for function clinic_change_visit_doctor").kode).toBe("DENIED");
    for (const raw of ["", null, undefined, "TypeError: fetch failed", "relation \"x\" does not exist"]) {
      const t = pesanUbahDokter(raw as string);
      expect(t).toMatchObject({ kode: "TIDAK_TERKONFIRMASI", pesan: PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI, perluKonfirmasi: false });
    }
  });
});

describe("ubah dokter PJ: ringkasan hasil", () => {
  const rpc = {
    ok: true, idempotent: false, dokter_lama_nama: "DRH. ILHAM", dokter_baru_nama: "DRH LUTHFIAH RUSYDA AINI", baris_diganti: 3, baris_tetap_tertagih: 0,
    baris_tetap_racikan: 0, baris_tetap_lain: 3, baris_tetap_tak_valid: 0, tagihan_belum_lunas_ikut: 0, tagihan_lunas_tak_berubah: 0, tagihan_lunas_digeser: 0,
  };
  it("jawaban RPC dikenali dan dijelaskan: apa yang pindah dan apa yang sengaja tidak", () => {
    const r = ringkasanDariRpc(rpc)!;
    expect(r).toMatchObject({ barisDiganti: 3, barisTetapLain: 3, dokterBaruNama: "DRH LUTHFIAH RUSYDA AINI" });
    const kalimat = kalimatHasilUbahDokter(r);
    expect(kalimat).toContain("dari DRH. ILHAM ke DRH LUTHFIAH RUSYDA AINI");
    expect(kalimat).toContain("3 baris yang belum ditagih ikut pindah");
    expect(kalimat).toContain("3 baris tetap dokter lama (3 tidak diikutkan/ditarik)");
    expect(kalimat).toContain("Catatan visit dokter yang sudah ditulis tidak berubah.");
  });
  it("tagihan lunas yang bergeser dan tagihan belum lunas disebut terang-terangan", () => {
    const kalimat = kalimatHasilUbahDokter(ringkasanDariRpc({ ...rpc, tagihan_lunas_digeser: 1, tagihan_belum_lunas_ikut: 2, baris_tetap_tertagih: 4 })!);
    expect(kalimat).toContain("2 tagihan belum lunas mengikuti dokter baru");
    expect(kalimat).toContain("1 tagihan lunas berbasis dokter kunjungan ikut pindah");
    expect(kalimat).toContain("4 sudah tertagih");
  });
  it("permintaan ulang yang sama dilaporkan sebagai idempoten", () => {
    expect(kalimatHasilUbahDokter(ringkasanDariRpc({ ...rpc, idempotent: true })!)).toContain("tidak diulang");
  });
  it("bentuk jawaban tidak dikenal = bukan berhasil", () => {
    for (const bad of [null, undefined, "ok", 1, {}, { ok: false }, { ok: true }, { ok: true, dokter_baru_nama: "" }]) expect(ringkasanDariRpc(bad)).toBeNull();
  });
});

describe("ubah dokter PJ: pemuat panel untuk layar", () => {
  const dokter = [{ id: "aini", nama: "Aini", jabatan: "Dokter" }, { id: "ilham", nama: "Ilham", jabatan: "Dokter Hewan Poli" }, { id: "p", nama: "Para", jabatan: "Paramedis" }];
  const klien = (over: { boleh?: boolean | "error" | "throw"; staff?: unknown[] } = {}) => ({
    rpc: async () => {
      if (over.boleh === "throw") throw new Error("putus");
      return over.boleh === "error" ? { data: null, error: { message: "x" } } : { data: over.boleh ?? true, error: null };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, lte: () => q, or: () => q, in: () => q, order: () => q,
        range: async () => { const data = table === "employees" ? (over.staff ?? dokter) : []; return { data, count: data.length, error: null }; },
      };
      return q;
    },
  });
  it("izin dari database + dokter cabang tanpa dokter sekarang", async () => {
    const panel = await muatPanelUbahDokter(klien({ boleh: true }), { branchId: "cabang", dokterSekarang: "ilham" });
    expect(panel.boleh).toBe(true);
    expect(panel.dokter.map((d) => d.id)).toEqual(["aini"]);
  });
  it("tanpa izin, izin tak terbaca, atau galat apa pun = tersembunyi (layar lama utuh)", async () => {
    for (const boleh of [false, "error", "throw"] as const) expect((await muatPanelUbahDokter(klien({ boleh }), { branchId: "cabang", dokterSekarang: null })).boleh).toBe(false);
    expect((await muatPanelUbahDokter(klien(), { branchId: null, dokterSekarang: null })).boleh).toBe(false);
    expect((await muatPanelUbahDokter({} as never, { branchId: "cabang", dokterSekarang: null })).boleh).toBe(false);
  });
  it("staf yang sudah dibaca layar dipakai ulang tanpa membaca lagi; rakitPanelUbahDokter sama hasilnya", async () => {
    const panel = await muatPanelUbahDokter({ rpc: async () => ({ data: true, error: null }) }, { branchId: "cabang", dokterSekarang: "aini", staff: dokter });
    expect(panel).toEqual({ boleh: true, dokter: [{ id: "ilham", nama: "Ilham", jabatan: "Dokter Hewan Poli" }] });
    expect(rakitPanelUbahDokter(true, dokter, "aini")).toEqual(panel);
    expect(rakitPanelUbahDokter(false, dokter, "aini")).toEqual({ boleh: false, dokter: [] });
    expect(rakitPanelUbahDokter(null, dokter, "aini")).toEqual({ boleh: false, dokter: [] });
  });
});

describe("ubah dokter PJ: migrasi sinkron dengan layar", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261129100000_ubah_dokter_pj.sql"), "utf8");
  it("baris katalog izin (id, enforced, grup Klinik) dan modul klinik; tanpa begin/commit sendiri", () => {
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\)\s*values \('klinik\.ubah_dokter_pj', '[^']*', 'Klinik', true\)/);
    expect(sql).toMatch(/action_modules\(id, module_id\)\s*values \('klinik\.ubah_dokter_pj', 'klinik'\)/);
    expect(sql.split("\n").filter((l) => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
  });
  it("kode penolakan yang dijanjikan layar semuanya ada di fungsi database", () => {
    for (const kode of ["AUTH", "DENIED", "INPUT", "ALASAN", "KUNCI_BEDA", "KUNJUNGAN", "CABANG", "ARSIP", "PILIHAN", "SAMA", "FINAL", "PAYROLL"]) expect(sql).toContain(`UBAH_DOKTER_${kode}:`);
  });
  it("batas alasan layar = database (5-500)", () => {
    expect(sql).toContain("c_alasan_min constant integer := 5;");
    expect(sql).toContain("length(v_reason) > 500");
    expect(ALASAN_UBAH_DOKTER_MIN).toBe(5);
    expect(ALASAN_UBAH_DOKTER_MAX).toBe(500);
  });
});
