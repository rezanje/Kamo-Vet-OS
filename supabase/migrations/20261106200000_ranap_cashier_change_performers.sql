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
--    snapshot invoice_items (dasar komisi, laporan penjual, struk) tidak pernah ditulis ulang.
--    Baris pending yang masih menunjuk invoice yang DIBATALKAN dikembalikan oleh kasir sebagai
--    performers_sealed=true (layar tidak membuka pemilihnya); bila tetap dikirim, RPC menolak dengan
--    pesan khusus (nama baris + alasan + jalan keluar), bukan galat umum;
--  * MENGOSONGKAN atribusi bukan tindakan yang disetujui: payload kosong ({} / dokter+non-dokter null /
--    string kosong) sama dengan null/tidak dikirim = TIDAK berubah. Hanya penggantian eksplisit ke
--    pasangan dokter/non-dokter lain yang valid yang dihitung berubah; pelindung juga menolak penulisan kosong;
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
  or to_regprocedure('public.clinic_read_inpatient_cashier(uuid,uuid)') is null
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

-- "Berubah" hanya bila payload menyebut paling sedikit satu dokter/non-dokter DAN id-nya berbeda dari yang
-- tersimpan. Hilang / null / {} / pasangan null atau string kosong = TIDAK berubah (tidak pernah mengosongkan
-- atribusi tersimpan). Bentuk bukan objek dianggap berubah agar divalidasi dan ditolak oleh normalize.
create function clinic_private.service_performers_changed(p_old jsonb,p_new jsonb) returns boolean
language sql immutable set search_path='' as $$
 select p_new is not null and jsonb_typeof(p_new)<>'null' and (jsonb_typeof(p_new)<>'object'
  or ((nullif(p_new->>'doctor_id','') is not null or nullif(p_new->>'staff_id','') is not null)
   and (nullif(p_new->>'doctor_id','') is distinct from nullif(p_old->>'doctor_id','')
    or nullif(p_new->>'staff_id','') is distinct from nullif(p_old->>'staff_id',''))));
$$;
revoke all on function clinic_private.service_performers_changed(jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare p record; d text; pre text;
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
    -- Mengosongkan atribusi tidak diizinkan (hanya mengganti); jangan biarkan normalize mengubah NULL/{} menjadi snapshot kosong.
    if new.service_performers is null or (jsonb_typeof(new.service_performers)='object'
     and nullif(new.service_performers->>'doctor_id','') is null and nullif(new.service_performers->>'staff_id','') is null) then
     raise exception using errcode='P0001',message='CARE_INVALID: atribusi tersimpan tidak boleh dikosongkan; pilih dokter/non-dokter pengganti';
    end if;
    -- Validasi sama dengan baris baru: karyawan aktif, cabang, satu dokter + satu non-dokter, berbeda orang.
    new.service_performers:=public.normalize_service_performers(new.service_performers,v_branch);
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
      -- Baris pending yang masih menunjuk invoice yang dibatalkan/terbit ulang tersegel: tolak dengan pesan yang dapat ditindaklanjuti.
      if exists(select 1 from public.invoice_items l where l.prescription_item_id=v_id) then
       raise exception using errcode='P0001',message='CARE_INVALID: pelaksana baris "'||coalesce(rx.nama_obat,'?')||'" tidak dapat diganti: baris ini pernah masuk invoice yang dibatalkan atau diterbitkan ulang. Muat ulang halaman; pelaksana baris ini hanya dapat diubah lewat koreksi dokumen invoice.';
      end if;
      insert into clinic_private.performer_change_permits values(txid_current(),auth.uid(),v_id);
     end if;
     update public.prescription_items set service_performers=case when v_perf_changed then v_perf else service_performers end,package_item_id=$new$),
  -- 5. Izin dicabut segera setelah UPDATE baris itu.
  ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
   $old$else 'obat' end where id=v_id;$old$,
   $new$else 'obat' end where id=v_id;
     delete from clinic_private.performer_change_permits where transaction_id=txid_current() and prescription_item_id=v_id;$new$),
  -- 6. Pembacaan keranjang: tandai baris pending yang masih menunjuk invoice (yang dibatalkan) sebagai tersegel.
  --    Hanya pada keluaran 'rows'; rows untuk snapshot/ekspor audit tidak berubah, jadi snapshot tidak bergeser.
  ('public.clinic_read_inpatient_cashier(uuid,uuid)',
   $old$'rows',rows,'quote'$old$,
   $new$'rows',case when rows is null then null else (select coalesce(jsonb_agg(t.v||jsonb_build_object('performers_sealed',exists(select 1 from public.invoice_items l where l.prescription_item_id=(t.v->>'id')::uuid)) order by t.n),'[]') from jsonb_array_elements(rows) with ordinality as t(v,n)) end,'quote'$new$)
 ) as patches(signature,old_text,new_text) loop
  d:=pg_get_functiondef(p.signature::regprocedure);
  if (length(d)-length(replace(d,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'Ranap performer anchor drift: % / %',p.signature,left(p.old_text,80);
  end if;
  pre:=(select format('%s|%s|%s|%s',proowner,proacl,prosecdef,proconfig) from pg_proc where oid=p.signature::regprocedure);
  execute replace(d,p.old_text,p.new_text);
  if pre is distinct from (select format('%s|%s|%s|%s',proowner,proacl,prosecdef,proconfig) from pg_proc where oid=p.signature::regprocedure) then
   raise exception 'Ranap performer: pemilik/ACL/definer/config berubah setelah ditambal: %',p.signature;
  end if;
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
 d:=pg_get_functiondef('public.clinic_read_inpatient_cashier(uuid,uuid)'::regprocedure);
 if position('performers_sealed' in d)=0 or position('SECURITY DEFINER' in d)=0 then
  raise exception 'Ranap performer: definisi pembacaan kasir tidak sesuai setelah ditambal';
 end if;
 d:=pg_get_functiondef('public.guard_service_line_performers()'::regprocedure);
 if position('performer_change_permits' in d)=0 or has_function_privilege('authenticated','public.guard_service_line_performers()','execute') then
  raise exception 'Ranap performer: pelindung atribusi tidak sesuai setelah ditambal';
 end if;
end $check$;
