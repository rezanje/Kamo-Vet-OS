-- Apply as ONE transaction. Batalkan / Ubah struk kasir tidak lagi wajib dari transaksi kasir yang terakhir
-- bila struk itu tidak memberi hadiah staf apa pun (21 Nov 2026, permintaan Reza, kasus POS-20261120-0008-K821).
--
-- Masalah: reverse_sale_staff_effects mengembalikan snapshot "sebelum" poin/rangkaian/progres misi kasir, jadi
-- hanya aman dari efek terakhir (LIFO). Kasir yang sudah jualan lagi (hampir selalu) membuat Batalkan penjualan
-- dan Ubah transaksi ditolak: "Transaksi staf berikutnya masih aktif".
--
-- Perubahan: bila masih ada efek staf sesudahnya, pembalikan TIDAK berurutan diizinkan hanya kalau struk ini:
--  - tidak memberi poin (ledger_ids kosong, poin sebelum = sesudah),
--  - tidak mengubah rangkaian (streak) aktivitas,
--  - hanya menambah nilai progres misi pada baris progres yang SUDAH ADA sebelumnya, tanpa mengubah
--    status / waktu selesai / waktu klaim, dan status/klaim baris itu sekarang masih sama.
-- Progres dibalik sebagai SELISIH (current_value - kontribusi struk ini). Snapshot efek staf sesudahnya yang
-- masih aktif ikut dikurangi selisih yang sama, supaya pembalikan berurutan mereka nanti tetap persis.
-- Selain itu (struk memberi poin, memulai streak, menyelesaikan misi, atau misi sudah diklaim/selesai sesudahnya)
-- tetap ditolak seperti dulu. Pembalikan berurutan (struk terakhir) tidak berubah sama sekali.

create or replace function public.reverse_sale_staff_effects(p_sale public.sales,p_audit uuid) returns void
language plpgsql security definer set search_path='' as $$
declare effects public.sale_staff_effects%rowtype;r jsonb;actual jsonb;expected jsonb;ledger record;
 after_row jsonb;prog public.staff_quest_progress%rowtype;delta numeric;pid text;
 blocked constant text:='Transaksi staf berikutnya masih aktif. Batalkan dari transaksi terakhir atau rekonsiliasi hadiah staf terlebih dahulu';
begin
 select * into effects from public.sale_staff_effects where sale_id=p_sale.id for update;
 if not found then
  if not p_sale.quest_effects_tracked and p_sale.channel is null and (
   exists(select 1 from public.staff_quest_progress where staff_id=p_sale.cashier_id and period_key in(to_char(p_sale.created_at at time zone 'Asia/Jakarta','YYYY-MM-DD'),to_char(p_sale.created_at at time zone 'Asia/Jakarta','YYYY-MM')))
   or exists(select 1 from public.staff_streaks where staff_id=p_sale.cashier_id and last_active_date>=(p_sale.created_at at time zone 'Asia/Jakarta')::date)
  ) then raise exception 'Hadiah staf transaksi lama belum memiliki rincian sumber. Rekonsiliasi hadiah staf diperlukan';end if;
  return;
 end if;
 if effects.reversed_at is not null then raise exception 'Hadiah staf sudah dibalik';end if;
 perform 1 from public.profiles where id=effects.staff_id for update;
 -- A later no-op effect still depends on the earlier streak initialization.
 if exists(select 1 from public.sale_staff_effects where staff_id=effects.staff_id and reversed_at is null and effect_order>effects.effect_order) then
  -- Out-of-order reversal: only for effects that awarded nothing and only added progress value.
  if cardinality(effects.ledger_ids)>0
   or effects.before_value->'points' is distinct from effects.after_value->'points'
   or effects.before_value->'streak' is distinct from effects.after_value->'streak'
   or jsonb_array_length(coalesce(effects.before_value->'progress','[]'))<>jsonb_array_length(coalesce(effects.after_value->'progress','[]'))
  then raise exception '%',blocked;end if;
  for r in select value from jsonb_array_elements(coalesce(effects.before_value->'progress','[]')) loop
   expected:=r->'row';
   if expected is null or expected='null'::jsonb then raise exception '%',blocked;end if;
   pid:=expected->>'id';
   select a.value into after_row from jsonb_array_elements(effects.after_value->'progress') a where a.value->>'id'=pid;
   if after_row is null or (after_row-'current_value') is distinct from (expected-'current_value') then raise exception '%',blocked;end if;
   delta:=(after_row->>'current_value')::numeric-(expected->>'current_value')::numeric;
   select * into prog from public.staff_quest_progress where id=pid::uuid for update;
   if not found or delta<0 or prog.current_value<delta
    or prog.status is distinct from after_row->>'status'
    or prog.completed_at is distinct from (after_row->>'completed_at')::timestamptz
    or prog.claimed_at is distinct from (after_row->>'claimed_at')::timestamptz
   then raise exception '%',blocked;end if;
   update public.staff_quest_progress set current_value=current_value-delta where id=prog.id;
   -- Keep later active snapshots consistent so their own (ordered) reversal stays exact.
   update public.sale_staff_effects e set
    before_value=jsonb_set(e.before_value,'{progress}',(select coalesce(jsonb_agg(case when x->'row'->>'id'=pid
      then jsonb_set(x,'{row,current_value}',to_jsonb((x->'row'->>'current_value')::numeric-delta)) else x end order by o),'[]'::jsonb)
      from jsonb_array_elements(e.before_value->'progress') with ordinality t(x,o))),
    after_value=jsonb_set(e.after_value,'{progress}',(select coalesce(jsonb_agg(case when x->>'id'=pid
      then jsonb_set(x,'{current_value}',to_jsonb((x->>'current_value')::numeric-delta)) else x end order by o),'[]'::jsonb)
      from jsonb_array_elements(e.after_value->'progress') with ordinality t(x,o)))
   where e.staff_id=effects.staff_id and e.reversed_at is null and e.effect_order>effects.effect_order
    and (e.after_value->'progress') @> jsonb_build_array(jsonb_build_object('id',pid));
  end loop;
  update public.sale_staff_effects set reversed_at=now() where sale_id=p_sale.id;
  return;
 end if;
 select to_jsonb(x) into actual from public.staff_points x where staff_id=effects.staff_id for update;
 if coalesce(actual,'null') is distinct from effects.after_value->'points' then raise exception 'Saldo hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 select to_jsonb(x) into actual from public.staff_streaks x where staff_id=effects.staff_id for update;
 if coalesce(actual,'null') is distinct from effects.after_value->'streak' then raise exception 'Rangkaian aktivitas staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 for r in select value from jsonb_array_elements(effects.after_value->'progress') loop
  select to_jsonb(x) into actual from public.staff_quest_progress x where id=(r->>'id')::uuid for update;
  if actual is distinct from r then raise exception 'Progres atau klaim hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 end loop;
 for r in select value from jsonb_array_elements(effects.before_value->'progress') loop
  expected:=r->'row';
  if expected='null'::jsonb then delete from public.staff_quest_progress where staff_id=effects.staff_id and quest_definition_id=(r->>'quest_id')::uuid and period_key=r->>'period_key';
  else update public.staff_quest_progress set current_value=(expected->>'current_value')::numeric,status=expected->>'status',completed_at=(expected->>'completed_at')::timestamptz,claimed_at=(expected->>'claimed_at')::timestamptz where id=(expected->>'id')::uuid;end if;
 end loop;
 expected:=effects.before_value->'streak';
 if expected='null'::jsonb then delete from public.staff_streaks where staff_id=effects.staff_id;
 else update public.staff_streaks set current_streak_days=(expected->>'current_streak_days')::integer,longest_streak_days=(expected->>'longest_streak_days')::integer,last_active_date=(expected->>'last_active_date')::date,updated_at=(expected->>'updated_at')::timestamptz where staff_id=effects.staff_id;end if;
 expected:=effects.before_value->'points';
 if expected='null'::jsonb then delete from public.staff_points where staff_id=effects.staff_id;
 else update public.staff_points set total_points=(expected->>'total_points')::integer,updated_at=(expected->>'updated_at')::timestamptz where staff_id=effects.staff_id;end if;
 for ledger in select * from public.staff_points_ledger where id=any(effects.ledger_ids) order by id for share loop
  insert into public.staff_points_ledger(staff_id,points_delta,source_type,source_id,branch_id,notes)
   values(ledger.staff_id,-ledger.points_delta,ledger.source_type,p_audit,ledger.branch_id,'Pembatalan penjualan '||p_sale.no_struk);
 end loop;
 update public.sale_staff_effects set reversed_at=now() where sale_id=p_sale.id;
end $$;
revoke all on function public.reverse_sale_staff_effects(public.sales,uuid) from public,anon,authenticated,service_role;
