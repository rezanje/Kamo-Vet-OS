-- Ubah dokter PJ kunjungan (Andri, 18 Nov 2026: Bubel / Elitha, RM R/2026/1116/EC2).
-- Dokter PJ dan pemberi obat sebenarnya dr. Aini, tetapi kunjungan tercatat DRH. ILHAM (dokter visit).
-- Sampai kini tidak ada jalan mengoreksi dokter PJ kunjungan: visits.doctor_id/dokter dan
-- inpatient_records.doctor_id/doctor_name hanya bisa dibaca, dan pagar protect_inpatient_care_staff menolak
-- perubahannya ("dokter PJ awal tetap tersimpan").
--
-- Yang ditambahkan (semua baru, tidak ada tabel lama yang diubah bentuknya):
--   * izin Akses Grup `klinik.ubah_dokter_pj` (izin khusus, bawaan MATI selain Owner)
--   * public.visit_doctor_changes            jejak audit tak dapat diubah (pelaku, alasan, dokter lama/baru, hitungan baris)
--   * clinic_private.visit_doctor_change_permits  izin per-transaksi untuk pagar rawat inap
--   * clinic_private.visit_doctor_change_actor()  / public.clinic_visit_doctor_change_allowed()
--   * public.clinic_change_visit_doctor(...)      satu-satunya jalan koreksi (SECURITY DEFINER)
-- Satu fungsi lama ditambal dengan jangkar tunggal: protect_inpatient_care_staff (kolom doctor_id/doctor_name stay
-- hanya boleh berubah bila ada izin transaksi untuk kunjungan itu).
--
-- Aturan keuangan: tagihan klinik Lunas yang barisnya bergantung pada visits.doctor_id (performers kosong, tanpa
-- penjual baris/tagihan) sudah dikomisikan; laporan Tenaga Penjual/Komisi membaca live, jadi mengubah dokter
-- kunjungan akan memindahkan komisi itu. Ditolak untuk semua peran kecuali Owner dengan centang eksplisit, dan
-- tetap ditolak bila ada slip gaji yang sudah disahkan (final) pada bulan pelunasan. Baris tagihan tidak pernah ditulis ulang.

do $pre$
declare v_src text;
begin
  v_src := (select prosrc from pg_proc where oid = 'public.protect_inpatient_care_staff()'::regprocedure);
  if position('dokter PJ awal tetap tersimpan' in v_src) = 0 then
    raise exception 'UBAH_DOKTER_DRIFT: pagar rawat inap berbeda dari yang ditinjau; tidak ada yang diubah';
  end if;
  if to_regclass('public.visit_doctor_changes') is not null
     or to_regclass('clinic_private.visit_doctor_change_permits') is not null
     or to_regprocedure('public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)') is not null then
    raise exception 'UBAH_DOKTER_DRIFT: objek ubah dokter sudah ada; periksa urutan migrasi';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prescription_items' and column_name = 'record_withdrawn_at')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('clinic_private.inpatient_visit_correction_actor()'))
     or to_regclass('clinic_private.performer_change_permits') is null then
    raise exception 'UBAH_DOKTER_DRIFT: prasyarat (A5, performer permits, penarikan baris) tidak lengkap';
  end if;
end $pre$;

-- ───────────────────────── 1) Izin Akses Grup (izin khusus, bawaan MATI untuk selain Owner) ─────────────────────────
insert into role_settings_private.action_catalog(id, label, "group", enforced)
values ('klinik.ubah_dokter_pj', 'Ubah dokter PJ kunjungan (koreksi dokter salah input); bawaan hanya Owner', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
values ('klinik.ubah_dokter_pj', 'klinik')
on conflict (id) do nothing;

-- ───────────────────────── 2) Tabel izin transaksi + jejak audit ─────────────────────────
create table clinic_private.visit_doctor_change_permits (
  transaction_id bigint not null,
  actor uuid not null,
  visit_id uuid not null,
  primary key (transaction_id, actor, visit_id)
);
revoke all on clinic_private.visit_doctor_change_permits from public, anon, authenticated, service_role;

create table public.visit_doctor_changes (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  inpatient_record_id uuid,
  branch_id uuid not null,
  old_doctor_id uuid,
  old_doctor_name text,
  new_doctor_id uuid not null,
  new_doctor_name text not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  request_key text not null,
  request_hash text not null,
  follow_lines boolean not null,
  ack_final boolean not null,
  actor uuid not null,
  actor_role text not null,
  lines_changed jsonb not null default '[]'::jsonb,
  lines_kept_invoiced integer not null default 0,
  lines_kept_compound integer not null default 0,
  lines_kept_other integer not null default 0,
  lines_kept_invalid integer not null default 0,
  invoices_unpaid_following integer not null default 0,
  invoices_paid_unaffected integer not null default 0,
  invoices_paid_shifted integer not null default 0,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (actor, request_key)
);
create index visit_doctor_changes_visit_idx on public.visit_doctor_changes (visit_id, created_at desc);
comment on table public.visit_doctor_changes is
  'Jejak koreksi dokter PJ kunjungan. Tanpa FK ke visits/employees (jejak tidak ikut terhapus). Hanya diisi clinic_change_visit_doctor; tak dapat diubah/dihapus.';
alter table public.visit_doctor_changes enable row level security;
create policy visit_doctor_changes_select on public.visit_doctor_changes for select to authenticated
  using (public.user_can_access_branch(branch_id));
revoke all on public.visit_doctor_changes from public, anon, authenticated, service_role;
grant select on public.visit_doctor_changes to authenticated;

create function clinic_private.visit_doctor_changes_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_JEJAK: jejak ubah dokter PJ tidak dapat diubah atau dihapus';
end $$;
revoke all on function clinic_private.visit_doctor_changes_immutable() from public, anon, authenticated, service_role;
create trigger visit_doctor_changes_immutable before update or delete on public.visit_doctor_changes
  for each row execute function clinic_private.visit_doctor_changes_immutable();

-- ───────────────────────── 3) Pelaku: Owner selalu; peran lain wajib izin tertulis ─────────────────────────
create function clinic_private.visit_doctor_change_actor() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  -- Owner tidak pernah dikunci oleh tabel kebijakan.
  if v_role = 'OWNER' then return 'OWNER'; end if;
  begin
    -- Peran lain: HARUS ada izin tertulis eksplisit (kebijakan bawaan lama = tidak boleh) dan lolos pagar modul.
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'klinik.ubah_dokter_pj' = any (a.allowed))
            and public.role_action_allowed('klinik.ubah_dokter_pj');
  exception when others then
    v_ok := false;   -- gagal baca untuk peran lain = ditolak
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function clinic_private.visit_doctor_change_actor() from public, anon, authenticated, service_role;

-- Untuk layar: tampilkan tombol "Ubah dokter" atau tidak (bukan otorisasi; fungsi koreksi memeriksa ulang).
create function public.clinic_visit_doctor_change_allowed() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return clinic_private.visit_doctor_change_actor() is not null;
end $$;
revoke all on function public.clinic_visit_doctor_change_allowed() from public, anon, service_role;
grant execute on function public.clinic_visit_doctor_change_allowed() to authenticated;

-- ───────────────────────── 4) Tambalan pagar rawat inap (jangkar tunggal) ─────────────────────────
-- Dokter PJ stay boleh berubah HANYA di transaksi yang sama dengan izin untuk kunjungan itu dan pelaku yang sama.
-- visit_id/branch_id tetap tidak boleh berubah apa pun izinnya.
do $patch$
declare
  d text; n integer;
  old_t constant text := $o$if new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name$o$;
  new_t constant text := $n$if ((new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name) and not exists (select 1 from clinic_private.visit_doctor_change_permits p where p.transaction_id = txid_current() and p.actor = auth.uid() and p.visit_id = old.visit_id))$n$;
begin
  d := pg_get_functiondef('public.protect_inpatient_care_staff()'::regprocedure);
  n := (length(d) - length(replace(d, old_t, ''))) / length(old_t);
  if n <> 1 then
    raise exception 'UBAH_DOKTER_DRIFT: jangkar pagar rawat inap ditemukan % kali (harus 1); tidak ada yang diubah', n;
  end if;
  execute replace(d, old_t, new_t);
end $patch$;

-- ───────────────────────── 5) Fungsi koreksi ─────────────────────────
create function public.clinic_change_visit_doctor(
  p_visit_id uuid, p_new_doctor_id uuid, p_reason text, p_request_key text,
  p_follow_lines boolean default true, p_ack_final boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $fn$
declare
  c_alasan_min constant integer := 5;
  v_actor text; v_role public.user_role;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := btrim(coalesce(p_request_key, ''));
  v_follow boolean := coalesce(p_follow_lines, true);
  v_ack boolean := coalesce(p_ack_final, false);
  v_hash text; v_prev public.visit_doctor_changes%rowtype;
  v_visit public.visits%rowtype; v_emp public.employees%rowtype; v_old_emp public.employees%rowtype;
  v_old_id uuid; v_old_name text; v_stay uuid; v_stays integer := 0;
  v_dep_paid integer; v_dep_unpaid integer; v_paid_free integer; v_pay_block boolean := false;
  v_line record; v_changed jsonb := '[]'::jsonb; v_n_changed integer := 0;
  v_k_inv integer := 0; v_k_comp integer := 0; v_k_other integer := 0; v_k_invalid integer := 0;
  v_result jsonb; v_audit uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_AUTH: pengguna tidak terautentikasi';
  end if;
  v_actor := clinic_private.visit_doctor_change_actor();
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_DENIED: ubah dokter PJ hanya dapat dilakukan Owner atau peran yang diberi izin Ubah dokter PJ di Akses Grup';
  end if;
  if p_visit_id is null or p_new_doctor_id is null or length(v_key) < 8 or length(v_key) > 100 then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_INPUT: data permintaan tidak lengkap; muat ulang halaman lalu coba lagi';
  end if;
  if length(v_reason) < c_alasan_min or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_ALASAN: alasan wajib diisi (5-500 huruf)';
  end if;
  v_hash := md5(concat_ws('|', p_visit_id::text, p_new_doctor_id::text, v_reason, v_follow::text, v_ack::text));
  perform pg_advisory_xact_lock(hashtextextended('ubah-dokter-pj:' || auth.uid()::text || ':' || v_key, 0));
  select * into v_prev from public.visit_doctor_changes where actor = auth.uid() and request_key = v_key;
  if found then
    if v_prev.request_hash = v_hash then
      return v_prev.result || jsonb_build_object('idempotent', true);
    end if;
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_KUNCI_BEDA: kunci permintaan ini sudah dipakai untuk isian lain; muat ulang halaman lalu coba lagi';
  end if;
  -- Urutan kunci sama dengan posting tagihan: kunjungan lebih dulu.
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_KUNJUNGAN: kunjungan tidak ditemukan';
  end if;
  if v_actor <> 'OWNER' and not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_CABANG: kunjungan ini di cabang yang tidak dapat Anda akses';
  end if;
  if v_visit.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_ARSIP: kunjungan sudah diarsipkan; dokternya tidak dapat diubah';
  end if;
  select * into v_emp from public.employees where id = p_new_doctor_id;
  if not found or v_emp.trashed_at is not null or v_emp.status is distinct from 'Aktif' then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_PILIHAN: dokter baru harus karyawan aktif';
  end if;
  if not ('doctor' = any (public.clinic_employee_roles(v_emp.jabatan))) then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_PILIHAN: yang dipilih bukan dokter (jabatan: ' || coalesce(v_emp.jabatan, '-') || ')';
  end if;
  if v_emp.branch_id is distinct from v_visit.branch_id and not exists (
       select 1 from public.employee_branch_assignments a where a.employee_id = v_emp.id and a.branch_id = v_visit.branch_id
         and public.employee_assignment_current(a.effective_date, a.end_date)) then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_PILIHAN: dokter baru tidak bertugas di cabang kunjungan ini';
  end if;
  v_old_id := v_visit.doctor_id;
  select * into v_old_emp from public.employees where id = v_old_id;
  v_old_name := coalesce(nullif(btrim(v_old_emp.nama), ''), nullif(btrim(v_visit.dokter), ''));
  if v_old_id is not distinct from p_new_doctor_id and v_visit.dokter is not distinct from v_emp.nama then
    raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_SAMA: dokter baru sama dengan dokter PJ saat ini';
  end if;
  -- Baris rawat inap dikunci setelah kunjungan (urutan sama dengan alur klinis lain).
  select count(*) into v_stays from (select 1 from public.inpatient_records where visit_id = p_visit_id for update) s;
  select id into v_stay from public.inpatient_records where visit_id = p_visit_id order by admitted_at, id limit 1;

  -- Uang: tagihan Lunas yang barisnya mengikuti dokter kunjungan sudah dikomisikan (laporan membaca live).
  select count(*) filter (where i.paid_status = 'Lunas' and dep.x),
         count(*) filter (where i.paid_status is distinct from 'Lunas' and dep.x),
         count(*) filter (where i.paid_status = 'Lunas' and not dep.x)
    into v_dep_paid, v_dep_unpaid, v_paid_free
    from public.invoices i
    cross join lateral (select i.salesperson_id is null and exists (
        select 1 from public.invoice_items ii where ii.invoice_id = i.id and ii.salesperson_id is null
          and (ii.service_performers is null or jsonb_typeof(ii.service_performers) = 'null')) as x) dep
   where i.visit_id = p_visit_id and i.voided_at is null;
  if v_dep_paid > 0 then
    if v_actor <> 'OWNER' then
      raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_FINAL: tagihan kunjungan ini sudah lunas dan komisinya mengikuti dokter kunjungan; hanya Owner yang dapat mengubah dokternya';
    end if;
    if not v_ack then
      raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_FINAL: tagihan lunas kunjungan ini mengikuti dokter kunjungan; komisi bulan pelunasan akan berpindah. Centang konfirmasi Owner untuk melanjutkan';
    end if;
    select exists (
      select 1 from public.payrolls pr
       where (pr.status = 'final' or pr.disahkan_at is not null) and pr.employee_id in (v_old_id, p_new_doctor_id)
         and pr.periode in (select to_char(i.paid_at at time zone 'Asia/Jakarta', 'YYYY-MM') from public.invoices i
                             where i.visit_id = p_visit_id and i.voided_at is null and i.paid_status = 'Lunas' and i.paid_at is not null
                               and i.salesperson_id is null
                               and exists (select 1 from public.invoice_items ii where ii.invoice_id = i.id and ii.salesperson_id is null
                                           and (ii.service_performers is null or jsonb_typeof(ii.service_performers) = 'null')))) into v_pay_block;
    if v_pay_block then
      raise exception using errcode = 'P0001', message = 'UBAH_DOKTER_PAYROLL: slip gaji bulan pelunasan sudah disahkan untuk dokter lama atau baru; dokter tidak dapat diubah';
    end if;
  end if;

  -- Tulis: kunjungan, rawat inap (izin transaksi), baris resep belum ditagih yang masih dokter lama.
  update public.visits set doctor_id = p_new_doctor_id, dokter = v_emp.nama where id = p_visit_id;
  insert into clinic_private.visit_doctor_change_permits values (txid_current(), auth.uid(), p_visit_id) on conflict do nothing;
  update public.inpatient_records set doctor_id = p_new_doctor_id, doctor_name = v_emp.nama where visit_id = p_visit_id;
  delete from clinic_private.visit_doctor_change_permits where transaction_id = txid_current() and actor = auth.uid() and visit_id = p_visit_id;

  if v_old_id is not null then
    for v_line in
      select pi.id, pi.nama_obat, pi.service_performers as sp, pi.compound_recipe_id, pi.billing_withdrawn_at, pi.record_withdrawn_at,
             exists (select 1 from public.invoice_items ii where ii.prescription_item_id = pi.id) as invoiced
        from public.prescription_items pi join public.medical_records m on m.id = pi.medical_record_id
       where m.visit_id = p_visit_id and pi.service_performers ->> 'doctor_id' = v_old_id::text
       order by pi.id for update of pi
    loop
      if v_line.invoiced then v_k_inv := v_k_inv + 1;
      elsif v_line.compound_recipe_id is not null then v_k_comp := v_k_comp + 1;
      elsif v_line.billing_withdrawn_at is not null or v_line.record_withdrawn_at is not null or not v_follow then v_k_other := v_k_other + 1;
      else
        begin
          insert into clinic_private.performer_change_permits values (txid_current(), auth.uid(), v_line.id);
          update public.prescription_items set service_performers = jsonb_build_object('version', 1, 'doctor_id', p_new_doctor_id,
              'staff_id', v_line.sp ->> 'staff_id', 'doctor_name', v_emp.nama, 'staff_name', v_line.sp ->> 'staff_name')
           where id = v_line.id;
          delete from clinic_private.performer_change_permits where transaction_id = txid_current() and actor = auth.uid() and prescription_item_id = v_line.id;
          v_n_changed := v_n_changed + 1;
          v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_line.id, 'nama', v_line.nama_obat));
        exception when sqlstate 'P0001' then
          if sqlerrm like 'CARE_INVALID%' then v_k_invalid := v_k_invalid + 1; else raise; end if;
        end;
      end if;
    end loop;
  end if;

  v_result := jsonb_build_object('ok', true, 'idempotent', false, 'visit_id', p_visit_id, 'inpatient_record_id', v_stay,
    'dokter_lama_id', v_old_id, 'dokter_lama_nama', v_old_name, 'dokter_baru_id', p_new_doctor_id, 'dokter_baru_nama', v_emp.nama,
    'baris_diganti', v_n_changed, 'baris_tetap_tertagih', v_k_inv, 'baris_tetap_racikan', v_k_comp, 'baris_tetap_lain', v_k_other,
    'baris_tetap_tak_valid', v_k_invalid, 'tagihan_belum_lunas_ikut', v_dep_unpaid, 'tagihan_lunas_tak_berubah', v_paid_free,
    'tagihan_lunas_digeser', v_dep_paid, 'audit_id', v_audit);
  insert into public.visit_doctor_changes (id, visit_id, inpatient_record_id, branch_id, old_doctor_id, old_doctor_name, new_doctor_id, new_doctor_name,
      reason, request_key, request_hash, follow_lines, ack_final, actor, actor_role, lines_changed, lines_kept_invoiced, lines_kept_compound,
      lines_kept_other, lines_kept_invalid, invoices_unpaid_following, invoices_paid_unaffected, invoices_paid_shifted, result)
    values (v_audit, p_visit_id, v_stay, v_visit.branch_id, v_old_id, v_old_name, p_new_doctor_id, v_emp.nama, v_reason, v_key, v_hash, v_follow, v_ack,
      auth.uid(), v_role::text, v_changed, v_k_inv, v_k_comp, v_k_other, v_k_invalid, v_dep_unpaid, v_paid_free, v_dep_paid, v_result);
  return v_result;
end $fn$;
revoke all on function public.clinic_change_visit_doctor(uuid, uuid, text, text, boolean, boolean) from public, anon, service_role;
grant execute on function public.clinic_change_visit_doctor(uuid, uuid, text, text, boolean, boolean) to authenticated;

-- ───────────────────────── 6) Pemeriksaan pasca-pasang ─────────────────────────
do $check$
declare d text;
begin
  d := pg_get_functiondef('public.protect_inpatient_care_staff()'::regprocedure);
  if position('visit_doctor_change_permits' in d) = 0 or position('SECURITY DEFINER' in d) = 0
     or has_function_privilege('authenticated', 'public.protect_inpatient_care_staff()', 'execute') then
    raise exception 'UBAH_DOKTER_DRIFT: pagar rawat inap tidak sesuai setelah ditambal';
  end if;
  d := pg_get_functiondef('public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)'::regprocedure);
  if position('SECURITY DEFINER' in d) = 0 or position('visit_doctor_change_actor' in d) = 0 or position('for update' in d) = 0
     or not has_function_privilege('authenticated', 'public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)', 'execute')
     or has_function_privilege('anon', 'public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)', 'execute') then
    raise exception 'UBAH_DOKTER_DRIFT: definisi/ACL fungsi koreksi tidak sesuai';
  end if;
end $check$;
