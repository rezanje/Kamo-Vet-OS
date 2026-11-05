-- ============================================================================================================
-- SEKALI JALAN (Owner) -- harga racikan ranap yang macet di bawah HPP
-- Kunjungan b1770b4b-f21a-4313-ad75-488288de2f76 · cabang VET_CMS · racikan "Obat Racik Probiotik"
-- (harga tersimpan Rp50.000, HPP sekitar Rp50.151). Tempel di Supabase SQL editor, per BAGIAN.
--
-- CARA PAKAI (baca semuanya dulu; urutan dan jumlah langkah penting)
--  K1. Jalankan BAGIAN 1 (pratinjau, hanya baca) SENDIRIAN. Lanjut HANYA bila: cabang = VET_CMS; rawat_inap satu catatan;
--      baris_keranjang berisi TEPAT SATU baris racikan (compound_recipe_id terisi) dan itu "Obat Racik Probiotik",
--      qty 1, harga 50000, sudah_di_invoice false, billing_withdrawn_at kosong, status_racikan pending/ready (belum
--      diserahkan); hpp_racikan_seperti_dilihat_P03 sekitar 50151,xx; harga_penjualan_racikan_master kosong atau
--      sama dengan harga; invoice_kunjungan tidak memuat baris racikan ini; cek_sistem.trigger_official_
--      prescription_snapshot = "O". Nilai lain apa pun: BERHENTI, jangan ubah skrip, tanya pembuat skrip.
--  K2. Di BAGIAN 2 ubah HANYA tiga nilai di blok paling bawah: (1) id baris racikan (salin dari baris racikan di
--      pratinjau), (2) harga baru (pakai saran_harga_baru baris itu, 50500; jangan memakai saran baris lain),
--      (3) id profil Owner aktif (dari "profil_owner_aktif"); alasan boleh disesuaikan. Nama racikan dan harga
--      lama di blok itu adalah PENJAGA: jangan diubah. Baca ulang ketiga nilai sebelum menekan Run.
--  K3. Jalankan BAGIAN 2 SEKALI, sebagai SATU Run (tempel seluruh bagian, tekan Run sekali). Jangan dijalankan lagi:
--      setelah berhasil, harga lama tidak cocok lagi sehingga skrip menolak sendiri.
--      Bila hasilnya galat apa pun ('F8: ...', 'must be owner', 'lock timeout', 'current transaction is aborted'):
--      TIDAK ADA yang berubah. Jalankan `rollback;` SENDIRIAN (satu Run), baca pesan galatnya, perbaiki nilai yang
--      salah; jangan menghapus penjaga agar lolos.
--  K4. Jalankan hanya saat tidak ada yang sedang menyimpan kasir ranap / log rawat inap kunjungan ini (bila tabel
--      sibuk, skrip menunggu paling lama 5 detik lalu gagal dengan "lock timeout": ulangi nanti).
--  K5. Segera sesudah sukses jalankan BAGIAN 3 (hanya baca) dengan id baris dan harga yang sama: SEMUA_LULUS harus true,
--      yaitu (a) harga = harga yang diketik, (b) TEPAT SATU baris audit (clinic_pending_cart_edits, request_key
--      f8-racikan-harga-sekali:<id baris>:...), (c) trigger official_prescription_snapshot tgenabled = 'O',
--      (d) harga penjualan racikan master (bila ada) = harga. Ada yang false: BERHENTI dan laporkan.
--  K6. Minta Andri MUAT ULANG halaman pembayaran (snapshot keranjang berubah) lalu Simpan / Bayar & Selesai. Aturan P03
--      diperiksa lagi saat bayar (harga >= HPP).
--  K7. Hanya file dengan sha256 yang disebut pemberi skrip, dan hanya tiga nilai di K2 yang boleh diubah.
--
-- ATURAN HARGA BARU (ditegakkan di BAGIAN 2; P03 TIDAK dilonggarkan):
--   harga baru >= ceil(HPP per qty) (qty x harga tetap >= HPP) DAN <= yang lebih besar dari (2x harga lama) dan
--   (1,5x ceil(HPP per qty)), paling banyak dua desimal. Contoh kasus ini: harga lama 50000, HPP 50151,xx ->
--   minimum 50152, maksimum 100000: 50500 lolos, salah ketik 450500 ditolak.
--   Skrip hanya mengubah SATU kolom (harga) pada SATU baris prescription_items, dengan penjaga, dan menulis jejak audit.
--   Penjaga wajib: nama racikan yang diharapkan dan harga lama yang diharapkan HARUS sama dengan baris yang dipilih
--   (salah tempel id baris racikan lain di kunjungan yang sama ditolak; menjalankan dua kali ditolak).
--
-- SIAPA YANG TERCATAT (jujur): editor SQL Supabase berjalan sebagai role postgres dan auth.uid() kosong. Id profil
--   Owner DIKETIK oleh yang menjalankan; skrip hanya memeriksa bahwa id itu profil OWNER aktif. Itu pernyataan,
--   bukan autentikasi: siapa pun yang memegang editor dapat mengetik Owner mana pun. Karena itu jejak audit juga
--   mencatat pengguna DB, pid, alamat klien, dan HPP saat dijalankan. Alasan wajib (minimal 5 huruf).
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
-- DI DALAM satu pemanggilan fungsi (satu transaksi), menghidupkannya lagi sebelum selesai (diperiksa; bila gagal
-- semuanya batal) -- sesi lain tidak pernah melihatnya mati (DDL transaksional). Trigger harus dalam keadaan normal
-- ('O') sebelum dimulai, bila tidak skrip berhenti. Tabel prescription_items terkunci TULIS sepersekian detik
-- (lock_timeout 5 detik; bila tabel sibuk, skrip gagal dan tidak mengubah apa pun). Bila racikan BUKAN resmi,
-- tidak ada trigger yang disentuh. BAGIAN 2 sengaja tanpa begin/commit sendiri: satu pemanggilan fungsi sudah satu
-- transaksi, jadi galat tidak meninggalkan sesi editor dalam transaksi yang menggantung.
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
      'hpp_racikan_seperti_dilihat_P03', hh.hpp,
      'harga_penjualan_racikan_master', (select s.sale_price from public.clinic_compound_sales s where s.recipe_id = pi.compound_recipe_id),
      'racikan_resmi', exists(select 1 from public.compound_official_usage u where u.recipe_id = pi.compound_recipe_id),
      'sudah_di_invoice', exists(select 1 from public.invoice_items ii where ii.prescription_item_id = pi.id or (pi.compound_recipe_id is not null and ii.compound_recipe_id = pi.compound_recipe_id)),
      'harga_minimum_per_qty', hh.minimum,
      -- hanya baris racikan yang boleh diubah skrip ini; baris lain TIDAK diberi saran (NULL)
      'saran_harga_baru', case when pi.compound_recipe_id is not null then ceil(hh.minimum / 500.0) * 500 end,
      'harga_baru_minimum', case when pi.compound_recipe_id is not null then hh.minimum end,
      'harga_baru_maksimum', case when pi.compound_recipe_id is not null then greatest(pi.harga * 2, hh.minimum * 1.5) end,
      'nama_yang_diharapkan', case when pi.compound_recipe_id is not null then pi.nama_obat end,
      'harga_lama_yang_diharapkan', case when pi.compound_recipe_id is not null then pi.harga end
    ) order by pi.nama_obat, pi.id), '[]'::jsonb)
    from public.prescription_items pi
    join public.medical_records m on m.id = pi.medical_record_id
    left join public.compounding_recipes cr on cr.id = pi.compound_recipe_id
    left join lateral (select round(sum(ci.qty * ci.unit_cost), 2) as hpp,
        ceil(round(sum(ci.qty * ci.unit_cost), 2) / greatest(pi.qty, 1)) as minimum
      from public.compound_issues ci where ci.recipe_id = pi.compound_recipe_id) hh on true
    where m.visit_id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'invoice_kunjungan', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'total', i.total,
      'dp_amount', i.dp_amount, 'paid_status', i.paid_status, 'voided_at', i.voided_at, 'stage_billing', i.stage_billing)), '[]'::jsonb)
    from public.invoices i where i.visit_id = 'b1770b4b-f21a-4313-ad75-488288de2f76'),
  'profil_owner_aktif', (select jsonb_agg(jsonb_build_object('id', p.id, 'nama', p.full_name)) from public.profiles p where p.role = 'OWNER' and p.is_active),
  'cek_sistem', jsonb_build_object(
    'current_user', current_user, 'session_user', session_user,
    'superuser', (select rolsuper from pg_roles where rolname = current_user),
    'pemilik_tabel_prescription_items', (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.prescription_items'::regclass),
    'trigger_official_prescription_snapshot', (select t.tgenabled::text from pg_trigger t
      where t.tgrelid = 'public.prescription_items'::regclass and t.tgname = 'official_prescription_snapshot'),
    'sesi_lain_memegang_kunci_prescription_items', (select count(distinct l.pid) from pg_locks l
      where l.relation = 'public.prescription_items'::regclass and l.pid <> pg_backend_pid())
  )
)) as pratinjau;


-- ============================================================================================================
-- BAGIAN 2 -- UBAH HARGA (satu baris). Jalankan SEKALI, sendirian, SETELAH pratinjau dikonfirmasi (K1-K4).
-- Ubah hanya tiga nilai di blok "select jsonb_pretty(...)" paling bawah: (1) id baris racikan, (2) harga baru,
-- (3) id profil Owner. Nilai nama racikan dan harga lama adalah penjaga: JANGAN diubah.
-- Hasil: JSON sebelum/sesudah. Lalu jalankan BAGIAN 3 (K5).
-- ============================================================================================================
create or replace function pg_temp.f8_apply(p_visit uuid, p_branch_code text, p_expected_name text, p_expected_old_price numeric,
  p_row_id uuid, p_new numeric, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $f8$
declare
  v_visit public.visits%rowtype;
  v_branch text;
  v_row public.prescription_items%rowtype;
  v_after public.prescription_items%rowtype;
  v_hpp numeric;
  v_min numeric;
  v_max numeric;
  v_bad integer;
  v_official boolean;
  v_actor uuid;
  v_n integer;
  v_orig "char";
  v_enabled "char";
  v_sale_price numeric;
  v_has_sale boolean;
begin
  perform set_config('lock_timeout', '5s', true);
  if p_expected_name is null or btrim(p_expected_name) = '' or p_expected_old_price is null then
    raise exception 'F8: isi nama racikan dan harga lama yang diharapkan (penjaga; salin dari BAGIAN 1, jangan dikosongkan)';
  end if;
  if p_new is null or p_row_id is null or p_new < 0 or p_new > 1e12 then
    raise exception 'F8: isi baris racikan dan harga baru (angka >= 0)';
  end if;
  if p_new <> round(p_new, 2) then
    raise exception 'F8: harga baru % harus paling banyak dua desimal', p_new;
  end if;
  if length(regexp_replace(coalesce(p_reason, ''), '\s', '', 'g')) < 5 then
    raise exception 'F8: alasan wajib (minimal 5 huruf)';
  end if;

  -- who is on record: the TYPED id must be an active OWNER profile (an attestation, not authentication)
  if p_actor is null then raise exception 'F8: isi id profil Owner (wajib)'; end if;
  select p.id into v_actor from public.profiles p where p.id = p_actor and p.role = 'OWNER' and p.is_active;
  if v_actor is null then raise exception 'F8: profil % bukan Owner aktif', p_actor; end if;

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
  -- compare-and-swap: the row must be the one the Owner looked at (wrong pasted id / a second run is refused)
  if v_row.nama_obat is distinct from p_expected_name then
    raise exception 'F8: nama baris "%" tidak sama dengan nama yang diharapkan "%"; kemungkinan id baris salah tempel', v_row.nama_obat, p_expected_name;
  end if;
  if v_row.harga is distinct from p_expected_old_price then
    raise exception 'F8: harga baris sekarang % tidak sama dengan harga lama yang diharapkan %; skrip ini hanya untuk satu kali jalan', v_row.harga, p_expected_old_price;
  end if;
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
  -- the price window: >= ceil(HPP per qty) and <= max(2 x old price, 1.5 x that minimum)
  v_min := ceil(v_hpp / greatest(v_row.qty, 1));
  v_max := greatest(v_row.harga * 2, v_min * 1.5);
  if p_new < v_min then
    raise exception 'F8: harga baru % di bawah harga minimum % (HPP dibulatkan ke atas)', p_new, v_min;
  end if;
  if p_new > v_max then
    raise exception 'F8: harga baru % melebihi batas % (batas = yang lebih besar dari 2x harga lama % dan 1,5x harga minimum %)', p_new, v_max, v_row.harga, v_min;
  end if;

  -- racikan master (SKU): the invoice trigger protect_master_compound_invoice demands line price = this stored sale price
  select s.sale_price into v_sale_price from public.clinic_compound_sales s where s.recipe_id = v_row.compound_recipe_id for update;
  v_has_sale := found;
  if v_has_sale and v_sale_price is distinct from v_row.harga then
    raise exception 'F8: harga penjualan racikan tersimpan (%) tidak sama dengan harga baris (%); periksa dulu', v_sale_price, v_row.harga;
  end if;

  v_official := exists (select 1 from public.compound_official_usage u where u.recipe_id = v_row.compound_recipe_id);
  if v_official then
    select t.tgenabled into v_orig from pg_trigger t
    where t.tgrelid = 'public.prescription_items'::regclass and t.tgname = 'official_prescription_snapshot';
    if v_orig is distinct from 'O' then
      raise exception 'F8: trigger official_prescription_snapshot tidak dalam keadaan normal (tgenabled=%); dibatalkan', coalesce(v_orig::text, 'tidak ada');
    end if;
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
    'Ubah harga racikan sekali jalan (Owner diketik, SQL editor): ' || btrim(p_reason)
      || ' [sesi DB: ' || session_user || '/' || current_user || ', pid ' || pg_backend_pid()
      || ', klien ' || coalesce(inet_client_addr()::text, 'socket') || ', HPP ' || v_hpp || ', batas ' || v_min || '..' || v_max || ']',
    jsonb_build_array(to_jsonb(v_row)), jsonb_build_array(to_jsonb(v_after)),
    'f8-racikan-harga-sekali:' || v_row.id || ':' || v_row.harga || '->' || p_new);

  return jsonb_build_object('sebelum', to_jsonb(v_row), 'sesudah', to_jsonb(v_after), 'hpp_racikan', v_hpp,
    'harga_minimum_per_qty', v_min, 'harga_maksimum_diizinkan', v_max, 'racikan_resmi_trigger_ditangani', v_official,
    'harga_penjualan_racikan_master', case when v_has_sale then jsonb_build_object('sebelum', v_sale_price, 'sesudah', p_new) end,
    'audit', 'clinic_pending_cart_edits (request_key f8-racikan-harga-sekali:...)',
    'langkah_berikut', 'Jalankan BAGIAN 3 (pemeriksaan) lalu minta Andri muat ulang halaman pembayaran');
end $f8$;

-- >>> UBAH TIGA NILAI: (1) id baris racikan, (2) harga baru, (3) id profil Owner (alasan boleh disesuaikan) <<<
-- >>> Nama racikan dan harga lama di bawah adalah PENJAGA: jangan diubah. <<<
select jsonb_pretty(pg_temp.f8_apply(
  'b1770b4b-f21a-4313-ad75-488288de2f76'::uuid,
  'VET_CMS',
  'Obat Racik Probiotik',
  50000,
  '00000000-0000-0000-0000-000000000001'::uuid,
  null,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Racikan Probiotik: HPP FIFO naik di atas harga tersimpan; harga dinaikkan agar lolos aturan di bawah HPP'
)) as hasil;


-- ============================================================================================================
-- BAGIAN 3 -- PERIKSA SESUDAH (hanya baca; K5). Isi dua nilai yang sama dengan BAGIAN 2: id baris racikan dan harga baru.
-- SEMUA_LULUS harus true. Bila false, BERHENTI dan laporkan (jangan menjalankan BAGIAN 2 lagi).
-- ============================================================================================================
with p as (
  select '00000000-0000-0000-0000-000000000001'::uuid as row_id,
         null::numeric as harga_baru
), c as (
  select p.row_id, p.harga_baru,
    (select pi.harga from public.prescription_items pi where pi.id = p.row_id) as harga,
    (select s.sale_price from public.clinic_compound_sales s join public.prescription_items pi on pi.compound_recipe_id = s.recipe_id where pi.id = p.row_id) as harga_master,
    exists(select 1 from public.clinic_compound_sales s join public.prescription_items pi on pi.compound_recipe_id = s.recipe_id where pi.id = p.row_id) as ada_master,
    (select count(*) from public.clinic_pending_cart_edits e where e.request_key like 'f8-racikan-harga-sekali:' || p.row_id || ':%') as jumlah_audit,
    (select t.tgenabled::text from pg_trigger t where t.tgrelid = 'public.prescription_items'::regclass and t.tgname = 'official_prescription_snapshot') as trigger_state
  from p
), k as (
  select c.*,
    (c.harga_baru is not null and c.harga = c.harga_baru) as cek_harga,
    c.jumlah_audit = 1 as cek_audit,
    c.trigger_state = 'O' as cek_trigger,
    ((not c.ada_master) or c.harga_master = c.harga) as cek_master
  from c
)
select jsonb_pretty(jsonb_build_object(
  'harga_sekarang', k.harga, 'harga_yang_diketik', k.harga_baru, 'harga_master_sekarang', k.harga_master,
  'jumlah_baris_audit', k.jumlah_audit, 'tgenabled_official_prescription_snapshot', k.trigger_state,
  'cek_harga_sama_dengan_yang_diketik', coalesce(k.cek_harga, false),
  'cek_tepat_satu_baris_audit', coalesce(k.cek_audit, false),
  'cek_trigger_official_prescription_snapshot_O', coalesce(k.cek_trigger, false),
  'cek_harga_master_sama_atau_tidak_ada', coalesce(k.cek_master, false),
  'SEMUA_LULUS', coalesce(k.cek_harga and k.cek_audit and k.cek_trigger and k.cek_master, false)
)) as periksa_sesudah from k;
