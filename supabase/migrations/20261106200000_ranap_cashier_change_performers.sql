-- Rawat inap: kasir boleh mengganti Dokter / Non-dokter (service_performers) pada baris
-- yang SUDAH masuk keranjang pending (Obat Khusus / catatan / paket) — keputusan Andri 4 Nov 2026.
--
-- Batas keras (semuanya ditegakkan di database, bukan hanya di layar):
--  * hanya lewat clinic_save_inpatient_cashier, hanya untuk baris keranjang pending kunjungan itu
--    (belum tertagih, belum ditarik, bukan racikan);
--  * peran OWNER/ADMIN/FINANCE/STAFF; DOCTOR ditolak (dokter tidak melakukan pembayaran);
--  * validasi sama persis dengan baris baru (karyawan aktif, cabang, satu dokter + satu non-dokter
--    sesuai jabatan, berbeda orang, aturan grooming) lewat normalize_service_performers;
--  * baris yang pernah punya invoice_items (tertagih/lunas/void/terbit ulang) tetap tersegel;
--    snapshot invoice_items (dasar komisi, laporan penjual, struk) tidak pernah ditulis ulang;
--  * jejak: clinic_pending_cart_edits (siapa/kapan/alasan/sebelum-sesudah) + activity_log.
-- Tidak ada backfill dan tidak ada perubahan uang/stok/jurnal. Definisi berjalan ditambal dengan
-- jangkar eksak dan gagal tertutup bila definisinya tidak seperti yang diharapkan.

do $guard$
begin
 if to_regclass('clinic_private.performer_change_permits') is not null then
  raise exception 'Ranap performer: izin sudah ada; periksa urutan migrasi';
 end if;
 if to_regprocedure('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)') is null
  or to_regprocedure('public.guard_service_line_performers()') is null
  or to_regprocedure('public.normalize_service_performers(jsonb,uuid)') is null
  or to_regclass('public.clinic_pending_cart_edits') is null then
  raise exception 'Ranap performer: prasyarat 0408/0430/0404/0611 tidak lengkap';
 end if;
end $guard$;

-- Izin sempit per transaksi + per baris. Hanya fungsi RPC (SECURITY DEFINER) yang menulisnya;
-- ia dihapus tepat setelah UPDATE dan ikut batal bila transaksi gagal.
create table clinic_private.performer_change_permits (
 transaction_id bigint not null, actor uuid not null, prescription_item_id uuid not null,
 primary key (transaction_id, prescription_item_id)
);
revoke all on clinic_private.performer_change_permits from public,anon,authenticated,service_role;

-- "Berubah" hanya bila id dokter/non-dokter berbeda dari yang tersimpan. Kosong/null = TIDAK berubah
-- (tidak pernah menghapus atribusi tersimpan); bentuk bukan objek dianggap berubah agar divalidasi dan ditolak.
create function clinic_private.service_performers_changed(p_old jsonb,p_new jsonb) returns boolean
language sql immutable set search_path='' as $$
 select p_new is not null and jsonb_typeof(p_new)<>'null' and (jsonb_typeof(p_new)<>'object'
  or nullif(p_new->>'doctor_id','') is distinct from nullif(p_old->>'doctor_id','')
  or nullif(p_new->>'staff_id','') is distinct from nullif(p_old->>'staff_id',''));
$$;
revoke all on function clinic_private.service_performers_changed(jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare p record; d text;
begin
 for p in select * from (values
  -- 1. Pelindung atribusi: UPDATE pelaksana pada baris resep pending hanya dengan izin RPC di atas.
  ('public.guard_service_line_performers()',
   $old$ if tg_op='UPDATE' then
  if tg_table_name='prescription_items' and new.service_performers is not distinct from old.service_performers$old$,
   $new$ if tg_op='UPDATE' then
  if tg_table_name='prescription_items' and new.service_performers is distinct from old.service_performers then
   if (to_jsonb(new)->>'medical_record_id') is not distinct from (to_jsonb(old)->>'medical_record_id') and new.item_id is not distinct from old.item_id
    and old.compound_recipe_id is null and old.billing_withdrawn_at is null
    and exists(select 1 from clinic_private.performer_change_permits p where p.transaction_id=txid_current() and p.actor=auth.uid() and p.prescription_item_id=old.id)
    and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id=old.id) then
    -- Validasi sama dengan baris baru: karyawan aktif, cabang, satu dokter + satu non-dokter, berbeda orang.
    if coalesce(v_service,false)=false and nullif(new.service_performers->>'doctor_id','') is null and nullif(new.service_performers->>'staff_id','') is null then
     new.service_performers:=null;
    else
     new.service_performers:=public.normalize_service_performers(new.service_performers,v_branch);
    end if;
    return new;
   end if;
  end if;
  if tg_table_name='prescription_items' and new.service_performers is not distinct from old.service_performers$new$),
  -- 2. Keranjang kasir: variabel kerja.
  ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
   $old$initial_accounts jsonb;$old$,
   $new$initial_accounts jsonb;v_perf jsonb;v_perf_changed boolean;$new$),
  -- 3. Racikan tetap terkunci: pelaksananya tidak boleh diganti dari kasir.
  ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
   $old$is distinct from rx.item_id then raise exception 'COMPOUND_LOCKED: racikan harus lewat koreksi asli'$old$,
   $new$is distinct from rx.item_id or clinic_private.service_performers_changed(rx.service_performers,nullif(row_value->'service_performers','null')) then raise exception 'COMPOUND_LOCKED: racikan harus lewat koreksi asli'$new$),
  -- 4. Baris pending yang sudah ada: pelaksana berubah -> peran dicek, izin diberikan, lalu UPDATE.
  ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
   $old$update public.prescription_items set package_item_id=$old$,
   $new$v_perf:=nullif(row_value->'service_performers','null');
     v_perf_changed:=clinic_private.service_performers_changed(rx.service_performers,v_perf);
     if v_perf_changed then
      if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE','STAFF')) then
       raise exception using errcode='P0001',message='ACCESS_DENIED: hanya kasir, admin, atau pemilik yang boleh mengganti pelaksana';
      end if;
      insert into clinic_private.performer_change_permits values(txid_current(),auth.uid(),v_id);
     end if;
     update public.prescription_items set service_performers=case when v_perf_changed then v_perf else service_performers end,package_item_id=$new$),
  -- 5. Izin dicabut segera setelah UPDATE baris itu.
  ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
   $old$else 'obat' end where id=v_id;$old$,
   $new$else 'obat' end where id=v_id;
     delete from clinic_private.performer_change_permits where transaction_id=txid_current() and prescription_item_id=v_id;$new$)
 ) as patches(signature,old_text,new_text) loop
  d:=pg_get_functiondef(p.signature::regprocedure);
  if (length(d)-length(replace(d,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'Ranap performer anchor drift: % / %',p.signature,left(p.old_text,80);
  end if;
  execute replace(d,p.old_text,p.new_text);
 end loop;
end $patch$;

-- CREATE OR REPLACE kept owner/ACL/definer/search_path/lock_timeout; assert it and the patched bodies.
do $check$
declare d text;
begin
 d:=pg_get_functiondef('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)'::regprocedure);
 if position('performer_change_permits' in d)=0 or position('service_performers_changed' in d)=0 or position('lock_timeout' in d)=0 or position('SECURITY DEFINER' in d)=0 then
  raise exception 'Ranap performer: definisi kasir tidak sesuai setelah ditambal';
 end if;
 if not has_function_privilege('authenticated','public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)','execute')
  or has_function_privilege('anon','public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)','execute') then
  raise exception 'Ranap performer: ACL kasir berubah';
 end if;
 d:=pg_get_functiondef('public.guard_service_line_performers()'::regprocedure);
 if position('performer_change_permits' in d)=0 or has_function_privilege('authenticated','public.guard_service_line_performers()','execute') then
  raise exception 'Ranap performer: pelindung atribusi tidak sesuai setelah ditambal';
 end if;
end $check$;
