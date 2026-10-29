import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Impor rekam medis 2026-10-29: satu transaksi per potongan, bukan satu RPC per baris.
// Tanpa database di CI, invarian penyimpanannya diperiksa dari teks migrasinya.
const NAMA = "20261031210000_impor_rekam_medis_massal.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const LAMA = readFileSync("supabase/migrations/20260910033000_import_medical_identity_resolution.sql", "utf8");

describe("simpan massal rekam medis lama", () => {
  it("memakai ulang fungsi impor per baris, bukan menyalin aturannya", () => {
    expect(SQL).toContain("create function public.import_legacy_medical_records_bulk(p_rows jsonb)");
    expect(SQL).toContain("v_visit := public.import_legacy_medical_record_resolved(");
    // Urutan argumen harus mengikuti tanda tangan yang sudah ada di migrasi lama.
    for (const kolom of ["record_no", "record_date", "owner_name", "phone", "address", "patient_name",
      "species", "breed", "gender", "dob", "doctor", "note", "anamnesis", "clinical_findings",
      "diagnosis", "therapy", "customer_id", "pet_id"]) {
      expect(SQL).toContain(`v_row->>'${kolom}'`);
    }
  });

  it("memeriksa peran yang sama dengan fungsi per baris dan tetap SECURITY INVOKER", () => {
    expect(SQL).toContain("if auth.uid() is null or not public.is_admin() then");
    expect(LAMA).toContain("if auth.uid() is null or not public.is_admin() then");
    expect(SQL).not.toContain("security definer");
    expect(SQL.match(/security invoker/g) ?? []).toHaveLength(2);
    expect(SQL).toContain("revoke all on function public.import_legacy_medical_records_bulk(jsonb) from public, anon;");
    expect(SQL).toContain("grant execute on function public.import_legacy_medical_records_bulk(jsonb) to authenticated;");
    expect(SQL).toContain("set search_path = ''");
  });

  it("melewati riwayat yang sudah pernah diimpor tanpa menulis ulang", () => {
    expect(SQL).toContain("select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;");
    expect(SQL).toContain("v_status := 'sudah_ada';");
  });

  it("kiriman berbarengan yang kalah di indeks unik dilaporkan sudah ada, bukan gagal", () => {
    const blok = SQL.slice(SQL.indexOf("exception when others then"), SQL.indexOf("v_hasil := v_hasil ||"));
    expect(blok).toContain("select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;");
    expect(blok).toContain("v_status := 'sudah_ada';");
    expect(blok).toContain("v_status := 'ditahan';");
    expect(blok).toContain("v_reason := sqlerrm;");
  });

  it("satu baris bermasalah tidak membatalkan baris lain dalam transaksi yang sama", () => {
    const badan = SQL.slice(SQL.indexOf("for v_row in select value from jsonb_array_elements(p_rows) loop"));
    expect(badan.indexOf("begin")).toBeLessThan(badan.indexOf("exception when others then"));
    expect(badan).toContain("end loop;");
  });

  it("mengembalikan status per baris supaya layar bisa menghitung tersimpan/sudah ada/ditahan", () => {
    expect(SQL).toContain("'source_key', v_key,");
    expect(SQL).toContain("'status', v_status,");
    expect(SQL).toContain("'reason', v_reason,");
    expect(SQL).toContain("'visit_id', v_visit");
  });

  it("membatasi ukuran kiriman supaya satu transaksi tidak melewati batas waktu", () => {
    expect(SQL).toContain("if v_jumlah > 500 then");
    expect(SQL).toContain("set statement_timeout = '30s'");
  });
});

describe("pemindaian identitas per potongan", () => {
  it("mengembalikan riwayat yang sudah ada dan calon pemilik dalam satu panggilan", () => {
    expect(SQL).toContain("create function public.import_legacy_identity_scan(");
    expect(SQL).toContain("where v.legacy_source_key = any(v_sources)");
    expect(SQL).toContain("jsonb_build_object('sudah_ada', v_sudah_ada, 'customers', v_customers, 'pets', v_pets)");
  });

  it("menyaring calon lebih luas daripada aturan aplikasi: nama ATAU telepon", () => {
    expect(SQL).toContain("where public.import_legacy_text_key(c.name) = any(v_owners)");
    expect(SQL).toContain("or public.import_legacy_phone_key(c.phone) = any(v_phones)");
    expect(SQL).toContain("from public.pets p where p.customer_id in (select id from calon)");
  });

  it("kunci normalisasi database mengikuti aturan yang sama dengan aplikasi", () => {
    expect(SQL).toContain("create function public.import_legacy_text_key(p text) returns text");
    expect(SQL).toContain("create function public.import_legacy_phone_key(p text) returns text");
    expect(SQL).toContain("'\\D', '', 'g'");
    expect(SQL).toContain("language sql immutable set search_path = ''");
  });

  it("memberi indeks supaya penyaring calon tidak memindai penuh tabel yang terus tumbuh", () => {
    expect(SQL).toContain("create index if not exists customers_import_name_key_idx");
    expect(SQL).toContain("create index if not exists customers_import_phone_key_idx");
  });

  it("membatasi jumlah kunci per pemeriksaan", () => {
    expect(SQL).toContain("raise exception 'Terlalu banyak kunci dalam satu pemeriksaan impor'");
  });
});

describe("penjaga migrasi", () => {
  it("gagal tertutup bila fungsi lama berubah atau penjaganya hilang", () => {
    expect(SQL).toContain("pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure)");
    expect(SQL).toContain("pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure)");
    expect(SQL).toContain("raise exception 'Fungsi impor per baris berubah; penjaga anti-ganda hilang'");
  });

  it("tidak mengubah satu pun migrasi lama", () => {
    expect(LAMA).toContain("create or replace function public.import_legacy_medical_record_resolved(");
    expect(SQL).not.toContain("import_legacy_medical_record_resolved(\n  p_source_key text");
  });
});
