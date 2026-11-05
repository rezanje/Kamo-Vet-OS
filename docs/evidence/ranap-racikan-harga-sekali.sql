-- ============================================================================================================
-- SEKALI JALAN (Owner) -- harga racikan ranap yang macet di bawah HPP
-- Kunjungan b1770b4b-f21a-4313-ad75-488288de2f76 · cabang VET_CMS · racikan "Obat Racik Probiotik"
-- (harga tersimpan Rp50.000, HPP Rp50.151). Tempel di Supabase SQL editor SEBAGAI OWNER PROYEK, per BAGIAN.
--
-- Aturan P03 TIDAK dilonggarkan: harga baru wajib >= HPP. Skrip ini hanya mengubah SATU kolom (harga) pada
-- SATU baris prescription_items, dengan penjaga, dan menulis jejak audit.
--
-- Mengapa tidak bisa dari layar: kasir ranap mengunci baris racikan (COMPOUND_LOCKED bila harga diubah) dan
-- diskon tahap ranap dikunci 0; aksi "Ubah komposisi" di /klinik/racik/<id> hanya tampil bila status racikan
-- pending/ready DAN di database ditolak (assert_compound_adjustable) bila racikan sudah serah, sudah ada di
-- invoice, atau tagihan kunjungan sudah menerima uang/DP (RECIPE_INVALID / RECIPE_LINKED / INVOICE_PAID) --
-- pasien ranap yang sudah DP selalu kena INVOICE_PAID.
--
-- Racikan master (SKU): invoice menolak (MASTER_COMPOUND_SNAPSHOT) bila harga baris != clinic_compound_sales.sale_price,
-- jadi BAGIAN 2 juga menyamakan sale_price baris snapshot racikan itu (hanya bila ada).
--
-- Soal trigger: bila racikan ini racikan resmi (ada baris compound_official_usage), trigger
-- official_prescription_snapshot menolak ubah baris resepnya (RECIPE_LINKED) bahkan untuk role postgres.
-- Satu-satunya jalan tanpa mematikan apa pun secara global: BAGIAN 2 mematikan HANYA trigger itu pada tabel itu,
-- DI DALAM transaksi yang sama, menghidupkannya lagi sebelum selesai (diperiksa; bila gagal semuanya batal) --
-- sesi lain tidak pernah melihatnya mati (DDL transaksional). Tabel prescription_items terkunci TULIS
-- sepersekian detik (lock_timeout 5 detik; bila tabel sibuk, skrip gagal dan tidak mengubah apa pun).
-- Bila racikan BUKAN resmi, tidak ada trigger yang disentuh.
-- ============================================================================================================


-- ============================================================================================================
-- BAGIAN 1 -- PRATINJAU (hanya baca). Jalankan sendirian. Hasilnya satu kotak JSON; salin "id" baris racikan
-- yang benar dan "id" profil Owner untuk BAGIAN 2.
-- ============================================================================================================
select jsonb_pretty(jsonb_build_object(
  'kunjungan', (select jsonb_build_object('id', v.id, 'status', v.status, 'cabang', b.code)
                from public.visits v join public.branches b on b.id = v.branch_id
                where v.id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'rawat_inap', (select jsonb_agg(jsonb_build_object('id', r.id, 'discharged_at', r.discharged_at))
                 from public.inpatient_records r where r.visit_id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'baris_keranjang', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', pi.id, 'nama', pi.nama_obat, 'jenis', pi.jenis, 'compound_recipe_id', pi.compound_recipe_id,
      'qty', pi.qty, 'harga', pi.harga, 'billing_withdrawn_at', pi.billing_withdrawn_at,
      'status_racikan', cr.status,
      'hpp_racikan_seperti_dilihat_P03', (select round(sum(ci.qty * ci.unit_cost), 2) from public.compound_issues ci where ci.recipe_id = pi.compound_recipe_id),
      'harga_penjualan_racikan_master', (select s.sale_price from public.clinic_compound_sales s where s.recipe_id = pi.compound_recipe_id),
      'racikan_resmi', exists(select 1 from public.compound_official_usage u where u.recipe_id = pi.compound_recipe_id),
      'sudah_di_invoice', exists(select 1 from public.invoice_items ii where ii.prescription_item_id = pi.id or (pi.compound_recipe_id is not null and ii.compound_recipe_id = pi.compound_recipe_id)),
      'harga_minimum_per_qty', (select ceil(round(sum(ci.qty * ci.unit_cost), 2) / greatest(pi.qty, 1)) from public.compound_issues ci where ci.recipe_id = pi.compound_recipe_id),
      'saran_harga_baru', (select least(ceil(ceil(round(sum(ci.qty * ci.unit_cost), 2) / greatest(pi.qty, 1)) / 500.0) * 500, pi.harga * 10)
                           from public.compound_issues ci where ci.recipe_id = pi.compound_recipe_id)
    ) order by pi.nama_obat, pi.id), '[]'::jsonb)
    from public.prescription_items pi
    join public.medical_records m on m.id = pi.medical_record_id
    left join public.compounding_recipes cr on cr.id = pi.compound_recipe_id
    where m.visit_id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'invoice_kunjungan', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'total', i.total,
      'dp_amount', i.dp_amount, 'paid_status', i.paid_status, 'voided_at', i.voided_at, 'stage_billing', i.stage_billing)), '[]'::jsonb)
    from public.invoices i where i.visit_id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'profil_owner_aktif', (select jsonb_agg(jsonb_build_object('id', p.id, 'nama', p.full_name)) from public.profiles p where p.role = 'OWNER' and p.is_active)
)) as pratinjau;


-- ============================================================================================================
-- BAGIAN 2 -- UBAH HARGA (satu baris). Jalankan sendirian SETELAH pratinjau dikonfirmasi.
-- Ubah hanya tiga nilai pada baris "select pg_temp.f8_apply(...)" di paling bawah:
--   baris racikan (id dari pratinjau), harga baru (>= HPP; lihat "saran_harga_baru"), profil Owner (id dari pratinjau).
-- Hasil: JSON sebelum/sesudah. Setelah itu minta Andri MUAT ULANG halaman pembayaran (snapshot keranjang berubah)
-- lalu Simpan / Bayar & Selesai seperti biasa. Aturan P03 tetap berlaku pada saat bayar.
-- ============================================================================================================
begin;
set local lock_timeout = '5s';

create or replace function pg_temp.f8_apply(p_visit uuid, p_branch_code text, p_row_id uuid, p_new numeric, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $f8$
declare
  v_visit public.visits%rowtype;
  v_branch text;
  v_row public.prescription_items%rowtype;
  v_after public.prescription_items%rowtype;
  v_hpp numeric;
  v_bad integer;
  v_official boolean;
  v_actor uuid;
  v_n integer;
  v_enabled "char";
  v_sale_price numeric;
  v_has_sale boolean;
begin
  if p_new is null or p_row_id is null or p_new < 0 or p_new > 1e12 then
    raise exception 'F8: isi baris racikan dan harga baru (angka >= 0)';
  end if;
  if length(regexp_replace(coalesce(p_reason, ''), '\s', '', 'g')) < 5 then
    raise exception 'F8: alasan wajib (minimal 5 huruf)';
  end if;
  select * into v_visit from public.visits where id = p_visit for update;
  if not found then raise exception 'F8: kunjungan tidak ditemukan'; end if;
  select b.code into v_branch from public.branches b where b.id = v_visit.branch_id;
  if v_branch is distinct from p_branch_code then
    raise exception 'F8: cabang kunjungan % bukan %', v_branch, p_branch_code;
  end if;
  if not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit) then
    raise exception 'F8: kunjungan ini bukan rawat inap';
  end if;

  -- exactly the one row, in THIS visit, a racikan, still pending
  select pi.* into v_row from public.prescription_items pi
  join public.medical_records m on m.id = pi.medical_record_id
  where pi.id = p_row_id and m.visit_id = p_visit for update of pi;
  if not found then raise exception 'F8: baris % tidak ada di kunjungan ini', p_row_id; end if;
  if v_row.compound_recipe_id is null then raise exception 'F8: baris bukan racikan'; end if;
  if v_row.billing_withdrawn_at is not null then raise exception 'F8: baris sudah ditarik dari tagihan'; end if;
  if exists (select 1 from public.invoice_items ii
    where ii.prescription_item_id = v_row.id or ii.compound_recipe_id = v_row.compound_recipe_id) then
    raise exception 'F8: racikan ini sudah masuk invoice; ubah lewat koreksi invoice, bukan skrip ini';
  end if;
  select count(*) into v_n from public.prescription_items pi
  join public.medical_records m on m.id = pi.medical_record_id
  where m.visit_id = p_visit and pi.compound_recipe_id is not null and pi.billing_withdrawn_at is null
    and pi.nama_obat = v_row.nama_obat;
  if v_n <> 1 then raise exception 'F8: ada % baris racikan bernama "%" pada kunjungan ini; harus tepat satu', v_n, v_row.nama_obat; end if;

  -- HPP exactly as clinic_post_invoice reads it: the summed issued cost of the recipe (no restored/posted issue)
  select round(sum(ci.qty * ci.unit_cost), 2), count(*) filter (where ci.restored_at is not null or ci.posted_invoice_item_id is not null)
    into v_hpp, v_bad from public.compound_issues ci where ci.recipe_id = v_row.compound_recipe_id;
  if v_hpp is null or v_hpp <= 0 then raise exception 'F8: HPP racikan tidak tersedia'; end if;
  if v_bad > 0 then raise exception 'F8: racikan punya pengeluaran bahan yang sudah dikembalikan/ditagih'; end if;
  if p_new = v_row.harga then raise exception 'F8: harga sudah % (tidak ada perubahan)', p_new; end if;
  if round(v_row.qty * p_new, 2) < v_hpp then
    raise exception 'F8: harga baru % x qty % = % masih di bawah HPP % (aturan P03 tidak dilonggarkan)', p_new, v_row.qty, v_row.qty * p_new, v_hpp;
  end if;
  if v_row.harga > 0 and p_new > v_row.harga * 10 then
    raise exception 'F8: harga baru % lebih dari 10x harga lama %', p_new, v_row.harga;
  end if;

  -- who is on record: an active OWNER profile
  if p_actor is null then
    select p.id into v_actor from public.profiles p where p.role = 'OWNER' and p.is_active;
    if (select count(*) from public.profiles p where p.role = 'OWNER' and p.is_active) <> 1 then
      raise exception 'F8: isi id profil Owner (ada lebih dari satu Owner aktif)';
    end if;
  else
    select p.id into v_actor from public.profiles p where p.id = p_actor and p.role = 'OWNER' and p.is_active;
    if v_actor is null then raise exception 'F8: profil % bukan Owner aktif', p_actor; end if;
  end if;

  -- racikan master (SKU): the invoice trigger protect_master_compound_invoice demands line price = this stored sale price
  select s.sale_price into v_sale_price from public.clinic_compound_sales s where s.recipe_id = v_row.compound_recipe_id for update;
  v_has_sale := found;
  if v_has_sale and v_sale_price is distinct from v_row.harga then
    raise exception 'F8: harga penjualan racikan tersimpan (%) tidak sama dengan harga baris (%); periksa dulu', v_sale_price, v_row.harga;
  end if;

  v_official := exists (select 1 from public.compound_official_usage u where u.recipe_id = v_row.compound_recipe_id);
  if v_official then
    -- only this trigger, only on this table, only inside this transaction (re-enabled below, verified)
    alter table public.prescription_items disable trigger official_prescription_snapshot;
  end if;
  update public.prescription_items set harga = p_new where id = v_row.id returning * into v_after;
  if v_official then
    -- deferred constraint triggers (package completeness) must run now, otherwise ALTER TABLE refuses ("pending trigger events")
    set constraints all immediate;
    alter table public.prescription_items enable trigger official_prescription_snapshot;
    select t.tgenabled into v_enabled from pg_trigger t
    where t.tgrelid = 'public.prescription_items'::regclass and t.tgname = 'official_prescription_snapshot';
    if v_enabled is distinct from 'O' then raise exception 'F8: trigger official_prescription_snapshot tidak hidup lagi; dibatalkan'; end if;
  end if;
  if v_has_sale then
    update public.clinic_compound_sales set sale_price = p_new where recipe_id = v_row.compound_recipe_id;
  end if;
  if v_after.id is null or (to_jsonb(v_after) - 'harga') <> (to_jsonb(v_row) - 'harga') then
    raise exception 'F8: ada kolom selain harga yang berubah; dibatalkan';
  end if;

  insert into public.clinic_pending_cart_edits(visit_id, created_by, reason, before_rows, after_rows, request_key)
  values (p_visit, v_actor,
    'Ubah harga racikan sekali jalan (Owner, SQL editor): ' || btrim(p_reason),
    jsonb_build_array(to_jsonb(v_row)), jsonb_build_array(to_jsonb(v_after)),
    'f8-racikan-harga-sekali:' || v_row.id || ':' || v_row.harga || '->' || p_new);

  return jsonb_build_object('sebelum', to_jsonb(v_row), 'sesudah', to_jsonb(v_after), 'hpp_racikan', v_hpp,
    'harga_minimum_per_qty', ceil(v_hpp / greatest(v_row.qty, 1)), 'racikan_resmi_trigger_ditangani', v_official,
    'harga_penjualan_racikan_master', case when v_has_sale then jsonb_build_object('sebelum', v_sale_price, 'sesudah', p_new) end,
    'audit', 'clinic_pending_cart_edits (request_key f8-racikan-harga-sekali:...)');
end $f8$;

-- >>> UBAH TIGA NILAI INI: id baris racikan, harga baru, id profil Owner (alasan boleh disesuaikan) <<<
select jsonb_pretty(pg_temp.f8_apply(
  'b1770b4b-f21a-4313-ad75-488288de2f76'::uuid,       -- kunjungan (jangan diubah)
  'VET_CMS',                                          -- cabang (jangan diubah)
  '00000000-0000-0000-0000-000000000000'::uuid,       -- id baris racikan dari PRATINJAU
  50500,                                              -- harga baru, >= HPP (lihat saran_harga_baru)
  null,                                               -- id profil Owner (boleh null bila hanya ada satu Owner aktif)
  'Racikan Probiotik: HPP FIFO naik di atas harga tersimpan; harga dinaikkan agar lolos aturan di bawah HPP'
)) as hasil;
commit;
