-- K07: bukti penyerahan & pemberian obat biasa PER RESEP (relasi kanonis prescription_items.id).
--
-- Batas sengaja:
--  * Hanya obat biasa (prescription_items.jenis='obat' tanpa compound_recipe_id). Racikan tetap memakai
--    status farmasi; dosis berprotokol tetap di inpatient_med_doses (Obat Khusus). Tidak digabung.
--  * Append-only. Koreksi = pembatalan berjejak (waktu, akun, nama, alasan). Tidak ada DELETE.
--  * Tidak menyentuh stok, jurnal, faktur, DP, atau durasi rawat inap terbayar.
--  * Aturan input klinis yang bisa berbeda per cabang ada di inpatient_rx_evidence_settings.
--    Tanpa baris pengaturan, dua jenis bukti tetap independen. Tanggal yang dimundurkan
--    memerlukan pengaturan cabang tersendiri. Tidak ada aturan dosis yang dikarang.

create table public.inpatient_rx_evidence_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  administration_requires_handover boolean not null default false,
  max_backdate_minutes integer not null default 0 check (max_backdate_minutes between 0 and 1440),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.inpatient_rx_evidence_settings enable row level security;
create policy inpatient_rx_evidence_settings_read on public.inpatient_rx_evidence_settings
  for select to authenticated using (public.user_can_access_branch(branch_id));
-- No write policy: settings change only through a reviewed migration/admin process.
revoke insert, update, delete, truncate on public.inpatient_rx_evidence_settings from anon, authenticated, service_role;

create table public.inpatient_rx_evidence (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid not null references public.inpatient_records(id) on delete restrict,
  prescription_item_id uuid not null references public.prescription_items(id) on delete restrict,
  visit_id uuid not null references public.visits(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  kind text not null check (kind in ('handover','administration')),
  qty numeric(12,3) not null check (qty > 0 and qty <> 'NaN'::numeric),
  unit text,
  occurred_at timestamptz not null,
  note text check (note is null or length(note) <= 1000),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_by_name text,
  request_key text not null check (length(request_key) between 8 and 100),
  request_hash text not null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_by_name text,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint inpatient_rx_evidence_request_unique unique (request_key),
  constraint inpatient_rx_evidence_void_complete check (
    (voided_at is null and voided_by is null and voided_by_name is null and void_reason is null)
    or (voided_at is not null and void_reason is not null and length(btrim(void_reason)) between 3 and 500)
  )
);
create index inpatient_rx_evidence_rx_idx on public.inpatient_rx_evidence(prescription_item_id);
create index inpatient_rx_evidence_record_idx on public.inpatient_rx_evidence(inpatient_record_id);

alter table public.inpatient_rx_evidence enable row level security;
create policy inpatient_rx_evidence_read on public.inpatient_rx_evidence
  for select to authenticated using (public.user_can_access_branch(branch_id));
-- No insert/update/delete policy: writes go only through the two RPCs below.
revoke insert, update, delete, truncate on public.inpatient_rx_evidence from anon, authenticated, service_role;

-- Relation and immutability invariants hold for every write path, not only the RPCs.
create function public.guard_inpatient_rx_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_rec public.inpatient_records%rowtype;v_visit uuid;v_jenis text;v_compound uuid;
  v_fixed text[]:=array['voided_at','voided_by','voided_by_name','void_reason','recorded_by'];
begin
  if tg_op='DELETE' then
    raise exception 'RX_EVIDENCE_LOCKED: bukti tidak dapat dihapus; batalkan dengan alasan';
  end if;
  if tg_op='UPDATE' then
    -- FK "on delete set null" may clear an account reference; nothing else besides the one-time void may change.
    if (to_jsonb(new)-v_fixed) is distinct from (to_jsonb(old)-v_fixed)
      or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null) then
      raise exception 'RX_EVIDENCE_LOCKED: isi bukti tidak dapat diubah';
    end if;
    if old.voided_at is not null and (new.voided_at is distinct from old.voided_at
      or new.void_reason is distinct from old.void_reason or new.voided_by_name is distinct from old.voided_by_name
      or (new.voided_by is distinct from old.voided_by and new.voided_by is not null)) then
      raise exception 'RX_EVIDENCE_LOCKED: pembatalan tidak dapat diubah atau dicabut';
    end if;
    return new;
  end if;
  select * into v_rec from public.inpatient_records where id=new.inpatient_record_id;
  select m.visit_id,p.jenis,p.compound_recipe_id into v_visit,v_jenis,v_compound
    from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id
    where p.id=new.prescription_item_id;
  if v_rec.id is null or v_visit is null or v_visit<>v_rec.visit_id
    or new.visit_id<>v_rec.visit_id or new.branch_id<>v_rec.branch_id
    or not exists(select 1 from public.visits v where v.id=v_rec.visit_id and v.branch_id=v_rec.branch_id) then
    raise exception 'RX_EVIDENCE_INVALID: resep bukan milik kunjungan dan cabang rawat inap ini';
  end if;
  if v_jenis is distinct from 'obat' or v_compound is not null then
    raise exception 'RX_EVIDENCE_INVALID: bukti per resep hanya untuk obat biasa, bukan racikan atau jasa';
  end if;
  if new.voided_at is not null then
    raise exception 'RX_EVIDENCE_INVALID: bukti baru tidak boleh langsung berstatus batal';
  end if;
  return new;
end $$;
create trigger inpatient_rx_evidence_guard before insert or update or delete on public.inpatient_rx_evidence
  for each row execute function public.guard_inpatient_rx_evidence();

-- A recorded dose must never silently become evidence for another drug, quantity,
-- unit or visit. The FK protects deletion, while these guards protect source edits.
create function public.protect_rx_evidence_prescription() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.inpatient_rx_evidence e where e.prescription_item_id=old.id) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op='DELETE' or new.medical_record_id is distinct from old.medical_record_id
    or new.item_id is distinct from old.item_id
    or new.nama_obat is distinct from old.nama_obat
    or new.qty is distinct from old.qty
    or new.satuan is distinct from old.satuan
    or new.faktor is distinct from old.faktor
    or new.jenis is distinct from old.jenis
    or new.compound_recipe_id is distinct from old.compound_recipe_id
    or new.aturan_pakai is distinct from old.aturan_pakai then
    raise exception 'RX_EVIDENCE_LOCKED: sumber resep dengan bukti pemberian tidak dapat diubah';
  end if;
  return new;
end $$;
create trigger protect_rx_evidence_prescription before update or delete on public.prescription_items
  for each row execute function public.protect_rx_evidence_prescription();

create function public.protect_rx_evidence_medical_record() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or new.visit_id is distinct from old.visit_id then
    if exists (
      select 1 from public.prescription_items p
      join public.inpatient_rx_evidence e on e.prescription_item_id=p.id
      where p.medical_record_id=old.id
    ) then
      raise exception 'RX_EVIDENCE_LOCKED: kunjungan rekam medis dengan bukti pemberian tidak dapat dipindah';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_rx_evidence_medical_record before update or delete on public.medical_records
  for each row execute function public.protect_rx_evidence_medical_record();
create function public.protect_rx_evidence_stay() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.inpatient_rx_evidence e where e.inpatient_record_id=old.id)
    and (tg_op='DELETE' or new.visit_id is distinct from old.visit_id
      or new.branch_id is distinct from old.branch_id
      or new.medical_record_id is distinct from old.medical_record_id
      or new.admitted_at is distinct from old.admitted_at) then
    raise exception 'RX_EVIDENCE_LOCKED: sumber rawat inap dengan bukti obat tidak dapat dipindah';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aa_protect_rx_evidence_stay before update or delete on public.inpatient_records
  for each row execute function public.protect_rx_evidence_stay();
create function public.protect_rx_evidence_visit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.inpatient_rx_evidence e where e.visit_id=old.id)
    and (tg_op='DELETE' or new.branch_id is distinct from old.branch_id
      or new.customer_id is distinct from old.customer_id
      or new.pet_id is distinct from old.pet_id) then
    raise exception 'RX_EVIDENCE_LOCKED: pasien atau cabang kunjungan dengan bukti obat tidak dapat dipindah';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aa_protect_rx_evidence_visit before update or delete on public.visits
  for each row execute function public.protect_rx_evidence_visit();
revoke all on function public.protect_rx_evidence_prescription(),
  public.protect_rx_evidence_medical_record(), public.protect_rx_evidence_stay(),
  public.protect_rx_evidence_visit() from public,anon,authenticated,service_role;

create function public.clinic_record_rx_evidence(
  p_inpatient_record_id uuid,p_prescription_item_id uuid,p_kind text,p_qty numeric,
  p_occurred_at timestamptz,p_note text,p_request_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_rec public.inpatient_records%rowtype;v_rx public.prescription_items%rowtype;v_visit uuid;
  v_key text:=nullif(btrim(p_request_key),'');v_note text:=nullif(btrim(p_note),'');v_hash text;
  v_existing public.inpatient_rx_evidence%rowtype;v_requires boolean;v_backdate integer;v_at timestamptz;
  v_handed numeric;v_given numeric;v_name text;v_id uuid;
begin
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and is_active
  ) then raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  if v_key is null or length(v_key) not between 8 and 100 then
    raise exception 'RX_EVIDENCE_INVALID: muat ulang formulir bukti obat';end if;
  if p_kind is null or p_kind not in ('handover','administration') then
    raise exception 'RX_EVIDENCE_INVALID: pilih jenis bukti penyerahan atau pemberian';end if;
  if p_qty is null or p_qty='NaN'::numeric or p_qty<=0 or p_qty>999999999 or p_qty<>round(p_qty,3) then
    raise exception 'RX_EVIDENCE_INVALID: jumlah harus lebih dari nol dengan maksimal tiga desimal';end if;
  if v_note is not null and length(v_note)>1000 then
    raise exception 'RX_EVIDENCE_INVALID: catatan maksimal 1000 karakter';end if;

  -- One lock per inpatient record serializes every evidence write and void for that patient.
  select * into v_rec from public.inpatient_records where id=p_inpatient_record_id for update;
  if not found or not public.user_can_access_branch(v_rec.branch_id)
    or not public.clinic_record_correction_actor(v_rec.visit_id) then
    raise exception 'ACCESS_DENIED: rawat inap atau cabang tidak dapat diakses';end if;
  perform 1 from public.visits where id=v_rec.visit_id and branch_id=v_rec.branch_id for share;
  if not found then
    raise exception 'RX_EVIDENCE_INVALID: cabang rawat inap berbeda dari kunjungan';end if;

  v_hash:=md5(jsonb_build_object('record',p_inpatient_record_id,'rx',p_prescription_item_id,'kind',p_kind,
    'qty',p_qty::text,'at',p_occurred_at,'note',v_note,'actor',auth.uid())::text);
  select * into v_existing from public.inpatient_rx_evidence where request_key=v_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: formulir bukti obat sudah dipakai untuk data berbeda; muat ulang halaman';
    end if;
    return v_existing.id;
  end if;

  if v_rec.discharged_at is not null then
    raise exception 'RX_EVIDENCE_INVALID: rawat inap sudah ditutup; bukti baru tidak dapat dicatat';end if;
  select * into v_rx from public.prescription_items where id=p_prescription_item_id for update;
  select m.visit_id into v_visit from public.medical_records m where m.id=v_rx.medical_record_id for share;
  if v_rx.id is null or v_visit is distinct from v_rec.visit_id then
    raise exception 'RX_EVIDENCE_INVALID: resep bukan milik kunjungan rawat inap ini';end if;
  if v_rx.jenis is distinct from 'obat' or v_rx.compound_recipe_id is not null then
    raise exception 'RX_EVIDENCE_INVALID: bukti per resep hanya untuk obat biasa, bukan racikan atau jasa';end if;
  if v_rx.qty is null or v_rx.qty<=0 then
    raise exception 'RX_EVIDENCE_INVALID: jumlah resep tidak valid';end if;

  select administration_requires_handover,max_backdate_minutes into v_requires,v_backdate
    from public.inpatient_rx_evidence_settings where branch_id=v_rec.branch_id;
  v_requires:=coalesce(v_requires,false);v_backdate:=coalesce(v_backdate,0);
  v_at:=coalesce(p_occurred_at,now());
  if v_at>now()+interval '1 minute' or v_at<now()-make_interval(mins=>v_backdate)-interval '1 minute'
    or v_at<v_rec.admitted_at then
    raise exception 'RX_EVIDENCE_INVALID: waktu bukti di luar batas yang diizinkan cabang';end if;

  select coalesce(sum(qty) filter (where kind='handover'),0),coalesce(sum(qty) filter (where kind='administration'),0)
    into v_handed,v_given from public.inpatient_rx_evidence
    where prescription_item_id=v_rx.id and voided_at is null;
  if p_kind='handover' and v_handed+p_qty>v_rx.qty then
    raise exception 'RX_EVIDENCE_INVALID: jumlah diserahkan melebihi jumlah resep';end if;
  if p_kind='administration' and v_given+p_qty>v_rx.qty then
    raise exception 'RX_EVIDENCE_INVALID: jumlah diberikan melebihi jumlah resep';end if;
  if p_kind='administration' and v_requires and v_given+p_qty>v_handed then
    raise exception 'RX_EVIDENCE_INVALID: jumlah diberikan melebihi jumlah yang sudah diserahkan';end if;

  select full_name into v_name from public.profiles where id=auth.uid();
  insert into public.inpatient_rx_evidence(inpatient_record_id,prescription_item_id,visit_id,branch_id,kind,qty,unit,
    occurred_at,note,recorded_by,recorded_by_name,request_key,request_hash)
  values(v_rec.id,v_rx.id,v_rec.visit_id,v_rec.branch_id,p_kind,p_qty,v_rx.satuan,
    v_at,v_note,auth.uid(),v_name,v_key,v_hash)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.clinic_record_rx_evidence(uuid,uuid,text,numeric,timestamptz,text,text) from public,anon,service_role;
grant execute on function public.clinic_record_rx_evidence(uuid,uuid,text,numeric,timestamptz,text,text) to authenticated;

create function public.clinic_void_rx_evidence(p_evidence_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_record uuid;v_rec public.inpatient_records%rowtype;v_ev public.inpatient_rx_evidence%rowtype;
  v_reason text:=nullif(btrim(p_reason),'');v_requires boolean;v_handed numeric;v_given numeric;v_name text;
begin
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and is_active
  ) then raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';end if;
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'RX_EVIDENCE_INVALID: isi alasan pembatalan (3 sampai 500 karakter)';end if;
  select inpatient_record_id into v_record from public.inpatient_rx_evidence where id=p_evidence_id;
  -- Same lock order as clinic_record_rx_evidence: inpatient record first, then the evidence row.
  select * into v_rec from public.inpatient_records where id=v_record for update;
  if not found or not public.user_can_access_branch(v_rec.branch_id)
    or not public.clinic_record_correction_actor(v_rec.visit_id) then
    raise exception 'ACCESS_DENIED: bukti atau cabang tidak dapat diakses';end if;
  select * into v_ev from public.inpatient_rx_evidence where id=p_evidence_id for update;
  if v_ev.branch_id is distinct from v_rec.branch_id then
    raise exception 'ACCESS_DENIED: bukti atau cabang tidak dapat diakses';end if;
  if v_ev.voided_at is not null then
    if v_ev.voided_by is distinct from auth.uid() or v_ev.void_reason is distinct from v_reason then
      raise exception 'IDEMPOTENCY_CONFLICT: bukti sudah dibatalkan dengan alasan atau pengguna berbeda';
    end if;
    return true;
  end if;
  if v_rec.discharged_at is not null then
    raise exception 'RX_EVIDENCE_INVALID: rawat inap sudah ditutup; pembatalan tidak dapat dicatat';end if;
  if v_ev.kind='handover' then
    select administration_requires_handover into v_requires
      from public.inpatient_rx_evidence_settings where branch_id=v_rec.branch_id;
    v_requires:=coalesce(v_requires,false);
    select coalesce(sum(qty) filter (where kind='handover'),0),coalesce(sum(qty) filter (where kind='administration'),0)
      into v_handed,v_given from public.inpatient_rx_evidence
      where prescription_item_id=v_ev.prescription_item_id and voided_at is null;
    if v_requires and v_given>v_handed-v_ev.qty then
      raise exception 'RX_EVIDENCE_INVALID: batalkan catatan pemberian terlebih dahulu; pemberian akan melebihi penyerahan';
    end if;
  end if;
  select full_name into v_name from public.profiles where id=auth.uid();
  update public.inpatient_rx_evidence set voided_at=now(),voided_by=auth.uid(),voided_by_name=v_name,void_reason=v_reason
    where id=v_ev.id;
  return true;
end $$;
revoke all on function public.clinic_void_rx_evidence(uuid,text) from public,anon,service_role;
grant execute on function public.clinic_void_rx_evidence(uuid,text) to authenticated;
