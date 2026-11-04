-- "Tarik item": audited soft-withdraw of SAVED, NOT-YET-BILLED cart rows of an outpatient medical record
-- (Andri 4 Nov 2026: two "Obat Tetes Kutu" rows saved, only one used).
-- TWO markers with two meanings, both stamped by the one RPC:
--   billing_withdrawn_at/by/reason (rawat-inap pattern 20261104130000) = "NOT BILLED". Every money engine (pending rows, cart
--     version, inpatient quote, invoice-line guard) already keys on it, so a Tarik row can never be billed. Its meaning is
--     NOT changed: the rawat-inap cashier 'Hapus item' keeps stamping only these columns.
--   record_withdrawn_at (NEW, nullable, no default = metadata-only ADD COLUMN) = "withdrawn from the MEDICAL RECORD". Clinical
--     views (record page, prints, patient clinical history, rawat-inap handoff) hide a row ONLY on this marker, so rows the
--     rawat-inap cashier removed from the bill stay in the clinical record exactly as before (review blocker: keying the
--     views on billing_withdrawn_at hid ranap rows retroactively).
-- Invariant (trigger): record_withdrawn_at is set only by this RPC, never without billing_withdrawn_at, never cleared.
-- No DELETE, no stock, money or journal writes (stock/BMHP/HPP post at billing, never at save). Racikan stay locked.
-- Gate = clinic_edit_queued_record's gate (OWNER/DOCTOR + klinik branch access + no invoice at all, void included).
-- Lock order = clinic_edit_queued_record / clinic_post_invoice_with_record:
--   billing coordinator -> visits FOR UPDATE -> medical_records FOR UPDATE -> prescription_items FOR UPDATE (by id).
-- Re-runnable: add column if not exists, create or replace, drop/create trigger, patches skip when already applied;
-- every patch still fails closed when the live function drifted from the expected text.

alter table public.prescription_items add column if not exists record_withdrawn_at timestamptz;

create or replace function public.guard_record_withdrawn_marker()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') and
  ((tg_op='INSERT' and new.record_withdrawn_at is not null) or (tg_op='UPDATE' and new.record_withdrawn_at is distinct from old.record_withdrawn_at)) then
  raise exception 'ACCESS_DENIED: penarikan item rekam medis hanya lewat Tarik item berjejak' using errcode='42501';
 end if;
 if new.record_withdrawn_at is not null and new.billing_withdrawn_at is null then
  raise exception 'RECORD_WITHDRAWN_INVALID: baris yang ditarik dari rekam medis wajib juga tidak dapat ditagih';
 end if;
 if tg_op='UPDATE' and old.record_withdrawn_at is not null and (new.record_withdrawn_at is distinct from old.record_withdrawn_at or new.billing_withdrawn_at is distinct from old.billing_withdrawn_at) then
  raise exception 'RECORD_WITHDRAWN_INVALID: penarikan item rekam medis tidak dapat dibatalkan';
 end if;
 return new;
end$$;
revoke all on function public.guard_record_withdrawn_marker()from public,anon,authenticated,service_role;
drop trigger if exists aa_record_withdrawn_marker on public.prescription_items;
create trigger aa_record_withdrawn_marker before insert or update of record_withdrawn_at,billing_withdrawn_at on public.prescription_items
 for each row execute function public.guard_record_withdrawn_marker();

create or replace function public.clinic_withdraw_record_items(
 p_visit_id uuid,p_record_id uuid,p_item_ids uuid[],p_reason text,p_request_key text
)returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 v_reason text:=btrim(coalesce(p_reason,''));v_key text:=nullif(btrim(p_request_key),'');v_ids uuid[];v_hash text;
 prev public.clinic_full_record_edits%rowtype;v_before jsonb;v_after jsonb;v_visit public.visits%rowtype;
 v_found integer;rx public.prescription_items%rowtype;v_audit uuid;v_name text;v_now timestamptz:=clock_timestamp();
begin
 perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','DOCTOR'))
  or not public.clinic_record_correction_actor(p_visit_id) then
  raise exception 'ACCESS_DENIED: hanya owner atau dokter dapat menarik item rekam medis' using errcode='42501';
 end if;
 select * into v_visit from public.visits where id=p_visit_id for update;
 perform 1 from public.medical_records where id=p_record_id and visit_id=p_visit_id for update;
 if v_visit.id is null or not found then raise exception 'ACCESS_DENIED: rekam medis tidak sesuai' using errcode='42501';end if;
 if v_key is null or length(v_key)>100 or p_item_ids is null or cardinality(p_item_ids)=0 or cardinality(p_item_ids)>50
  or array_position(p_item_ids,null) is not null then
  raise exception 'WITHDRAW_INVALID: data penarikan tidak valid';
 end if;
 select array_agg(distinct x order by x) into v_ids from unnest(p_item_ids) x;
 if cardinality(v_ids)<>cardinality(p_item_ids) then raise exception 'WITHDRAW_INVALID: baris ganda dalam penarikan';end if;
 if length(v_reason) not between 5 and 200 then raise exception 'WITHDRAW_INVALID: alasan penarikan wajib 5-200 karakter';end if;
 -- At least 5 SIGNIFICANT characters: spaces, punctuation, control and zero-width/invisible characters do not count.
 if length(regexp_replace(v_reason,'[[:space:][:punct:][:cntrl:]\u00a0\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180e\u2000-\u200f\u2010-\u2027\u2028-\u202f\u2030-\u205e\u205f-\u206f\u3000-\u3003\u3008-\u3011\u3164\ufe00-\ufe0f\ufeff\uff01-\uff0f\uffa0]','','g'))<5 then
  raise exception 'WITHDRAW_INVALID: alasan penarikan wajib berisi minimal 5 huruf/angka (bukan hanya spasi atau tanda baca)';
 end if;
 v_hash:=md5(jsonb_build_array('tarik-item',p_visit_id,p_record_id,v_ids,v_reason)::text);
 select * into prev from public.clinic_full_record_edits where created_by=auth.uid() and request_key=v_key;
 if found then
  if prev.request_hash is distinct from v_hash or prev.medical_record_id<>p_record_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('record_id',p_record_id,'withdrawn',to_jsonb(v_ids),'audit_id',prev.id);
 end if;
 if v_visit.archived_at is not null then raise exception 'WITHDRAW_REFUSED: kunjungan sudah diarsipkan';end if;
 if exists(select 1 from public.invoices i where i.visit_id=p_visit_id) then
  raise exception 'RECORD_POSTED: tagihan sudah terbit (termasuk yang dibatalkan); gunakan koreksi tagihan di Pembayaran';
 end if;
 if exists(select 1 from public.inpatient_records s where s.visit_id=p_visit_id) then
  raise exception 'WITHDRAW_REFUSED: kunjungan rawat inap ditarik lewat kasir rawat inap';
 end if;
 if not public.clinic_can_correct_record(p_record_id) then raise exception 'RECORD_POSTED: kunjungan sudah berubah atau memiliki invoice';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into v_before from public.prescription_items p where p.medical_record_id=p_record_id;
 select count(*) into v_found from(select 1 from public.prescription_items where id=any(v_ids) and medical_record_id=p_record_id order by id for update)l;
 if v_found<>cardinality(v_ids) then raise exception 'WITHDRAW_INVALID: resep bukan milik rekam medis ini';end if;
 for rx in select * from public.prescription_items where id=any(v_ids) order by id loop
  if rx.billing_withdrawn_at is not null then raise exception 'WITHDRAW_ALREADY: % sudah ditarik sebelumnya',rx.nama_obat;end if;
  if rx.compound_recipe_id is not null or rx.jenis='racikan' or rx.satuan='racikan' then
   raise exception 'COMPOUND_LOCKED: % adalah racikan (stok bahan sudah keluar); gunakan Aksi → Ubah komposisi / koreksi racikan',rx.nama_obat;
  end if;
  if exists(select 1 from public.invoice_items l where l.prescription_item_id=rx.id) then
   raise exception 'WITHDRAW_BILLED: % sudah tertaut ke tagihan',rx.nama_obat;
  end if;
  if rx.package_item_id is not null and exists(select 1 from public.prescription_items o join public.medical_records m on m.id=o.medical_record_id
    where m.visit_id=p_visit_id and o.package_item_id=rx.package_item_id and o.billing_withdrawn_at is null and not(o.id=any(v_ids))) then
   select name into v_name from public.items where id=rx.package_item_id;
   raise exception 'PACKAGE_PARTIAL: paket % hanya dapat ditarik utuh (semua isinya sekaligus)',coalesce(v_name,'');
  end if;
 end loop;
 update public.prescription_items set billing_withdrawn_at=v_now,billing_withdrawn_by=auth.uid(),billing_withdrawal_reason=v_reason,record_withdrawn_at=v_now
 where id=any(v_ids);
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into v_after from public.prescription_items p where p.medical_record_id=p_record_id;
 insert into public.clinic_full_record_edits(medical_record_id,created_by,request_key,request_hash,reason,before_rows,after_rows)
 values(p_record_id,auth.uid(),v_key,v_hash,'Tarik item: '||v_reason,v_before,v_after) returning id into v_audit;
 return jsonb_build_object('record_id',p_record_id,'withdrawn',to_jsonb(v_ids),'audit_id',v_audit);
end$$;
revoke all on function public.clinic_withdraw_record_items(uuid,uuid,uuid[],text,text)from public,anon,authenticated,service_role;
grant execute on function public.clinic_withdraw_record_items(uuid,uuid,uuid[],text,text)to authenticated;

-- Transparent history: who withdrew what and why (names resolved server side).
create or replace function public.clinic_record_withdrawn_items(p_record_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_visit uuid;
begin
 select m.visit_id into v_visit from public.medical_records m where m.id=p_record_id;
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or v_visit is null
  or not exists(select 1 from public.profiles where id=auth.uid() and is_active) or not public.clinic_record_correction_actor(v_visit) then
  raise exception 'ACCESS_DENIED: rekam medis tidak dapat dibaca' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nama_obat',p.nama_obat,'qty',p.qty,'satuan',p.satuan,'jenis',p.jenis,
   'package_item_id',p.package_item_id,'package_name',g.name,'withdrawn_at',p.record_withdrawn_at,'withdrawn_by',p.billing_withdrawn_by,
   'withdrawn_by_name',pr.full_name,'reason',p.billing_withdrawal_reason) order by p.record_withdrawn_at,p.id)
  from public.prescription_items p left join public.profiles pr on pr.id=p.billing_withdrawn_by left join public.items g on g.id=p.package_item_id
  where p.medical_record_id=p_record_id and p.record_withdrawn_at is not null and p.compound_recipe_id is null),'[]'::jsonb);
end$$;
revoke all on function public.clinic_record_withdrawn_items(uuid)from public,anon,authenticated,service_role;
grant execute on function public.clinic_record_withdrawn_items(uuid)to authenticated;

-- Readers/writers patched with exact counted anchors. Each patch is applied once, skipped when its new text is already
-- present (re-run), and FAILS CLOSED when neither the old nor the new text is found exactly once (drift).
do $patch$
declare p record;d text;n_old integer;n_new integer;
begin
 for p in select * from(values
  ('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)',
   E'if not found then raise exception ''RECORD_INVALID: resep asing'';end if;',
   E'if not found then raise exception ''RECORD_INVALID: resep asing'';end if;\n   if rx.record_withdrawn_at is not null then raise exception ''RECORD_INVALID: baris sudah ditarik dari rekam medis; muat ulang halaman'';end if;'),
  ('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)',
   'where medical_record_id=p_record_id and not(id=any(v_seen))',
   'where medical_record_id=p_record_id and record_withdrawn_at is null and not(id=any(v_seen))'),
  ('public.clinic_patient_clinical_history(uuid,uuid)',
   'from public.prescription_items pi where pi.medical_record_id = m.id)',
   'from public.prescription_items pi where pi.medical_record_id = m.id and pi.record_withdrawn_at is null)')
 )as t(signature,old_text,new_text)loop
  d:=pg_get_functiondef(p.signature::regprocedure);
  n_old:=(length(d)-length(replace(d,p.old_text,'')))/length(p.old_text);
  n_new:=(length(d)-length(replace(d,p.new_text,'')))/length(p.new_text);
  if n_new=1 then continue;
  elsif n_new=0 and n_old=1 then execute replace(d,p.old_text,p.new_text);
  else raise exception 'Tarik item anchor drift: % / %',p.signature,p.old_text;
  end if;
 end loop;
end $patch$;
