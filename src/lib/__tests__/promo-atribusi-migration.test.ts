import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Atribusi promo klinik + impor daftar promo hidup di satu migrasi maju. Tanpa
// database di CI, invariannya diperiksa dari teks migrasinya: jangkar eksak,
// kolom yang ditulis, pengaman nilai, dan hak akses RPC impor.
const NAMA = "20261104150000_promo_atribusi_klinik_dan_impor_daftar.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const potong = (awal: string, akhir: string) => SQL.slice(SQL.indexOf(awal), SQL.indexOf(akhir));

describe("urutan dan gaya migrasi", () => {
  it("dipasang setelah kunci tulis master promo dan memakai jangkar eksak", () => {
    const semua = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
    expect(semua).toContain(NAMA);
    expect(NAMA > "20261031090000_promo_voucher_manager_only_rls.sql").toBe(true);
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("jangkar harus muncul tepat sekali");
    // Semua tambalan satu fungsi dikumpulkan dulu, lalu dikompilasi sekali.
    expect(SQL).toContain("pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));");
    expect(SQL).toContain("do $check$");
  });

  it("menambal ketiga jalur tulis baris tagihan klinik", () => {
    for (const sig of [
      "public.clinic_post_invoice(uuid,text,jsonb,jsonb)",
      "public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)",
      "public.clinic_void_reissue_invoice_core(uuid,text,text)",
    ]) {
      expect(SQL).toContain(`('${sig}',`);
    }
  });
});

describe("kolom atribusi", () => {
  const kolom = potong("alter table public.invoice_items", "-- 2. Posting, koreksi");
  it("nullable dengan sengaja supaya tagihan lama terbaca sebagai tidak tercatat", () => {
    expect(kolom).toContain("add column if not exists promo_id uuid references public.promos(id) on delete set null");
    expect(kolom).toContain("add column if not exists promo_discount numeric(15,2)");
    expect(kolom).toContain("add column if not exists voucher_discount numeric(15,2)");
    expect(kolom).toContain("add column if not exists diskon_kategori numeric(15,2)");
    expect(kolom).not.toContain("not null default 0");
  });
  it("menolak potongan negatif dan potongan tanpa promo", () => {
    expect(kolom).toContain("check (promo_discount is null or (promo_discount >= 0 and (promo_discount = 0 or promo_id is not null)))");
    expect(kolom).toContain("voucher_discount is null or voucher_discount >= 0");
    expect(kolom).toContain("diskon_kategori is null or diskon_kategori >= 0");
  });
});

describe("posting tagihan klinik", () => {
  it("menyimpan promo per baris dan potongan program di kepala invoice", () => {
    expect(SQL).toContain("promo_id, promo_discount");
    expect(SQL).toContain("voucher_discount, diskon_kategori");
    expect(SQL).toContain("nullif(p_invoice->>''voucher_discount'','''')::numeric(15,2)");
    expect(SQL).toContain("nullif(p_invoice->>''diskon_kategori'','''')::numeric(15,2)");
  });
  it("menolak potongan promo yang melebihi barisnya atau tanpa promo yang ada", () => {
    expect(SQL).toContain("LINE_INVALID: potongan promo baris tidak valid");
    expect(SQL).toContain("v_promo_discount > v_line_amount");
    expect(SQL).toContain("select 1 from public.promos p where p.id = v_promo_id");
  });
  it("menjaga jumlah atribusi tidak melebihi diskon invoice", () => {
    expect(SQL).toContain("INVOICE_INVALID: rincian potongan melebihi diskon invoice");
    expect(SQL).toContain("v_attributed > v_discount");
  });
});

describe("koreksi dan terbit ulang mempertahankan atribusi (S-4)", () => {
  it("koreksi membawa promo baris asal dan membatasinya pada nilai baris baru", () => {
    expect(SQL).toContain("S-4: koreksi mempertahankan atribusi program dari baris asalnya.");
    expect(SQL).toContain("jsonb_object_agg(id::text,jsonb_build_object(''promo_id'',promo_id,''promo_discount'',promo_discount))");
    expect(SQL).toContain("nullif(v_promo_old->nullif(v_line->>''source_invoice_item_id'','''')->>''promo_id'','''')::uuid");
    // NULL pada baris lama tetap NULL: tagihan lama tidak diubah jadi "nol rupiah".
    expect(SQL).toContain("->>''promo_discount'' is null then null");
    expect(SQL).toContain("v_promo_scale := v_discount/v_attributed");
  });
  it("potongan program ikut dikecilkan bersama barisnya, bukan dihapus", () => {
    expect(SQL).toContain("voucher_discount=case when voucher_discount is null then null else round(voucher_discount*v_promo_scale,2) end");
    expect(SQL).toContain("diskon_kategori=case when diskon_kategori is null then null else round(diskon_kategori*v_promo_scale,2) end");
  });
  it("terbit ulang menyalin atribusi baris dan kepala invoice", () => {
    expect(SQL).toContain("v_invoice.voucher_discount,v_invoice.diskon_kategori)");
    expect(SQL).toContain("promo_id,promo_discount from public.invoice_items where invoice_id=p_invoice_id;");
  });
});

describe("RPC impor daftar promo", () => {
  const rpc = potong("create or replace function public.import_promo_master", "-- 4. Pemeriksaan akhir");
  it("hanya untuk owner/manajer aktif dan tidak dapat dipanggil anon", () => {
    expect(rpc).toContain("perform public.assert_promo_manager();");
    expect(rpc).toContain("security definer set search_path = ''");
    expect(SQL).toContain("revoke all on function public.import_promo_master(jsonb) from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.import_promo_master(jsonb) to authenticated;");
  });
  it("mengubah JSON null cabang menjadi array kosong sebelum ekspansi", () => {
    // Payload aplikasi memakai null untuk semua cabang. COALESCE saja tidak
    // mengubah JSON null menjadi SQL NULL; jsonb_array_elements_text menolak scalar.
    expect(rpc).toContain("coalesce(nullif(v_entry -> 'branch_ids', 'null'::jsonb), '[]'::jsonb)");
  });
  it("memperbarui promo bernama sama beserta daftar barangnya, bukan menggandakan", () => {
    expect(rpc).toContain("select * into v_existing from public.promos p where lower(btrim(p.name)) = lower(v_name) for update;");
    expect(rpc).toContain("delete from public.promo_items pi where pi.promo_id = v_existing.id and not (pi.item_id = any(v_item_ids));");
    expect(rpc).toContain("perform pg_advisory_xact_lock(hashtextextended('vetos:promo-master:' || lower(v_name), 0));");
  });
  it("menolak isian yang tidak masuk akal dan target yang dikunci impor per-SKU", () => {
    expect(rpc).toContain("Impor daftar promo harus berisi 1 sampai 50 promo");
    expect(rpc).toContain("Maksimal 500 baris barang per berkas");
    expect(rpc).toContain("v_entry ->> 'discount_type' = 'percent' and v_discount_value > 100");
    expect(rpc).toContain("Ada barang promo % yang tidak dikenal atau nonaktif");
    expect(rpc).toContain("Cabang promo % tidak tersedia atau tidak dapat diakses");
    expect(rpc).toContain("from public.promo_import_targets t where t.promo_id = v_existing.id");
    expect(rpc).toContain("memakai perhitungan total per paket");
    expect(rpc).toContain("Nama promo muncul dua kali dalam satu berkas");
  });
});
