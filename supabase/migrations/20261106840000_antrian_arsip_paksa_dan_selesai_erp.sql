-- Antrian klinik: lanjutan arsip (keputusan Andri 4 Nov 2026, setelah PR #438).
--
--  1. OWNER (bukan ADMIN) boleh MEMAKSA arsip kunjungan walau berstatus Diperiksa / Pembayaran dan rekam medisnya
--     sudah berisi data (isi klinis, item tertunda, racikan, persetujuan bertanda tangan, tindak lanjut, dst).
--     Wajib: alasan (>=5 karakter bermakna = huruf/angka, bukan tanda baca), kata konfirmasi "PAKSA", dan jejak
--     append-only (forced=true + daftar syarat yang dilewati). Yang TIDAK PERNAH bisa dipaksa (uang/stok/rawat inap):
--     invoice (batal pun), pembayaran/kwitansi, uang muka, refund, penjualan racikan, jejak tagihan/kasir rawat inap,
--     rawat inap (berjalan maupun riwayat), dan kunjungan Selesai hasil impor / asal tidak pasti.
--  2. Kunjungan berstatus Selesai boleh diarsipkan HANYA bila berasal dari ERP (alur biasa), bukan riwayat yang
--     diimpor sebelum migrasi. Penanda impor yang dipakai: visits.legacy_source_key / legacy_record_no /
--     legacy_source_hash (diisi SEMUA jalur impor rekam medis: 0907, 0908, 0910, massal, atomik, jejak_setara,
--     penulis_riwayat_bersama). Bukti ERP positif: checked_in_at terisi (registrasi, lanjutan rawat inap).
--     Selesai tanpa penanda impor tetapi tanpa checked_in_at = "tidak pasti" => DITOLAK (gagal tertutup) sampai Reza
--     mengklasifikasikannya (lihat docs/2026-11-04-antrian-arsip-lanjutan.md).
--  3. Pengaman PR #438 dipertahankan: kunci FOR UPDATE, pemeriksaan ulang di bawah kunci, permit per transaksi,
--     refuse_archived_visit, guard_visit_archive. Ditambah lock_timeout pada RPC arsip (saran review S1).
--
-- Tidak ada backfill, tidak ada perubahan uang/stok/jurnal, RLS tidak berubah. Tanda tangan publik lama
-- (clinic_archive_visit/clinic_unarchive_visit) tidak berubah.

do $guard$
declare d text;
begin
 if to_regprocedure('clinic_private.change_visit_archive(uuid,text,text,boolean)') is null
  or to_regprocedure('clinic_private.visit_archive_blockers(uuid)') is null
  or to_regprocedure('public.clinic_archive_visit(uuid,text,text)') is null
  or to_regclass('public.visit_archive_events') is null then
  raise exception 'Arsip lanjutan: prasyarat (PR #438) tidak lengkap; periksa urutan migrasi';
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='visit_archive_events' and column_name in ('forced','overridden'))
  or to_regprocedure('clinic_private.change_visit_archive(uuid,text,text,boolean,boolean,text)') is not null
  or to_regprocedure('public.clinic_force_archive_visit(uuid,text,text,text)') is not null
  or to_regprocedure('clinic_private.visit_archive_classify(uuid)') is not null then
  raise exception 'Arsip lanjutan: objek sudah ada; periksa urutan migrasi';
 end if;
 -- definisi yang akan diganti harus persis bentuk PR #438 (gagal tertutup bila sudah berubah)
 d:=pg_get_functiondef('clinic_private.change_visit_archive(uuid,text,text,boolean)'::regprocedure);
 if position('ARCHIVE_STALE: kunjungan ini sudah diarsipkan' in d)=0 or position('visit_archive_blockers(p_visit_id)' in d)=0 or position('lock_timeout' in d)>0 then
  raise exception 'Arsip lanjutan: change_visit_archive tidak seperti yang diharapkan';
 end if;
 d:=pg_get_functiondef('clinic_private.visit_archive_blockers(uuid)'::regprocedure);
 if position('kunjungan sudah selesai (riwayat tidak diarsipkan)' in d)=0 or position('ada persetujuan yang sudah ditandatangani' in d)=0 then
  raise exception 'Arsip lanjutan: visit_archive_blockers tidak seperti yang diharapkan';
 end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='visits'
   and column_name in ('legacy_source_key','legacy_record_no','legacy_source_hash','checked_in_at','checked_out_at'))<>5 then
  raise exception 'Arsip lanjutan: kolom penanda asal kunjungan tidak lengkap';
 end if;
end $guard$;

alter table public.visit_archive_events
 add column forced boolean not null default false,
 add column overridden text[] not null default '{}',
 add constraint visit_archive_events_forced_consistent check(forced or cardinality(overridden)=0);

-- Asal kunjungan untuk aturan "Selesai": 'impor' (penanda impor terisi), 'erp' (bukti alur ERP: checked_in_at), selain itu 'tidak_pasti'.
create function clinic_private.visit_archive_origin(p_visit uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when v.legacy_source_key is not null or v.legacy_record_no is not null or v.legacy_source_hash is not null then 'impor'
             when v.checked_in_at is not null then 'erp'
             else 'tidak_pasti' end
 from public.visits v where v.id=p_visit $$;
revoke all on function clinic_private.visit_archive_origin(uuid) from public,anon,authenticated,service_role;

-- Penghalang dikelompokkan: "hard" tidak pernah bisa dipaksa (uang, stok, rawat inap, riwayat impor); "soft" hanya
-- isi klinis/antrean yang tetap utuh (arsip = sembunyi) dan bisa dipaksa oleh OWNER.
create function clinic_private.visit_archive_classify(p_visit uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.visits%rowtype; hard text[]:='{}'; soft text[]:='{}'; o text;
begin
 select * into v from public.visits where id=p_visit;
 if not found then return jsonb_build_object('hard',jsonb_build_array('kunjungan tidak ditemukan'),'soft','[]'::jsonb); end if;
 if v.status::text not in ('Menunggu','Diperiksa','Pembayaran','Selesai') then
  hard:=hard||'status kunjungan tidak dikenal'::text; end if;
 if v.status::text='Selesai' or v.checked_out_at is not null then
  o:=clinic_private.visit_archive_origin(p_visit);
  if o='impor' then hard:=hard||'kunjungan sudah selesai dan berasal dari impor riwayat lama (riwayat tidak diarsipkan)'::text;
  elsif o<>'erp' then hard:=hard||'kunjungan sudah selesai dan asalnya tidak dapat dipastikan berasal dari ERP (belum diklasifikasi)'::text; end if;
 end if;
 -- HARD: uang / stok / rawat inap
 if exists(select 1 from public.invoices i where i.visit_id=p_visit) then hard:=hard||'sudah ada tagihan/invoice (termasuk yang dibatalkan)'::text; end if;
 if exists(select 1 from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.visit_id=p_visit)
  or exists(select 1 from public.clinic_payment_receipts r where r.visit_id=p_visit) then hard:=hard||'sudah ada pembayaran'::text; end if;
 if exists(select 1 from public.clinic_customer_advances a where a.visit_id=p_visit) then hard:=hard||'sudah ada uang muka/DP'::text; end if;
 if exists(select 1 from public.clinic_refunds r where r.visit_id=p_visit) then hard:=hard||'sudah ada refund'::text; end if;
 if exists(select 1 from public.clinic_compound_sales s where s.visit_id=p_visit) then hard:=hard||'sudah ada penjualan racikan'::text; end if;
 if exists(select 1 from public.clinic_inpatient_billable_entries e where e.visit_id=p_visit)
  or exists(select 1 from clinic_private.inpatient_bill_pay_requests e where e.visit_id=p_visit)
  or exists(select 1 from clinic_private.inpatient_cashier_requests e where e.visit_id=p_visit)
  or exists(select 1 from public.clinic_pending_cart_edits e where e.visit_id=p_visit) then hard:=hard||'ada jejak tagihan/kasir rawat inap'::text; end if;
 if exists(select 1 from public.inpatient_records s where s.visit_id=p_visit and s.discharged_at is null) then hard:=hard||'rawat inap masih berjalan'::text;
 elsif exists(select 1 from public.inpatient_records s where s.visit_id=p_visit) or exists(select 1 from public.inpatient_rx_evidence e where e.visit_id=p_visit) then
  hard:=hard||'ada riwayat rawat inap'::text; end if;
 -- SOFT: isi klinis / antrean
 if exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id
   where mr.visit_id=p_visit and pi.billing_withdrawn_at is null
    and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id=pi.id)) then
  soft:=soft||'ada tagihan tertunda (item/layanan belum ditagih)'::text;
 elsif exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id=p_visit) then
  soft:=soft||'ada item resep/layanan pada rekam medis'::text;
 end if;
 if exists(select 1 from public.compounding_recipes c join public.medical_records mr on mr.id=c.medical_record_id where mr.visit_id=p_visit) then
  soft:=soft||'ada racikan pada rekam medis'::text; end if;
 if exists(select 1 from public.consents c where c.visit_id=p_visit and c.status='sudah_ttd') then soft:=soft||'ada persetujuan yang sudah ditandatangani'::text; end if;
 if exists(select 1 from public.medical_records mr where mr.visit_id=p_visit and (
   coalesce(nullif(btrim(mr.diagnosis),''),nullif(btrim(mr.anamnesis),''),nullif(btrim(mr.therapy),''),nullif(btrim(mr.gejala_klinis),''),
    nullif(btrim(mr.hasil_penunjang),''),nullif(btrim(mr.follow_up),''),nullif(btrim(mr.catatan_resep),'')) is not null
   or mr.suhu is not null or mr.berat is not null or coalesce(cardinality(mr.penunjang_urls),0)>0
   or mr.submission_key is not null or mr.submitted_by is not null or mr.clinical_revision>0 or mr.continued_from_record_id is not null)) then
  soft:=soft||'rekam medis sudah berisi data klinis'::text; end if;
 if exists(select 1 from public.follow_ups f where f.visit_id=p_visit) or exists(select 1 from public.visit_referrals f where f.visit_id=p_visit)
  or exists(select 1 from public.clinic_record_addenda f where f.visit_id=p_visit) or exists(select 1 from public.clinic_record_item_additions f where f.visit_id=p_visit) then
  soft:=soft||'ada tindak lanjut/rujukan/addendum'::text; end if;
 if v.continued_from_visit_id is not null or exists(select 1 from public.visits x where x.continued_from_visit_id=p_visit) then
  soft:=soft||'terhubung ke kunjungan lanjutan rawat inap'::text; end if;
 return jsonb_build_object('hard',to_jsonb(hard),'soft',to_jsonb(soft));
end $$;
revoke all on function clinic_private.visit_archive_classify(uuid) from public,anon,authenticated,service_role;

-- Nama lama dipertahankan (pemanggil/tes lama): gabungan hard+soft.
create or replace function clinic_private.visit_archive_blockers(p_visit uuid) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=clinic_private.visit_archive_classify(p_visit);
begin
 return array(select jsonb_array_elements_text(c->'hard'))||array(select jsonb_array_elements_text(c->'soft'));
end $$;

-- Satu pintu (kunci, peran, kunci permintaan, jejak sama seperti sebelumnya) + mode paksa untuk OWNER.
create function clinic_private.change_visit_archive(p_visit_id uuid,p_reason text,p_request_key text,p_archive boolean,p_force boolean,p_confirm text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_key text:=nullif(btrim(p_request_key),'');v_reason text:=nullif(btrim(p_reason),'');
 v public.visits%rowtype;v_event public.visit_archive_events%rowtype;v_action text:=case when p_archive then 'archive' else 'unarchive' end;
 v_actor uuid:=auth.uid();v_name text;v_cls jsonb;v_hard text[];v_soft text[];v_now timestamptz;v_over text[]:='{}';
begin
 if coalesce(auth.role(),'')<>'authenticated' or v_actor is null
  or not exists(select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role in ('OWNER','ADMIN')) then
  raise exception using errcode='P0001',message='ACCESS_DENIED: hanya pemilik atau admin yang aktif yang boleh mengarsipkan atau memulihkan kunjungan';
 end if;
 if p_force and not exists(select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role='OWNER') then
  raise exception using errcode='P0001',message='FORCE_DENIED: hanya pemilik yang boleh memaksa arsip';
 end if;
 if p_visit_id is null or v_key is null or length(v_key) not between 8 and 100 then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: muat ulang halaman lalu coba lagi';
 end if;
 if p_force and not p_archive then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: paksa hanya berlaku untuk mengarsipkan';
 end if;
 if p_archive and (v_reason is null or length(v_reason)<5 or length(v_reason)>500) then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: alasan arsip wajib diisi (5-500 karakter)';
 end if;
 if p_force and length(regexp_replace(v_reason,'[^[:alnum:]]','','g'))<5 then
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: alasan arsip paksa harus berisi minimal 5 huruf/angka (bukan hanya tanda baca)';
 end if;
 if p_force and p_confirm is distinct from 'PAKSA' then
  raise exception using errcode='P0001',message='FORCE_CONFIRM: ketik PAKSA untuk mengonfirmasi arsip paksa';
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
  if v_event.visit_id=p_visit_id and v_event.action=v_action and v_event.created_by=v_actor and v_event.forced=p_force then
   return jsonb_build_object('event_id',v_event.id,'visit_id',p_visit_id,'action',v_action,'replay',true,'at',v_event.created_at,'forced',v_event.forced,'overridden',to_jsonb(v_event.overridden));
  end if;
  raise exception using errcode='P0001',message='ARCHIVE_INVALID: kunci permintaan sudah dipakai untuk tindakan lain; muat ulang halaman';
 end if;
 if p_archive then
  if v.archived_at is not null then
   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan; muat ulang daftar antrian';
  end if;
  v_cls:=clinic_private.visit_archive_classify(p_visit_id);
  v_hard:=array(select jsonb_array_elements_text(v_cls->'hard'));v_soft:=array(select jsonb_array_elements_text(v_cls->'soft'));
  if cardinality(v_hard)>0 then
   raise exception using errcode='P0001',message='ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan'||case when p_force then ' (walau dipaksa)' else '' end||' karena '||array_to_string(v_hard||v_soft,'; ')||'.';
  end if;
  if cardinality(v_soft)>0 then
   if not p_force then
    raise exception using errcode='P0001',message='ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan karena '||array_to_string(v_soft,'; ')||'. Pemilik dapat memaksa arsip dengan konfirmasi tambahan.';
   end if;
   v_over:=v_soft;
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
 insert into public.visit_archive_events(visit_id,branch_id,action,reason,visit_status,request_key,created_by,created_by_name,created_at,forced,overridden)
 values(p_visit_id,v.branch_id,v_action,v_reason,v.status::text,v_key,v_actor,v_name,v_now,p_force,v_over) returning * into v_event;
 return jsonb_build_object('event_id',v_event.id,'visit_id',p_visit_id,'action',v_action,'replay',false,'at',v_now,'forced',p_force,'overridden',to_jsonb(v_over));
end $$;
revoke all on function clinic_private.change_visit_archive(uuid,text,text,boolean,boolean,text) from public,anon,authenticated,service_role;

-- Tanda tangan 4-argumen lama menjadi pembungkus (tidak pernah memaksa) supaya satu-satunya badan logika adalah di atas.
create or replace function clinic_private.change_visit_archive(p_visit_id uuid,p_reason text,p_request_key text,p_archive boolean)
returns jsonb language sql security definer set search_path='' as $$
 select clinic_private.change_visit_archive(p_visit_id,p_reason,p_request_key,p_archive,false,null) $$;

create function public.clinic_force_archive_visit(p_visit_id uuid,p_reason text,p_request_key text,p_confirm text) returns jsonb
language sql security definer set search_path='' as $$ select clinic_private.change_visit_archive(p_visit_id,p_reason,p_request_key,true,true,p_confirm) $$;
revoke all on function public.clinic_force_archive_visit(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.clinic_force_archive_visit(uuid,text,text,text) to authenticated;
comment on function public.clinic_force_archive_visit(uuid,text,text,text) is 'Arsip PAKSA kunjungan (hanya OWNER; alasan + kata PAKSA wajib). Tidak melewati invoice/pembayaran/DP/refund/racikan terjual/rawat inap/riwayat impor.';
