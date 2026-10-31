import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelSusulan, labelSusulanRingkas } from "../rekam-medis-susulan";

// "Semua harus masuk ke rekam medis juga" (Andri 29 Okt, opsi B) hidup di satu migrasi
// maju. Tanpa database di CI, invariannya diperiksa dari teks migrasi: penjaga peran,
// cabang, keadaan kunjungan, kunci permintaan unik, ACL, dan — yang paling penting —
// bahwa pembungkus MEMANGGIL RPC posting lama, bukan menulis ulang badannya.
const NAMA = "20261104340000_item_susulan_rekam_medis.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const potong = (awal: string, akhir: string) => SQL.slice(SQL.indexOf(awal), SQL.indexOf(akhir));

describe("bentuk migrasi", () => {
  it("ada di folder migrasi dan hanya menambah, tidak menyentuh migrasi lama", () => {
    expect(readdirSync("supabase/migrations")).toContain(NAMA);
    // Tidak ada drop/alter pada fungsi atau tabel milik migrasi sebelumnya.
    expect(SQL).not.toMatch(/drop (function|table|trigger|index|policy)/i);
    expect(SQL).not.toMatch(/create or replace function public\.clinic_post_invoice\b/);
    expect(SQL).not.toMatch(/create or replace function public\.clinic_edit_invoice\b/);
    // Kolom baru nullable: baris resep lama tetap sah tanpa backfill.
    expect(SQL).toContain("add column susulan_at timestamptz");
    expect(SQL).not.toMatch(/update public\.prescription_items set/);
  });

  it("memakai kolom biasa, bukan FK kedua ke employees/profiles (aturan embed PostgREST)", () => {
    const kolom = potong("alter table public.prescription_items\n  add column susulan_at", "alter table public.prescription_items\n  add constraint");
    expect(kolom).toContain("add column susulan_by uuid,");
    expect(kolom).not.toContain("references");
    expect(SQL).toContain("PGRST201");
  });
});

describe("penanda susulan tidak dapat dikarang atau diubah", () => {
  const guard = potong("create function public.guard_prescription_susulan", "revoke all on function public.guard_prescription_susulan");
  it("menolak perubahan penanda yang sudah tersimpan", () => {
    expect(guard).toContain("SUSULAN_LOCKED: penanda item susulan tidak dapat diubah");
    expect(guard).toContain("if tg_op = 'UPDATE' then");
  });
  it("membuang penanda dari tulisan langsung aplikasi, dan hanya menerima titipan RPC", () => {
    // SECURITY INVOKER wajib: dengan DEFINER, current_user selalu pemilik fungsi dan
    // pemeriksaan di bawah tidak pernah berlaku (lihat guard_posted_clinic_invoice).
    expect(guard).toContain("language plpgsql security invoker");
    expect(guard).not.toContain("security definer");
    expect(guard).toContain("if current_user in ('authenticated','anon','service_role') then");
    expect(guard).toContain("current_setting('kamo.clinic_record_susulan', true)");
    expect(guard).toContain("not in ('dokter','kasir')");
    expect(guard).toContain("new.susulan_at := now();");
  });
  it("trigger terpasang untuk insert maupun update, dan fungsinya tertutup", () => {
    expect(SQL).toContain("create trigger clinic_prescription_susulan before insert or update on public.prescription_items");
    expect(SQL).toContain("revoke all on function public.guard_prescription_susulan() from public, anon, authenticated, service_role;");
  });
});

describe("buku kunci permintaan", () => {
  const tabel = potong("create table public.clinic_record_item_additions", "create index clinic_record_item_additions_record_idx");
  it("kunci permintaan unik dan sumbernya terbatas", () => {
    expect(tabel).toContain("request_key text primary key check (length(btrim(request_key)) between 1 and 100)");
    expect(tabel).toContain("source text not null check (source in ('dokter','kasir'))");
    expect(tabel).toContain("prescription_item_ids uuid[] not null");
  });
  it("tertutup dari aplikasi: RLS menyala, tanpa policy, semua hak dicabut", () => {
    expect(SQL).toContain("alter table public.clinic_record_item_additions enable row level security;");
    expect(SQL).toContain("revoke all on public.clinic_record_item_additions from public, anon, authenticated, service_role;");
    expect(SQL).not.toContain("create policy clinic_record_item_additions");
  });
});

describe("RPC item susulan dokter", () => {
  const rpc = potong("create function public.clinic_add_record_items", "revoke all on function public.clinic_add_record_items");
  it("memeriksa autentikasi, profil aktif, cabang, dan mengunci kunjungan lebih dulu", () => {
    expect(rpc).toContain("coalesce(auth.role(), '') <> 'authenticated'");
    expect(rpc).toContain("select 1 from public.profiles where id = v_user and is_active = true");
    expect(rpc).toContain("from public.visits where id = p_visit_id for update;");
    expect(rpc).toContain("not public.user_can_access_branch(v_visit.branch_id)");
    // Kunjungan dikunci sebelum izin dinilai, urutan yang sama dengan posting tagihan.
    expect(rpc.indexOf("for update;")).toBeLessThan(rpc.indexOf("clinic_can_correct_record"));
  });
  it("memakai syarat yang sama dengan tombol Edit rekam medis", () => {
    expect(rpc).toContain("if not public.clinic_can_correct_record(v_record_id) then");
    expect(rpc).toContain("RECORD_LOCKED:");
  });
  it("idempoten per kunci permintaan, termasuk saat isinya berbeda", () => {
    expect(rpc).toContain("where request_key = v_key for update;");
    expect(rpc).toContain("IDEMPOTENCY_CONFLICT: kunci item susulan dipakai untuk data berbeda");
    expect(rpc).toContain("v_hash := md5(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'compounds', p_compounds)::text);");
  });
  it("racikan tetap lewat fungsi peracikan yang ada — stok bahan keluar saat diracik", () => {
    for (const fn of ["clinic_issue_master_compound", "clinic_issue_official_compound", "clinic_issue_compound"]) {
      expect(rpc).toContain(`public.${fn}(`);
    }
    // Tidak ada mutasi stok/jurnal baru di RPC ini: barisnya murni catatan.
    expect(rpc).not.toContain("stock_out_fifo");
    expect(rpc).not.toContain("stock_in_fifo");
    expect(rpc).not.toContain("clinic_write_journal");
  });
  it("ACL-nya sama dengan RPC klinik lain", () => {
    expect(SQL).toContain("revoke all on function public.clinic_add_record_items(uuid,text,jsonb,jsonb) from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.clinic_add_record_items(uuid,text,jsonb,jsonb) to authenticated;");
  });
});

describe("baris tambahan kasir ditautkan, bukan digandakan", () => {
  const helper = potong("create function clinic_private.link_unrecorded_lines", "revoke all on function clinic_private.link_unrecorded_lines");
  it("hanya baris tanpa resep, tanpa racikan, dan tanpa warisan koreksi yang dicatat", () => {
    expect(helper).toContain("nullif(x.value->>'prescription_item_id', '') is null");
    expect(helper).toContain("nullif(x.value->>'recipe_id', '') is null");
    expect(helper).toContain("nullif(x.value->>'source_invoice_item_id', '') is null");
    expect(helper).toContain("if jsonb_array_length(v_pending) = 0 then return p_lines; end if;");
  });
  it("kunjungan tanpa rekam medis tetap ditagih seperti sebelumnya", () => {
    expect(helper).toContain("if v_record_id is null then return p_lines; end if;");
  });
  it("kiriman ulang memakai baris resep yang sama supaya hash invoice tetap cocok", () => {
    expect(helper).toContain("v_id := v_existing.prescription_item_ids[v_index];");
    expect(helper).toContain("IDEMPOTENCY_CONFLICT: kunci tagihan dipakai untuk rincian berbeda");
    expect(helper).toContain("cardinality(v_existing.prescription_item_ids), 0) <> jsonb_array_length(v_pending)");
  });
  it("satuan & faktor dibaca dari master supaya pemeriksaan clinic_post_invoice lolos", () => {
    expect(helper).toContain("v_unit := coalesce(v_unit, 'jasa');");
    expect(helper).toContain("v_unit := coalesce(v_unit, v_base_unit, 'pcs');");
    expect(helper).toContain("from public.item_units iu");
    expect(helper).toContain("UNIT_INVALID: satuan barang tidak ditemukan");
    expect(helper).toContain("jsonb_build_object('prescription_item_id', v_id, 'unit', v_unit)");
  });
  it("baris kasir tidak membawa kategori tindakan (gerbang persetujuan tidak berubah)", () => {
    expect(helper).not.toContain("tindakan_kategori");
    expect(helper).not.toContain("kategori,");
    expect(SQL).toContain("kategori sengaja TIDAK diisi untuk baris kasir");
  });
  it("tidak menggerakkan stok, HPP, atau jurnal", () => {
    for (const larangan of ["stock_out_fifo", "stock_in_fifo", "stock_layers", "clinic_write_journal", "invoice_items"]) {
      expect(helper).not.toContain(larangan);
    }
  });
});

describe("pembungkus posting & koreksi tagihan", () => {
  const post = potong("create function public.clinic_post_invoice_with_record", "revoke all on function public.clinic_post_invoice_with_record");
  const edit = potong("create function public.clinic_edit_invoice_with_record", "revoke all on function public.clinic_edit_invoice_with_record");
  it("memanggil RPC posting yang ada tanpa mendefinisikan ulang badannya", () => {
    expect(post).toContain("return public.clinic_post_invoice(p_visit_id, v_key, p_invoice, v_lines);");
    expect(post).toContain("public.clinic_post_split_invoice(p_visit_id, v_key, p_invoice, v_lines, p_payments)");
    expect(post).toContain("public.clinic_post_demo_invoice(p_visit_id, v_key, p_invoice, v_lines, p_policy_id, p_payments, p_employee_ids)");
    expect(post).not.toContain("insert into public.invoices");
    expect(edit).toContain("return public.clinic_edit_invoice(p_invoice_id, v_key, p_invoice, v_lines);");
    expect(edit).not.toContain("delete from public.invoice_items");
  });
  it("mengunci dengan urutan yang sama dengan RPC yang dibungkusnya", () => {
    expect(post).toContain("pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:' || v_key, 0))");
    expect(edit).toContain("pg_advisory_xact_lock(hashtextextended('clinic-invoice-operation:' || v_key, 0))");
    for (const badan of [post, edit]) {
      expect(badan.indexOf("pg_advisory_xact_lock")).toBeLessThan(badan.indexOf("for update"));
      expect(badan.indexOf("for update")).toBeLessThan(badan.indexOf("link_unrecorded_lines"));
    }
  });
  it("memeriksa autentikasi dan cabang sebelum menulis apa pun", () => {
    for (const badan of [post, edit]) expect(badan).toContain("coalesce(auth.role(), '') <> 'authenticated'");
    expect(edit).toContain("not public.user_can_access_branch(");
  });
  it("ACL-nya sama dengan RPC posting yang dibungkus", () => {
    for (const sig of ["public.clinic_post_invoice_with_record(uuid,text,jsonb,jsonb,jsonb,uuid,uuid[],text)",
      "public.clinic_post_dp_and_admit_with_record(uuid,text,jsonb,jsonb,text,text,text)",
      "public.clinic_edit_invoice_with_record(uuid,text,jsonb,jsonb)"]) {
      expect(SQL).toContain(`revoke all on function ${sig}`);
      expect(SQL).toContain(`grant execute on function ${sig}`);
    }
  });
  it("gagal tertutup bila RPC yang dipanggil tidak ada atau ikut ditulis ulang", () => {
    expect(SQL).toContain("do $check$");
    expect(SQL).toContain("Item susulan: RPC wajib tidak ada: %");
    expect(SQL).toContain("clinic_post_invoice tidak boleh ditulis ulang oleh migrasi ini");
    expect(SQL).toContain("Item susulan: pembungkus % tidak memanggil %");
  });
});

describe("komposisi terhadap main terbaru (versi 20261104340000)", () => {
  const rpc = potong("create function public.clinic_add_record_items", "revoke all on function public.clinic_add_record_items");
  it("versi berada sesudah migrasi main terakhir, bukan di tengah rantai yang sudah terpasang", () => {
    const semua = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(semua).not.toContain("20261101000000_item_susulan_rekam_medis.sql");
    expect(semua.indexOf(NAMA)).toBeGreaterThan(semua.indexOf("20261104140000_kartu_rekam_medis_tertunda.sql"));
  });
  it("dokter: koordinator tagihan diambil SEBELUM kunci kunjungan (racikan susulan vs posting kasir)", () => {
    expect(rpc).toContain("perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));");
    expect(rpc.indexOf("billing_lock(")).toBeLessThan(rpc.indexOf("for update;"));
  });
  it("dokter: gerbang owner/dokter dicek sebelum replay; item wajib dari master aktif", () => {
    expect(rpc).toContain("role in ('OWNER','DOCTOR')");
    expect(rpc.indexOf("role in ('OWNER','DOCTOR')")).toBeLessThan(rpc.indexOf("from public.clinic_record_item_additions"));
    expect(rpc).toContain("RECORD_INVALID: item susulan harus dipilih dari master");
    expect(rpc).toContain("from public.items where id = (v_row->>'item_id')::uuid and is_active");
  });
  it("versi keranjang: semua baris resep belum tertagih, dibandingkan di bawah kunci, gagal tertutup", () => {
    const versi = potong("create function clinic_private.outpatient_cart_version", "revoke all on function clinic_private.outpatient_cart_version");
    expect(versi).toContain("to_jsonb(p)");
    expect(versi).toContain("p.billing_withdrawn_at is null");
    expect(versi).toContain("i.voided_at is null");
    const cek = potong("create function clinic_private.assert_outpatient_cart", "revoke all on function clinic_private.assert_outpatient_cart");
    expect(cek).toContain("CART_STALE:");
    expect(cek).toContain("nullif(btrim(p_cart_version), '') is null");
    expect(cek).toContain("i.request_key = p_request_key");
    for (const awal of ["create function public.clinic_post_invoice_with_record", "create function public.clinic_post_dp_and_admit_with_record"]) {
      const badan = SQL.slice(SQL.indexOf(awal), SQL.indexOf("$function$;", SQL.indexOf(awal)));
      expect(badan.indexOf("for update;")).toBeLessThan(badan.indexOf("assert_outpatient_cart("));
      expect(badan.indexOf("assert_outpatient_cart(")).toBeLessThan(badan.indexOf("link_unrecorded_lines("));
    }
    expect(SQL).toContain("grant execute on function public.clinic_outpatient_cart_version(uuid) to authenticated;");
  });
  it("DP & rawat inap memanggil RPC asli 0302 tanpa menulis ulang badannya", () => {
    const dp = potong("create function public.clinic_post_dp_and_admit_with_record", "revoke all on function public.clinic_post_dp_and_admit_with_record");
    expect(dp).toContain("return public.clinic_post_dp_and_admit(p_visit_id, v_key, p_invoice, v_lines, p_treatment_plan, p_stay_type);");
    expect(SQL).not.toMatch(/create or replace function public\.clinic_post_dp_and_admit\b/);
  });
  it("koreksi penuh 0408 ditambal lewat jangkar tepat-sekali, pemilik/ACL dipertahankan", () => {
    const tambal = potong("-- 8. Koreksi penuh dokter/owner", "-- 9. Pemeriksaan akhir");
    expect(tambal).toContain("Item susulan: jangkar koreksi penuh berubah");
    expect(tambal).toContain("Item susulan: koreksi penuh berubah pemilik/ACL/security");
    expect(tambal).toContain("''source'',''dokter''");
  });
});

describe("label susulan di layar & dokumen", () => {
  const baris = { susulan_at: "2026-11-01T07:30:00Z", susulan_by_name: "Drh. Andri", susulan_source: "dokter" };
  it("menyebut pelaku, sumber, dan jamnya dalam waktu Jakarta", () => {
    expect(labelSusulan(baris)).toBe("Ditambahkan setelah pemeriksaan oleh Drh. Andri (dokter), 01 Nov 2026, 14.30");
    expect(labelSusulanRingkas(baris)).toBe("Susulan · Drh. Andri · 01 Nov 2026, 14.30");
  });
  it("baris pemeriksaan biasa tidak diberi label", () => {
    expect(labelSusulan(null)).toBeNull();
    expect(labelSusulan({})).toBeNull();
    expect(labelSusulanRingkas({ susulan_at: null })).toBeNull();
  });
  it("nama yang tidak tercatat tidak pernah dikarang dari data karyawan hari ini", () => {
    expect(labelSusulan({ susulan_at: baris.susulan_at, susulan_source: "kasir" }))
      .toContain("petugas yang tidak tercatat (kasir)");
  });
  it("waktu yang rusak diperlakukan sebagai tanpa label, bukan \"Invalid Date\"", () => {
    expect(labelSusulan({ susulan_at: "bukan-tanggal" })).toBeNull();
    expect(labelSusulanRingkas({ susulan_at: "bukan-tanggal" })).toBeNull();
  });
});
