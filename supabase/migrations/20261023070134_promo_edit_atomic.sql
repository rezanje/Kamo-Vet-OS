-- C01: one atomic configuration edit; stored sale discounts are never rewritten.
create function public.assert_promo_manager() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then
  raise exception 'Hanya owner/manajer aktif yang bisa mengatur promo' using errcode='42501';
 end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN') for share;
 if not found then
  raise exception 'Hanya owner/manajer aktif yang bisa mengatur promo' using errcode='42501';
 end if;
end$$;
revoke all on function public.assert_promo_manager() from public,anon,authenticated,service_role;

-- Private snapshot is built in ONE statement, including the sorted target set.
-- The token detects stale forms, not authorization. No additional row/table needed.
create function public.promo_edit_snapshot(p_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 with snapshot as (
 select jsonb_build_object('id',p.id,'name',p.name,'promo_type',p.promo_type,'rule',p.rule,
 'is_active',p.is_active,'branch_ids',p.branch_ids,'valid_from',p.valid_from,'valid_until',p.valid_until,
 'min_qty',p.min_qty,'max_qty',p.max_qty,'kelipatan',p.kelipatan,'auto_apply',p.auto_apply,
 'discount_type',p.discount_type,'discount_value',p.discount_value) as promo,
 coalesce((select jsonb_agg(i.item_id order by i.item_id) from public.promo_items i where i.promo_id=p.id),'[]'::jsonb) as item_ids
 from public.promos p where p.id=p_id
 ) select jsonb_build_object('promo',promo,'item_ids',item_ids,'version',md5(promo::text||item_ids::text)) from snapshot
$$;
revoke all on function public.promo_edit_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.read_promo_edit(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.assert_promo_manager();
 result:=public.promo_edit_snapshot(p_id);
 if result is null then raise exception 'Promo tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 return result;
end$$;
revoke all on function public.read_promo_edit(uuid) from public,anon,service_role;
grant execute on function public.read_promo_edit(uuid) to authenticated;

-- Existing central-manager policy is enforced at the source as well as in UI.
-- Child writes lock parents in stable order so legacy DML cannot bypass tokens.
create function public.guard_promo_configuration() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb:='{}';new_row jsonb:='{}';parent record;
begin
 if auth.uid() is not null or current_setting('role',true) in('authenticated','anon','service_role') then
  perform public.assert_promo_manager();
 end if;
 if tg_table_name='promo_items' then
  if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
  for parent in select id from public.promos where id in((old_row->>'promo_id')::uuid,(new_row->>'promo_id')::uuid) order by id for update loop
   null;
  end loop;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_promo_configuration() from public,anon,authenticated,service_role;
create trigger promo_configuration_guard before insert or update or delete on public.promos
 for each row execute function public.guard_promo_configuration();
create trigger promo_configuration_guard before insert or update or delete on public.promo_items
 for each row execute function public.guard_promo_configuration();

create function public.edit_promo(p_id uuid,p_expected_version text,p_values jsonb,p_item_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.promos%rowtype;values_row public.promos%rowtype;new_rule jsonb;snapshot jsonb;
 item_ids uuid[];new_branch_ids uuid[];min_subtotal numeric;key text;number_value numeric;
 fields constant text[]:=array['name','promo_type','suggest','min_subtotal','min_qty','max_qty','kelipatan','auto_apply','discount_type','discount_value','branch_ids','valid_from','valid_until'];
begin
 perform public.assert_promo_manager();
 select * into existing from public.promos where id=p_id for update;
 if not found then raise exception 'Promo tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 snapshot:=public.promo_edit_snapshot(p_id);
 if p_expected_version is null or snapshot->>'version' is distinct from p_expected_version then
  raise exception 'PROMO_EDIT_CONFLICT: Promo sudah berubah. Muat ulang data terbaru sebelum mengedit lagi.' using errcode='40001';
 end if;
 if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields
 or exists(select 1 from jsonb_object_keys(p_values) k where k<>all(fields)) then raise exception 'Data edit promo tidak lengkap atau memuat kolom yang tidak diizinkan';end if;
 if jsonb_typeof(p_values->'name')<>'string' or jsonb_typeof(p_values->'suggest')<>'string'
 or length(btrim(p_values->>'name')) not between 1 and 120 or nullif(btrim(p_values->>'suggest'),'') is null then raise exception 'Nama (maks. 120 karakter) & teks saran wajib diisi';end if;
 if p_values->>'promo_type' not in('diskon_produk','bundling','tebus_murah') or p_values->>'promo_type' is null then raise exception 'Tipe promo tidak valid';end if;
 if p_values->>'discount_type' is not null and p_values->>'discount_type' not in('percent','nominal') then raise exception 'Jenis diskon tidak valid';end if;
 if jsonb_typeof(p_values->'kelipatan')<>'boolean' or jsonb_typeof(p_values->'auto_apply')<>'boolean' then raise exception 'Aturan otomatis/kelipatan tidak valid';end if;
 foreach key in array array['min_qty','max_qty','discount_value','min_subtotal'] loop
  if jsonb_typeof(p_values->key) not in('null','number') then raise exception 'Angka promo tidak valid';end if;
  number_value:=(p_values->>key)::numeric;
  if number_value::text in('NaN','Infinity','-Infinity') then raise exception 'Angka promo tidak valid';end if;
 end loop;
 values_row:=jsonb_populate_record(null::public.promos,p_values-array['suggest','min_subtotal']);
 min_subtotal:=(p_values->>'min_subtotal')::numeric;
 if min_subtotal<0 then raise exception 'Min. subtotal tidak boleh negatif';end if;
 if values_row.discount_type is not null and (values_row.discount_value is null or values_row.discount_value<=0) then raise exception 'Nilai diskon harus lebih dari 0';end if;
 if values_row.discount_type='percent' and values_row.discount_value>100 then raise exception 'Diskon persen tidak boleh lebih dari 100%%';end if;
 if values_row.min_qty<=0 then raise exception 'Min. qty harus lebih dari 0';end if;
 if values_row.max_qty<=0 then raise exception 'Maks. qty harus lebih dari 0';end if;
 if values_row.max_qty<values_row.min_qty then raise exception 'Maks. qty tidak boleh lebih kecil dari min. qty';end if;
 if values_row.valid_until<values_row.valid_from then raise exception 'Tanggal berakhir lebih awal dari tanggal mulai';end if;
 if values_row.auto_apply and (values_row.discount_type is null or values_row.discount_value is null) then raise exception 'Potong otomatis butuh jenis & nilai diskon terisi';end if;
 if values_row.auto_apply and values_row.kelipatan and values_row.min_qty is null then raise exception 'Aturan kelipatan butuh min. qty terisi';end if;
 if p_item_ids is null or array_position(p_item_ids,null) is not null then raise exception 'Daftar barang promo tidak valid';end if;
 select coalesce(array_agg(distinct id order by id),'{}') into item_ids from unnest(p_item_ids) id;
 if jsonb_typeof(p_values->'branch_ids') not in('array','null') then raise exception 'Daftar cabang promo tidak valid';end if;
 new_branch_ids:=values_row.branch_ids;
 if array_position(new_branch_ids,null) is not null then raise exception 'Daftar cabang promo tidak valid';end if;
 select array_agg(distinct id order by id) into new_branch_ids from unnest(new_branch_ids) id;
 -- An unchanged legacy/inactive target can be retained. Only NEW targets must be active.
 -- Lock referenced catalog rows through commit against concurrent archive/delete.
 perform id from public.items where id=any(item_ids) order by id for share;
 if exists(select 1 from unnest(item_ids) candidate(id) where not exists(select 1 from public.promo_items where promo_id=p_id and item_id=candidate.id)
 and not exists(select 1 from public.items i where i.id=candidate.id and i.is_active)) then raise exception 'Barang baru harus tersedia dan aktif; target lama tidak dihapus otomatis';end if;
 perform id from public.branches where id=any(new_branch_ids) order by id for share;
 if exists(select 1 from unnest(new_branch_ids) candidate(id) where not(candidate.id=any(coalesce(existing.branch_ids,'{}')))
 and not exists(select 1 from public.branches b where b.id=candidate.id and b.is_active and public.user_can_access_branch(b.id))) then raise exception 'Cabang baru harus tersedia dan aktif; target lama tidak dihapus otomatis';end if;
 new_rule:=coalesce(existing.rule,'{}')-'suggest'-'min_subtotal';
 new_rule:=new_rule||jsonb_build_object('suggest',btrim(p_values->>'suggest'));
 if min_subtotal is not null then new_rule:=new_rule||jsonb_build_object('min_subtotal',min_subtotal);end if;
 update public.promos set name=btrim(values_row.name),promo_type=values_row.promo_type,rule=new_rule,
 min_qty=values_row.min_qty,max_qty=values_row.max_qty,kelipatan=values_row.kelipatan,auto_apply=values_row.auto_apply,
 discount_type=values_row.discount_type,discount_value=values_row.discount_value,
 branch_ids=new_branch_ids,valid_from=values_row.valid_from,valid_until=values_row.valid_until where id=p_id;
 delete from public.promo_items where promo_id=p_id and not(item_id=any(item_ids));
 insert into public.promo_items(promo_id,item_id) select p_id,candidate.id from unnest(item_ids) candidate(id) where not exists(select 1 from public.promo_items i where i.promo_id=p_id and i.item_id=candidate.id);
 return public.promo_edit_snapshot(p_id);
end$$;
revoke all on function public.edit_promo(uuid,text,jsonb,uuid[]) from public,anon,service_role;
grant execute on function public.edit_promo(uuid,text,jsonb,uuid[]) to authenticated;

-- Reuse immutable A01 and existing OWNER/ADMIN/global visibility. Strings and
-- arbitrary rule payload remain redacted; safe numeric/boolean before/after only.
update public.activity_log_sources set metadata_only=false,
 value_keys=array['min_qty','max_qty','kelipatan','auto_apply','discount_value','is_active'] where entity='promos';
