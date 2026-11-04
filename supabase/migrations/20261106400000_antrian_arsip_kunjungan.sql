-- Antrian klinik: tab "Diarsipkan" (keputusan Andri 4 Nov 2026) — kunjungan yang menumpuk (percobaan /
-- dibatalkan / sisa migrasi) bisa DISEMBUNYIKAN dari daftar kerja TANPA dihapus permanen.
--
-- Arsip = sembunyi: baris visits tetap ada (id, status, rekam medis, riwayat pasien tidak berubah); hanya tiga kolom
-- baru yang menandainya. Dapat dipulihkan; kembali ke daftar semula karena status tidak pernah diubah.
--
-- Batas keras (semuanya ditegakkan di database, bukan hanya di layar):
--  * hanya OWNER / ADMIN yang aktif (dicek di dalam RPC SECURITY DEFINER, bukan dari klaim layar) dan hanya untuk
--    cabang yang dapat diaksesnya; STAFF, DOCTOR, FINANCE, anon ditolak. Kolom arsip tidak dapat ditulis langsung
--    (RLS visits_write mengizinkan UPDATE biasa): pelindung BEFORE UPDATE hanya meloloskan perubahan kolom arsip bila
--    izin per-transaksi dari RPC ada;
--  * alasan wajib (5-500 karakter setelah dipangkas);
--  * RPC mengunci baris kunjungan (FOR UPDATE — kunci yang sama dengan set_visit_service_state dan RPC kasir) lalu
--    memeriksa ULANG syarat arsip di dalam transaksi. Kunci permintaan membuat ulangan persis tidak menulis dua kali;
--    keadaan basi (sudah diarsipkan / tidak sedang diarsipkan) ditolak dengan pesan jelas;
--  * jejak: tabel append-only visit_archive_events (siapa/kapan/alasan/status saat itu) + activity_log yang sudah ada
--    (visits sudah termasuk sumber: perubahan archived_at tercatat).
--
-- Syarat "dapat diarsipkan" (minimal yang aman; kunjungan yang belum diperiksa sungguhan boleh, yang punya uang atau
-- isi klinis tidak):
--   status Menunggu / Diperiksa / Pembayaran (bukan Selesai) DAN tidak ada: invoice (batal pun), pembayaran/kwitansi/
--   uang muka (DP)/refund, penjualan racikan, entri tagihan rawat inap, item resep/layanan (tertagih atau belum),
--   racikan, rawat inap (aktif maupun riwayat), persetujuan yang sudah ditandatangani, isi rekam medis (anamnesis,
--   diagnosis, terapi, gejala, hasil penunjang, tindak lanjut, catatan resep, suhu, berat, lampiran, sudah disimpan/
--   dikirim, direvisi), tindak lanjut/rujukan/addendum/item susulan, atau tautan lanjutan rawat inap.
--   Rekam medis KOSONG (draf tanpa isi) dan persetujuan belum tanda tangan tidak menghalangi.
--
-- Pemblokiran lanjutan pada kunjungan yang diarsipkan (pelindung INSERT di tabel kerja + pelindung perubahan siklus
-- di visits): tidak dapat dipanggil/diperiksa/dibayar/dibuatkan rekam medis, tagihan, resep, rawat inap atau
-- persetujuan baru sampai dipulihkan. Riwayat medis pasien tidak disembunyikan (tidak ada pembaca lain yang berubah).
-- Tidak ada backfill, tidak ada perubahan uang/stok/jurnal, RLS tidak berubah.

do $guard$
begin
 if to_regclass('public.visits') is null or to_regclass('public.invoices') is null
  or to_regclass('public.medical_records') is null or to_regclass('public.prescription_items') is null
  or to_regclass('public.inpatient_records') is null or to_regclass('public.consents') is null
  or to_regclass('public.activity_log_sources') is null or to_regclass('clinic_private.performer_change_permits') is null
  or to_regprocedure('public.set_visit_service_state(uuid,text,uuid)') is null
  or to_regprocedure('public.user_can_access_branch(uuid)') is null then
  raise exception 'Arsip kunjungan: prasyarat tidak lengkap; periksa urutan migrasi';
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name like 'archiv%') then
  raise exception 'Arsip kunjungan: kolom arsip sudah ada; periksa urutan migrasi';
 end if;
 -- Daftar tabel berisi uang/isi klinis yang dibaca syarat arsip: setiap tabel dan kolomnya harus ada (gagal tertutup).
 if (select count(*) from information_schema.columns where (table_schema||'.'||table_name,column_name) in (
   ('public.invoices','visit_id'),('public.invoice_payments','invoice_id'),('public.clinic_payment_receipts','visit_id'),('public.clinic_customer_advances','visit_id'),
   ('public.clinic_refunds','visit_id'),('public.clinic_compound_sales','visit_id'),('public.clinic_inpatient_billable_entries','visit_id'),
   ('clinic_private.inpatient_bill_pay_requests','visit_id'),('clinic_private.inpatient_cashier_requests','visit_id'),('public.clinic_pending_cart_edits','visit_id'),
   ('public.clinic_record_item_additions','visit_id'),('public.clinic_record_addenda','visit_id'),('public.inpatient_rx_evidence','visit_id'),
   ('public.inpatient_records','visit_id'),('public.inpatient_records','discharged_at'),('public.consents','visit_id'),('public.consents','status'),
   ('public.follow_ups','visit_id'),('public.visit_referrals','visit_id'),('public.medical_records','visit_id'),('public.prescription_items','medical_record_id'),
   ('public.prescription_items','billing_withdrawn_at'),('public.compounding_recipes','medical_record_id'),('public.invoice_items','prescription_item_id'),
   ('public.medical_records','submission_key'),('public.medical_records','submitted_by'),('public.medical_records','clinical_revision'),
   ('public.medical_records','continued_from_record_id'),('public.visits','continued_from_visit_id'),('public.visits','checked_out_at')))<>30 then
  raise exception 'Arsip kunjungan: tabel/kolom bukti tidak seperti yang diharapkan';
 end if;
end $guard$;

alter table public.visits
 add column archived_at timestamptz,
 add column archived_by uuid,
 add column archive_reason text,
 add constraint visits_archive_consistent check(
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archived_by is not null and archive_reason is not null and length(btrim(archive_reason))>=5));

-- Daftar yang diarsipkan per cabang (tab Diarsipkan) dan pembaca lain yang menyingkirkan arsip tetap memakai
-- visits_belum_selesai_idx; baris arsip jumlahnya kecil.
create index visits_diarsipkan_idx on public.visits (branch_id, archived_at desc) where archived_at is not null;

-- Jejak append-only. Tanpa FK ke visits: bukti tidak boleh ikut hilang bila kunjungan kelak dihapus.
create table public.visit_archive_events (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null,
 branch_id uuid,
 action text not null check(action in ('archive','unarchive')),
 reason text check(reason is null or length(btrim(reason))>=3),
 visit_status text not null,
 request_key text not null unique check(length(request_key) between 8 and 100),
 created_by uuid not null,
 created_by_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(action<>'archive' or reason is not null)
);
create index visit_archive_events_visit on public.visit_archive_events(visit_id, created_at desc);
alter table public.visit_archive_events enable row level security;
revoke all on public.visit_archive_events from public,anon,authenticated,service_role;
grant select on public.visit_archive_events to authenticated;
create policy visit_archive_events_read on public.visit_archive_events for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN'))
  and branch_id is not null and public.user_can_access_branch(branch_id));
create function clinic_private.visit_archive_events_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Jejak arsip kunjungan bersifat tetap dan tidak dapat diubah atau dihapus' using errcode='42501'; end$$;
revoke all on function clinic_private.visit_archive_events_immutable() from public,anon,authenticated,service_role;
create trigger visit_archive_events_immutable before update or delete on public.visit_archive_events
 for each row execute function clinic_private.visit_archive_events_immutable();
create trigger visit_archive_events_no_truncate before truncate on public.visit_archive_events
 for each statement execute function clinic_private.visit_archive_events_immutable();

-- Izin sempit per transaksi + per kunjungan (pola sama dengan performer_change_permits): hanya RPC yang menulisnya
-- dan ia dihapus tepat setelah UPDATE; ikut batal bila transaksi gagal.
create table clinic_private.visit_archive_permits (
 transaction_id bigint not null, actor uuid not null, visit_id uuid not null,
 primary key (transaction_id, visit_id)
);
revoke all on clinic_private.visit_archive_permits from public,anon,authenticated,service_role;

-- Pelindung visits. INSERT: baris baru tidak pernah lahir diarsipkan. UPDATE: kolom arsip hanya berubah dengan izin RPC;
-- selama masih diarsipkan, kolom siklus layanan (status, waktu panggil/mulai/selesai/keluar, pelaksana, dokter, poli) beku
-- sehingga Panggil/Selesaikan/Checkout/ganti pelaksana (set_visit_service_state dan update langsung) ditolak jelas.
create function clinic_private.guard_visit_archive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null then
   raise exception using errcode='42501',message='ARCHIVE_LOCKED: kunjungan baru tidak dapat dibuat dalam keadaan diarsipkan';
  end if;
  return new;
 end if;
 if (new.archived_at,new.archived_by,new.archive_reason) is distinct from (old.archived_at,old.archived_by,old.archive_reason) then
  if not exists(select 1 from clinic_private.visit_archive_permits p
   where p.transaction_id=txid_current() and p.visit_id=old.id and p.actor=auth.uid()) then
   raise exception using errcode='42501',message='ARCHIVE_LOCKED: arsip kunjungan hanya dapat diubah oleh pemilik/admin lewat tombol Arsipkan/Pulihkan';
  end if;
  return new;
 end if;
 if old.archived_at is not null and (new.status,new.called_at,new.service_started_at,new.service_finished_at,new.checked_in_at,
   new.checked_out_at,new.service_provider_id,new.doctor_id,new.dokter,new.poli)
  is distinct from (old.status,old.called_at,old.service_started_at,old.service_finished_at,old.checked_in_at,
   old.checked_out_at,old.service_provider_id,old.doctor_id,old.dokter,old.poli) then
  raise exception using errcode='P0001',message='VISIT_ARCHIVED: kunjungan ini sudah diarsipkan. Pulihkan dulu dari tab Diarsipkan sebelum dipanggil, diperiksa atau dibayar';
 end if;
 return new;
end $$;
revoke all on function clinic_private.guard_visit_archive() from public,anon,authenticated,service_role;
create trigger a0_guard_visit_archive before insert or update on public.visits
 for each row execute function clinic_private.guard_visit_archive();

-- Pelindung tabel kerja: tidak ada rekam medis/resep/tagihan/pembayaran/uang muka/racikan/rawat inap/persetujuan baru untuk
-- kunjungan yang diarsipkan. Hanya INSERT (baris lama tidak disentuh).
create function clinic_private.refuse_archived_visit() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_visit uuid;
begin
 if tg_table_name='prescription_items' then
  select mr.visit_id into v_visit from public.medical_records mr where mr.id=new.medical_record_id;
 else
  v_visit:=(to_jsonb(new)->>'visit_id')::uuid;
 end if;
 if v_visit is not null and exists(select 1 from public.visits v where v.id=v_visit and v.archived_at is not null) then
  raise exception using errcode='P0001',message='VISIT_ARCHIVED: kunjungan ini sudah diarsipkan. Pulihkan dulu dari tab Diarsipkan sebelum membuat rekam medis, resep, tagihan atau pembayaran';
 end if;
 return new;
end $$;
revoke all on function clinic_private.refuse_archived_visit() from public,anon,authenticated,service_role;
do $trg$
declare t text;
begin
 foreach t in array array['medical_records','prescription_items','invoices','clinic_payment_receipts','clinic_customer_advances',
   'clinic_compound_sales','clinic_inpatient_billable_entries','inpatient_records','consents'] loop
  execute format('create trigger a0_refuse_archived_visit before insert on public.%I for each row execute function clinic_private.refuse_archived_visit()',t);
 end loop;
end $trg$;

-- Syarat arsip: daftar alasan penghalang (kosong = boleh). Dibaca di dalam transaksi RPC saat baris kunjungan terkunci.
create function clinic_private.visit_archive_blockers(p_visit uuid) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare v public.visits%rowtype; b text[]:='{}';
begin
 select * into v from public.visits where id=p_visit;
 if not found then return array['kunjungan tidak ditemukan']; end if;
 if v.status::text not in ('Menunggu','Diperiksa','Pembayaran') or v.checked_out_at is not null then
  b:=b||'kunjungan sudah selesai (riwayat tidak diarsipkan)'::text; end if;
 if exists(select 1 from public.invoices i where i.visit_id=p_visit) then b:=b||'sudah ada tagihan/invoice (termasuk yang dibatalkan)'::text; end if;
 if exists(select 1 from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.visit_id=p_visit)
  or exists(select 1 from public.clinic_payment_receipts r where r.visit_id=p_visit) then b:=b||'sudah ada pembayaran'::text; end if;
 if exists(select 1 from public.clinic_customer_advances a where a.visit_id=p_visit) then b:=b||'sudah ada uang muka/DP'::text; end if;
 if exists(select 1 from public.clinic_refunds r where r.visit_id=p_visit) then b:=b||'sudah ada refund'::text; end if;
 if exists(select 1 from public.clinic_compound_sales s where s.visit_id=p_visit) then b:=b||'sudah ada penjualan racikan'::text; end if;
 if exists(select 1 from public.clinic_inpatient_billable_entries e where e.visit_id=p_visit)
  or exists(select 1 from clinic_private.inpatient_bill_pay_requests e where e.visit_id=p_visit)
  or exists(select 1 from clinic_private.inpatient_cashier_requests e where e.visit_id=p_visit)
  or exists(select 1 from public.clinic_pending_cart_edits e where e.visit_id=p_visit) then b:=b||'ada jejak tagihan/kasir rawat inap'::text; end if;
 if exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id
   where mr.visit_id=p_visit and pi.billing_withdrawn_at is null
    and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id=pi.id)) then
  b:=b||'ada tagihan tertunda (item/layanan belum ditagih)'::text;
 elsif exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id=p_visit) then
  b:=b||'ada item resep/layanan pada rekam medis'::text;
 end if;
 if exists(select 1 from public.compounding_recipes c join public.medical_records mr on mr.id=c.medical_record_id where mr.visit_id=p_visit) then
  b:=b||'ada racikan pada rekam medis'::text; end if;
 if exists(select 1 from public.inpatient_records s where s.visit_id=p_visit and s.discharged_at is null) then b:=b||'rawat inap masih berjalan'::text;
 elsif exists(select 1 from public.inpatient_records s where s.visit_id=p_visit) or exists(select 1 from public.inpatient_rx_evidence e where e.visit_id=p_visit) then
  b:=b||'ada riwayat rawat inap'::text; end if;
 if exists(select 1 from public.consents c where c.visit_id=p_visit and c.status='sudah_ttd') then b:=b||'ada persetujuan yang sudah ditandatangani'::text; end if;
 if exists(select 1 from public.medical_records mr where mr.visit_id=p_visit and (
   coalesce(nullif(btrim(mr.diagnosis),''),nullif(btrim(mr.anamnesis),''),nullif(btrim(mr.therapy),''),nullif(btrim(mr.gejala_klinis),''),
    nullif(btrim(mr.hasil_penunjang),''),nullif(btrim(mr.follow_up),''),nullif(btrim(mr.catatan_resep),'')) is not null
   or mr.suhu is not null or mr.berat is not null or coalesce(cardinality(mr.penunjang_urls),0)>0
   or mr.submission_key is not null or mr.submitted_by is not null or mr.clinical_revision>0 or mr.continued_from_record_id is not null)) then
  b:=b||'rekam medis sudah berisi data klinis'::text; end if;
 if exists(select 1 from public.follow_ups f where f.visit_id=p_visit) or exists(select 1 from public.visit_referrals f where f.visit_id=p_visit)
  or exists(select 1 from public.clinic_record_addenda f where f.visit_id=p_visit) or exists(select 1 from public.clinic_record_item_additions f where f.visit_id=p_visit) then
  b:=b||'ada tindak lanjut/rujukan/addendum'::text; end if;
 if v.continued_from_visit_id is not null or exists(select 1 from public.visits o where o.continued_from_visit_id=p_visit) then
  b:=b||'terhubung ke kunjungan lanjutan rawat inap'::text; end if;
 return b;
end $$;
revoke all on function clinic_private.visit_archive_blockers(uuid) from public,anon,authenticated,service_role;

-- Satu pintu untuk arsip dan pulihkan (kunci, peran, kunci permintaan, jejak sama).
create function clinic_private.change_visit_archive(p_visit_id uuid,p_reason text,p_request_key text,p_archive boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_key text:=nullif(btrim(p_request_key),'');v_reason text:=nullif(btrim(p_reason),'');
 v public.visits%rowtype;v_event public.visit_archive_events%rowtype;v_action text:=case when p_archive then 'archive' else 'unarchive' end;
 v_actor uuid:=auth.uid();v_name text;v_blockers text[];v_now timestamptz;
begin
 if coalesce(auth.role(),'')<>'authenticated' or v_actor is null
  or not exists(select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('OWNER','ADMIN')) then
  raise exception using errcode='P0001',message='ACCESS_DENIED: hanya pemilik atau admin yang aktif yang boleh mengarsipkan atau memulihkan kunjungan';
 end if;
 if p_visit_id is null or v_key is null or length(v_key) not between 8 and 100 then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: muat ulang halaman lalu coba lagi';
 end if;
 if p_archive and (v_reason is null or length(v_reason)<5 or length(v_reason)>500) then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: alasan arsip wajib diisi (5-500 karakter)';
 end if;
 if not p_archive and v_reason is not null and (length(v_reason)<3 or length(v_reason)>500) then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: alasan pemulihan 3-500 karakter bila diisi';
 end if;
 -- Kunci baris kunjungan lebih dulu (urutan yang sama dengan set_visit_service_state dan RPC kasir), baru periksa ulang.
 select * into v from public.visits where id=p_visit_id for update;
 if not found or not public.user_can_access_branch(v.branch_id) then
  raise exception using errcode='P0001',message='ARCHIVE_NOT_FOUND: kunjungan tidak ditemukan atau cabang tidak dapat diakses';
 end if;
 select * into v_event from public.visit_archive_events where request_key=v_key;
 if found then
  if v_event.visit_id=p_visit_id and v_event.action=v_action and v_event.created_by=v_actor then
   return jsonb_build_object('event_id',v_event.id,'visit_id',p_visit_id,'action',v_action,'replay',true,'at',v_event.created_at);
  end if;
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: kunci permintaan sudah dipakai untuk tindakan lain; muat ulang halaman';
 end if;
 if p_archive then
  if v.archived_at is not null then
   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan; muat ulang daftar antrian';
  end if;
  v_blockers:=clinic_private.visit_archive_blockers(p_visit_id);
  if cardinality(v_blockers)>0 then
   raise exception using errcode='P0001',message='ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan karena '||array_to_string(v_blockers,'; ')||'.';
  end if;
 elsif v.archived_at is null then
  raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini tidak sedang diarsipkan; muat ulang daftar antrian';
 end if;
 select coalesce(nullif(full_name,''),v_actor::text) into v_name from public.profiles where id=v_actor;
 v_now:=clock_timestamp();
 insert into clinic_private.visit_archive_permits values(txid_current(),v_actor,p_visit_id);
 if p_archive then
  update public.visits set archived_at=v_now,archived_by=v_actor,archive_reason=v_reason where id=p_visit_id;
 else
  update public.visits set archived_at=null,archived_by=null,archive_reason=null where id=p_visit_id;
 end if;
 delete from clinic_private.visit_archive_permits where transaction_id=txid_current() and visit_id=p_visit_id;
 insert into public.visit_archive_events(visit_id,branch_id,action,reason,visit_status,request_key,created_by,created_by_name,created_at)
 values(p_visit_id,v.branch_id,v_action,v_reason,v.status::text,v_key,v_actor,v_name,v_now) returning * into v_event;
 return jsonb_build_object('event_id',v_event.id,'visit_id',p_visit_id,'action',v_action,'replay',false,'at',v_now);
end $$;
revoke all on function clinic_private.change_visit_archive(uuid,text,text,boolean) from public,anon,authenticated,service_role;

create function public.clinic_archive_visit(p_visit_id uuid,p_reason text,p_request_key text) returns jsonb
language sql security definer set search_path='' as $$ select clinic_private.change_visit_archive(p_visit_id,p_reason,p_request_key,true) $$;
create function public.clinic_unarchive_visit(p_visit_id uuid,p_reason text,p_request_key text) returns jsonb
language sql security definer set search_path='' as $$ select clinic_private.change_visit_archive(p_visit_id,p_reason,p_request_key,false) $$;
revoke all on function public.clinic_archive_visit(uuid,text,text),public.clinic_unarchive_visit(uuid,text,text) from public,anon,service_role;
grant execute on function public.clinic_archive_visit(uuid,text,text),public.clinic_unarchive_visit(uuid,text,text) to authenticated;
comment on function public.clinic_archive_visit(uuid,text,text) is 'Arsipkan kunjungan (sembunyikan dari antrian, bukan hapus). Hanya OWNER/ADMIN; syarat diperiksa ulang di bawah kunci baris.';

-- Perubahan archived_at ikut tercatat di activity_log yang sudah ada (nilai sebelum/sesudah; alasan tidak disalin ke log umum).
do $log$
declare n integer;
begin
 update public.activity_log_sources set value_keys=value_keys||array['archived_at'] where entity='visits' and value_keys=array['status'];
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Arsip kunjungan: registri activity_log untuk visits tidak seperti yang diharapkan'; end if;
end $log$;

-- Daftar Rekam Medis (/klinik/rekam-medis, tanpa filter hewan) tidak lagi memuat kunjungan yang diarsipkan (draf kosong yang
-- menumpuk). Riwayat satu hewan (p_pet terisi) TETAP menampilkan semuanya: arsip tidak menyembunyikan riwayat medis pasien.
-- Definisi berjalan ditambal dengan jangkar eksak dan gagal tertutup bila bentuknya berbeda.
do $list$
declare d text; old_text text:=$old$where (p_pet is null or v.pet_id = p_pet)$old$; new_text text:=$new$where (p_pet is null or v.pet_id = p_pet)
       and (p_pet is not null or v.archived_at is null)$new$;
begin
 if to_regprocedure('public.daftar_rekam_medis(uuid)') is null then raise exception 'Arsip kunjungan: daftar_rekam_medis(uuid) tidak ada'; end if;
 d:=pg_get_functiondef('public.daftar_rekam_medis(uuid)'::regprocedure);
 if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 or position('archived_at' in d)>0 then
  raise exception 'Arsip kunjungan: definisi daftar_rekam_medis tidak seperti yang diharapkan';
 end if;
 execute replace(d,old_text,new_text);
end $list$;
