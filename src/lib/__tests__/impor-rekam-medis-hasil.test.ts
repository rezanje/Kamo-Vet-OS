import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// RS-1: layar impor membaca hasil impor riwayat bersama di cabang aktif lewat RPC baca-saja yang
// dibatasi database. Perilaku database diuji di scripts/test-impor-rekam-medis-rls-postgres.py; di
// sini server action ASLI (Supabase diganti) dan invarian teks migrasinya.
const s = vi.hoisted(() => ({
  role: "OWNER" as string | null,
  panggilan: [] as Array<{ name: string; args: Record<string, unknown> }>,
  data: [] as unknown,
  rpcError: "",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: s.role ? { id: "aktor" } : null } }) },
    from() {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: s.role } }) };
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.panggilan.push({ name, args });
      return s.rpcError ? { data: null, error: { message: s.rpcError } } : { data: s.data, error: null };
    },
  }),
}));

import { periksaHasilImporRekamMedis } from "@/app/(app)/klinik/rekam-medis/impor/actions";
import { barisHasilImpor, catatKunciTersimpan, kunciPeriksaHasil, MAKS_PERIKSA_HASIL_REKAM_MEDIS, ringkasIsiKlinis } from "@/lib/impor-rekam-medis-hasil";

const hasil = (kunci: string, ubah: Record<string, unknown> = {}) => ({
  kunci, visit_id: `kunjungan-${kunci}`, jejak_tersimpan: kunci, tanggal: "2026-01-14T17:00:00+00:00", pemilik: "Pemilik Fiktif",
  hewan: "Anabul Fiktif", dokter: null, keluhan: null, diagnosis: "Diagnosis fiktif", anamnesis: null, gejala_klinis: null, terapi: null, ...ubah,
});

beforeEach(() => {
  s.role = "OWNER";
  s.panggilan = [];
  s.data = [];
  s.rpcError = "";
});

describe("kunci untuk periksa hasil", () => {
  it("dirapikan, unik, dan yang kosong/terlalu panjang dibuang", () => {
    expect(kunciPeriksaHasil([" a ", "a", "", "b", "x".repeat(501), 7])).toEqual(["a", "b"]);
  });
  it("menolak kosong dan lebih dari 500 sebelum memanggil database", () => {
    expect(() => kunciPeriksaHasil([])).toThrow(/Belum ada/);
    expect(() => kunciPeriksaHasil("a")).toThrow(/tidak terbaca/);
    expect(() => kunciPeriksaHasil(Array.from({ length: 501 }, (_, i) => `k${i}`))).toThrow(/500/);
    expect(kunciPeriksaHasil(Array.from({ length: 500 }, (_, i) => `k${i}`))).toHaveLength(500);
  });
  it("daftar di tab menyimpan yang terakhir, unik, dibatasi", () => {
    expect(catatKunciTersimpan(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(catatKunciTersimpan(["a", "b"], ["a"])).toEqual(["b", "a"]);
    const banyak = catatKunciTersimpan([], Array.from({ length: MAKS_PERIKSA_HASIL_REKAM_MEDIS + 5 }, (_, i) => `k${i}`));
    expect(banyak).toHaveLength(MAKS_PERIKSA_HASIL_REKAM_MEDIS);
    expect(banyak[0]).toBe("k5");
  });
  it("jawaban database dibaca aman dan diringkas", () => {
    expect(() => barisHasilImpor(null)).toThrow();
    expect(barisHasilImpor([hasil("a"), { kunci: 1 }, null])).toHaveLength(1);
    expect(ringkasIsiKlinis(barisHasilImpor([hasil("a", { diagnosis: null, anamnesis: "  Anamnesis\n fiktif " })])[0])).toBe("Anamnesis fiktif");
    expect(ringkasIsiKlinis(barisHasilImpor([hasil("a", { diagnosis: null })])[0])).toBe("—");
  });
});

describe("server action periksaHasilImporRekamMedis", () => {
  it("memanggil RPC baca-saja dengan jejak tervalidasi dan melaporkan yang ditemukan", async () => {
    s.data = [hasil("a"), hasil("b")];
    const jawab = await periksaHasilImporRekamMedis(["a", "b", "a", "c"]);
    expect(s.panggilan).toEqual([{ name: "hasil_impor_rekam_medis", args: { p_keys: ["a", "b", "c"] } }]);
    expect(jawab).toMatchObject({ ok: true, diminta: 3, message: "2 dari 3 riwayat ditemukan di riwayat bersama." });
    expect(jawab.rows.map((row) => row.kunci)).toEqual(["a", "b"]);
  });
  it("hanya OWNER/ADMIN; peran lain tidak memanggil database", async () => {
    s.role = "STAFF";
    expect(await periksaHasilImporRekamMedis(["a"])).toMatchObject({ ok: false, rows: [] });
    expect(s.panggilan).toEqual([]);
  });
  it("lebih dari 500 jejak ditolak tanpa memanggil database", async () => {
    expect((await periksaHasilImporRekamMedis(Array.from({ length: 501 }, (_, i) => `k${i}`))).ok).toBe(false);
    expect(s.panggilan).toEqual([]);
  });
  it("galat database diteruskan, fungsi belum terpasang diberi pesan jelas", async () => {
    s.rpcError = "Cabang aktif tidak valid atau tidak boleh diakses untuk impor rekam medis";
    expect(await periksaHasilImporRekamMedis(["a"])).toMatchObject({ ok: false, message: expect.stringContaining("Cabang aktif") });
    s.rpcError = "Could not find the function public.hasil_impor_rekam_medis";
    expect(await periksaHasilImporRekamMedis(["a"])).toMatchObject({ ok: false, message: expect.stringContaining("Database belum diperbarui") });
  });
});

describe("migrasi penulis riwayat bersama (invarian teks; perilaku diuji di harness Postgres)", () => {
  const SQL = readFileSync("supabase/migrations/20261101120000_impor_penulis_riwayat_bersama.sql", "utf8");
  it("role sempit tanpa bypass RLS, gagal tertutup bila sudah ada", () => {
    expect(SQL).toContain("create role kamo_legacy_import_writer nologin noinherit nobypassrls nocreatedb nocreaterole noreplication;");
    expect(SQL).toContain("role kamo_legacy_import_writer sudah ada");
    expect(SQL).not.toMatch(/\bbypassrls\b(?<!nobypassrls)/i);
    expect(SQL).not.toMatch(/service_role\s*(?:to|,)/i);
    expect(SQL).not.toMatch(/disable row level security/i);
  });
  it("RPC publik tetap SECURITY INVOKER dan menulis kunjungan hanya lewat penulis", () => {
    expect(SQL).toContain("create function public.hasil_impor_rekam_medis(p_keys text[])");
    expect(SQL.match(/language sql stable security invoker set search_path = '' as \$\$\n  select \* from kamo_import\.baca_hasil_impor\(p_keys\)/g)).toHaveLength(1);
    expect(SQL.match(/security invoker\nset search_path = ''/g) ?? []).toHaveLength(2);
    expect(SQL).toContain("return kamo_import.simpan_riwayat_bersama(v_row, v_customer_id, v_pet_id);");
    expect(SQL.match(/insert into public\.visits\(/g) ?? []).toHaveLength(1);
  });
  it("penulis tidak menerima sidik dari pemanggil dan tidak bisa mengisi cabang/tautan lanjutan", () => {
    expect(SQL).toContain("v_hash := public.import_legacy_row_hash(p_row);");
    expect(SQL).not.toContain("p_row ->> 'legacy_source_hash'");
    expect(SQL).not.toMatch(/grant insert \([^)]*\b(branch_id|continued_from_visit_id|continued_from_record_id)\b/);
  });
  it("pencarian jejak tidak membocorkan kecocokan di cabang yang tidak terjangkau dan semua jalur menahannya", () => {
    expect(SQL).toContain("where v.branch_id is not null and public.user_can_access_branch(v.branch_id) is not true");
    expect(SQL).toContain("return query select null::uuid, null::text, true;");
    // Penulis, RPC per baris, dan kedua jalur RPC massal memeriksa tanda terkunci sebelum apa pun.
    expect(SQL.match(/\n\s+if v_terkunci then\n/g) ?? []).toHaveLength(4);
    expect(SQL).toContain("from kamo_import.cari_jejak(v_key, v_phone) m;");
  });
  it("D2 menutup semua tabel anak kunjungan yang bisa ditulis authenticated", () => {
    for (const tabel of ["visits", "medical_records", "prescription_items", "compounding_recipes", "compounding_ingredients", "consents",
      "inpatient_records", "inpatient_medications", "inpatient_daily_logs", "inpatient_status_log", "inpatient_med_doses",
      "visit_operational_events", "visit_referrals", "bookings", "follow_ups", "clinic_record_addenda", "clinic_record_corrections", "invoice_edit_log"]) {
      expect(SQL).toContain(`    ('${tabel}',`);
    }
    expect(SQL).toContain("as restrictive for insert to authenticated");
    expect(SQL).toContain("as restrictive for update to authenticated using (%s) with check (%s)");
    expect(SQL).toContain("as restrictive for delete to authenticated");
  });
  it("hak EXECUTE diberikan sebelum pindah pemilik, lalu gerbang pasca-cek", () => {
    const grant = SQL.indexOf("grant execute on function\n  kamo_import.pastikan_pengimpor()");
    const owner = SQL.indexOf("alter function %s owner to kamo_legacy_import_writer");
    const gate = SQL.indexOf("do $gerbang$");
    expect(grant).toBeGreaterThan(0);
    expect(owner).toBeGreaterThan(grant);
    expect(gate).toBeGreaterThan(owner);
    expect(SQL).toContain("revoke kamo_legacy_import_writer from %I granted by %I");
    expect(SQL).toContain("revoke create on schema kamo_import from kamo_legacy_import_writer;");
  });
});
